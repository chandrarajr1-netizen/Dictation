import { useEffect, useRef, useState } from 'react'
import './App.css'

type View = 'raw' | 'cleaned'
type Status = 'idle' | 'recording' | 'transcribing'

const API_URL = 'http://localhost:8000/api/transcribe'

// Add a new chunk of dictation on a new line.
function append(existing: string, next: string) {
  if (!next) return existing
  return existing ? `${existing}\n${next}` : next
}

function App() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [micId, setMicId] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [view, setView] = useState<View>('cleaned')
  const [rawText, setRawText] = useState('')
  const [cleanedText, setCleanedText] = useState('')
  const [error, setError] = useState('')

  const recorderRef = useRef<MediaRecorder | null>(null)

  // Ask for mic permission once (so device names show), then list microphones.
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => {})
      .finally(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const inputs = devices.filter((d) => d.kind === 'audioinput')
        setMics(inputs)
        setMicId(inputs[0]?.deviceId ?? '')
      })
  }, [])

  // Send the recorded audio to the backend and show the returned text.
  async function sendAudio(audio: Blob) {
    setStatus('transcribing')
    try {
      const form = new FormData()
      form.append('audio', audio, 'recording.webm')
      const response = await fetch(API_URL, { method: 'POST', body: form })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail ?? `Request failed (${response.status})`)
      }

      setRawText((t) => append(t, data.raw_text))
      setCleanedText((t) => append(t, data.cleaned_text))

      // Whisper worked but the cleanup failed: show the error and the Whisper text.
      if (data.error) {
        setError(data.error)
        setView('raw')
      }
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Could not reach the backend. Is it running on port 8000?'
          : (err as Error).message,
      )
    } finally {
      setStatus('idle')
    }
  }

  // Start or stop recording when the button is clicked.
  async function toggleRecording() {
    if (status === 'recording') {
      recorderRef.current?.stop()
      return
    }

    setError('')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: micId ? { deviceId: { exact: micId } } : true,
      })
    } catch {
      setError('Could not access the microphone. Check your browser permissions.')
      return
    }

    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      sendAudio(new Blob(chunks, { type: recorder.mimeType }))
    }
    recorder.start()
    recorderRef.current = recorder
    setStatus('recording')
  }

  return (
    <main className="app">
      <h1>Dictation</h1>

      {/* Microphone Selection */}
      <select value={micId} onChange={(e) => setMicId(e.target.value)} disabled={status !== 'idle'}>
        {mics.map((mic, i) => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </select>

      {/* Record Button */}
      <button
        className={`mic ${status}`}
        onClick={toggleRecording}
        disabled={status === 'transcribing'}
      >
        {status === 'recording' && 'Stop'}
        {status === 'idle' && '🎤 Start'}
        {status === 'transcribing' && (
          <>
            <span className="spinner" /> Transcribing…
          </>
        )}
      </button>

      {/* Error Message */}
      {error && <p className="error">{error}</p>}

      {/* View Toggle */}
      <div className="toggle">
        <button className={view === 'raw' ? 'active' : ''} onClick={() => setView('raw')}>
          Raw (Whisper)
        </button>
        <button className={view === 'cleaned' ? 'active' : ''} onClick={() => setView('cleaned')}>
          Cleaned (LLM)
        </button>
      </div>

      {/* Text Display */}
      <textarea
        readOnly
        value={view === 'raw' ? rawText : cleanedText}
        placeholder="Your transcribed text will appear here…"
      />
    </main>
  )
}

export default App
