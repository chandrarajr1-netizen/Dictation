/**
 * End-to-end tests: real browser -> real frontend -> real backend -> real Whisper + real Claude.
 *
 * Every test runs in Chrome, Firefox and WebKit (Safari's engine). Each test "speaks" a
 * known sentence by playing a WAV file from Tests/audio as the microphone.
 * These call the real Claude API, so each run costs a small amount.
 *
 * Run from FrontEnd:  npm run test:e2e
 * One browser only:   npm run test:e2e -- --project=firefox
 */
import path from 'node:path'
import { test as base, expect, type Page } from '@playwright/test'

const AUDIO = path.resolve(__dirname, '../audio')

// Firefox and WebKit can't use a file as the microphone, so this runs inside the page:
// it lets the browser's real getUserMedia run (so permissions still apply), then
// returns the WAV clip played through the browser's own audio system instead.
function playFileAsMicrophone(url: string) {
  if (location.protocol === 'about:') return // the blank page before the app loads
  const audio = new AudioContext()
  const clip = fetch(url)
    .then((response) => response.arrayBuffer())
    .then((bytes) => audio.decodeAudioData(bytes))
  // Replaced on the prototype: WebKit can drop properties set on navigator.mediaDevices itself.
  const realGetUserMedia = MediaDevices.prototype.getUserMedia

  MediaDevices.prototype.getUserMedia = async function (constraints) {
    const real = await realGetUserMedia.call(this, constraints)
    real.getTracks().forEach((track) => track.stop())

    await audio.resume()
    const source = audio.createBufferSource()
    source.buffer = await clip
    const output = audio.createMediaStreamDestination()
    source.connect(output)
    source.start()
    return output.stream
  }
}

