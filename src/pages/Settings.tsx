import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/permissions'
import {
  getNotificationPermission,
  registerDevicePushSubscription,
  requestNotificationPermission,
  showSystemNotification,
  unregisterDevicePushSubscription
} from '../lib/notifications'
import type { School } from '../lib/types'

export default function SettingsPage() {
  const { school, subjects, refresh } = useSchool()
  const { profile, updatePassword } = useAuth()
  const [draft, setDraft] = useState<School | null>(null)
  const [newSubject, setNewSubject] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)

  // Notifications state
  const [notifPermission, setNotifPermission] = useState<string>('default')
  const [notifBusy, setNotifBusy] = useState(false)
  const [notifMessage, setNotifMessage] = useState('')
  const [notifError, setNotifError] = useState('')

  useEffect(() => {
    setNotifPermission(getNotificationPermission())
  }, [])

  const enableNotifications = async () => {
    if (!profile) return
    setNotifError('')
    setNotifMessage('')
    setNotifBusy(true)
    try {
      const perm = await requestNotificationPermission()
      setNotifPermission(perm)
      if (perm === 'granted') {
        const ok = await registerDevicePushSubscription(profile.id)
        if (ok) {
          setNotifMessage('Push notifications enabled successfully for this device.')
          showSystemNotification('✅ Notifications Activated', {
            body: 'You will now receive attendance reminders and alerts on your phone.'
          })
        } else {
          setNotifMessage('Notification permission granted.')
        }
      } else if (perm === 'denied') {
        setNotifError('Notification permission was blocked. Please allow notifications in your browser/phone settings.')
      }
    } catch (e: any) {
      setNotifError(e.message || 'Failed to enable notifications.')
    } finally {
      setNotifBusy(false)
    }
  }

  const disableNotifications = async () => {
    if (!profile) return
    setNotifBusy(true)
    try {
      await unregisterDevicePushSubscription(profile.id)
      setNotifMessage('Push notifications disabled on this device.')
    } catch {
      // Non-blocking
    } finally {
      setNotifBusy(false)
    }
  }

  const sendTestNotification = async () => {
    setNotifError('')
    setNotifMessage('Test notification sent.')
    showSystemNotification('🔔 Test Notification', {
      body: 'Notifications are working perfectly on this phone/device!',
      data: { url: '/dashboard' }
    })
  }


  const canEdit = can(profile?.role, 'editSchool', profile?.additional_roles)
  const canSubjects = can(profile?.role, 'manageSubjects', profile?.additional_roles)

  useEffect(() => {
    if (school) setDraft(school)
  }, [school])

  if (!draft) {
    return <div className="page"><div className="card"><p className="muted center">Loading…</p></div></div>
  }

  const set = (patch: Partial<School>) => setDraft({ ...draft, ...patch })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api.saveSchool(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      refresh()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const addSubject = async () => {
    const name = newSubject.trim()
    if (!name) return
    setError('')
    try {
      await api.addSubject(name)
      setNewSubject('')
      refresh()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const removeSubject = async (id: string, name: string) => {
    if (!confirm(`Delete subject "${name}"? Its unit tests and scores will be removed.`)) return
    try {
      await api.deleteSubject(id)
      refresh()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    setPasswordBusy(true)
    const result = await updatePassword(currentPassword, newPassword)
    if (result.error) setPasswordError(result.error)
    else {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Password changed successfully.')
    }
    setPasswordBusy(false)
  }

  return (
    <div className="page">
      <h2>School Settings</h2>
      <p className="muted">{canEdit ? 'Details shown on every report, plus your subject list.' : 'View of the school details used on reports.'}</p>

      <form onSubmit={save} className="card stack">
        <h3>School &amp; report header</h3>
        <div className="grid3">
          <label className="field"><span>School name</span>
            <input value={draft.name} disabled={!canEdit} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="field"><span>Motto (optional)</span>
            <input value={draft.motto} disabled={!canEdit} onChange={(e) => set({ motto: e.target.value })} />
          </label>
          <label className="field"><span>Academic year</span>
            <input value={draft.academic_year} disabled={!canEdit} onChange={(e) => set({ academic_year: e.target.value })} />
          </label>
          <label className="field"><span>Term</span>
            <input value={draft.term} disabled={!canEdit} onChange={(e) => set({ term: e.target.value })} />
          </label>
          <label className="field"><span>Footer text (contact details)</span>
            <input value={draft.footer_text} disabled={!canEdit} onChange={(e) => set({ footer_text: e.target.value })} />
          </label>
          <label className="field inline"><span>Footer colour</span>
            <input type="color" value={draft.footer_color} disabled={!canEdit} onChange={(e) => set({ footer_color: e.target.value })} />
          </label>
        </div>
        {canEdit && (
          <div className="row">
            <label className="check"><input type="checkbox" checked={draft.show_school_logo} onChange={(e) => set({ show_school_logo: e.target.checked })} /> Show school logo</label>
            <label className="check"><input type="checkbox" checked={draft.show_cambridge_logo} onChange={(e) => set({ show_cambridge_logo: e.target.checked })} /> Show Cambridge logo</label>
          </div>
        )}
        {canEdit && (
          <div className="row">
            <button className="btn btn-primary">Save settings</button>
            {saved && <span className="notice-ok">Saved ✓</span>}
          </div>
        )}
        {error && <div className="notice notice-error">{error}</div>}
      </form>

      {canSubjects && (
        <div className="card">
          <h3>Subjects</h3>
          <div className="row">
            <input
              className="grow"
              placeholder="New subject name…"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubject() } }}
            />
            <button className="btn" onClick={addSubject}>Add subject</button>
          </div>
          <div className="chips">
            {subjects.map((s) => (
              <span key={s.id} className="chip">
                {s.name}
                <button type="button" className="chip-x" onClick={() => removeSubject(s.id, s.name)} aria-label={`Delete ${s.name}`}>×</button>
              </span>
            ))}
            {subjects.length === 0 && <span className="muted">No subjects yet.</span>}
          </div>
        </div>
      )}

      {/* Mobile Push Notifications & Attendance Reminders */}
      <div className="card stack">
        <h3>📱 Mobile Push Notifications &amp; Reminders</h3>
        <p className="muted">
          Enable native phone notifications for <strong>8:00 AM Mon–Fri morning attendance reminders</strong> (repetitive until marked) and <strong>instant attendance updates for leadership</strong>.
        </p>

        <div className="row" style={{ alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px' }}>
            Status on this device:{' '}
            <strong style={{
              color: notifPermission === 'granted' ? '#166534' : notifPermission === 'denied' ? '#991b1b' : '#854d0e'
            }}>
              {notifPermission === 'granted' ? '✅ Enabled' : notifPermission === 'denied' ? '🚫 Blocked in Browser Settings' : '⚠️ Not Enabled'}
            </strong>
          </span>
        </div>

        <div className="row" style={{ gap: '10px' }}>
          {notifPermission !== 'granted' ? (
            <button type="button" className="btn btn-primary" disabled={notifBusy} onClick={enableNotifications}>
              {notifBusy ? 'Enabling…' : '🔔 Enable Notifications on this Phone/Device'}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-small" disabled={notifBusy} onClick={sendTestNotification}>
                {notifBusy ? 'Sending…' : '🔔 Test Notification (Send to Phone)'}
              </button>
              <button type="button" className="btn btn-small btn-ghost" onClick={disableNotifications}>
                Disable on this device
              </button>
            </>
          )}
        </div>

        {notifMessage && <div className="notice notice-ok">{notifMessage}</div>}
        {notifError && <div className="notice notice-error">{notifError}</div>}
      </div>

      <form onSubmit={changePassword} className="card stack">
        <h3>Change password</h3>
        <p className="muted">Update the password for your signed-in account.</p>
        <label className="field"><span>Current password</span>
          <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <div className="grid3">
          <label className="field"><span>New password</span>
            <input type="password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="field"><span>Confirm new password</span>
            <input type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        {passwordError && <div className="notice notice-error">{passwordError}</div>}
        {passwordMessage && <div className="notice notice-ok">{passwordMessage}</div>}
        <button className="btn btn-primary" disabled={passwordBusy}>{passwordBusy ? 'Changing…' : 'Change password'}</button>
      </form>
    </div>
  )
}

