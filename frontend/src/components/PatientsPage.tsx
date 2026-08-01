import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  approveForumPost,
  generatePatientForumPost,
  getForumPost,
  getMyPatients,
  getPatientCaseContext,
  getReviewInbox,
  monitorForumPost,
  type AgentDetails,
  type ForumPost,
  type ForumResponse,
  type MonitoringResult,
  type PatientCaseContext,
  type PatientSummary,
} from '../api/client'
import { demoSession } from '../session'
import { displayError } from '../utils'
import { ForumPostView } from './ForumPostView'
import { Badge, EmptyState, ErrorBanner, PageLoading, PrimaryButton } from './ui'

const SELECTED_PATIENT_KEY = 'lamina.selectedPatientRef'
const postStorageKey = (patientRef: string) => `lamina.patientPost.${patientRef}`

type PendingAction = 'patients' | 'case' | 'generating' | 'publishing' | 'monitoring' | null

function ClinicalList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      {items.length ? (
        <ul className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">
          {items.map((item) => (
            <li key={item} className="border-l-2 border-indigo-100 pl-3">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-400">No bounded facts returned.</p>
      )}
    </section>
  )
}

export function PatientsPage({
  physician,
  onOpenNetwork,
  onOpenReviews,
}: {
  physician: AgentDetails
  onOpenNetwork: (postId: string) => void
  onOpenReviews: (postId: string) => void
}) {
  const [patients, setPatients] = useState<PatientSummary[]>([])
  const [selectedRef, setSelectedRef] = useState<string | null>(() =>
    window.localStorage.getItem(SELECTED_PATIENT_KEY),
  )
  const [caseContext, setCaseContext] = useState<PatientCaseContext | null>(null)
  const [post, setPost] = useState<ForumPost | null>(null)
  const [specialistDraft, setSpecialistDraft] = useState<ForumResponse | null>(null)
  const [monitoringResults, setMonitoringResults] = useState<MonitoringResult[]>([])
  const [guidance, setGuidance] = useState('')
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<PendingAction>('patients')
  const [error, setError] = useState<string | null>(null)

  const loadPatient = useCallback(
    async (patientRef: string) => {
      setPending('case')
      setError(null)
      setSpecialistDraft(null)
      setMonitoringResults([])
      try {
        const [context, specialistInbox] = await Promise.all([
          getPatientCaseContext(physician.physician_npi, patientRef),
          getReviewInbox(demoSession.specialistReviewer.npi),
        ])
        setCaseContext(context)
        const storedPostId = window.localStorage.getItem(postStorageKey(patientRef))
        if (!storedPostId) {
          setPost(null)
          return
        }
        try {
          const storedPost = await getForumPost(storedPostId, physician.physician_npi)
          setPost(storedPost)
          setSpecialistDraft(
            specialistInbox.response_drafts.find((item) => item.post_id === storedPost.id) ?? null,
          )
        } catch (loadError) {
          if (loadError instanceof ApiError && loadError.status === 404) {
            window.localStorage.removeItem(postStorageKey(patientRef))
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
        window.localStorage.removeItem(SELECTED_PATIENT_KEY)
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
    window.localStorage.setItem(SELECTED_PATIENT_KEY, patientRef)
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

  const generate = () =>
    run('generating', async () => {
      if (!selectedRef || !guidance.trim()) return
      const generated = await generatePatientForumPost(
        physician.physician_npi,
        selectedRef,
        guidance,
      )
      window.localStorage.setItem(postStorageKey(selectedRef), generated.id)
      setPost(generated)
      setSpecialistDraft(null)
      setMonitoringResults([])
    })

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
      const [thread, inbox] = await Promise.all([
        getForumPost(post.id, physician.physician_npi),
        getReviewInbox(demoSession.specialistReviewer.npi),
      ])
      setPost(thread)
      setSpecialistDraft(
        inbox.response_drafts.find((response) => response.post_id === post.id) ?? null,
      )
    })

  if (pending === 'patients' && patients.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <PageLoading>Loading authorized patients...</PageLoading>
      </div>
    )
  }

  if (!selectedRef) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8 pb-24">
        <div>
          <div className="text-sm font-semibold text-indigo-600">Good afternoon</div>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">
            {physician.physician.display_name}
          </h1>
          <p className="mt-1 text-slate-500">{physician.physician.primary_specialty}</p>
        </div>

        <div className="mt-8 flex flex-wrap items-end gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">My Patients</h2>
            <p className="mt-1 text-sm text-slate-500">
              Your authorized synthetic Medplum panel. No raw FHIR resources are shown.
            </p>
          </div>
          <Badge tone="emerald">Synthetic demo data</Badge>
          <button
            type="button"
            onClick={() => void loadPatients()}
            className="ml-auto text-sm font-semibold text-indigo-700 hover:text-indigo-900"
          >
            Refresh
          </button>
        </div>

        {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search patients returned by Medplum"
          className="mt-5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {visiblePatients.map((patient) => (
            <article key={patient.patient_ref} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-slate-900">{patient.display_name}</h3>
                {patient.synthetic && <Badge tone="emerald">Synthetic</Badge>}
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-600">Age {patient.age_band}</div>
              {patient.summary && (
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{patient.summary}</p>
              )}
              <button
                type="button"
                onClick={() => selectPatient(patient.patient_ref)}
                className="mt-4 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                View patient
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
    <div className="mx-auto max-w-5xl px-6 py-8 pb-24">
      <button
        type="button"
        onClick={() => {
          window.localStorage.removeItem(SELECTED_PATIENT_KEY)
          setSelectedRef(null)
          setCaseContext(null)
          setPost(null)
          setError(null)
        }}
        className="text-sm font-semibold text-indigo-700 hover:text-indigo-900"
      >
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
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{caseContext.display_name}</h1>
              <p className="mt-1 text-sm text-slate-500">Age {caseContext.age_band}</p>
            </div>
            <Badge tone="emerald">Synthetic demo data</Badge>
            <Badge tone="indigo">Source: Medplum</Badge>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <ClinicalList
              title="Conditions"
              items={caseContext.conditions.map(
                (item) => `${item.display} · ${item.clinical_status}`,
              )}
            />
            <ClinicalList
              title="Medication context"
              items={caseContext.medications.map(
                (item) => `${item.display} · ${item.timing_summary || item.status}`,
              )}
            />
            <ClinicalList
              title="Observations and outcomes"
              items={caseContext.observations.map((item) =>
                [item.display, item.value_summary, item.effective_date].filter(Boolean).join(' · '),
              )}
            />
          </div>

          {!post && (
            <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
              <h2 className="text-lg font-bold text-slate-900">Ask Lamina</h2>
              <p className="mt-1 text-sm text-slate-600">
                Ask the physician network about this bounded case. Lamina will create a draft for
                your review; it will not publish automatically.
              </p>
              <label htmlFor="physician-guidance" className="mt-4 block text-sm font-semibold text-slate-700">
                What would you like to ask the network?
              </label>
              <textarea
                id="physician-guidance"
                rows={4}
                value={guidance}
                onChange={(event) => setGuidance(event.target.value)}
                placeholder="I haven't seen this pattern before. Has anyone seen something similar?"
                className="mt-2 w-full rounded-2xl border border-indigo-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              <div className="mt-3">
                <PrimaryButton disabled={pending === 'generating' || !guidance.trim()} onClick={generate}>
                  {pending === 'generating' ? 'Drafting question...' : 'Generate network question'}
                </PrimaryButton>
              </div>
            </section>
          )}

          {post && (
            <div className="mt-6 space-y-4">
              <ForumPostView post={post} />
              {post.status === 'awaiting_physician_approval' && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div>
                    <div className="font-semibold text-amber-900">Physician review required</div>
                    <div className="text-sm text-amber-800">Approval publishes this exact backend draft.</div>
                  </div>
                  <div className="ml-auto">
                    <PrimaryButton tone="emerald" disabled={pending === 'publishing'} onClick={approve}>
                      {pending === 'publishing' ? 'Publishing...' : 'Approve and publish'}
                    </PrimaryButton>
                  </div>
                </div>
              )}

              {post.status === 'published' && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <h2 className="font-bold text-slate-900">Grounded physician-agent monitoring</h2>
                      <p className="mt-1 text-sm text-slate-500">
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
                    <div className="mt-4 space-y-2">
                      {monitoringResults.map((result) => (
                        <div key={result.monitoring_run_id} className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                          <strong>{result.physician_name}</strong> · {result.outcome.replaceAll('_', ' ')} ·{' '}
                          {result.matched_case_count} matched case
                          {result.matched_case_count === 1 ? '' : 's'}
                        </div>
                      ))}
                    </div>
                  )}

                  {specialistDraft && (
                    <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge tone="indigo">AI drafted</Badge>
                        <Badge tone="emerald">Grounded in Medplum</Badge>
                        <Badge>{specialistDraft.provenance.grounding.matched_case_count} similar case found</Badge>
                        <Badge tone="amber">Awaiting physician approval</Badge>
                      </div>
                      <h3 className="mt-3 font-bold text-slate-900">{specialistDraft.headline}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-700">{specialistDraft.content}</p>
                      <button
                        type="button"
                        onClick={() => onOpenReviews(post.id)}
                        className="mt-3 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
                      >
                        Open specialist review
                      </button>
                    </div>
                  )}

                  {post.responses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenNetwork(post.id)}
                      className="mt-4 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
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
