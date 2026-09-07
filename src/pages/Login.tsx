import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { DEMO_PERSONAS } from '../lib/auth'
import { isDemo } from '../lib/api'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [apkReady, setApkReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    if (mode === 'signin') {
      const res = await signIn(email, password)
      if (res.error) setError(res.error)
    } else {
      const res = await signUp(email, password, fullName)
      if (res.error) setError(res.error)
      else if (res.needsConfirmation) setInfo('Account created — check your email to confirm, then sign in.')
    }
    setBusy(false)
  }

  const quickSignIn = async (personaEmail: string) => {
    setError('')
    setBusy(true)
    const res = await signIn(personaEmail, 'demo')
    if (res.error) setError(res.error)
    setBusy(false)
  }

  useEffect(() => {
    // Show the Android-app download button only if the APK is actually present.
    fetch(`${import.meta.env.BASE_URL}leera-reports.apk`, { method: 'HEAD' })
      .then((r) => setApkReady(r.ok))
      .catch(() => setApkReady(false))
  }, [])

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/icons/icon-192.png" alt="" width="72" height="72" className="login-logo" />
        <h1>Leera End-of-Unit Reports</h1>
        <p className="muted">Record unit-test marks and share parent reports.</p>

        {isDemo ? (
          <>
            <div className="notice">
              <strong>Demo mode</strong> — Supabase isn’t connected yet, so data lives in this
              browser. Pick a role below to explore.
            </div>
            <div className="personas">
              {DEMO_PERSONAS.map((p) => (
                <button
                  key={p.email}
                  className="persona"
                  disabled={busy}
                  onClick={() => quickSignIn(p.email)}
                >
                  <span className="persona-label">{p.label}</span>
                  <span className="persona-hint">{p.hint}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="seg">
              <button
                className={mode === 'signin' ? 'seg-btn active' : 'seg-btn'}
                onClick={() => { setMode('signin'); setError(''); setInfo('') }}
              >
                Sign in
              </button>
              <button
                className={mode === 'signup' ? 'seg-btn active' : 'seg-btn'}
                onClick={() => { setMode('signup'); setError(''); setInfo('') }}
              >
                Create account
              </button>
            </div>

            <form onSubmit={submit} className="stack">
              {mode === 'signup' && (
                <label className="field">
                  <span>Full name</span>
                  <input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Teacher" autoComplete="name" />
                </label>
              )}
              <label className="field">
                <span>Email</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@school.ac.tz" autoComplete="email" />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
              </label>
              {error && <div className="notice notice-error">{error}</div>}
              {info && <div className="notice notice-ok">{info}</div>}
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </>
        )}

        {apkReady && (
          <div className="apk-card">
            <strong>📱 Android app</strong>
            <span>Download the APK to install Leera Reports on an Android phone.</span>
            <a className="btn btn-primary btn-block" href={`${import.meta.env.BASE_URL}leera-reports.apk`} download>
              ⬇ Download APK for Android
            </a>
            <span className="muted apk-note">You may be asked to allow “install from unknown sources”.</span>
          </div>
        )}
      </div>
    </div>
  )
}
