import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  approveForumPost,
  generatePatientForumPost,
  getForumPost,
  getMyPatients,
  getPatientCaseContext,
  monitorForumPost,
  type AgentDetails,
  type ForumPost,
  type MonitoringResult,
  type PatientCaseContext,
  type PatientSummary,
} from '../api/client'
import {
  ASK_LAMINA_UNSUPPORTED,
  OPEN_PATIENT_FOR_NETWORK_QUESTION,
  isNetworkQuestionRequest,
  isPatientNetworkQuestionRequest,
  isReferralRequest,
} from '../askLamina'
import { displayError } from '../utils'
import { ForumPostView } from './ForumPostView'
import { Icon, type IconName } from './Icon'
import type { AskLaminaConfiguration } from './RightRail'
import type { PatientPostContext } from './PostComposerModal'
import { Badge, EmptyState, ErrorBanner, PageLoading, PrimaryButton } from './ui'

const selectedPatientKey = (physicianNpi: string) =>
  `lamina.selectedPatientRef.${physicianNpi}`
const postStorageKey = (physicianNpi: string, patientRef: string) =>
  `lamina.patientPost.${physicianNpi}.${patientRef}`

type PendingAction = 'patients' | 'case' | 'generating' | 'publishing' | 'monitoring' | null

function ClinicalList({
  title,
  icon,
  items,
}: {
  title: string
  icon: IconName
  items: Array<{ primary: string; secondary?: string }>
}) {
  return (
    <section className="clinical-context-card">
      <div className="clinical-card-head">
        <span className="clinical-card-icon">
          <Icon name={icon} className="h-4 w-4" />
        </span>
        <h3>{title}</h3>
        <span className="clinical-card-count">{items.length}</span>
      </div>
      {items.length ? (
        <ul className="clinical-item-list">
          {items.map((item) => (
            <li key={`${item.primary}-${item.secondary ?? ''}`}>
              <span className="clinical-item-primary">{item.primary}</span>
              {item.secondary && <span className="clinical-item-secondary">{item.secondary}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="secondary-copy mt-3">No bounded facts returned.</p>
      )}
    </section>
  )
}

export function PatientsPage({
  physician,
  organizationName,
  onOpenNetwork,
  onAskChange,
  onPatientContextChange,
}: {
  physician: AgentDetails
  organizationName: string | null
  onOpenNetwork: (postId: string) => void
  onAskChange: (configuration: AskLaminaConfiguration) => void
  onPatientContextChange: (context: PatientPostContext | null) => void
}) {
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [selectedRef, setSelectedRef] = useState<string | null>(() =>
    window.localStorage.getItem(selectedPatientKey(physician.physician_npi)),
  )
  const [caseContext, setCaseContext] = useState<PatientCaseContext | null>(null)
  const [post, setPost] = useState<ForumPost | null>(null)
  const [monitoringResults, setMonitoringResults] = useState<MonitoringResult[]>([])
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<PendingAction>('patients')
  const [error, setError] = useState<string | null>(null)

  const loadPatient = useCallback(
    async (patientRef: string) => {
      setPending('case')
      setError(null)
      setMonitoringResults([])
      try {
        const context = await getPatientCaseContext(physician.physician_npi, patientRef)
        setCaseContext(context)
        const storedPostId = window.localStorage.getItem(
          postStorageKey(physician.physician_npi, patientRef),
        )
        if (!storedPostId) {
          setPost(null)
          return
        }
        try {
          const storedPost = await getForumPost(storedPostId, physician.physician_npi)
          setPost(storedPost)
        } catch (loadError) {
          if (loadError instanceof ApiError && loadError.status === 404) {
            window.localStorage.removeItem(
              postStorageKey(physician.physician_npi, patientRef),
            )
            setPost(null)
          } else {
            throw loadError
          }
        }
      } catch (loadError) {
        setCaseContext(null)
        setPost(null)
        setError(displayError(loadError))
      } finally {
        setPending(null)
      }
    },
    [physician.physician_npi],
  )

  const loadPatients = useCallback(async () => {
    setPending('patients')
    setError(null)
    try {
      const result = await getMyPatients(physician.physician_npi)
      setPatients(result)
      if (selectedRef && result.some((patient) => patient.patient_ref === selectedRef)) {
        await loadPatient(selectedRef)
      } else if (selectedRef) {
        window.localStorage.removeItem(selectedPatientKey(physician.physician_npi))
        setSelectedRef(null)
      }
    } catch (loadError) {
      setPatients([])
      setError(displayError(loadError))
    } finally {
      setPending(null)
    }
  }, [loadPatient, physician.physician_npi, selectedRef])

  useEffect(() => {
    void loadPatients()
  }, [loadPatients])

  const visiblePatients = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return patients
    return patients.filter((patient) =>
      `${patient.display_name} ${patient.age_band} ${patient.summary}`
        .toLowerCase()
        .includes(query),
    )
  }, [patients, search])

  const selectPatient = (patientRef: string) => {
    window.localStorage.setItem(selectedPatientKey(physician.physician_npi), patientRef)
    setSelectedRef(patientRef)
  }

  const run = async (action: Exclude<PendingAction, 'patients' | 'case' | null>, task: () => Promise<void>) => {
    if (pending) return
    setPending(action)
    setError(null)
    try {
      await task()
    } catch (actionError) {
      setError(displayError(actionError))
    } finally {
      setPending(null)
    }
  }

  const generate = useCallback(async (request: string): Promise<string> => {
    const patientNetworkQuestion = isPatientNetworkQuestionRequest(request)
    if (
      isReferralRequest(request) ||
      (!patientNetworkQuestion && !isNetworkQuestionRequest(request))
    ) {
      return ASK_LAMINA_UNSUPPORTED
    }
    if (!selectedRef || pending) throw new Error('The patient context is not ready yet.')
    setPending('generating')
    setError(null)
    try {
      const generated = await generatePatientForumPost(
        physician.physician_npi,
        selectedRef,
        request,
      )
      window.localStorage.setItem(
        postStorageKey(physician.physician_npi, selectedRef),
        generated.id,
      )
      setPost(generated)
      setMonitoringResults([])
      return 'Network question ready for your review. It has not been published.'
    } catch (generationError) {
      setError(displayError(generationError))
      throw generationError
    } finally {
      setPending(null)
    }
  }, [pending, physician.physician_npi, selectedRef])

  useEffect(() => {
    if (caseContext && selectedRef) {
      onAskChange({
        contextLabel: `${caseContext.display_name} · bounded Medplum context`,
        placeholder: 'Ask the network about this synthetic patient context...',
        processingLabel: 'Preparing a real approval-required network question...',
        suggestions: [
          'Has anyone seen something similar?',
          'Draft a question about this medication pattern',
        ],
        onSubmit: generate,
      })
      return
    }
    onAskChange({
      contextLabel: 'My Patients · authorized synthetic panel',
      placeholder: 'Select a patient to work with bounded case context...',
      processingLabel: 'Reviewing patient workspace context...',
      suggestions: ['How does patient context stay private?'],
      onSubmit: async () => OPEN_PATIENT_FOR_NETWORK_QUESTION,
    })
  }, [caseContext, generate, onAskChange, selectedRef])

  useEffect(() => {
    onPatientContextChange(
      caseContext && selectedRef
        ? { patientRef: selectedRef, displayName: caseContext.display_name }
        : null,
    )
  }, [caseContext, onPatientContextChange, selectedRef])

  const approve = () =>
    run('publishing', async () => {
      if (!post) return
      setPost(await approveForumPost(post.id, physician.physician_npi))
    })

  const monitor = () =>
    run('monitoring', async () => {
      if (!post) return
      const result = await monitorForumPost(post.id)
      setMonitoringResults(result.results)
      setPost(await getForumPost(post.id, physician.physician_npi))
    })

  if (pending === 'patients' && patients.length === 0) {
    return (
      <div className="page-shell">
        <PageLoading>Loading authorized patients...</PageLoading>
      </div>
    )
  }

  if (!selectedRef) {
    return (
      <div className="page-shell">
        <div className="feed-searchbar">
          <Icon name="search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your patient panel…"
            aria-label="Search patients returned by Medplum"
          />
        </div>

        <div className="feed-headrow">
          <div>
            <h1>My Patients</h1>
            <p className="secondary-copy mt-1">
              Authorized synthetic Medplum panel for {physician.physician.display_name}
              {organizationName ? ` · ${organizationName}` : ''}. No raw FHIR resources are shown.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={() => void loadPatients()} className="text-action">
              Refresh
            </button>
            <Badge tone="clinical">Medplum synchronized</Badge>
          </div>
        </div>

        {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

        <div className="mt-6 grid gap-4">
          {visiblePatients.map((patient) => (
            <article key={patient.patient_ref} className="patient-card">
              <div className="patient-monogram">
                {patient.display_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="physician-name text-xl font-bold">{patient.display_name}</h3>
                  {patient.synthetic && <Badge tone="success">Synthetic</Badge>}
                </div>
                <div className="patient-meta">
                  <span><Icon name="user" className="h-3.5 w-3.5" /> Age {patient.age_band}</span>
                  <span><Icon name="chart" className="h-3.5 w-3.5" /> Medplum case</span>
                </div>
                {patient.summary && (
                  <p className="patient-summary">{patient.summary}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => selectPatient(patient.patient_ref)}
                className="button-primary patient-open-button"
              >
                Open patient
                <Icon name="arrow-right" className="h-4 w-4" />
              </button>
            </article>
          ))}
        </div>

        {visiblePatients.length === 0 && (
          <div className="mt-5">
            <EmptyState
              title={patients.length ? 'No patients match this search.' : 'No patients are available.'}
              detail="Lamina does not substitute mocked patients when Medplum returns no authorized records."
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page-shell">
      <button
        type="button"
        onClick={() => {
          window.localStorage.removeItem(selectedPatientKey(physician.physician_npi))
          setSelectedRef(null)
          setCaseContext(null)
          setPost(null)
          setError(null)
        }}
        className="text-action inline-flex items-center gap-1.5"
      >
        <Icon name="arrow-left" className="h-4 w-4" />
        Back to My Patients
      </button>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}
      {pending === 'case' ? (
        <div className="mt-5"><PageLoading>Loading bounded Medplum case...</PageLoading></div>
      ) : !caseContext ? (
        <div className="mt-5">
          <EmptyState
            title="Patient context is unavailable."
            detail="Return to My Patients or retry after the backend and Medplum are available."
          />
        </div>
      ) : (
        <>
          <header className="patient-hero mt-5">
            <div className="patient-monogram large">
              {caseContext.display_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="eyebrow">Patient chart summary</div>
              <h1 className="page-title mt-1">{caseContext.display_name}</h1>
              <div className="patient-meta mt-2">
                <span><Icon name="user" className="h-3.5 w-3.5" /> Age {caseContext.age_band}</span>
                <span>
                  <Icon name="stethoscope" className="h-3.5 w-3.5" />
                  {caseContext.conditions.length} condition{caseContext.conditions.length === 1 ? '' : 's'}
                </span>
                <span>
                  <Icon name="pharmacology" className="h-3.5 w-3.5" />
                  {caseContext.medications.length} medication{caseContext.medications.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Badge tone="success">Synthetic demo data</Badge>
              <Badge tone="clinical">Medplum synchronized</Badge>
            </div>
          </header>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <ClinicalList
              title="Conditions"
              icon="stethoscope"
              items={caseContext.conditions.map((item) => ({
                primary: item.display,
                secondary: item.clinical_status,
              }))}
            />
            <ClinicalList
              title="Medications"
              icon="pharmacology"
              items={caseContext.medications.map((item) => ({
                primary: item.display,
                secondary: item.timing_summary || item.status,
              }))}
            />
            <ClinicalList
              title="Observations & outcomes"
              icon="chart"
              items={caseContext.observations.map((item) => ({
                primary: item.display,
                secondary: [item.value_summary, item.effective_date].filter(Boolean).join(' · '),
              }))}
            />
          </div>

          {post && (
            <div className="mt-6 space-y-4">
              <ForumPostView post={post} />
              {post.status === 'awaiting_physician_approval' && (
                <div className="surface flex flex-wrap items-center gap-3 border-l-4 border-l-[var(--warning)] px-4 py-4">
                  <div>
                    <div className="font-semibold text-[var(--text-primary)]">Physician review required</div>
                    <div className="secondary-copy">Approval publishes this exact backend draft.</div>
                  </div>
                  <div className="ml-auto">
                    <PrimaryButton tone="approve" disabled={pending === 'publishing'} onClick={approve}>
                      {pending === 'publishing' ? 'Publishing...' : 'Approve and publish'}
                    </PrimaryButton>
                  </div>
                </div>
              )}

              {post.status === 'published' && (
                <section className="surface px-5 py-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <h2 className="section-title text-xl">Grounded physician monitoring</h2>
                      <p className="secondary-copy mt-1">
                        Search authorized specialist experience through the existing Agents SDK workflow.
                      </p>
                    </div>
                    <div className="ml-auto">
                      <PrimaryButton disabled={pending === 'monitoring'} onClick={monitor}>
                        {pending === 'monitoring'
                          ? 'Reviewing authorized clinical experience...'
                          : 'Search physician network'}
                      </PrimaryButton>
                    </div>
                  </div>

                  {monitoringResults.length > 0 && (
                    <div className="mt-4 divide-y divide-[var(--border)]">
                      {monitoringResults.map((result) => (
                        <div key={result.monitoring_run_id} className="px-1 py-3 text-sm text-[var(--text-secondary)]">
                          <strong>{result.physician_name}</strong> · {result.outcome.replaceAll('_', ' ')} ·{' '}
                          {result.matched_case_count} matched case
                          {result.matched_case_count === 1 ? '' : 's'}
                        </div>
                      ))}
                    </div>
                  )}

                  {monitoringResults.some((result) => result.outcome === 'draft_created') && (
                    <div className="mt-5 border-l-2 border-l-[var(--clinical)] bg-[#f2f0eb] px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge tone="clinical">Grounded in Medplum</Badge>
                        <Badge tone="warning">Awaiting physician approval</Badge>
                      </div>
                      <h3 className="publication-title mt-4">Relevant specialist experience found</h3>
                      {monitoringResults
                        .filter((result) => result.outcome === 'draft_created')
                        .map((result) => (
                          <p key={result.monitoring_run_id} className="secondary-copy mt-2">
                            {result.physician_name} · {result.matched_case_count} similar authorized case
                            {result.matched_case_count === 1 ? '' : 's'} · Response awaiting physician review
                          </p>
                        ))}
                    </div>
                  )}

                  {post.responses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenNetwork(post.id)}
                      className="text-action mt-4"
                    >
                      Open published network thread
                    </button>
                  )}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
