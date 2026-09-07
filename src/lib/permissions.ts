import type { Role } from './types'

// Role -> capabilities. Centralised so the UI and nav stay consistent.
export type Capability =
  | 'manageUsers'        // assign roles (HOS + curriculum coordinator)
  | 'createAccounts'     // invite new teachers (HOS only)
  | 'editSchool'         // school settings (HOS only)
  | 'manageSubjects'     // add/edit subjects (HOS + curriculum coordinator)
  | 'manageClasses'      // create classes / set homeroom teacher (HOS only)
  | 'assignTeachers'     // assign subject teachers (HOS + homeroom teacher)
  | 'addStudents'        // homeroom teacher only
  | 'addMarks'           // homeroom + subject teachers
  | 'viewAllClasses'     // sees the whole school (director/HOS/coordinator)

export function can(role: Role | undefined, cap: Capability): boolean {
  switch (cap) {
    case 'manageUsers':
      return role === 'head_of_school' || role === 'curriculum_coordinator'
    case 'createAccounts':
    case 'editSchool':
    case 'manageClasses':
      return role === 'head_of_school'
    case 'manageSubjects':
      return role === 'head_of_school' || role === 'curriculum_coordinator'
    case 'assignTeachers':
      return role === 'head_of_school' || role === 'homeroom_teacher'
    case 'addStudents':
      return role === 'homeroom_teacher'
    case 'addMarks':
      return role === 'homeroom_teacher' || role === 'subject_teacher'
    case 'viewAllClasses':
      return role === 'director' || role === 'head_of_school' || role === 'curriculum_coordinator'
    default:
      return false
  }
}

export interface Tab {
  to: string
  label: string
  icon: string
}

export function navTabs(role: Role | undefined): Tab[] {
  if (!role || role === 'pending') return []
  const tabs: Tab[] = [
    { to: '/students', label: 'Students', icon: '👥' },
    { to: '/marks', label: 'Marks', icon: '📝' },
    { to: '/reports', label: 'Reports', icon: '📄' }
  ]
  if (can(role, 'manageClasses') || role === 'homeroom_teacher') {
    tabs.push({ to: '/classes', label: 'Classes', icon: '🏫' })
  }
  if (can(role, 'manageUsers')) {
    tabs.push({ to: '/people', label: 'People', icon: '🧑‍🏫' })
  }
  if (can(role, 'editSchool')) {
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
