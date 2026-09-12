import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { navTabs, ROLE_LABEL } from '../lib/permissions'
import {
  getNotificationPermission,
  registerDevicePushSubscription,
  requestNotificationPermission,
  startAttendanceReminderWatcher,
  stopAttendanceReminderWatcher
} from '../lib/notifications'

export default function AppShell() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [showNotifPrompt, setShowNotifPrompt] = useState(false)

  const handleSignOut = async () => {
    stopAttendanceReminderWatcher()
    await signOut()
    navigate('/')
  }

  useEffect(() => {
    if (profile) {
      startAttendanceReminderWatcher(profile)
      const perm = getNotificationPermission()
      if (perm === 'default') {
        const dismissed = localStorage.getItem('leera_notif_prompt_dismissed')
        if (!dismissed) setShowNotifPrompt(true)
      } else if (perm === 'granted') {
        // Auto refresh / register push subscription
        registerDevicePushSubscription(profile.id).catch(() => {})
      }
    }
    return () => {
      stopAttendanceReminderWatcher()
    }
  }, [profile?.id, profile?.role, profile?.class_id])

  const enableNotifications = async () => {
    if (!profile) return
    setShowNotifPrompt(false)
    const perm = await requestNotificationPermission()
    if (perm === 'granted') {
      await registerDevicePushSubscription(profile.id)
    }
  }

  const dismissPrompt = () => {
    setShowNotifPrompt(false)
    localStorage.setItem('leera_notif_prompt_dismissed', 'true')
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

      {showNotifPrompt && (
        <div style={{
          background: 'linear-gradient(90deg, #1f8a5f, #1f4e5f)',
          color: '#ffffff',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          fontSize: '13px'
        }}>
          <span>
            🔔 <strong>Enable phone notifications</strong> for 8:00 AM attendance reminders and instant updates.
          </span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="btn btn-small"
              style={{ background: '#ffffff', color: '#1f8a5f', fontWeight: 700, border: 0 }}
              onClick={enableNotifications}
            >
              Enable
            </button>
            <button
              className="btn btn-small"
              style={{ background: 'transparent', color: '#ffffff', border: '1px solid rgba(255,255,255,0.4)' }}
              onClick={dismissPrompt}
            >
              Later
            </button>
          </div>
        </div>
      )}

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

