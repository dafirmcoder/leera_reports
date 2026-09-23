import type { Role } from './types'

// Role -> capabilities. Centralised so the UI and nav stay consistent.
export type Capability =
  | 'manageUsers'        // assign roles (HOS + curriculum coordinator)
  | 'createAccounts'     // invite new teachers (HOS only)
  | 'editSchool'         // school settings (HOS only)
  | 'manageSubjects'     // add/edit subjects (HOS + curriculum coordinator)
  | 'manageClasses'      // create classes / set homeroom teacher (HOS only)
  | 'assignTeachers'     // assign subject teachers (HOS + coordinators + homeroom teacher)
  | 'addStudents'        // homeroom teacher only
  | 'viewStudents'       // homeroom teacher, HOS, curriculum coordinator (hidden from pure subject teachers)
  | 'addMarks'           // homeroom + subject teachers + coordinators
  | 'deleteTests'        // coordinators + HOS + admin only (regular teachers cannot delete)
  | 'viewAllClasses'     // sees the whole school (director/HOS/coordinator/admin)
  | 'markAttendance'     // homeroom teachers today; coordinators for school classes
  | 'markPastAttendance' // coordinator backfills skipped attendance dates
  | 'viewDirectorDashboard' // executive summaries (director, HOS, coordinator)
  | 'viewAttendanceSummaries' // attendance summaries (admin, director, HOS, coordinator)
  | 'downloadAttendanceReports' // download xlsx/csv (admin, director, HOS, coordinator)

export function hasRole(role: Role | undefined, requiredRole: Role, additionalRoles: Role[] = []): boolean {
  return role === requiredRole || additionalRoles.includes(requiredRole)
}

export function isHomeroomTeacher(
  profile?: { id?: string; role?: Role; additional_roles?: Role[]; class_id?: string | null } | null,
  classes: Array<{ id: string; homeroom_teacher_id?: string | null }> = []
): boolean {
  if (!profile) return false
  if (profile.role === 'homeroom_teacher') return true
  if (Array.isArray(profile.additional_roles) && profile.additional_roles.includes('homeroom_teacher')) return true
  if (profile.class_id) return true
  if (profile.id && classes.some((c) => c.homeroom_teacher_id === profile.id)) return true
  return false
}

export function getTeacherHomeroomClasses<T extends { id: string; homeroom_teacher_id?: string | null }>(
  profile?: { id?: string; class_id?: string | null } | null,
  classes: T[] = []
): T[] {
  if (!profile) return []
  return classes.filter(
    (c) => c.id === profile.class_id || (profile.id && c.homeroom_teacher_id === profile.id)
  )
}


export function can(role: Role | undefined, cap: Capability, additionalRoles: Role[] = []): boolean {
  const roles = new Set<Role>(role ? [role, ...additionalRoles] : [])
  switch (cap) {
    case 'manageUsers':
      return roles.has('head_of_school') || roles.has('curriculum_coordinator')
    case 'createAccounts':
    case 'editSchool':
    case 'manageClasses':
      return roles.has('head_of_school')
    case 'manageSubjects':
      return roles.has('head_of_school') || roles.has('curriculum_coordinator')
    case 'assignTeachers':
      return roles.has('head_of_school') || roles.has('curriculum_coordinator') || roles.has('homeroom_teacher')
    case 'addStudents':
      return roles.has('homeroom_teacher')
    case 'viewStudents':
      return roles.has('homeroom_teacher') || roles.has('head_of_school') || roles.has('curriculum_coordinator')
    case 'addMarks':
      return roles.has('homeroom_teacher') || roles.has('subject_teacher') || roles.has('curriculum_coordinator') || roles.has('head_of_school')
    case 'deleteTests':
      return roles.has('curriculum_coordinator') || roles.has('head_of_school')
    case 'viewAllClasses':
      return roles.has('director') || roles.has('head_of_school') || roles.has('curriculum_coordinator') || roles.has('admin')
    case 'markAttendance':
      return roles.has('homeroom_teacher') || roles.has('curriculum_coordinator')
    case 'markPastAttendance':
      return roles.has('curriculum_coordinator')
    case 'viewDirectorDashboard':
      return roles.has('director') || roles.has('head_of_school') || roles.has('curriculum_coordinator')
    case 'viewAttendanceSummaries':
    case 'downloadAttendanceReports':
      return roles.has('admin') || roles.has('director') || roles.has('head_of_school') || roles.has('curriculum_coordinator')
    default:
      return false
  }
}

export interface Tab {
  to: string
  label: string
  icon: string
}

export function navTabs(
  role: Role | undefined,
  additionalRoles: Role[] = [],
  options?: { isHomeroom?: boolean }
): Tab[] {
  if (!role || role === 'pending') return []
  const tabs: Tab[] = []

  // Admin role: sees Dashboard, Attendance, and Settings
  if (role === 'admin') {
    tabs.push({ to: '/dashboard', label: 'Dashboard', icon: '📊' })
    tabs.push({ to: '/attendance', label: 'Attendance', icon: '📅' })
    tabs.push({ to: '/settings', label: 'Settings', icon: '⚙️' })
    return tabs
  }

  // Director role: sees Executive Dashboard, Sub-menus, and Settings (no teacher tools)
  if (role === 'director') {
    tabs.push({ to: '/dashboard', label: 'Dashboard', icon: '📊' })
    tabs.push({ to: '/dashboard/population', label: 'Population', icon: '👥' })
    tabs.push({ to: '/dashboard/attendance', label: 'Attendance', icon: '📅' })
    tabs.push({ to: '/dashboard/marks', label: 'Marks Summaries', icon: '📝' })
    tabs.push({ to: '/dashboard/teachers', label: 'Teachers Summary', icon: '🧑‍🏫' })
    tabs.push({ to: '/settings', label: 'Settings', icon: '⚙️' })
    return tabs
  }

  // All other roles (Head of School, Coordinator, Homeroom Teacher, Subject Teacher)
  tabs.push({ to: '/dashboard', label: 'Dashboard', icon: '📊' })

  // Students page: only accessible to homeroom teachers, coordinators, and head of school.
  // Pure subject teachers who are not homeroom teachers are excluded.
  const canSeeStudents = options?.isHomeroom || can(role, 'viewStudents', additionalRoles)
  if (canSeeStudents) {
    tabs.push({ to: '/students', label: 'Students', icon: '👥' })
  }

  tabs.push(
    { to: '/marks', label: 'Marks', icon: '📝' },
    { to: '/reports', label: 'Reports', icon: '📄' }
  )

  if (can(role, 'manageClasses', additionalRoles) || can(role, 'assignTeachers', additionalRoles)) {
    tabs.push({ to: '/classes', label: 'Classes', icon: '🏫' })
  }
  if (can(role, 'manageUsers', additionalRoles)) {
    tabs.push({ to: '/people', label: 'People', icon: '🧑‍🏫' })
  }
  if (can(role, 'markAttendance', additionalRoles) || can(role, 'viewAllClasses', additionalRoles)) {
    tabs.push({ to: '/attendance', label: 'Attendance', icon: '📅' })
  }
  if (role) {
    tabs.push({ to: '/settings', label: 'Settings', icon: '⚙️' })
  }
  return tabs
}

export const ROLE_LABEL: Record<Role, string> = {
  pending: 'Pending (no access)',
  admin: 'Admin',
  director: 'Director',
  head_of_school: 'Head of School',
  curriculum_coordinator: 'Curriculum Coordinator',
  homeroom_teacher: 'Homeroom Teacher',
  subject_teacher: 'Subject Teacher'
}
