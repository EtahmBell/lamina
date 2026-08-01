import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getDeepgramTemporaryToken } from '../api/client'
import { displayError } from '../utils'

type ComposerStatus = 'idle' | 'processing' | 'ready' | 'error'
type VoiceStatus = 'idle' | 'listening' | 'transcribing' | 'ready' | 'error'

type DeepgramResult = {
  type?: string
  start?: number
  is_final?: boolean
  from_finalize?: boolean
  channel?: { alternatives?: Array<{ transcript?: string }> }
}

const DEEPGRAM_LISTEN_URL = 'wss://api.deepgram.com/v1/listen'

export function AskLaminaComposer({
  contextLabel,
  placeholder,
  processingLabel,
  suggestions = [],
  panel = false,
  onSubmit,
}: {
  contextLabel: string
  placeholder: string
  processingLabel: string
  suggestions?: string[]
  panel?: boolean
  onSubmit: (request: string) => Promise<string>
}) {
  const [request, setRequest] = useState('')
  const [status, setStatus] = useState<ComposerStatus>('idle')
  const [result, setResult] = useState<string | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const baseTextRef = useRef('')
  const finalSegmentsRef = useRef<Map<number, string>>(new Map())
  const interimRef = useRef('')
  const stoppingRef = useRef(false)
  const sessionRef = useRef(0)
  const finalizeTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sessionRef.current += 1
      if (finalizeTimerRef.current !== null) window.clearTimeout(finalizeTimerRef.current)
      const recorder = recorderRef.current
      recorderRef.current = null
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      const socket = socketRef.current
      socketRef.current = null
      if (socket) {
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close()
        }
      }
    }
  }, [])

  const clearFinalizeTimer = () => {
    if (finalizeTimerRef.current !== null) {
      window.clearTimeout(finalizeTimerRef.current)
      finalizeTimerRef.current = null
    }
  }

  const releaseMicrophone = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const closeSocket = () => {
    const socket = socketRef.current
    socketRef.current = null
    if (!socket) return
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }
  }

  const finishVoice = () => {
    clearFinalizeTimer()
    releaseMicrophone()
    recorderRef.current = null
    closeSocket()
    if (mountedRef.current) {
      setVoiceStatus('ready')
      setVoiceMessage('Transcript is ready to edit. It has not been sent.')
    }
  }

  const failVoice = (message: string) => {
    stoppingRef.current = true
    clearFinalizeTimer()
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.stop()
    }
    releaseMicrophone()
    closeSocket()
    if (mountedRef.current) {
      setVoiceStatus('error')
      setVoiceMessage(message)
    }
  }

  const updateTranscript = () => {
    const finalText = [...finalSegmentsRef.current.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, transcript]) => transcript)
    setRequest(joinText(baseTextRef.current, ...finalText, interimRef.current))
  }

  const startVoice = async () => {
    if (status === 'processing') return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      failVoice('Live transcription is not supported in this browser.')
      return
    }

    const session = sessionRef.current + 1
    sessionRef.current = session
    stoppingRef.current = false
    baseTextRef.current = request.trim()
    finalSegmentsRef.current.clear()
    interimRef.current = ''
    setVoiceStatus('transcribing')
    setVoiceMessage('Preparing secure transcription...')
    setResult(null)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      if (session !== sessionRef.current || !mountedRef.current) return
      const denied = error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      failVoice(denied
        ? 'Microphone access was denied. Allow access and try again.'
        : 'A microphone could not be opened. Check your device and try again.')
      return
    }
    if (session !== sessionRef.current || !mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    streamRef.current = stream

    let accessToken: string
    try {
      accessToken = (await getDeepgramTemporaryToken()).access_token
    } catch (error) {
      if (session !== sessionRef.current || !mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      failVoice(displayError(error))
      return
    }
    if (session !== sessionRef.current || !mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop())
      if (streamRef.current === stream) streamRef.current = null
      return
    }

    const parameters = new URLSearchParams({
      model: 'nova-3-medical',
      language: 'en-US',
      smart_format: 'true',
      interim_results: 'true',
    })
    let socket: WebSocket
    try {
      socket = new WebSocket(`${DEEPGRAM_LISTEN_URL}?${parameters}`, ['bearer', accessToken])
    } catch {
      failVoice('Deepgram transcription could not be started. Try again.')
      return
    }
    socketRef.current = socket

    socket.onopen = () => {
      console.info('[Deepgram] WebSocket open')
      if (stoppingRef.current || session !== sessionRef.current) {
        finishVoice()
        return
      }
      try {
        const mimeType = preferredAudioMimeType()
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream)
        recorderRef.current = recorder
        console.info('[Deepgram] MediaRecorder mimeType:', recorder.mimeType)
        recorder.ondataavailable = (event) => {
          console.info('[Deepgram] audio chunk bytes:', event.data.size)
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data)
          }
        }
        recorder.onstop = () => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'Finalize' }))
          } else {
            finishVoice()
          }
        }
        recorder.start(250)
        setVoiceStatus('listening')
        setVoiceMessage('Speak naturally. Your words will appear here.')
      } catch {
        failVoice('Microphone audio could not be streamed. Try another browser or device.')
      }
    }

    socket.onmessage = (event) => {
      let message: DeepgramResult
      try {
        message = JSON.parse(String(event.data)) as DeepgramResult
      } catch {
        return
      }
      const transcript = message.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
      console.info('[Deepgram] message:', message.type ?? 'unknown', 'transcript:', transcript)
      if (message.type === 'Results') {
        if (transcript) {
          if (message.is_final) {
            const segmentStart = Number.isFinite(message.start)
              ? Number(message.start)
              : finalSegmentsRef.current.size
            finalSegmentsRef.current.set(segmentStart, transcript)
            interimRef.current = ''
          } else {
            interimRef.current = transcript
          }
          updateTranscript()
        }
      }
      if (stoppingRef.current && message.from_finalize) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'CloseStream' }))
        }
        finishVoice()
      }
    }

    socket.onerror = (event) => {
      console.error('[Deepgram] WebSocket error', event)
      if (!stoppingRef.current) {
        failVoice('The Deepgram connection failed. Your typed text is still available.')
      }
    }

    socket.onclose = (event) => {
      console.info('[Deepgram] WebSocket close:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      })
      if (socketRef.current !== socket) return
      socketRef.current = null
      releaseMicrophone()
      const recorder = recorderRef.current
      recorderRef.current = null
      if (recorder && recorder.state !== 'inactive') {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.stop()
      }
      clearFinalizeTimer()
      if (!mountedRef.current) return
      if (stoppingRef.current) {
        setVoiceStatus('ready')
        setVoiceMessage('Transcript is ready to edit. It has not been sent.')
      } else {
        setVoiceStatus('error')
        setVoiceMessage('The Deepgram connection closed unexpectedly. Your text is still editable.')
      }
    }
  }

  const stopVoice = () => {
    stoppingRef.current = true
    setVoiceStatus('transcribing')
    setVoiceMessage('Finalizing the transcript...')

    const recorder = recorderRef.current
    if (!recorder) {
      releaseMicrophone()
      sessionRef.current += 1
      finishVoice()
      return
    }
    if (recorder.state !== 'inactive') {
      try {
        recorder.requestData()
        recorder.stop()
      } catch {
        finishVoice()
        return
      }
    }
    releaseMicrophone()
    finalizeTimerRef.current = window.setTimeout(finishVoice, 3000)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cleanRequest = request.trim()
    if (!cleanRequest || status === 'processing' || isVoiceActive(voiceStatus)) return
    setStatus('processing')
    setResult(null)
    try {
      setResult(await onSubmit(cleanRequest))
      setStatus('ready')
    } catch (error) {
      setResult(displayError(error))
      setStatus('error')
    }
  }

  const voiceActive = isVoiceActive(voiceStatus)

  return (
    <section className={panel ? 'ask-lamina ask-lamina-panel' : 'ask-lamina'} aria-label="Ask Lamina command">
      <div className={panel ? 'hidden' : 'flex flex-wrap items-baseline gap-x-3 gap-y-1'}>
        <h2 className="eyebrow text-[var(--clinical)]">Ask Lamina</h2>
        <span className="metadata">{contextLabel}</span>
      </div>
      <form onSubmit={(event) => void submit(event)} className={panel ? 'mt-4' : 'mt-3 flex items-stretch gap-2'}>
        <textarea
          value={request}
          onChange={(event) => {
            setRequest(event.target.value)
            if (status !== 'processing') {
              setStatus('idle')
              setResult(null)
              setVoiceStatus('idle')
              setVoiceMessage(null)
            }
          }}
          disabled={status === 'processing' || voiceActive}
          placeholder={placeholder}
          aria-label="Ask Lamina request"
          rows={panel ? 5 : 1}
          className={panel ? 'input-control ask-panel-input' : 'input-control min-w-0 flex-1'}
        />
        <div className={panel ? 'mt-2 flex justify-end gap-2' : 'contents'}>
          <button
            type="button"
            onClick={() => void (voiceActive ? stopVoice() : startVoice())}
            disabled={status === 'processing'}
            aria-label={voiceActive ? 'Stop voice transcription' : 'Start voice transcription'}
            aria-pressed={voiceActive}
            title={voiceActive ? 'Stop recording' : 'Dictate with Deepgram'}
            className={`ask-lamina-mic ask-lamina-mic-${voiceStatus}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
              <path d="M6.5 11.5v.5a5.5 5.5 0 0 0 11 0v-.5M12 17.5V21M9.5 21h5" />
            </svg>
          </button>
          <button
            type="submit"
            disabled={!request.trim() || status === 'processing' || voiceActive}
            className="button-primary"
          >
            Send
          </button>
        </div>
      </form>
      {suggestions.length > 0 && status === 'idle' && !request && !voiceActive && (
        <div className="ask-suggestions" aria-label="Suggested prompts">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setRequest(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
      {status === 'processing' && (
        <p className="secondary-copy mt-2" role="status">{processingLabel}</p>
      )}
      {result && status !== 'processing' && (
        <p
          className={`secondary-copy mt-2 ${status === 'error' ? 'text-[var(--danger)]' : ''}`}
          role="status"
        >
          {result}
        </p>
      )}
      <VoiceState status={voiceStatus} message={voiceMessage} />
    </section>
  )
}

function VoiceState({ status, message }: { status: VoiceStatus; message: string | null }) {
  if (status === 'idle') {
    return <p className="metadata mt-2">Dictation is transcribed only. It never submits automatically.</p>
  }
  const label = status === 'listening'
    ? 'Listening'
    : status === 'transcribing'
      ? 'Transcribing'
      : status === 'ready'
        ? 'Ready'
        : 'Transcription unavailable'
  return (
    <p className={`voice-state voice-state-${status}`} role="status">
      <span aria-hidden="true" />
      <strong>{label}</strong>
      {message && <> · {message}</>}
    </p>
  )
}

function preferredAudioMimeType(): string | null {
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? null
}

function isVoiceActive(status: VoiceStatus): boolean {
  return status === 'listening' || status === 'transcribing'
}

function joinText(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(' ')
}
