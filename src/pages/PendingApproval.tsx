import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function PendingApproval() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/icons/icon-192.png" alt="" width="64" height="64" className="login-logo" />
        <h1>Account pending approval</h1>
        <p className="muted">
          You’re signed in as <strong>{user?.email}</strong>, but your account has no
          assigned role yet.
        </p>
        <div className="notice">
          Ask your <strong>Head of School</strong> (or Curriculum Coordinator) to assign
          you a role — e.g. Homeroom Teacher or Subject Teacher — from the People screen.
        </div>
        <button
          className="btn btn-primary btn-block"
          onClick={async () => { await signOut(); navigate('/') }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
