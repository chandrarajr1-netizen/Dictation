import { useEffect, useRef, useState } from 'react'
import './App.css'

type View = 'raw' | 'cleaned'

function App() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [micId, setMicId] = useState('')
  const [recording, setRecording] = useState(false)
  const [view, setView] = useState<View>('cleaned')
  // Filled in once the backend is connected.
  const [rawText] = useState('')
  const [cleanedText] = useState('')

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

  // Start or stop recording when the button is clicked.
  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop()
      setRecording(false)
      return
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: micId ? { deviceId: { exact: micId } } : true,
    })
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      const audio = new Blob(chunks, { type: recorder.mimeType })
      console.log('Recorded audio:', audio) // TODO: send to backend
    }
    recorder.start()
    recorderRef.current = recorder
    setRecording(true)
  }

  return (
    <main className="app">
      <h1>Dictation</h1>

      {/* Microphone Selection */}
      <select value={micId} onChange={(e) => setMicId(e.target.value)} disabled={recording}>
        {mics.map((mic, i) => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </select>

      {/* Record Button */}
      <button className={recording ? 'mic recording' : 'mic'} onClick={toggleRecording}>
        {recording ? 'Stop' : '🎤 Start'}
      </button>

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
