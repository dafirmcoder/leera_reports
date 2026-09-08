import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import PendingApproval from './pages/PendingApproval'
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

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/students" replace />} />
        <Route path="/students" element={<Students />} />
        <Route path="/marks" element={<Marks />} />
        <Route path="/marks/:classId/:testId" element={<ScoreEntry />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/reports/:studentId" element={<ReportView />} />
        <Route path="/classes" element={<Classes />} />
        <Route path="/people" element={<People />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="*" element={<Navigate to="/students" replace />} />
      </Route>
    </Routes>
  )
}
