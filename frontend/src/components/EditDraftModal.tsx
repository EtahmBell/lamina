import { useCallback, useEffect, useRef, useState } from 'react'

export type DraftKind = 'post' | 'article'

export const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

interface EditDraftModalProps {
  kindLabel: string
  showTypeSelector: boolean
  initialKind: DraftKind
  title: string
  body: string
  initialTags?: string[]
  heading?: string
  saveLabel?: string
  onSave: (title: string, bodyHtml: string, kind: DraftKind, tags: string[]) => void
  onClose: () => void
}

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

function toInitialHtml(body: string): string {
  if (/<(p|h1|h2|h3|ul|ol|blockquote|div)[\s>]/i.test(body)) return body
  return body
    .split(/\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${p}</p>`)
    .join('')
}

export function EditDraftModal({
  kindLabel,
  showTypeSelector,
  initialKind,
  title,
  body,
  initialTags = [],
  heading = 'Edit draft',
  saveLabel = 'Save changes',
  onSave,
  onClose,
}: EditDraftModalProps) {
  const [draftTitle, setDraftTitle] = useState(title)
  const [kind, setKind] = useState<DraftKind>(initialKind)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [tagInput, setTagInput] = useState('')

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, '')
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setTags((prev) => [...prev, tag])
    }
    setTagInput('')
  }
  const [recording, setRecording] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null)
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null)
  const [slashMenu, setSlashMenu] = useState<{ top: number; left: number } | null>(null)

  const editorRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = toInitialHtml(body)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (slashMenu) setSlashMenu(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, slashMenu])

  useEffect(() => () => recognitionRef.current?.stop(), [])

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
    // remove the "/" the user typed to open the menu
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
      editorRef.current?.focus()
      const sel = window.getSelection()
      if (target && sel) {
        sel.removeAllRanges()
        sel.addRange(target)
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
        ? '🎙 Listening… dictated text will replace your selection.'
        : '🎙 Listening… dictated text will be inserted at the cursor.',
    )
    setRecording(true)
    recognition.start()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">{heading}</h2>
          {showTypeSelector ? (
            <div className="flex gap-1 rounded-full bg-slate-100 p-1">
              <button
                onClick={() => setKind('post')}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  kind === 'post' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                💬 Post
              </button>
              <button
                onClick={() => setKind('article')}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  kind === 'article' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                📝 Article
              </button>
            </div>
          ) : (
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 uppercase">
              {kindLabel}
            </span>
          )}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={startVoiceEdit}
            className={`ml-auto flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              recording
                ? 'animate-pulse bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-600 hover:bg-rose-100'
            }`}
            title="Select text, then dictate a replacement"
          >
            🎤 {recording ? 'Stop' : 'Voice edit'}
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Untitled"
            className="w-full border-none text-3xl font-extrabold text-slate-900 outline-none placeholder:text-slate-300"
          />

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full bg-indigo-50 py-1 pr-1.5 pl-2.5 text-xs font-semibold text-indigo-700"
              >
                #{tag.replace(/\s+/g, '')}
                <button
                  onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
                  title={`Remove ${tag}`}
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  e.preventDefault()
                  addTag(tagInput)
                } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                  setTags((prev) => prev.slice(0, -1))
                }
              }}
              placeholder={tags.length === 0 ? 'Add topics — e.g. Cardiology…' : 'Add topic…'}
              className="min-w-36 flex-1 border-none py-1 text-sm outline-none placeholder:text-slate-300"
            />
          </div>
          {tagInput.trim() === '' && tags.length === 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestedTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => addTag(tag)}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:border-indigo-300 hover:text-indigo-700"
                >
                  + {tag}
                </button>
              ))}
            </div>
          )}

          <div
            className="sticky top-0 z-10 mt-4 flex items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5"
            onMouseDown={(e) => e.preventDefault()}
          >
            <button onClick={() => exec('bold')} title="Bold" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black text-slate-600 hover:bg-white hover:shadow-sm">
              B
            </button>
            <button onClick={() => exec('italic')} title="Italic" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold text-slate-600 italic hover:bg-white hover:shadow-sm">
              I
            </button>
            <button onClick={() => exec('underline')} title="Underline" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold text-slate-600 underline hover:bg-white hover:shadow-sm">
              U
            </button>
            <button onClick={() => exec('strikeThrough')} title="Strikethrough" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold text-slate-600 line-through hover:bg-white hover:shadow-sm">
              S
            </button>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <button onClick={() => applyBlock('h1')} title="Heading 1" className="flex h-8 min-w-8 items-center justify-center rounded-lg px-1 text-xs font-black text-slate-600 hover:bg-white hover:shadow-sm">
              H1
            </button>
            <button onClick={() => applyBlock('h2')} title="Heading 2" className="flex h-8 min-w-8 items-center justify-center rounded-lg px-1 text-xs font-black text-slate-600 hover:bg-white hover:shadow-sm">
              H2
            </button>
            <button onClick={() => applyBlock('p')} title="Plain text" className="flex h-8 min-w-8 items-center justify-center rounded-lg px-1 text-xs font-bold text-slate-600 hover:bg-white hover:shadow-sm">
              T
            </button>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <button onClick={() => exec('insertUnorderedList')} title="Bullet list" className="flex h-8 w-8 items-center justify-center rounded-lg text-base text-slate-600 hover:bg-white hover:shadow-sm">
              •
            </button>
            <button onClick={() => exec('insertOrderedList')} title="Numbered list" className="flex h-8 min-w-8 items-center justify-center rounded-lg px-1 text-xs font-bold text-slate-600 hover:bg-white hover:shadow-sm">
              1.
            </button>
            <button onClick={() => applyBlock('blockquote')} title="Quote" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-600 hover:bg-white hover:shadow-sm">
              ❝
            </button>
            <span className="ml-auto hidden text-xs text-slate-400 sm:block">
              or select text / type “/”
            </span>
          </div>

          <div ref={wrapRef} className="relative mt-2">
            {bubble && (
              <div
                className="absolute z-20 flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                style={{ top: bubble.top, left: bubble.left }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <button onClick={() => exec('bold')} title="Bold" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black text-slate-700 hover:bg-slate-100">
                  B
                </button>
                <button onClick={() => exec('italic')} title="Italic" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold text-slate-700 italic hover:bg-slate-100">
                  I
                </button>
                <button onClick={() => exec('underline')} title="Underline" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold text-slate-700 underline hover:bg-slate-100">
                  U
                </button>
                <button onClick={() => exec('strikeThrough')} title="Strikethrough" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold text-slate-700 line-through hover:bg-slate-100">
                  S
                </button>
                <span className="mx-0.5 h-5 w-px bg-slate-200" />
                <button onClick={() => applyBlock('h1')} title="Heading 1" className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black text-slate-700 hover:bg-slate-100">
                  H1
                </button>
                <button onClick={() => applyBlock('h2')} title="Heading 2" className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black text-slate-700 hover:bg-slate-100">
                  H2
                </button>
                <button onClick={() => applyBlock('blockquote')} title="Quote" className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-slate-700 hover:bg-slate-100">
                  ❝
                </button>
                <span className="mx-0.5 h-5 w-px bg-slate-200" />
                <button
                  onClick={startVoiceEdit}
                  title="Dictate a replacement for the selection"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm hover:bg-rose-50 ${recording ? 'animate-pulse bg-rose-600' : ''}`}
                >
                  🎤
                </button>
              </div>
            )}

            {slashMenu && (
              <div
                className="absolute z-20 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
                style={{ top: slashMenu.top, left: slashMenu.left }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <div className="px-3 py-1.5 text-[11px] font-bold tracking-wide text-slate-400 uppercase">
                  Blocks
                </div>
                {blockOptions.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => runSlashCommand(opt.action)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-indigo-50"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600">
                      {opt.icon}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">{opt.label}</span>
                      <span className="block text-xs text-slate-400">{opt.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onKeyDown={(e) => {
                if (e.key === '/') setTimeout(openSlashMenu, 0)
                else if (slashMenu && e.key !== 'Shift') setSlashMenu(null)
              }}
              className="min-h-[20rem] text-[16px] leading-relaxed text-slate-800 outline-none [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-200 [&_blockquote]:pl-4 [&_blockquote]:text-slate-600 [&_blockquote]:italic [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-extrabold [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2]:text-xl [&_h2]:font-bold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
            />
          </div>

          {voiceStatus && (
            <div
              className={`mt-3 rounded-xl px-3.5 py-2 text-sm ${
                recording ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {voiceStatus}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-slate-200 px-6 py-4">
          <span className="text-xs text-slate-400">
            💡 Select text for the formatting bubble · type “/” for blocks · 🎤 dictates over your
            selection
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-full px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave(
                draftTitle,
                editorRef.current?.innerHTML ?? '',
                kind,
                tagInput.trim() ? [...tags, tagInput.trim().replace(/^#/, '')] : tags,
              )
            }
            className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
