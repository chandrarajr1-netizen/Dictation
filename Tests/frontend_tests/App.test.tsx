/**
 * Frontend tests for App.tsx.
 *
 * The browser's microphone (getUserMedia), MediaRecorder and fetch are replaced
 * with fakes, so no real microphone or backend is needed.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from '../../FrontEnd/src/App'

const API_URL = 'http://localhost:8000/api/transcribe'

const MICS = [
  { kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in Microphone' },
  { kind: 'audioinput', deviceId: 'mic-2', label: 'USB Headset' },
]

// Fake MediaRecorder: stop() emits one chunk of "audio", then fires onstop.
class FakeMediaRecorder {
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(['fake audio'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

const fakeStream = () => ({ getTracks: () => [{ stop: vi.fn() }] })
const getUserMedia = vi.fn()
const fetchMock = vi.fn()

function jsonResponse(body: object, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

beforeEach(() => {
  getUserMedia.mockReset().mockImplementation(() => Promise.resolve(fakeStream()))
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices: () => Promise.resolve(MICS) },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Render the app and wait until the microphone list has loaded.
async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('option', { name: 'Built-in Microphone' })
  return user
}

// Click Start, then Stop, so a recording is sent to the backend.
async function recordOnce(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /start/i }))
  await user.click(screen.getByRole('button', { name: 'Stop' }))
}

const textBox = () => screen.getByRole('textbox') as HTMLTextAreaElement

test('lists the microphones in the dropdown', async () => {
  await renderApp()

  const options = screen.getAllByRole('option').map((o) => o.textContent)
  expect(options).toEqual(['Built-in Microphone', 'USB Headset'])
})

test('records from the selected microphone', async () => {
  const user = await renderApp()

  await user.selectOptions(screen.getByRole('combobox'), 'mic-2')
  await user.click(screen.getByRole('button', { name: /start/i }))

  expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'mic-2' } } })
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
})

test('sends the recording to the backend as "audio"', async () => {
  fetchMock.mockReturnValue(jsonResponse({ raw_text: 'um hi', cleaned_text: 'Hi.', error: null }))
  const user = await renderApp()

  await recordOnce(user)

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const [url, options] = fetchMock.mock.calls[0]
  expect(url).toBe(API_URL)
  expect(options.method).toBe('POST')
  expect((options.body as FormData).get('audio')).toBeInstanceOf(Blob)
})

test('shows a transcribing state with a loading wheel while waiting', async () => {
  let respond!: (r: Response) => void
  fetchMock.mockReturnValue(new Promise<Response>((resolve) => (respond = resolve)))
  const user = await renderApp()

  await recordOnce(user)

  const button = await screen.findByRole('button', { name: /transcribing/i })
  expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(button.querySelector('.spinner')).not.toBeNull()
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)

  respond(new Response(JSON.stringify({ raw_text: 'um hi', cleaned_text: 'Hi.', error: null })))
  await screen.findByRole('button', { name: /start/i })
})

test('shows the cleaned text, and the toggle switches to the Whisper text', async () => {
  fetchMock.mockReturnValue(jsonResponse({ raw_text: 'um so hi', cleaned_text: 'So hi.', error: null }))
  const user = await renderApp()

  await recordOnce(user)

  await waitFor(() => expect(textBox().value).toBe('So hi.'))
  await user.click(screen.getByRole('button', { name: 'Raw (Whisper)' }))
  expect(textBox().value).toBe('um so hi')
  await user.click(screen.getByRole('button', { name: 'Cleaned (LLM)' }))
  expect(textBox().value).toBe('So hi.')
})

test('adds each new recording on a new line', async () => {
  fetchMock
    .mockReturnValueOnce(jsonResponse({ raw_text: 'um one', cleaned_text: 'One.', error: null }))
    .mockReturnValueOnce(jsonResponse({ raw_text: 'uh two', cleaned_text: 'Two.', error: null }))
  const user = await renderApp()

  await recordOnce(user)
  await waitFor(() => expect(textBox().value).toBe('One.'))
  await recordOnce(user)

  await waitFor(() => expect(textBox().value).toBe('One.\nTwo.'))
})

test('when the cleanup fails, shows the error and switches to the Whisper text', async () => {
  fetchMock.mockReturnValue(
    jsonResponse({ raw_text: 'um hello there', cleaned_text: '', error: 'Cleanup failed: no credits' }),
  )
  const user = await renderApp()

  await recordOnce(user)

  expect(await screen.findByText('Cleanup failed: no credits')).toBeTruthy()
  expect(textBox().value).toBe('um hello there')
  expect(screen.getByRole('button', { name: 'Raw (Whisper)' }).className).toBe('active')
})

test('shows the backend error message when the request fails', async () => {
  fetchMock.mockReturnValue(jsonResponse({ detail: 'Transcription failed: bad audio' }, 500))
  const user = await renderApp()

  await recordOnce(user)

  expect(await screen.findByText('Transcription failed: bad audio')).toBeTruthy()
  expect(screen.getByRole('button', { name: /start/i })).toBeTruthy()
})

test('shows a helpful message when the backend is not running', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  const user = await renderApp()

  await recordOnce(user)

  expect(await screen.findByText('Could not reach the backend. Is it running on port 8000?')).toBeTruthy()
})

test('shows an error when microphone access is denied', async () => {
  const user = await renderApp()
  getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))

  await user.click(screen.getByRole('button', { name: /start/i }))

  expect(
    await screen.findByText('Could not access the microphone. Check your browser permissions.'),
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: /start/i })).toBeTruthy()
})

test('clears the previous error when a new recording starts', async () => {
  fetchMock
    .mockReturnValueOnce(jsonResponse({ detail: 'Transcription failed: bad audio' }, 500))
    .mockReturnValueOnce(jsonResponse({ raw_text: 'hi', cleaned_text: 'Hi.', error: null }))
  const user = await renderApp()

  await recordOnce(user)
  await screen.findByText('Transcription failed: bad audio')
  await user.click(screen.getByRole('button', { name: /start/i }))

  expect(screen.queryByText('Transcription failed: bad audio')).toBeNull()
})
