import { useAuth } from '../context/AuthContext'
import { useSchool } from '../context/SchoolContext'
import { isHomeroomTeacher } from '../lib/permissions'
import ExecutiveDashboard from '../components/dashboards/ExecutiveDashboard'
import AdminDashboard from '../components/dashboards/AdminDashboard'
import HomeroomTeacherDashboard from '../components/dashboards/HomeroomTeacherDashboard'
import SubjectTeacherDashboard from '../components/dashboards/SubjectTeacherDashboard'

interface DashboardProps {
  section?: 'overview' | 'population' | 'attendance' | 'marks' | 'teachers'
}

export default function Dashboard({ section = 'overview' }: DashboardProps) {
  const { profile } = useAuth()
  const { classes } = useSchool()
  const isHomeroom = isHomeroomTeacher(profile, classes)

  // If navigating to an executive sub-section (population, attendance, marks, teachers), render Executive Dashboard
  if (section !== 'overview') {
    return <ExecutiveDashboard section={section} />
  }

  // Role-specific landing dashboards on /dashboard
  switch (profile?.role) {
    case 'admin':
      return <AdminDashboard />

    case 'homeroom_teacher':
      return <HomeroomTeacherDashboard />

    case 'subject_teacher':
      return isHomeroom ? <HomeroomTeacherDashboard /> : <SubjectTeacherDashboard />

    case 'director':
    case 'head_of_school':
    case 'curriculum_coordinator':
    default:
      return <ExecutiveDashboard section={section} />
  }
}
