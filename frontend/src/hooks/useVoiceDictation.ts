import { useEffect, useRef, useState } from 'react'
import { getDeepgramTemporaryToken } from '../api/client'
import { displayError } from '../utils'

/**
 * Deepgram live dictation, shared by the agent chat panel (and reusable by
 * other inputs). Streams microphone audio to Deepgram over a WebSocket using a
 * short-lived token issued by the Lamina backend — no browser speech service
 * involved, which avoids the Web Speech API "network" failure.
 *
 * Mirrors the flow in AskLaminaComposer.
 */

export type VoiceDictationStatus = 'idle' | 'listening' | 'transcribing' | 'ready' | 'error'

type DeepgramResult = {
  type?: string
  start?: number
  is_final?: boolean
  from_finalize?: boolean
  channel?: { alternatives?: Array<{ transcript?: string }> }
}

const DEEPGRAM_LISTEN_URL = 'wss://api.deepgram.com/v1/listen'

function preferredAudioMimeType(): string | null {
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? null
}

function joinText(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(' ')
}

export function useVoiceDictation(onTranscript: (text: string) => void) {
  const [status, setStatus] = useState<VoiceDictationStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

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

  const finish = () => {
    clearFinalizeTimer()
    releaseMicrophone()
    recorderRef.current = null
    closeSocket()
    if (mountedRef.current) {
      setStatus('ready')
      setMessage('Transcript is ready to edit. It has not been sent.')
    }
  }

  const fail = (failMessage: string) => {
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
      setStatus('error')
      setMessage(failMessage)
    }
  }

  const updateTranscript = () => {
    const finalText = [...finalSegmentsRef.current.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, transcript]) => transcript)
    onTranscriptRef.current(joinText(baseTextRef.current, ...finalText, interimRef.current))
  }

  const start = async (baseText: string) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      fail('Live transcription is not supported in this browser.')
      return
    }

    const session = sessionRef.current + 1
    sessionRef.current = session
    stoppingRef.current = false
    baseTextRef.current = baseText.trim()
    finalSegmentsRef.current.clear()
    interimRef.current = ''
    setStatus('transcribing')
    setMessage('Preparing secure transcription...')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      if (session !== sessionRef.current || !mountedRef.current) return
      const denied = error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      fail(denied
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
      fail(displayError(error))
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
      fail('Deepgram transcription could not be started. Try again.')
      return
    }
    socketRef.current = socket

    socket.onopen = () => {
      if (stoppingRef.current || session !== sessionRef.current) {
        finish()
        return
      }
      try {
        const mimeType = preferredAudioMimeType()
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream)
        recorderRef.current = recorder
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data)
          }
        }
        recorder.onstop = () => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'Finalize' }))
          } else {
            finish()
          }
        }
        recorder.start(250)
        setStatus('listening')
        setMessage('Listening… speak your request.')
      } catch {
        fail('Microphone audio could not be streamed. Try another browser or device.')
      }
    }

    socket.onmessage = (event) => {
      let parsed: DeepgramResult
      try {
        parsed = JSON.parse(String(event.data)) as DeepgramResult
      } catch {
        return
      }
      const transcript = parsed.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
      if (parsed.type === 'Results' && transcript) {
        if (parsed.is_final) {
          const segmentStart = Number.isFinite(parsed.start)
            ? Number(parsed.start)
            : finalSegmentsRef.current.size
          finalSegmentsRef.current.set(segmentStart, transcript)
          interimRef.current = ''
        } else {
          interimRef.current = transcript
        }
        updateTranscript()
      }
      if (stoppingRef.current && parsed.from_finalize) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'CloseStream' }))
        }
        finish()
      }
    }

    socket.onerror = () => {
      if (!stoppingRef.current) {
        fail('The transcription connection failed. Your typed text is still available.')
      }
    }

    socket.onclose = () => {
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
        setStatus('ready')
        setMessage('Transcript is ready to edit. It has not been sent.')
      } else {
        setStatus('error')
        setMessage('The transcription connection closed unexpectedly. Your text is still editable.')
      }
    }
  }

  const stop = () => {
    stoppingRef.current = true
    setStatus('transcribing')
    setMessage('Finalizing the transcript...')

    const recorder = recorderRef.current
    if (!recorder) {
      releaseMicrophone()
      sessionRef.current += 1
      finish()
      return
    }
    if (recorder.state !== 'inactive') {
      try {
        recorder.requestData()
        recorder.stop()
      } catch {
        finish()
        return
      }
    }
    releaseMicrophone()
    finalizeTimerRef.current = window.setTimeout(finish, 3000)
  }

  const active = status === 'listening' || status === 'transcribing'

  const toggle = (baseText: string) => {
    if (active) stop()
    else void start(baseText)
  }

  const reset = () => {
    if (active) return
    setStatus('idle')
    setMessage(null)
  }

  return { status, message, active, toggle, reset }
}
