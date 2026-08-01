import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AgentDetails } from '../api/client'
import { displayError } from '../utils'
import { Icon } from './Icon'

export type AskLaminaConfiguration = {
  contextLabel: string
  placeholder: string
  processingLabel: string
  suggestions?: string[]
  onSubmit: (request: string) => Promise<string>
}

type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  error?: boolean
}

let messageId = 0

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

function timeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function RightRail({
  physician,
  configuration,
}: {
  physician: AgentDetails
  configuration: AskLaminaConfiguration
}) {
  const baseName = physician.physician.display_name.split(',')[0].replace(/^Dr\.?\s+/i, '').trim()
  const lastName = baseName.split(' ').slice(-1)[0]

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [request, setRequest] = useState('')
  const [processing, setProcessing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  // Fresh conversation when the signed-in physician changes.
  useEffect(() => {
    setMessages([])
    setRequest('')
    setProcessing(false)
  }, [physician.physician_npi])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, processing])

  const send = async (text: string) => {
    const clean = text.trim()
    if (!clean || processing) return
    setRequest('')
    setMessages((prev) => [...prev, { id: ++messageId, role: 'user', text: clean }])
    setProcessing(true)
    try {
      const reply = await configuration.onSubmit(clean)
      setMessages((prev) => [...prev, { id: ++messageId, role: 'assistant', text: reply }])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { id: ++messageId, role: 'assistant', text: displayError(error), error: true },
      ])
    } finally {
      setProcessing(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void send(request)
  }

  const toggleVoice = () => {
    if (recording) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = getSpeechRecognition()
    if (!recognition) {
      setVoiceNote('Voice input is not supported in this browser — try Chrome or Edge.')
      return
    }
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length })
        .map((_, i) => event.results[i][0].transcript)
        .join(' ')
        .trim()
      if (!transcript) return
      setRequest((current) => (current ? `${current.trim()} ${transcript}` : transcript))
      setVoiceNote(null)
    }
    recognition.onerror = (event) => {
      setVoiceNote(
        event.error === 'not-allowed'
          ? 'Microphone access was denied.'
          : `Voice input error: ${event.error}`,
      )
      setRecording(false)
    }
    recognition.onend = () => setRecording(false)
    recognitionRef.current = recognition
    setVoiceNote('Listening… speak your request.')
    setRecording(true)
    recognition.start()
  }

  // Stop listening if the panel unmounts mid-recording.
  useEffect(() => () => recognitionRef.current?.stop(), [])

  return (
    <aside className="right-rail ask-right-rail agent-chat" aria-label="Your agent">
      <header className="agent-chat-header">
        <div className="agent-chat-avatar">
          <Icon name="sparkle" className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="agent-chat-name truncate">Dr. {baseName} Agent</div>
          <div className="agent-chat-status">
            <span className="agent-chat-status-dot" aria-hidden="true" />
            Online
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="agent-chat-messages">
        <div className="agent-chat-bubble assistant">
          {timeGreeting()}, Dr. {lastName}. I&apos;m your Lamina agent. I can search the physician
          network, find specialists, or work with your current context. What would you like to do?
        </div>
        <div className="agent-chat-context">Context · {configuration.contextLabel}</div>
        {messages.map((message) => (
          <div
            key={message.id}
            className={`agent-chat-bubble ${message.role}${message.error ? ' error' : ''}`}
          >
            {message.text}
          </div>
        ))}
        {processing && (
          <div className="agent-chat-bubble assistant processing" role="status">
            {configuration.processingLabel}
          </div>
        )}
      </div>

      <footer className="agent-chat-footer">
        {(configuration.suggestions ?? []).length > 0 && (
          <div className="agent-chat-chips" aria-label="Suggested prompts">
            {(configuration.suggestions ?? []).map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => setRequest(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="agent-chat-inputrow">
          <input
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            disabled={processing}
            placeholder={recording ? 'Listening…' : configuration.placeholder}
            aria-label="Ask your agent"
            className="agent-chat-input"
          />
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={recording ? 'Stop voice input' : 'Start voice input'}
            aria-pressed={recording}
            title={recording ? 'Stop listening' : 'Dictate your request'}
            className={`agent-chat-mic${recording ? ' recording' : ''}`}
          >
            <Icon name="mic" className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={!request.trim() || processing}
            aria-label="Send"
            className="agent-chat-send"
          >
            <Icon name="arrow-up" className="h-4 w-4" />
          </button>
        </form>
        {voiceNote && (
          <p className="agent-chat-voicenote" role="status">{voiceNote}</p>
        )}
        <p className="agent-chat-safety">
          Lamina routes supported actions through physician-network workflows. It does not provide
          generic medical chat.
        </p>
      </footer>
    </aside>
  )
}
