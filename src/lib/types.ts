// Shared domain types for the Leera End-of-Unit Reports app (v2).

export type Role =
  | 'pending'
  | 'director'
  | 'head_of_school'
  | 'curriculum_coordinator'
  | 'homeroom_teacher'
  | 'subject_teacher'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  additional_roles: Role[]
  school_id: string | null
  class_id: string | null
}

export interface School {
  id: string
  name: string
  motto: string
  academic_year: string
  term: string
  footer_text: string
  footer_color: string
  show_school_logo: boolean
  show_cambridge_logo: boolean
}

export interface ClassInfo {
  id: string
  name: string
  homeroom_teacher_id: string | null
  homeroom_teacher_name: string
}

export interface Subject {
  id: string
  name: string
  sort_order: number
}

export interface Student {
  id: string
  class_id: string
  student_no: string
  admission_no: string
  full_name: string
  gender: string
}

export interface UnitTest {
  id: string
  class_id: string
  subject_id: string
  subject_name: string
  title: string
  test_date: string // ISO yyyy-mm-dd
  max_mark: number
}

export interface ScoreRow {
  id?: string
  unit_test_id: string
  student_id: string
  student_name?: string
  student_no?: string
  score: number | null
}

export interface Assignment {
  id: string
  class_id: string
  class_name: string
  subject_id: string
  subject_name: string
  teacher_id: string
  teacher_name: string
}

/** One raw mark line feeding the report builder. */
export interface StudentReportRow {
  subject: string
  title: string
  test_date: string
  score: number
  max_mark: number
}

export interface ReportSubject {
  name: string
  rows: StudentReportRow[]
  count: number
  totalScore: number
  totalMax: number
  average: number // percent
}

export interface ReportData {
  subjects: ReportSubject[]
  overall: number // percent
}

// ---------------------------------------------------------------------------
// Data-access layer. Both the Supabase and the demo (localStorage)
// implementations satisfy this interface, so the UI is backend-agnostic.
// ---------------------------------------------------------------------------

export interface Api {
  mode: 'supabase' | 'demo'

  getProfile(): Promise<Profile | null>

  // school
  getSchool(): Promise<School | null>
  saveSchool(s: School): Promise<void>

  // subjects (school-scoped)
  listSubjects(): Promise<Subject[]>
  addSubject(name: string): Promise<Subject>
  updateSubject(s: Subject): Promise<void>
  deleteSubject(id: string): Promise<void>

  // classes
  listClasses(): Promise<ClassInfo[]>
  createClass(name: string): Promise<void>
  deleteClass(id: string): Promise<void>
  setHomeroomTeacher(classId: string, teacherId: string | null): Promise<void>

  // people (HOS / curriculum coordinator)
  listProfiles(): Promise<Profile[]>
  setRole(userId: string, role: Role, classId: string | null, additionalRoles?: Role[]): Promise<void>
  inviteUser(input: { email: string; full_name: string; role: Role; class_id: string | null; additional_roles?: Role[] }): Promise<void>
  deleteTeacher(userId: string): Promise<void>

  // subject-teacher assignments
  listAssignments(classId: string): Promise<Assignment[]>
  assignTeacher(classId: string, subjectId: string, teacherId: string): Promise<void>
  removeAssignment(id: string): Promise<void>

  // students
  listStudents(classId: string): Promise<Student[]>
  getStudent(id: string): Promise<Student | null>
  addStudent(classId: string, s: Omit<Student, 'id' | 'class_id'>): Promise<Student>
  updateStudent(s: Student): Promise<void>
  deleteStudent(id: string): Promise<void>

  // unit tests
  listUnitTests(classId: string): Promise<UnitTest[]>
  createUnitTest(classId: string, input: { subject_id: string; title: string; test_date: string; max_mark: number }): Promise<string>
  deleteUnitTest(id: string): Promise<void>

  // scores
  listScoresForTest(testId: string): Promise<ScoreRow[]>
  saveScore(unit_test_id: string, student_id: string, score: number | null): Promise<void>

  // reports
  getStudentReport(studentId: string): Promise<StudentReportRow[]>
  getClassReportRows(classId: string): Promise<Record<string, StudentReportRow[]>>
}
