import { useEffect, useState, type KeyboardEvent } from 'react'
import {
  saveAgentConfiguration,
  type AgentConfigurationUpdate,
  type AgentDetails,
} from '../api/client'
import {
  getActivityFrequency,
  saveActivityFrequency,
  type ActivityFrequency,
} from '../demo/demoAgentPreferences'
import { displayError } from '../utils'
import { Icon, type IconName } from './Icon'
import type { AskLaminaConfiguration } from './RightRail'
import { ErrorBanner } from './ui'

const ACTIVITY_STOPS: Array<{ value: ActivityFrequency; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'Your agent will not draft answers.' },
  { value: 'weekly', label: '1× / week', hint: 'Your agent will answer questions up to 1 time per week. You review before anything is posted.' },
  { value: 'three_times_weekly', label: '3× / week', hint: 'Your agent will answer questions up to 3 times per week. You review before anything is posted.' },
  { value: 'daily', label: 'Daily', hint: 'Your agent will answer questions daily. You review before anything is posted.' },
]

type ReportCadence = 'none' | 'weekly' | 'monthly'

const REPORT_STOPS: Array<{ value: ReportCadence; label: string; hint: string }> = [
  { value: 'none', label: 'Off', hint: 'Your agent will not prepare network reports.' },
  { value: 'weekly', label: 'Weekly', hint: 'Your agent will prepare a weekly summary of relevant discussions for your review.' },
  { value: 'monthly', label: 'Monthly', hint: 'Your agent will prepare a monthly summary of relevant discussions for your review.' },
]

export function AgentSetupPage({
  physician,
  medplumStatus,
  onAgentUpdated,
  onAskChange,
}: {
  physician: AgentDetails
  medplumStatus?: string | null
  onAgentUpdated: (agent: AgentDetails) => void
  onAskChange: (configuration: AskLaminaConfiguration) => void
}) {
  const configuration = physician.configuration
  const [monitoringTopics, setMonitoringTopics] = useState<string[]>([])
  const [expertiseTags, setExpertiseTags] = useState<string[]>([])
  const [reportTopics, setReportTopics] = useState<string[]>([])
  const [reportCadence, setReportCadence] = useState<ReportCadence>('none')
  const [activityFrequency, setActivityFrequency] = useState<ActivityFrequency>('off')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const medplumConnected = medplumStatus === 'connected'

  useEffect(() => {
    if (!configuration) return
    setMonitoringTopics(configuration.monitoring_topics)
    setExpertiseTags(configuration.declared_expertise_tags)
    setReportTopics(configuration.report_topics)
    setReportCadence(configuration.report_cadence)
    setActivityFrequency(
      getActivityFrequency(physician.physician_npi, configuration.response_drafting_enabled),
    )
  }, [configuration, physician.physician_npi])

  useEffect(() => {
    onAskChange({
      contextLabel: 'Agent Setup · physician-controlled preferences',
      placeholder: 'Ask what these preferences control...',
      processingLabel: 'Reviewing this settings context...',
      suggestions: ['What does weekly reporting mean?', 'What always requires my approval?'],
      onSubmit: async () =>
        'These controls store drafting and report preferences. Lamina does not run a background scheduler or publish without physician approval.',
    })
  }, [onAskChange])

  const save = async () => {
    if (!configuration || saving) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const payload: AgentConfigurationUpdate = {
        declared_expertise_tags: expertiseTags,
        monitoring_topics: monitoringTopics,
        voice_post_drafting_enabled: configuration.voice_post_drafting_enabled,
        response_drafting_enabled: activityFrequency !== 'off',
        thread_summaries_enabled: configuration.thread_summaries_enabled,
        citations_required: configuration.citations_required,
        publication_mode: 'requires_physician_approval',
        report_cadence: reportCadence,
        report_topics: reportTopics,
        report_source_scope: configuration.report_source_scope,
        report_length: configuration.report_length,
        notifications: configuration.notifications,
      }
      const updated = await saveAgentConfiguration(physician.id, payload)
      saveActivityFrequency(physician.physician_npi, activityFrequency)
      onAgentUpdated(updated)
      setSaved(true)
    } catch (saveError) {
      setError(displayError(saveError))
    } finally {
      setSaving(false)
    }
  }

  if (!configuration) {
    return (
      <div className="page-shell">
        <ErrorBanner message="This physician does not have an agent configuration yet." />
      </div>
    )
  }

  return (
    <div className="page-shell">
      <h1 className="page-title text-[1.8rem]">Agent Setup</h1>
      <p className="secondary-copy mt-2">
        Configure how your personal agent works on your behalf across the network. Nothing is
        published without your approval.
      </p>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      <div className="setup-eyebrow">Data sources</div>
      <div className={`setup-source-banner${medplumConnected ? ' connected' : ''}`}>
        <span className="setup-source-icon">
          <Icon name="stethoscope" className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="setup-source-title">
            {medplumConnected ? 'Medplum connected' : 'Connect Medplum'}
          </div>
          <p className="setup-source-copy">
            {medplumConnected
              ? 'Your agent answers with real context from your synced patient panel, notes, and observations.'
              : 'FHIR-native clinical data platform. Sync your patient panel, notes, and observations so your agent answers with real context.'}
          </p>
        </div>
        <Icon
          name={medplumConnected ? 'check' : 'arrow-right'}
          className="h-6 w-6 shrink-0 opacity-80"
        />
      </div>

      <div className="setup-eyebrow">Followed topics</div>
      <section className="setup-card">
        <TopicChips
          label="Monitoring topics"
          placeholder="Add a topic to follow — e.g. stroke, diabetes…"
          topics={monitoringTopics}
          onChange={setMonitoringTopics}
        />
        <div className="mt-6">
          <TopicChips
            label="Declared expertise"
            placeholder="Add an expertise tag…"
            topics={expertiseTags}
            onChange={setExpertiseTags}
          />
        </div>
      </section>

      <div className="setup-eyebrow">Activity schedule</div>
      <section className="setup-card">
        <ScheduleSlider
          icon="message"
          title="Answer questions from your topics"
          description="Your agent drafts replies to open discussions that match your expertise."
          stops={ACTIVITY_STOPS}
          value={activityFrequency}
          onChange={(value) => setActivityFrequency(value)}
        />
      </section>

      <section className="setup-card">
        <ScheduleSlider
          icon="note"
          title="Prepare network reports"
          description="Summaries of relevant discussions and clinical themes, prepared for your review."
          stops={REPORT_STOPS}
          value={reportCadence}
          onChange={(value) => setReportCadence(value)}
        />
        {reportCadence !== 'none' && (
          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <TopicChips
              label="Report topics"
              placeholder="Add a report topic…"
              topics={reportTopics}
              onChange={setReportTopics}
            />
          </div>
        )}
      </section>

      <footer className="mt-7 flex items-center gap-4">
        <button type="button" onClick={() => void save()} disabled={saving} className="button-primary">
          {saving ? 'Saving preferences...' : 'Save agent configuration'}
        </button>
        {saved && <span className="secondary-copy text-[var(--success)]">Preferences saved.</span>}
      </footer>
    </div>
  )
}

