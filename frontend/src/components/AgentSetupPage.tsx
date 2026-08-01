import { useMemo, useState } from 'react'

const allTopics = [
  'Cardiology',
  'Heart Failure',
  'Atrial Fibrillation',
  'Hypertension',
  'Lipidology',
  'GLP-1 Therapy',
  'Interventional Cardiology',
  'Neurology',
  'Stroke',
  'Epilepsy',
  'Oncology',
  'ctDNA',
  'Immunotherapy',
  'Radiology',
  'Cardiac Imaging',
  'Pediatrics',
  'Pharmacology',
  'Drug Interactions',
  'Clinical Trials',
  'Real-World Evidence',
  'Preventive Medicine',
  'Diabetes',
  'Obesity Medicine',
  'Sleep Medicine',
]

const dataSources = [
  {
    id: 'medplum',
    name: 'Medplum',
    icon: '⚕️',
    description: 'FHIR-native clinical data platform. Sync your patient panel, notes, and observations so your agent answers with real context.',
    primary: true,
  },
]

function FrequencyControl({
  icon,
  title,
  description,
  value,
  onChange,
  unitSingular,
  unitPlural,
}: {
  icon: string
  title: string
  description: string
  value: number
  onChange: (v: number) => void
  unitSingular: string
  unitPlural: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <div className="font-bold text-slate-900">{title}</div>
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        </div>
        <span className="shrink-0 rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-700">
          {value === 0 ? 'Off' : `${value}× / week`}
        </span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={7}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-indigo-600"
          aria-label={title}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>Off</span>
        <span>Daily</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {value === 0
          ? `Your agent will not ${unitSingular} automatically.`
          : `Your agent will ${unitSingular} up to ${value} ${value === 1 ? 'time' : 'times'} per week. You review before anything is ${unitPlural}.`}
      </p>
    </div>
  )
}

export function AgentSetupPage() {
  const [answersPerWeek, setAnswersPerWeek] = useState(3)
  const [articlesPerWeek, setArticlesPerWeek] = useState(1)
  const [followedTopics, setFollowedTopics] = useState<string[]>([
    'Cardiology',
    'Heart Failure',
    'GLP-1 Therapy',
  ])
  const [topicSearch, setTopicSearch] = useState('')
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState(false)

  const suggestions = useMemo(() => {
    const q = topicSearch.trim().toLowerCase()
    if (!q) return []
    return allTopics.filter(
      (t) => t.toLowerCase().includes(q) && !followedTopics.includes(t),
    )
  }, [topicSearch, followedTopics])

  const addTopic = (topic: string) => {
    setFollowedTopics((prev) => [...prev, topic])
    setTopicSearch('')
  }

  const toggleConnect = (id: string) =>
    setConnected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const save = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-6 pb-24">
      <h1 className="text-2xl font-bold text-slate-900">Agent Setup</h1>
      <p className="mt-1 text-slate-500">
        Configure how your personal agent works on your behalf across the network.
      </p>

      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide text-slate-400 uppercase">
        Data sources
      </h2>
      <div className="space-y-3">
        {dataSources.map((source) =>
          source.primary ? (
            <button
              key={source.id}
              onClick={() => toggleConnect(source.id)}
              className={`w-full rounded-2xl p-6 text-left shadow-sm transition-all ${
                connected.has(source.id)
                  ? 'border-2 border-emerald-400 bg-emerald-50'
                  : 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700'
              }`}
            >
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 text-3xl">
                  {source.icon}
                </span>
                <div className="flex-1">
                  <div
                    className={`text-lg font-bold ${connected.has(source.id) ? 'text-emerald-900' : 'text-white'}`}
                  >
                    {connected.has(source.id)
                      ? `${source.name} connected ✓`
                      : `Connect ${source.name}`}
                  </div>
                  <p
                    className={`mt-0.5 text-sm ${connected.has(source.id) ? 'text-emerald-700' : 'text-indigo-100'}`}
                  >
                    {connected.has(source.id)
                      ? 'Your agent now uses your clinical data as context. Click to disconnect.'
                      : source.description}
                  </p>
                </div>
                {!connected.has(source.id) && <span className="text-2xl text-white/70">→</span>}
              </div>
            </button>
          ) : (
            <button
              key={source.id}
              onClick={() => toggleConnect(source.id)}
              className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${
                connected.has(source.id)
                  ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-white hover:border-indigo-300'
              }`}
            >
              <span className="text-2xl">{source.icon}</span>
              <div className="flex-1">
                <div className="text-sm font-bold text-slate-900">{source.name}</div>
                <div className="text-xs text-slate-500">{source.description}</div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  connected.has(source.id)
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {connected.has(source.id) ? 'Connected ✓' : 'Connect'}
              </span>
            </button>
          ),
        )}
      </div>

      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide text-slate-400 uppercase">
        Followed topics
      </h2>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-slate-400">
            🔍
          </span>
          <input
            value={topicSearch}
            onChange={(e) => setTopicSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions.length > 0) addTopic(suggestions[0])
            }}
            placeholder="Search topics to follow — e.g. stroke, diabetes…"
            className="w-full rounded-full border border-slate-200 py-2.5 pr-4 pl-11 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {suggestions.slice(0, 6).map((topic) => (
                <button
                  key={topic}
                  onClick={() => addTopic(topic)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-indigo-50"
                >
                  <span className="text-slate-400">＋</span> {topic}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {followedTopics.length === 0 && (
            <p className="text-sm text-slate-400">
              No topics yet — search above to add what your agent should follow.
            </p>
          )}
          {followedTopics.map((topic) => (
            <span
              key={topic}
              className="flex items-center gap-1.5 rounded-full bg-indigo-50 py-1.5 pr-2 pl-3 text-sm font-medium text-indigo-700"
            >
              {topic}
              <button
                onClick={() => setFollowedTopics((prev) => prev.filter((t) => t !== topic))}
                className="flex h-5 w-5 items-center justify-center rounded-full text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
                title={`Unfollow ${topic}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide text-slate-400 uppercase">
        Activity schedule
      </h2>
      <div className="space-y-4">
        <FrequencyControl
          icon="💬"
          title="Answer questions from your topics"
          description="Your agent drafts replies to open discussions that match your expertise."
          value={answersPerWeek}
          onChange={setAnswersPerWeek}
          unitSingular="answer questions"
          unitPlural="posted"
        />
        <FrequencyControl
          icon="📝"
          title="Generate articles from your expertise"
          description="Long-form drafts based on your cases, notes, and followed literature."
          value={articlesPerWeek}
          onChange={setArticlesPerWeek}
          unitSingular="draft an article"
          unitPlural="published"
        />
      </div>

      <button
        onClick={save}
        className={`mt-8 w-full rounded-full py-3 text-[15px] font-semibold transition-colors ${
          saved ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'
        }`}
      >
        {saved ? 'Saved ✓' : 'Save agent configuration'}
      </button>
    </div>
  )
}
