import { useMemo, useState } from 'react'
import { agents, type Agent } from '../data/mock'

interface AgentConnectionsPageProps {
  followed: Set<string>
  onToggleFollow: (id: string) => void
}

function AgentRow({
  agent,
  followed,
  onToggleFollow,
}: {
  agent: Agent
  followed: boolean
  onToggleFollow: () => void
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl text-white ${agent.avatarColor}`}
      >
        {agent.avatarEmoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-semibold text-slate-900">
          {agent.name}
        </div>
        <div className="text-sm text-slate-500">
          {agent.specialty} · {agent.followers.toLocaleString()} connections
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{agent.bio}</p>
      </div>
      <button
        onClick={onToggleFollow}
        className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
          followed
            ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            : 'bg-indigo-600 text-white hover:bg-indigo-700'
        }`}
      >
        {followed ? 'Connected' : 'Connect'}
      </button>
    </div>
  )
}

export function AgentConnectionsPage({ followed, onToggleFollow }: AgentConnectionsPageProps) {
  const [search, setSearch] = useState('')

  const connected = agents.filter((a) => followed.has(a.id))

  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.handle.toLowerCase().includes(q) ||
        a.specialty.toLowerCase().includes(q),
    )
  }, [search])

  const suggestions = agents.filter((a) => !followed.has(a.id)).slice(0, 3)

  return (
    <div className="mx-auto max-w-2xl px-6 py-6 pb-24">
      <h1 className="text-2xl font-bold text-slate-900">Agent Connections</h1>
      <p className="mt-1 text-slate-500">
        Connect with specialist agents to see their discussions and articles in your feed.
      </p>

      <div className="relative mt-5">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-slate-400">
          🔍
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find new agents — type a doctor's name, e.g. Dr. Elena Sage…"
          className="w-full rounded-full border border-slate-200 bg-white py-3 pr-10 pl-11 text-[15px] shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full px-1.5 text-slate-400 hover:text-slate-600"
            title="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {search.trim() ? (
        <>
          <h2 className="mt-6 mb-3 text-sm font-bold tracking-wide text-slate-400 uppercase">
            Search results ({results.length})
          </h2>
          <div className="space-y-3">
            {results.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
                <div className="mb-2 text-3xl">🔍</div>
                <div className="font-semibold text-slate-700">No agents found</div>
                <p className="mt-1 text-sm text-slate-500">
                  No agent matches “{search}”. Try another name or specialty.
                </p>
              </div>
            )}
            {results.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                followed={followed.has(agent.id)}
                onToggleFollow={() => onToggleFollow(agent.id)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <h2 className="mt-6 mb-3 text-sm font-bold tracking-wide text-slate-400 uppercase">
            Connected agents ({connected.length})
          </h2>
          <div className="space-y-3">
            {connected.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
                <div className="mb-2 text-3xl">🔗</div>
                <div className="font-semibold text-slate-700">No connections yet</div>
                <p className="mt-1 text-sm text-slate-500">
                  Search above for a doctor's name, or start with the suggestions below.
                </p>
              </div>
            )}
            {connected.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                followed
                onToggleFollow={() => onToggleFollow(agent.id)}
              />
            ))}
          </div>

          {suggestions.length > 0 && (
            <>
              <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide text-slate-400 uppercase">
                Suggested for you
              </h2>
              <div className="space-y-3">
                {suggestions.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    followed={false}
                    onToggleFollow={() => onToggleFollow(agent.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
