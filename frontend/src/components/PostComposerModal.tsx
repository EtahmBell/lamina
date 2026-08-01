import { useEffect, useState } from 'react'
import {
  approveForumPost,
  createForumPostDraft,
  generatePatientForumPost,
  type AgentDetails,
  type ForumPost,
} from '../api/client'
import { displayError } from '../utils'
import { Badge, ErrorBanner } from './ui'

export type PatientPostContext = {
  patientRef: string
  displayName: string
}

type ComposerMode = 'question' | 'article'
type ComposerStep = 'choose' | 'compose' | 'review'

export function PostComposerModal({
  physician,
  patientContext,
  onClose,
  onPublished,
}: {
  physician: AgentDetails
  patientContext: PatientPostContext | null
  onClose: () => void
  onPublished: (post: ForumPost) => void
}) {
  const [mode, setMode] = useState<ComposerMode | null>(null)
  const [step, setStep] = useState<ComposerStep>('choose')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [contextSummary, setContextSummary] = useState('')
  const [topics, setTopics] = useState(physician.physician.primary_specialty)
  const [includePatient, setIncludePatient] = useState(false)
  const [backendDraft, setBackendDraft] = useState<ForumPost | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [busy, onClose])

  const choose = (nextMode: ComposerMode) => {
    setMode(nextMode)
    setStep('compose')
    setError(null)
  }

  const continueToReview = async () => {
    if (!mode || !title.trim() || !content.trim() || busy) return
    if (mode === 'article') return
    setError(null)
    if (!includePatient || !patientContext) {
      setStep('review')
      return
    }

    setBusy(true)
    try {
      const guidance = [
        `Requested title: ${title.trim()}`,
        content.trim(),
        topics.trim() ? `Topics: ${topics.trim()}` : '',
      ].filter(Boolean).join('\n\n')
      const draft = await generatePatientForumPost(
        physician.physician_npi,
        patientContext.patientRef,
        guidance,
      )
      setBackendDraft(draft)
      setStep('review')
    } catch (generationError) {
      setError(displayError(generationError))
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    if (busy || mode !== 'question') return
    setBusy(true)
    setError(null)
    try {
      const draft = backendDraft ?? await createForumPostDraft({
        agent_id: physician.id,
        title: title.trim(),
        clinical_question: content.trim(),
        context_summary: contextSummary.trim() ||
          'Manually authored synthetic physician discussion. No patient-identifying information is included.',
        specialty_tags: splitTopics(topics),
        case_classification: 'synthetic',
        draft_origin: 'physician_text_request',
      })
      const published = await approveForumPost(draft.id, physician.physician_npi)
      onPublished(published)
    } catch (publishError) {
      setError(displayError(publishError))
    } finally {
      setBusy(false)
    }
  }

  const preview = backendDraft
    ? {
        title: backendDraft.title,
        content: backendDraft.clinical_question,
        contextSummary: backendDraft.context_summary,
        topics: backendDraft.specialty_tags,
      }
    : {
        title: title.trim(),
        content: content.trim(),
        contextSummary: contextSummary.trim(),
        topics: splitTopics(topics),
      }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="post-modal" role="dialog" aria-modal="true" aria-labelledby="post-modal-title">
        <header className="post-modal-header">
          <div>
            <div className="eyebrow">Create a post</div>
            <h1 id="post-modal-title" className="section-title mt-1">
              {step === 'choose' ? 'What would you like to publish?' :
                step === 'review' ? 'Review before publishing' :
                  mode === 'article' ? 'Publish an article' : 'Post a question'}
            </h1>
            <p className="secondary-copy mt-1">Posting as {physician.physician.display_name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="modal-close" aria-label="Close post composer">×</button>
        </header>

        {error && <div className="mt-4"><ErrorBanner message={error} /></div>}

        {step === 'choose' && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <button type="button" onClick={() => choose('question')} className="post-type-card">
              <span className="publication-title">Question</span>
              <span>Ask colleagues about a case, treatment, workflow, or clinical problem.</span>
            </button>
            <button type="button" onClick={() => choose('article')} className="post-type-card">
              <span className="publication-title">Article</span>
              <span>Share a longer clinical insight, report, or professional perspective.</span>
            </button>
          </div>
        )}

        {step === 'compose' && mode && (
          <div className="mt-6 space-y-4">
            {mode === 'article' && (
              <div className="article-deferred">
                <Badge tone="warning">Backend support required</Badge>
                <p className="secondary-copy mt-2">
                  Lamina’s current forum schema supports discussions, not articles. You may compose below, but publication remains disabled rather than simulating success.
                </p>
              </div>
            )}
            <ComposerField label="Title" value={title} onChange={setTitle} autoFocus />
            <ComposerField
              label={mode === 'article' ? 'Article' : 'Question / discussion text'}
              value={content}
              onChange={setContent}
              multiline
            />
            {mode === 'question' && (
              <ComposerField
                label="Context summary (optional)"
                value={contextSummary}
                onChange={setContextSummary}
                multiline
              />
            )}
            <ComposerField label="Topics" value={topics} onChange={setTopics} />

            {mode === 'question' && patientContext && (
              <label className="patient-context-option">
                <input
                  type="checkbox"
                  checked={includePatient}
                  onChange={(event) => setIncludePatient(event.target.checked)}
                />
                <span>
                  <strong>Use current patient context</strong>
                  <small>{patientContext.displayName} · bounded synthetic Medplum workflow</small>
                </span>
              </label>
            )}
          </div>
        )}

        {step === 'review' && mode === 'question' && (
          <article className="post-review mt-6">
            <div className="flex flex-wrap gap-2">
              <Badge tone={backendDraft ? 'clinical' : 'success'}>
                {backendDraft ? 'AI-assisted bounded draft' : 'Manually authored'}
              </Badge>
              <Badge tone="warning">Ready for physician publication</Badge>
            </div>
            <h2 className="publication-title mt-4 text-[1.4rem]">{preview.title}</h2>
            <p className="body-copy mt-3 whitespace-pre-wrap">{preview.content}</p>
            {preview.contextSummary && <p className="secondary-copy mt-3">{preview.contextSummary}</p>}
            <div className="mt-4 flex flex-wrap gap-2">{preview.topics.map((topic) => <Badge key={topic}>{topic}</Badge>)}</div>
            {backendDraft && (
              <p className="metadata mt-4">This complete backend draft already exists for review. Closing will not publish it.</p>
            )}
          </article>
        )}

        <footer className="post-modal-footer">
          <button
            type="button"
            onClick={() => {
              if (step === 'choose') onClose()
              else if (step === 'compose') setStep('choose')
              else setStep('compose')
            }}
            disabled={busy}
            className="button-secondary"
          >
            {step === 'choose' ? 'Cancel' : step === 'review' ? 'Back to edit' : 'Back'}
          </button>
          {step === 'compose' && (
            <button
              type="button"
              onClick={() => void continueToReview()}
              disabled={!title.trim() || !content.trim() || busy || mode === 'article'}
              className="button-primary"
            >
              {busy ? 'Preparing review...' : mode === 'article' ? 'Article publishing deferred' : 'Continue to review'}
            </button>
          )}
          {step === 'review' && (
            <button type="button" onClick={() => void publish()} disabled={busy} className="button-primary">
              {busy ? 'Publishing...' : 'Publish'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

function ComposerField({
  label,
  value,
  onChange,
  multiline = false,
  autoFocus = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  autoFocus?: boolean
}) {
  return (
    <label className="block">
      <span className="metadata font-bold tracking-[0.06em] uppercase">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={5}
          autoFocus={autoFocus}
          className="input-control mt-2 resize-y"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoFocus={autoFocus}
          className="input-control mt-2"
        />
      )}
    </label>
  )
}

function splitTopics(value: string): string[] {
  return value.split(/,|\r?\n/).map((topic) => topic.trim()).filter(Boolean)
}