function TopicChips({
  label,
  placeholder,
  topics,
  onChange,
}: {
  label: string
  placeholder: string
  topics: string[]
  onChange: (topics: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const clean = draft.trim()
    if (!clean) return
    if (!topics.some((topic) => topic.toLowerCase() === clean.toLowerCase())) {
      onChange([...topics, clean])
    }
    setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    }
  }

  return (
    <div>
      <span className="metadata font-bold tracking-[0.06em] uppercase">{label}</span>
      <div className="setup-topic-search">
        <Icon name="search" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          placeholder={placeholder}
          aria-label={label}
        />
      </div>
      {topics.length > 0 && (
        <div className="setup-topic-chips">
          {topics.map((topic) => (
            <span key={topic} className="setup-topic-chip">
              {topic}
              <button
                type="button"
                onClick={() => onChange(topics.filter((item) => item !== topic))}
                aria-label={`Remove ${topic}`}
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ScheduleSlider<T extends string>({
  icon,
  title,
  description,
  stops,
  value,
  onChange,
}: {
  icon: IconName
  title: string
  description: string
  stops: Array<{ value: T; label: string; hint: string }>
  value: T
  onChange: (value: T) => void
}) {
  const index = Math.max(0, stops.findIndex((stop) => stop.value === value))
  const active = stops[index]

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="setup-slider-icon">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="setup-slider-title">{title}</div>
          <p className="secondary-copy mt-1">{description}</p>
        </div>
        <span className="setup-slider-badge">{active.label}</span>
      </div>
      <input
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        onChange={(event) => onChange(stops[Number(event.target.value)].value)}
        aria-label={title}
        className="setup-slider"
      />
      <div className="setup-slider-scale">
        <span>{stops[0].label}</span>
        <span>{stops[stops.length - 1].label}</span>
      </div>
      <p className="secondary-copy mt-3 text-[0.82rem]">{active.hint}</p>
    </div>
  )
}
