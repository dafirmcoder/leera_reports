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
  | 'addMarks'           // homeroom + subject teachers
  | 'viewAllClasses'     // sees the whole school (director/HOS/coordinator)
  | 'markAttendance'     // homeroom teachers today; coordinators for school classes
  | 'markPastAttendance' // coordinator backfills skipped attendance dates

export function hasRole(role: Role | undefined, requiredRole: Role, additionalRoles: Role[] = []): boolean {
  return role === requiredRole || additionalRoles.includes(requiredRole)
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
    case 'addMarks':
      return roles.has('homeroom_teacher') || roles.has('subject_teacher') || roles.has('curriculum_coordinator')
    case 'viewAllClasses':
      return roles.has('director') || roles.has('head_of_school') || roles.has('curriculum_coordinator')
    case 'markAttendance':
      return roles.has('homeroom_teacher') || roles.has('curriculum_coordinator')
    case 'markPastAttendance':
      return roles.has('curriculum_coordinator')
    default:
      return false
  }
}

export interface Tab {
  to: string
  label: string
  icon: string
}

export function navTabs(role: Role | undefined, additionalRoles: Role[] = []): Tab[] {
  if (!role || role === 'pending') return []
  const tabs: Tab[] = [
    { to: '/students', label: 'Students', icon: '👥' },
    { to: '/marks', label: 'Marks', icon: '📝' },
    { to: '/reports', label: 'Reports', icon: '📄' }
  ]
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
  director: 'Director',
  head_of_school: 'Head of School',
  curriculum_coordinator: 'Curriculum Coordinator',
  homeroom_teacher: 'Homeroom Teacher',
  subject_teacher: 'Subject Teacher'
}
