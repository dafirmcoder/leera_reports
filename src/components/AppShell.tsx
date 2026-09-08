import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { navTabs, ROLE_LABEL } from '../lib/permissions'

export default function AppShell() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img src="/icons/icon-192.png" alt="" width="30" height="30" />
            <span>Leera Reports</span>
          </div>
          <div className="topbar-right">
            <span className="user-chip">
              {profile?.full_name || user?.email}
              {profile && <em className="role-tag">{[profile.role, ...profile.additional_roles].map((r) => ROLE_LABEL[r]).join(' + ')}</em>}
            </span>
            <button className="btn btn-ghost" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>

      <nav className="bottomnav">
        {navTabs(profile?.role, profile?.additional_roles).map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
