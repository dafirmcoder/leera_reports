import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { can } from './lib/permissions'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import PendingApproval from './pages/PendingApproval'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import Marks from './pages/Marks'
import ScoreEntry from './pages/ScoreEntry'
import Reports from './pages/Reports'
import ReportView from './pages/ReportView'
import SettingsPage from './pages/Settings'
import People from './pages/People'
import Classes from './pages/Classes'
import Attendance from './pages/Attendance'

export default function App() {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="splash">
        <img src="/icons/icon-192.png" alt="Leera" width="64" height="64" />
        <p>Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  // Signed in but no profile yet (or role pending) -> approval screen.
  if (!profile || profile.role === 'pending') {
    return (
      <Routes>
        <Route path="*" element={<PendingApproval />} />
      </Routes>
    )
  }

  const isDirector = profile.role === 'director'
  const isAdmin = profile.role === 'admin'
  const defaultPath = isDirector ? '/dashboard' : isAdmin ? '/attendance' : '/students'

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to={defaultPath} replace />} />
        {can(profile.role, 'viewDirectorDashboard', profile.additional_roles) && (
          <Route path="/dashboard" element={<Dashboard />} />
        )}
        {!isAdmin && (
          <>
            <Route path="/students" element={<Students />} />
            <Route path="/marks" element={<Marks />} />
            <Route path="/marks/:classId/:testId" element={<ScoreEntry />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:studentId" element={<ReportView />} />
          </>
        )}
        {(can(profile.role, 'manageClasses', profile.additional_roles) || can(profile.role, 'assignTeachers', profile.additional_roles)) && (
          <Route path="/classes" element={<Classes />} />
        )}
        {can(profile.role, 'manageUsers', profile.additional_roles) && (
          <Route path="/people" element={<People />} />
        )}
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Route>
    </Routes>
  )
}

