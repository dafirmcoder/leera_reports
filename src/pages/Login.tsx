import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const [apkReady, setApkReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    const res = await signIn(email.trim(), password)
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
        <h1>Leera international school - cambridge wing</h1>
        <p className="muted">Academic planning, assessments, and school management.</p>

        <form onSubmit={submit} className="stack" style={{ marginTop: '16px' }}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. director@leeraschool.ac.tz"
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Password / PIN</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
            />
          </label>
          {error && <div className="notice notice-error">{error}</div>}
          {info && <div className="notice notice-ok">{info}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : 'Sign in'}
          </button>
        </form>

        {apkReady && (
          <div className="apk-card">
            <strong>📱 Android app</strong>
            <span>Download the APK to install LEERA SCHOOL on an Android phone.</span>
            <a className="btn btn-primary btn-block" href={`${import.meta.env.BASE_URL}leera-reports.apk`} download="LEERA_SCHOOL.apk">
              ⬇ Download LEERA SCHOOL APK
            </a>
            <span className="muted apk-note">You may be asked to allow “install from unknown sources”.</span>
          </div>
        )}
      </div>
    </div>
  )
}