// Each test opens a browser with a WAV file from Tests/audio playing as the microphone.
// Set `mic` to the file name, or to null to make the browser deny microphone access.
const test = base.extend<{ mic: string | null }>({
  mic: ['clean.wav', { option: true }],
  page: async ({ playwright, browserName, mic, baseURL }, use) => {
    const allow = mic !== null

    if (browserName === 'chromium') {
      // Chrome can play the file as its microphone directly.
      const args = mic
        ? [
            '--use-fake-ui-for-media-stream', // auto-allow the microphone
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${path.join(AUDIO, mic)}`,
          ]
        : ['--use-fake-device-for-media-stream', '--deny-permission-prompts']
      const browser = await playwright.chromium.launch({ channel: 'chrome', args })
      const page = await (await browser.newContext({ baseURL })).newPage()
      await use(page)
      await browser.close()
      return
    }

    const browser =
      browserName === 'firefox'
        ? await playwright.firefox.launch({
            firefoxUserPrefs: {
              'media.navigator.streams.fake': true, // never touch the real microphone
              'media.navigator.permission.disabled': allow, // auto-allow the microphone
              'permissions.default.microphone': allow ? 1 : 2, // 2 = block
            },
          })
        : await playwright.webkit.launch()
    const context = await browser.newContext({ baseURL })
    if (mic) {
      if (browserName === 'webkit') await context.grantPermissions(['microphone'])
      await context.route('**/__test-mic.wav', (route) => route.fulfill({ path: path.join(AUDIO, mic) }))
      await context.addInitScript(playFileAsMicrophone, '/__test-mic.wav')
    }
    const page = await context.newPage()
    await use(page)
    await browser.close()
  },
})

const micPlaying = (file: string) => ({ mic: file })

const startButton = (page: Page) => page.getByRole('button', { name: /start/i })
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop' })
const transcribingButton = (page: Page) => page.getByRole('button', { name: /transcribing/i })
const textBox = (page: Page) => page.getByRole('textbox')
const rawToggle = (page: Page) => page.getByRole('button', { name: 'Raw (Whisper)' })
const cleanedToggle = (page: Page) => page.getByRole('button', { name: 'Cleaned (LLM)' })
const errorMessage = (page: Page) => page.locator('.error')

// Open the app and wait until the microphone list has loaded.
async function openApp(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('combobox').locator('option').first()).toBeAttached()
}

// Record for a number of seconds, then stop. Each test records about a second longer
// than its clip, because WebKit can drop the last part of a recording when it stops.
async function record(page: Page, seconds: number) {
  await startButton(page).click()
  await expect(stopButton(page)).toBeVisible()
  await page.waitForTimeout(seconds * 1000)
  await stopButton(page).click()
}

// Wait until the backend has answered and the app is ready again.
async function waitUntilDone(page: Page) {
  await expect(startButton(page)).toBeVisible({ timeout: 45_000 })
}

test.describe('speaking a clean sentence', () => {
  test.use(micPlaying('clean.wav'))

  test('loads the page and lists the microphone', async ({ page }) => {
    await openApp(page)

    await expect(page.getByRole('heading', { name: 'Dictation' })).toBeVisible()
    await expect(page.getByRole('combobox')).toBeEnabled()
    expect(await page.getByRole('combobox').locator('option').count()).toBeGreaterThan(0)
    await expect(textBox(page)).toHaveValue('')
  })

  test('sends the real recording to the backend', async ({ page }) => {
    await openApp(page)

    const responsePromise = page.waitForResponse('**/api/transcribe')
    await record(page, 4)
    const response = await responsePromise

    // The browser sent a real file upload to the real backend...
    const request = response.request()
    expect(request.method()).toBe('POST')
    expect(request.url()).toBe('http://localhost:8000/api/transcribe')
    expect(request.headers()['content-type']).toContain('multipart/form-data')

    // ...and the backend heard the recorded sentence and cleaned it up.
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.raw_text).toMatch(/thursday/i)
    expect(body.cleaned_text).toMatch(/thursday/i)
    expect(body.error).toBeNull()
    await waitUntilDone(page)
  })

  test('shows the transcribing state with a loading wheel, then the result', async ({ page }) => {
    await openApp(page)

    await record(page, 4)

    await expect(transcribingButton(page)).toBeVisible()
    await expect(transcribingButton(page)).toBeDisabled()
    await expect(transcribingButton(page).locator('.spinner')).toBeVisible()
    await expect(page.getByRole('combobox')).toBeDisabled()

    await waitUntilDone(page)
    await expect(page.getByRole('combobox')).toBeEnabled()
    await expect(errorMessage(page)).toHaveCount(0)
  })

  test('shows the cleaned text, and the toggle shows what Whisper heard', async ({ page }) => {
    await openApp(page)

    await record(page, 4)
    await waitUntilDone(page)

    // Check "Thursday" and "afternoon": Whisper sometimes mishears "meeting" as "meaning".
    await expect(cleanedToggle(page)).toHaveClass('active')
    await expect(textBox(page)).toHaveValue(/thursday/i)
    await expect(textBox(page)).toHaveValue(/afternoon/i)

    await rawToggle(page).click()
    await expect(rawToggle(page)).toHaveClass('active')
    await expect(textBox(page)).toHaveValue(/thursday/i)

    await cleanedToggle(page).click()
    await expect(textBox(page)).toHaveValue(/thursday/i)
  })

  test('adds a second recording on a new line', async ({ page }) => {
    await openApp(page)

    await record(page, 4)
    await waitUntilDone(page)
    const first = await textBox(page).inputValue()

    await record(page, 4)
    await waitUntilDone(page)

    const lines = (await textBox(page).inputValue()).split('\n')
    expect(lines.length).toBe(2)
    expect(lines[0]).toBe(first)
    expect(lines[1]).toMatch(/thursday/i)
  })
})

test.describe('speaking with filler words', () => {
  test.use(micPlaying('filler.wav'))

  test('Whisper hears the fillers and Claude removes them', async ({ page }) => {
    await openApp(page)

    await record(page, 7.5)
    await waitUntilDone(page)

    const cleaned = await textBox(page).inputValue()
    expect(cleaned).toMatch(/friday/i)
    expect(cleaned).not.toMatch(/\b(um|uh)\b/i)

    await rawToggle(page).click()
    const raw = await textBox(page).inputValue()
    expect(raw).toMatch(/\b(um|uh)\b/i)
  })
})

test.describe('speaking a question', () => {
  test.use(micPlaying('question.wav'))

  test('Claude cleans up the question instead of answering it', async ({ page }) => {
    await openApp(page)

    await record(page, 3.5)
    await waitUntilDone(page)

    const cleaned = await textBox(page).inputValue()
    expect(cleaned).toMatch(/france/i)
    expect(cleaned).not.toMatch(/paris/i)
  })
})

test.describe('speaking an instruction', () => {
  test.use(micPlaying('instruction.wav'))

  test('Claude does not follow the spoken instruction', async ({ page }) => {
    await openApp(page)

    await record(page, 5.5)
    await waitUntilDone(page)

    const cleaned = await textBox(page).inputValue()
    expect(cleaned).toMatch(/ocean/i)
    expect(cleaned).not.toContain('\n') // no poem
  })
})

test.describe('recording silence', () => {
  test.use(micPlaying('silence.wav'))

  test('adds no text and shows no error', async ({ page }) => {
    await openApp(page)

    await record(page, 2)
    await waitUntilDone(page)

    await expect(textBox(page)).toHaveValue('')
    await expect(errorMessage(page)).toHaveCount(0)
  })
})

test.describe('when something goes wrong', () => {
  test.use(micPlaying('clean.wav'))

  test('cleanup failure: shows the error and the Whisper text', async ({ page }) => {
    // Send the request to the second backend, which has an invalid Claude key.
    await page.route('**/api/transcribe', (route) =>
      route.continue({ url: route.request().url().replace(':8000', ':8001') }),
    )
    await openApp(page)

    await record(page, 4)
    await waitUntilDone(page)

    await expect(errorMessage(page)).toContainText('Cleanup failed')
    await expect(rawToggle(page)).toHaveClass('active')
    await expect(textBox(page)).toHaveValue(/thursday/i)
  })

  test('backend error: shows the message from the backend', async ({ page }) => {
    // Replace the recording with a file that is not audio, so the real backend fails.
    await page.route('**/api/transcribe', (route) => {
      const boundary = 'e2e-boundary'
      const body =
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="audio"; filename="recording.webm"\r\n' +
        'Content-Type: audio/webm\r\n\r\n' +
        'this is not audio\r\n' +
        `--${boundary}--\r\n`
      return route.continue({
        postData: body,
        headers: { ...route.request().headers(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      })
    })
    await openApp(page)

    await record(page, 2)
    await waitUntilDone(page)

    await expect(errorMessage(page)).toContainText('Transcription failed')
    await expect(textBox(page)).toHaveValue('')
  })

  test('backend not running: shows a helpful message', async ({ page }) => {
    await page.route('**/api/transcribe', (route) => route.abort('connectionrefused'))
    await openApp(page)

    await record(page, 2)
    await waitUntilDone(page)

    await expect(errorMessage(page)).toHaveText('Could not reach the backend. Is it running on port 8000?')
  })

  test('the error goes away when a new recording starts', async ({ page }) => {
    await page.route('**/api/transcribe', (route) => route.abort('connectionrefused'))
    await openApp(page)
    await record(page, 2)
    await waitUntilDone(page)
    await expect(errorMessage(page)).toBeVisible()

    await startButton(page).click()

    await expect(errorMessage(page)).toHaveCount(0)
    await stopButton(page).click()
    await waitUntilDone(page)
  })
})

test.describe('microphone access denied', () => {
  test.use({ mic: null })

  test('shows an error instead of recording', async ({ page }) => {
    await page.goto('/')

    await startButton(page).click()

    await expect(errorMessage(page)).toHaveText(
      'Could not access the microphone. Check your browser permissions.',
    )
    await expect(startButton(page)).toBeVisible()
  })
})
