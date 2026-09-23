import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useSchool } from './context/SchoolContext'
import { can, isHomeroomTeacher } from './lib/permissions'
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
import ClassMarksheetPage from './pages/ClassMarksheetPage'
import LeeraLoader from './components/LeeraLoader'

export default function App() {
  const { user, profile, loading } = useAuth()
  const { classes } = useSchool()

  if (loading) {
    return <LeeraLoader variant="fullscreen" message="Starting Leera Reports…" />
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
  const defaultPath = '/dashboard'

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to={defaultPath} replace />} />

        {/* Dashboard landing page for all user roles */}
        <Route path="/dashboard" element={<Dashboard section="overview" />} />

        {/* Executive sub-sections for leadership */}
        {(can(profile.role, 'viewDirectorDashboard', profile.additional_roles) || isAdmin || isDirector) && (
          <>
            <Route path="/dashboard/population" element={<Dashboard section="population" />} />
            <Route path="/dashboard/attendance" element={<Dashboard section="attendance" />} />
            <Route path="/dashboard/marks" element={<Dashboard section="marks" />} />
            <Route path="/dashboard/teachers" element={<Dashboard section="teachers" />} />
          </>
        )}

        {/* Tabulated Class Marksheet / Broadsheet: accessible to leadership (any class) and homeroom teachers (their class only) */}
        {(can(profile.role, 'viewDirectorDashboard', profile.additional_roles) || isAdmin || isDirector || isHomeroomTeacher(profile, classes)) && (
          <>
            <Route path="/dashboard/marks/class/:classId" element={<ClassMarksheetPage />} />
            <Route path="/marks/class/:classId" element={<ClassMarksheetPage />} />
            <Route path="/marks/class" element={<ClassMarksheetPage />} />
          </>
        )}

        {/* Marksheet / Score Sheet view: accessible to Director as read-only marksheet, and to teachers/HOS/coordinators */}
        <Route path="/marks/:classId/:testId" element={<ScoreEntry />} />

        {/* Teacher & Academic routes: hidden from Director and Admin */}
        {!isAdmin && !isDirector && (
          <>
            {(isHomeroomTeacher(profile, classes) || can(profile.role, 'viewStudents', profile.additional_roles)) && (
              <Route path="/students" element={<Students />} />
            )}
            <Route path="/marks" element={<Marks />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:studentId" element={<ReportView />} />
          </>
        )}

        {!isDirector && (can(profile.role, 'manageClasses', profile.additional_roles) || can(profile.role, 'assignTeachers', profile.additional_roles)) && (
          <Route path="/classes" element={<Classes />} />
        )}
        {!isDirector && can(profile.role, 'manageUsers', profile.additional_roles) && (
          <Route path="/people" element={<People />} />
        )}
        {!isDirector && (
          <Route path="/attendance" element={<Attendance />} />
        )}

        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Route>
    </Routes>
  )
}

