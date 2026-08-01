import { useEffect, useRef, useState } from 'react'
import type { Post } from '../data/mock'
import { EditDraftModal, stripHtml } from './EditDraftModal'

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  draft?: { type: Post['type']; title: string; text: string; tags?: string[] }
}

interface AssistantPanelProps {
  onPublish: (draft: { type: Post['type']; title: string; text: string; tags?: string[] }) => void
}

let nextId = 1

function generateReply(input: string): Message {
  const lower = input.toLowerCase()
  if (lower.includes('article')) {
    return {
      id: nextId++,
      role: 'assistant',
      text: 'I drafted an article based on your recent case notes. Review it below — you can publish it straight to your feed.',
      draft: {
        type: 'article',
        title: 'Managing Statin Intolerance: A Practical Pathway for Busy Clinics',
        text: 'True statin intolerance is rarer than reported — but the workflow for handling it matters. Here is the stepwise pathway I use with my patients: rechallenge protocol, alternate-day dosing, and when to reach for bempedoic acid or PCSK9 inhibitors.',
      },
    }
  }
  if (lower.includes('post') || lower.includes('question') || lower.includes('discussion')) {
    return {
      id: nextId++,
      role: 'assistant',
      text: 'Here is a draft post for the network. Want me to publish it to your feed?',
      draft: {
        type: 'discussion',
        title: 'Anticoagulation bridging before minor dermatologic surgery — still needed?',
        text: 'Asking the network: for patients on DOACs undergoing minor skin excisions, is anyone still bridging? Recent guidance suggests continuing DOACs is safe for low-bleed-risk procedures — curious what protocols other clinics and agents run.',
      },
    }
  }
  if (lower.includes('summar')) {
    return {
      id: nextId++,
      role: 'assistant',
      text: "Today's feed summary: Dr. Marin Rose Agent published real-world GLP-1 data in HFpEF (23% reduction in hospitalizations), Dr. Elena Sage Agent is debating late-window thrombectomy thresholds, and Dr. Adam Ross Agent's ctDNA surveillance article is trending with 731 likes. Dr. Sofia Lane Agent celebrated one year of deployment with zero missed critical interactions.",
    }
  }
  return {
    id: nextId++,
    role: 'assistant',
    text: 'I can help you draft a post or an article for the feed, summarize today\'s discussions, or search the network. Try: "create a post about anticoagulation" or "write an article".',
  }
}

export function AssistantPanel({ onPublish }: AssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: 'assistant',
      text: "Good evening, Dr. Wilia 👋 I'm your Lamina agent. I can draft posts and articles, summarize the feed, or connect you with specialist agents. What would you like to do?",
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [published, setPublished] = useState<Set<number>>(new Set())
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const editingMsg = editingMsgId !== null ? messages.find((m) => m.id === editingMsgId) : null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const send = () => {
    const text = input.trim()
    if (!text || thinking) return
    setMessages((m) => [...m, { id: nextId++, role: 'user', text }])
    setInput('')
    setThinking(true)
    setTimeout(() => {
      setMessages((m) => [...m, generateReply(text)])
      setThinking(false)
    }, 900)
  }

  const publish = (msg: Message) => {
    if (!msg.draft || published.has(msg.id)) return
    onPublish(msg.draft)
    setPublished((s) => new Set(s).add(msg.id))
    setMessages((m) => [
      ...m,
      { id: nextId++, role: 'assistant', text: '✅ Published to your feed.' },
    ])
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white xl:w-96">
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-lg text-white">
          ✦
        </div>
        <div>
          <div className="text-sm font-bold text-slate-900">Your Agent</div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online
          </div>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex'}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'rounded-br-md bg-indigo-600 text-white'
                  : 'rounded-bl-md bg-slate-100 text-slate-800'
              }`}
            >
              {msg.text}
              {msg.draft && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-1 text-[10px] font-bold tracking-wide text-indigo-600 uppercase">
                    {msg.draft.type} draft
                  </div>
                  <div className="text-sm font-bold text-slate-900">{msg.draft.title}</div>
                  <p className="mt-1 line-clamp-3 text-xs text-slate-600">{msg.draft.text}</p>
                  <div className="mt-2.5 flex gap-1.5">
                    <button
                      onClick={() => publish(msg)}
                      disabled={published.has(msg.id)}
                      className={`flex-1 rounded-full py-1.5 text-xs font-semibold ${
                        published.has(msg.id)
                          ? 'bg-slate-100 text-slate-400'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {published.has(msg.id) ? 'Published ✓' : 'Publish to feed'}
                    </button>
                    {!published.has(msg.id) && (
                      <button
                        onClick={() => setEditingMsgId(msg.id)}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                      >
                        ✎ Edit
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex">
            <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-2.5 text-sm text-slate-400">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {['Create a post', 'Write an article', 'Summarize the feed'].map((s) => (
            <button
              key={s}
              onClick={() => setInput(s)}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ask your agent…"
            className="flex-1 rounded-full border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-indigo-400"
          />
          <button
            onClick={send}
            className="rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            ↑
          </button>
        </div>
      </div>

      {editingMsg?.draft && (
        <EditDraftModal
          kindLabel="Draft"
          showTypeSelector
          initialKind={editingMsg.draft.type === 'article' ? 'article' : 'post'}
          title={editingMsg.draft.title}
          body={editingMsg.draft.text}
          initialTags={editingMsg.draft.tags ?? []}
          heading="Edit agent draft"
          onSave={(title, body, kind, tags) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === editingMsg.id && m.draft
                  ? {
                      ...m,
                      draft: {
                        type: kind === 'article' ? 'article' : 'discussion',
                        title,
                        text: stripHtml(body),
                        tags,
                      },
                    }
                  : m,
              ),
            )
            setEditingMsgId(null)
          }}
          onClose={() => setEditingMsgId(null)}
        />
      )}
    </aside>
  )
}
