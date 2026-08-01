import { useEffect, useState } from 'react'
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
import type { AskLaminaConfiguration } from './RightRail'
import { Badge, ErrorBanner } from './ui'

const ACTIVITY_OPTIONS: Array<{ value: ActivityFrequency; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'weekly', label: '1× / week' },
  { value: 'three_times_weekly', label: '3× / week' },
  { value: 'daily', label: 'Daily' },
]

export function AgentSetupPage({
  physician,
  onAgentUpdated,
  onAskChange,
}: {
  physician: AgentDetails
  onAgentUpdated: (agent: AgentDetails) => void
  onAskChange: (configuration: AskLaminaConfiguration) => void
}) {
  const configuration = physician.configuration
  const [monitoringTopics, setMonitoringTopics] = useState('')
  const [expertiseTags, setExpertiseTags] = useState('')
  const [reportTopics, setReportTopics] = useState('')
  const [reportCadence, setReportCadence] = useState<'none' | 'weekly' | 'monthly'>('none')
  const [activityFrequency, setActivityFrequency] = useState<ActivityFrequency>('off')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!configuration) return
    setMonitoringTopics(configuration.monitoring_topics.join('\n'))
    setExpertiseTags(configuration.declared_expertise_tags.join('\n'))
    setReportTopics(configuration.report_topics.join('\n'))
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
        declared_expertise_tags: lines(expertiseTags),
        monitoring_topics: lines(monitoringTopics),
        voice_post_drafting_enabled: configuration.voice_post_drafting_enabled,
        response_drafting_enabled: activityFrequency !== 'off',
        thread_summaries_enabled: configuration.thread_summaries_enabled,
        citations_required: configuration.citations_required,
        publication_mode: 'requires_physician_approval',
        report_cadence: reportCadence,
        report_topics: lines(reportTopics),
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
      <header className="page-hero">
        <div>
          <div className="eyebrow">Physician-controlled preferences</div>
          <h1 className="page-title mt-1">Agent Setup</h1>
          <p className="secondary-copy mt-2">
            Decide what Lamina may prepare for review. Nothing is published without your approval.
          </p>
        </div>
        <Badge tone="clinical">{physician.physician.primary_specialty}</Badge>
      </header>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      <section className="settings-card mt-6">
        <div className="eyebrow">Followed topics</div>
        <h2 className="section-title mt-2">Clinical activity interests</h2>
        <p className="secondary-copy mt-2">One topic per line. Verified specialty remains backend-controlled.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <SettingTextarea label="Monitoring topics" value={monitoringTopics} onChange={setMonitoringTopics} />
          <SettingTextarea label="Declared expertise" value={expertiseTags} onChange={setExpertiseTags} />
        </div>
      </section>

      <section className="settings-card mt-5">
        <div className="eyebrow">Network activity</div>
        <h2 className="section-title mt-2">Answer relevant questions</h2>
        <p className="secondary-copy mt-2">
          This is a drafting preference only. Lamina does not currently run a background scheduler.
        </p>
        <SegmentedControl
          value={activityFrequency}
          options={ACTIVITY_OPTIONS}
          onChange={(value) => setActivityFrequency(value as ActivityFrequency)}
        />
      </section>

      <section className="settings-card mt-5">
        <div className="eyebrow">Network reports</div>
        <h2 className="section-title mt-2">Report frequency</h2>
        <p className="secondary-copy mt-2">
          Prepare a summary of relevant discussions and clinical themes for your review.
        </p>
        <SegmentedControl
          value={reportCadence}
          options={[
            { value: 'none', label: 'Off' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ]}
          onChange={(value) => setReportCadence(value as 'none' | 'weekly' | 'monthly')}
        />
        <div className="mt-5 max-w-xl">
          <SettingTextarea label="Report topics" value={reportTopics} onChange={setReportTopics} />
        </div>
      </section>

      <footer className="mt-6 flex items-center gap-4">
        <button type="button" onClick={() => void save()} disabled={saving} className="button-primary">
          {saving ? 'Saving preferences...' : 'Save preferences'}
        </button>
        {saved && <span className="secondary-copy text-[var(--success)]">Preferences saved.</span>}
      </footer>
    </div>
  )
}

function lines(value: string): string[] {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
}

function SettingTextarea({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="metadata font-bold tracking-[0.06em] uppercase">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        className="input-control mt-2 resize-y"
      />
    </label>
  )
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="settings-segments mt-5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
