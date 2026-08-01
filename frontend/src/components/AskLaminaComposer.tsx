import { useState, type FormEvent } from 'react'
import { displayError } from '../utils'

type ComposerStatus = 'idle' | 'processing' | 'ready' | 'error'

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

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cleanRequest = request.trim()
    if (!cleanRequest || status === 'processing') return
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
            }
          }}
          disabled={status === 'processing'}
          placeholder={placeholder}
          aria-label="Ask Lamina request"
          rows={panel ? 5 : 1}
          className={panel ? 'input-control ask-panel-input' : 'input-control min-w-0 flex-1'}
        />
        <div className={panel ? 'mt-2 flex justify-end gap-2' : 'contents'}>
          <button
            type="button"
            disabled
            aria-label="Voice input unavailable"
            title="Voice input will be available after backend transcription is implemented."
            className="ask-lamina-mic"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
              <path d="M6.5 11.5v.5a5.5 5.5 0 0 0 11 0v-.5M12 17.5V21M9.5 21h5" />
            </svg>
          </button>
          <button
            type="submit"
            disabled={!request.trim() || status === 'processing'}
            className="button-primary"
          >
            Send
          </button>
        </div>
      </form>
      {suggestions.length > 0 && status === 'idle' && !request && (
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
      <p className="metadata mt-2">Voice input is unavailable until backend transcription is implemented.</p>
    </section>
  )
}
