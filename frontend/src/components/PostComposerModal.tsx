import { useCallback, useEffect, useRef, useState } from 'react'
import {
  approveForumPost,
  createForumPostDraft,
  generatePatientForumPost,
  type AgentDetails,
  type ForumPost,
} from '../api/client'
import { displayError } from '../utils'
import { Icon } from './Icon'
import { Badge, ErrorBanner } from './ui'

export type PatientPostContext = {
  patientRef: string
  displayName: string
}

type ComposerMode = 'question' | 'article'
type ComposerStep = 'compose' | 'review'

const suggestedTags = [
  'Cardiology',
  'Neurology',
  'Oncology',
  'Radiology',
  'Pediatrics',
  'Pharmacology',
  'Clinical Trials',
  'Case Report',
]

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

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

const toolButton =
  'flex h-8 min-w-8 items-center justify-center rounded-lg px-1 text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:shadow-sm'
const bubbleButton =
  'flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-primary)] hover:bg-[#f4ecdf]'

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
  const [mode, setMode] = useState<ComposerMode>('question')
  const [step, setStep] = useState<ComposerStep>('compose')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [includePatient, setIncludePatient] = useState(false)
  const [backendDraft, setBackendDraft] = useState<ForumPost | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null)
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null)
  const [slashMenu, setSlashMenu] = useState<{ top: number; left: number } | null>(null)

  const editorRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const contentHtmlRef = useRef('')

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      if (slashMenu) setSlashMenu(null)
      else onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [busy, onClose, slashMenu])

  useEffect(() => () => recognitionRef.current?.stop(), [])

  // Restore the editor HTML when returning from the review step.
  useEffect(() => {
    if (step === 'compose' && editorRef.current) {
      editorRef.current.innerHTML = contentHtmlRef.current
    }
  }, [step])

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '')
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setTags((prev) => [...prev, tag])
    }
    setTagInput('')
  }

  const selectionInEditor = useCallback((): Range | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    if (!editorRef.current?.contains(range.commonAncestorContainer)) return null
    return range
  }, [])

  useEffect(() => {
    const handler = () => {
      const range = selectionInEditor()
      if (!range) {
        setBubble(null)
        return
      }
      savedRangeRef.current = range.cloneRange()
      if (range.collapsed) {
        setBubble(null)
        return
      }
      const rect = range.getBoundingClientRect()
      const wrap = wrapRef.current?.getBoundingClientRect()
      if (!wrap) return
      setBubble({
        top: rect.top - wrap.top - 44,
        left: Math.max(8, Math.min(rect.left - wrap.left + rect.width / 2 - 130, wrap.width - 270)),
      })
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [selectionInEditor])

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
  }

  const applyBlock = (tag: string) => exec('formatBlock', tag)

  const openSlashMenu = () => {
    const range = selectionInEditor()
    if (!range) return
    const rect = range.getBoundingClientRect()
    const wrap = wrapRef.current?.getBoundingClientRect()
    if (!wrap) return
    setSlashMenu({
      top: rect.bottom - wrap.top + 6,
      left: Math.max(8, Math.min(rect.left - wrap.left, wrap.width - 240)),
    })
  }

  const runSlashCommand = (action: () => void) => {
    editorRef.current?.focus()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      const node = range.startContainer
      if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
        const text = node.textContent ?? ''
        if (text[range.startOffset - 1] === '/') {
          const del = document.createRange()
          del.setStart(node, range.startOffset - 1)
          del.setEnd(node, range.startOffset)
          del.deleteContents()
        }
      }
    }
    action()
    setSlashMenu(null)
  }

  const blockOptions = [
    { icon: 'T', label: 'Text', hint: 'Plain paragraph', action: () => applyBlock('p') },
    { icon: 'H1', label: 'Heading 1', hint: 'Large section heading', action: () => applyBlock('h1') },
    { icon: 'H2', label: 'Heading 2', hint: 'Medium section heading', action: () => applyBlock('h2') },
    { icon: '•', label: 'Bullet list', hint: 'Simple bulleted list', action: () => exec('insertUnorderedList') },
    { icon: '1.', label: 'Numbered list', hint: 'Ordered list', action: () => exec('insertOrderedList') },
    { icon: '❝', label: 'Quote', hint: 'Callout quotation', action: () => applyBlock('blockquote') },
  ]

  const startVoiceEdit = () => {
    if (recording) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = getSpeechRecognition()
    if (!recognition) {
      setVoiceStatus('Voice input is not supported in this browser — try Chrome or Edge.')
      return
    }
    const target = savedRangeRef.current ? savedRangeRef.current.cloneRange() : null
    const replacing = target !== null && !target.collapsed
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length })
        .map((_, i) => event.results[i][0].transcript)
        .join(' ')
        .trim()
      if (!transcript) return
      const editor = editorRef.current
      if (!editor) return
      editor.focus()
      const sel = window.getSelection()
      if (target && sel) {
        sel.removeAllRanges()
        sel.addRange(target)
        document.execCommand('insertText', false, transcript)
      } else {
        document.execCommand('insertText', false, transcript)
      }
      setVoiceStatus(replacing ? 'Replaced selection with dictated text.' : 'Inserted dictated text.')
    }
    recognition.onerror = (event) => {
      setVoiceStatus(
        event.error === 'not-allowed'
          ? 'Microphone access was denied.'
          : `Voice input error: ${event.error}`,
      )
      setRecording(false)
    }
    recognition.onend = () => setRecording(false)
    recognitionRef.current = recognition
    setVoiceStatus(
      replacing
        ? 'Listening… dictated text will replace your selection.'
        : 'Listening… dictated text will be inserted at the cursor.',
    )
    setRecording(true)
    recognition.start()
  }

  const contentText = () => stripHtml(contentHtmlRef.current)

  const continueToReview = async () => {
    contentHtmlRef.current = editorRef.current?.innerHTML ?? contentHtmlRef.current
    if (!title.trim() || !contentText() || busy || mode === 'article') return
    setError(null)
    if (!includePatient || !patientContext) {
      setStep('review')
      return
    }
    setBusy(true)
    try {
      const guidance = [
        `Requested title: ${title.trim()}`,
        contentText(),
        tags.length ? `Topics: ${tags.join(', ')}` : '',
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
        clinical_question: contentText(),
        context_summary:
          'Manually authored synthetic physician discussion. No patient-identifying information is included.',
        specialty_tags: tags.length ? tags : [physician.physician.primary_specialty],
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
        content: contentText(),
        contextSummary: '',
        topics: tags,
      }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(30_26_20/55%)] p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => !busy && onClose()}
    >
      <section
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[var(--surface)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-4">
          <h1 id="post-modal-title" className="section-title text-lg">
            {step === 'review' ? 'Review before publishing' : 'New post'}
          </h1>
          {step === 'compose' && (
            <div className="flex gap-1 rounded-full bg-[#f4ecdf] p-1">
              <button
                type="button"
                onClick={() => setMode('question')}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  mode === 'question'
                    ? 'bg-[var(--surface)] text-[var(--accent-hover)] shadow-sm'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                <Icon name="message" className="h-4 w-4" />
                Post
              </button>
              <button
                type="button"
                onClick={() => setMode('article')}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  mode === 'article'
                    ? 'bg-[var(--surface)] text-[var(--accent-hover)] shadow-sm'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                <Icon name="note" className="h-4 w-4" />
                Article
              </button>
            </div>
          )}
          {step === 'compose' && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={startVoiceEdit}
              className={`ml-auto flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                recording
                  ? 'animate-pulse bg-[var(--danger)] text-white'
                  : 'bg-[#f7e8e6] text-[var(--danger)] hover:bg-[#f2dbd8]'
              }`}
              title="Select text, then dictate a replacement"
            >
              <Icon name="mic" className="h-4 w-4" /> {recording ? 'Stop' : 'Voice edit'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[#f4ecdf] hover:text-[var(--text-primary)] ${
              step === 'compose' ? '' : 'ml-auto'
            }`}
            aria-label="Close post composer"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

          {step === 'compose' && (
            <>
              {mode === 'article' && (
                <div className="mb-4 rounded-xl bg-[#f8f3eb] px-4 py-3">
                  <Badge tone="warning">Backend support required</Badge>
                  <p className="secondary-copy mt-2">
                    Lamina’s current forum schema supports discussions, not articles. You may
                    compose below, but publication remains disabled rather than simulating success.
                  </p>
                </div>
              )}

              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Untitled"
                aria-label="Post title"
                className="page-title w-full border-none bg-transparent text-3xl outline-none placeholder:text-[#d9d2c5]"
              />

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-full bg-[#f3e7db] py-1 pr-1.5 pl-2.5 text-xs font-semibold text-[var(--accent-hover)]"
                  >
                    #{tag.replace(/\s+/g, '')}
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[rgb(147_71_41/60%)] hover:bg-[rgb(184_92_50/18%)] hover:text-[var(--accent-hover)]"
                      title={`Remove ${tag}`}
                    >
                      <Icon name="close" className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && tagInput.trim()) {
                      event.preventDefault()
                      addTag(tagInput)
                    } else if (event.key === 'Backspace' && !tagInput && tags.length > 0) {
                      setTags((prev) => prev.slice(0, -1))
                    }
                  }}
                  placeholder={tags.length === 0 ? 'Add topics — e.g. Cardiology…' : 'Add topic…'}
                  aria-label="Add topics"
                  className="min-w-36 flex-1 border-none bg-transparent py-1 text-sm outline-none placeholder:text-[#d9d2c5]"
                />
              </div>
              {tagInput.trim() === '' && tags.length === 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {suggestedTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => addTag(tag)}
                      className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent-hover)]"
                    >
                      + {tag}
                    </button>
                  ))}
                </div>
              )}

              <div
                className="sticky top-0 z-10 mt-4 flex items-center gap-0.5 rounded-xl border border-[var(--border)] bg-[#faf6ee] px-2 py-1.5"
                onMouseDown={(event) => event.preventDefault()}
              >
                <button type="button" onClick={() => exec('bold')} title="Bold" className={`${toolButton} text-sm font-black`}>B</button>
                <button type="button" onClick={() => exec('italic')} title="Italic" className={`${toolButton} text-sm font-semibold italic`}>I</button>
                <button type="button" onClick={() => exec('underline')} title="Underline" className={`${toolButton} text-sm font-semibold underline`}>U</button>
                <button type="button" onClick={() => exec('strikeThrough')} title="Strikethrough" className={`${toolButton} text-sm font-semibold line-through`}>S</button>
                <span className="mx-1 h-5 w-px bg-[var(--border)]" />
                <button type="button" onClick={() => applyBlock('h1')} title="Heading 1" className={`${toolButton} text-xs font-black`}>H1</button>
                <button type="button" onClick={() => applyBlock('h2')} title="Heading 2" className={`${toolButton} text-xs font-black`}>H2</button>
                <button type="button" onClick={() => applyBlock('p')} title="Plain text" className={`${toolButton} text-xs font-bold`}>T</button>
                <span className="mx-1 h-5 w-px bg-[var(--border)]" />
                <button type="button" onClick={() => exec('insertUnorderedList')} title="Bullet list" className={`${toolButton} text-base`}>•</button>
                <button type="button" onClick={() => exec('insertOrderedList')} title="Numbered list" className={`${toolButton} text-xs font-bold`}>1.</button>
                <button type="button" onClick={() => applyBlock('blockquote')} title="Quote" className={toolButton}>
                  <Icon name="quote" className="h-4 w-4" />
                </button>
                <span className="ml-auto hidden text-xs text-[var(--text-secondary)] sm:block">
                  or select text / type “/”
                </span>
              </div>

              <div ref={wrapRef} className="relative mt-2">
                {bubble && (
                  <div
                    className="absolute z-20 flex items-center gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg"
                    style={{ top: bubble.top, left: bubble.left }}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <button type="button" onClick={() => exec('bold')} title="Bold" className={`${bubbleButton} text-sm font-black`}>B</button>
                    <button type="button" onClick={() => exec('italic')} title="Italic" className={`${bubbleButton} text-sm font-semibold italic`}>I</button>
                    <button type="button" onClick={() => exec('underline')} title="Underline" className={`${bubbleButton} text-sm font-semibold underline`}>U</button>
                    <button type="button" onClick={() => exec('strikeThrough')} title="Strikethrough" className={`${bubbleButton} text-sm font-semibold line-through`}>S</button>
                    <span className="mx-0.5 h-5 w-px bg-[var(--border)]" />
                    <button type="button" onClick={() => applyBlock('h1')} title="Heading 1" className={`${bubbleButton} text-xs font-black`}>H1</button>
                    <button type="button" onClick={() => applyBlock('h2')} title="Heading 2" className={`${bubbleButton} text-xs font-black`}>H2</button>
                    <button type="button" onClick={() => applyBlock('blockquote')} title="Quote" className={bubbleButton}>
                      <Icon name="quote" className="h-4 w-4" />
                    </button>
                    <span className="mx-0.5 h-5 w-px bg-[var(--border)]" />
                    <button
                      type="button"
                      onClick={startVoiceEdit}
                      title="Dictate a replacement for the selection"
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        recording ? 'animate-pulse bg-[var(--danger)] text-white' : 'text-[var(--danger)] hover:bg-[#f7e8e6]'
                      }`}
                    >
                      <Icon name="mic" className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {slashMenu && (
                  <div
                    className="absolute z-20 w-60 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
                    style={{ top: slashMenu.top, left: slashMenu.left }}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <div className="px-3 py-1.5 text-[11px] font-bold tracking-wide text-[var(--text-secondary)] uppercase">
                      Blocks
                    </div>
                    {blockOptions.map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => runSlashCommand(option.action)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#f8f0e8]"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-bold text-[var(--text-secondary)]">
                          {option.icon}
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-[var(--text-primary)]">{option.label}</span>
                          <span className="block text-xs text-[var(--text-secondary)]">{option.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  aria-label={mode === 'article' ? 'Article body' : 'Post body'}
                  onKeyDown={(event) => {
                    if (event.key === '/') setTimeout(openSlashMenu, 0)
                    else if (slashMenu && event.key !== 'Shift') setSlashMenu(null)
                  }}
                  onInput={() => {
                    contentHtmlRef.current = editorRef.current?.innerHTML ?? ''
                  }}
                  className="min-h-[16rem] text-[16px] leading-relaxed text-[var(--text-primary)] outline-none [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-[rgb(184_92_50/35%)] [&_blockquote]:pl-4 [&_blockquote]:text-[var(--text-secondary)] [&_blockquote]:italic [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:font-[var(--font-display)] [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2]:font-[var(--font-display)] [&_h2]:text-xl [&_h2]:font-bold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
                />
              </div>

              {voiceStatus && (
                <div
                  className={`mt-3 rounded-xl px-3.5 py-2 text-sm ${
                    recording ? 'bg-[#f7e8e6] text-[var(--danger)]' : 'bg-[#f4ecdf] text-[var(--text-secondary)]'
                  }`}
                  role="status"
                >
                  {voiceStatus}
                </div>
              )}

              {mode === 'question' && patientContext && (
                <label className="patient-context-option mt-4">
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
            </>
          )}

          {step === 'review' && (
            <article className="post-review">
              <div className="flex flex-wrap gap-2">
                <Badge tone={backendDraft ? 'clinical' : 'success'}>
                  {backendDraft ? 'AI-assisted bounded draft' : 'Manually authored'}
                </Badge>
                <Badge tone="warning">Ready for physician publication</Badge>
              </div>
              <h2 className="publication-title mt-4 text-[1.4rem]">{preview.title}</h2>
              <p className="body-copy mt-3 whitespace-pre-wrap">{preview.content}</p>
              {preview.contextSummary && <p className="secondary-copy mt-3">{preview.contextSummary}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {preview.topics.map((topic) => <Badge key={topic}>{topic}</Badge>)}
              </div>
              {backendDraft && (
                <p className="metadata mt-4">
                  This complete backend draft already exists for review. Closing will not publish it.
                </p>
              )}
            </article>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-[var(--border)] px-6 py-4">
          <span className="hidden text-xs text-[var(--text-secondary)] sm:block">
            {step === 'compose'
              ? 'Select text for the formatting bubble · type “/” for blocks · the mic dictates over your selection'
              : `Posting as ${physician.physician.display_name}`}
          </span>
          <button
            type="button"
            onClick={() => {
              if (step === 'review') setStep('compose')
              else onClose()
            }}
            disabled={busy}
            className="ml-auto rounded-full px-5 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[#f4ecdf]"
          >
            {step === 'review' ? 'Back to edit' : 'Cancel'}
          </button>
          {step === 'compose' ? (
            <button
              type="button"
              onClick={() => void continueToReview()}
              disabled={!title.trim() || busy || mode === 'article'}
              className="button-primary"
            >
              {busy ? 'Preparing review...' : mode === 'article' ? 'Article publishing deferred' : 'Continue to review'}
            </button>
          ) : (
            <button type="button" onClick={() => void publish()} disabled={busy} className="button-primary">
              {busy ? 'Publishing...' : 'Publish'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
