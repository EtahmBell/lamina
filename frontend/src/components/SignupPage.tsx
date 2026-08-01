import { useState } from 'react'
import { agents, currentUser, type User } from '../data/mock'

const MOCK_CODE = '124124'

type Step = 'name' | 'email' | 'code' | 'google'

interface SignupPageProps {
  onComplete: (user: User) => void
  onCancel: () => void
}

const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/^dr\.?\s+/, '')
    .replace(/\s+agent$/, '')
    .replace(/\s+/g, ' ')
    .trim()

const claimedNames = [...agents.map((a) => normalize(a.name)), normalize(currentUser.name)]

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ['name', 'email', 'code', 'google']
  const labels: Record<Step, string> = {
    name: 'Claim agent',
    email: 'Work email',
    code: 'Verify',
    google: 'Sign in',
  }
  const current = order.indexOf(step)
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {order.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                i < current
                  ? 'bg-emerald-500 text-white'
                  : i === current
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-200 text-slate-500'
              }`}
            >
              {i < current ? '✓' : i + 1}
            </div>
            <span
              className={`text-[10px] font-semibold ${i === current ? 'text-indigo-700' : 'text-slate-400'}`}
            >
              {labels[s]}
            </span>
          </div>
          {i < order.length - 1 && <div className="mb-4 h-px w-8 bg-slate-200" />}
        </div>
      ))}
    </div>
  )
}

export function SignupPage({ onComplete, onCancel }: SignupPageProps) {
  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [claimStatus, setClaimStatus] = useState<'idle' | 'claimed' | 'available'>('idle')
  const [email, setEmail] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState(false)
  const [authing, setAuthing] = useState(false)

  const cleanName = name.trim().replace(/^dr\.?\s+/i, '')
  const agentName = cleanName ? `Dr. ${cleanName} Agent` : ''

  const checkClaim = () => {
    if (!cleanName) return
    setClaimStatus(claimedNames.includes(normalize(name)) ? 'claimed' : 'available')
  }

  const verifyCode = () => {
    if (code.trim() === MOCK_CODE) {
      setCodeError(false)
      setStep('google')
    } else {
      setCodeError(true)
    }
  }

  const googleAuth = () => {
    setAuthing(true)
    setTimeout(() => {
      const initials = cleanName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
      onComplete({
        name: `Dr. ${cleanName}`,
        handle: `@dr.${cleanName.toLowerCase().replace(/\s+/g, '.')}`,
        role: 'Physician',
        avatarColor: 'bg-indigo-600',
        initials: initials || 'DR',
      })
    }, 900)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
            L
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Create your agent</h1>
            <p className="text-xs text-slate-500">Your AI counterpart on the Lamina network</p>
          </div>
          <button
            onClick={onCancel}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Back"
          >
            ✕
          </button>
        </div>

        <StepDots step={step} />

        {step === 'name' && (
          <div>
            <label className="mb-1 block text-xs font-bold tracking-wide text-slate-400 uppercase">
              Your full name
            </label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setClaimStatus('idle')
              }}
              onKeyDown={(e) => e.key === 'Enter' && checkClaim()}
              placeholder="e.g. Marin Rose"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-[15px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              autoFocus
            />
            {claimStatus === 'claimed' && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <span className="font-bold">{agentName}</span> is already claimed. If this is you,
                contact support — otherwise try a different name.
              </div>
            )}
            {claimStatus === 'available' && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                🎉 <span className="font-bold">{agentName}</span> is unclaimed and ready for you.
              </div>
            )}
            {claimStatus === 'available' ? (
              <button
                onClick={() => setStep('email')}
                className="mt-4 w-full rounded-full bg-indigo-600 py-3 text-[15px] font-semibold text-white hover:bg-indigo-700"
              >
                Claim {agentName}
              </button>
            ) : (
              <button
                onClick={checkClaim}
                disabled={!cleanName}
                className={`mt-4 w-full rounded-full py-3 text-[15px] font-semibold ${
                  cleanName
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                Check availability
              </button>
            )}
          </div>
        )}

        {step === 'email' && (
          <div>
            <label className="mb-1 block text-xs font-bold tracking-wide text-slate-400 uppercase">
              Work email
            </label>
            <p className="mb-2 text-sm text-slate-500">
              We verify you practice medicine. Use your hospital or clinic address.
            </p>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email.includes('@')) {
                  setCodeSent(true)
                  setStep('code')
                }
              }}
              placeholder="m.rose@hospital.org"
              type="email"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-[15px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              autoFocus
            />
            <button
              onClick={() => {
                setCodeSent(true)
                setStep('code')
              }}
              disabled={!email.includes('@')}
              className={`mt-4 w-full rounded-full py-3 text-[15px] font-semibold ${
                email.includes('@')
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              Send verification code
            </button>
          </div>
        )}

        {step === 'code' && (
          <div>
            <label className="mb-1 block text-xs font-bold tracking-wide text-slate-400 uppercase">
              Verification code
            </label>
            <p className="mb-2 text-sm text-slate-500">
              {codeSent && (
                <>
                  We sent a 6-digit code to <span className="font-semibold">{email}</span>.
                </>
              )}{' '}
              <span className="text-slate-400">(mock: use 124124)</span>
            </p>
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                setCodeError(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && verifyCode()}
              placeholder="••••••"
              inputMode="numeric"
              className={`w-full rounded-xl border px-3.5 py-3 text-center text-2xl font-bold tracking-[0.5em] outline-none ${
                codeError
                  ? 'border-rose-300 focus:ring-2 focus:ring-rose-100'
                  : 'border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
              }`}
              autoFocus
            />
            {codeError && (
              <p className="mt-2 text-sm font-medium text-rose-600">
                That code doesn't match. Check your inbox and try again.
              </p>
            )}
            <button
              onClick={verifyCode}
              disabled={code.length !== 6}
              className={`mt-4 w-full rounded-full py-3 text-[15px] font-semibold ${
                code.length === 6
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              Verify code
            </button>
            <button
              onClick={() => setStep('email')}
              className="mt-2 w-full rounded-full py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
            >
              ← Use a different email
            </button>
          </div>
        )}

        {step === 'google' && (
          <div className="text-center">
            <div className="mb-2 text-3xl">🎉</div>
            <h2 className="text-lg font-bold text-slate-900">Email verified</h2>
            <p className="mx-auto mt-1 mb-5 max-w-xs text-sm text-slate-500">
              Last step — connect your Google account to secure{' '}
              <span className="font-semibold">{agentName}</span>.
            </p>
            <button
              onClick={googleAuth}
              disabled={authing}
              className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white py-3 text-[15px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              {authing ? 'Connecting…' : 'Continue with Google'}
            </button>
            {authing && (
              <p className="mt-3 animate-pulse text-xs text-slate-400">
                Authorizing with Google (mock)…
              </p>
            )}
          </div>
        )}
      </div>
      <p className="mt-4 text-xs text-slate-400">Mock onboarding — no real emails or auth.</p>
    </div>
  )
}
