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

export type AttendanceStatus = 'P' | 'A' | 'E'

export interface AttendanceRow {
  id?: string
  class_id: string
  student_id: string
  student_name: string
  student_no: string
  attendance_date: string
  status: AttendanceStatus
  reason: string
}

export interface AttendanceSummary {
  class_id: string
  class_name: string
  date: string
  present: number
  absent: number
  excused: number
  total: number
  absences: Array<{ student_name: string; student_no: string; reason: string }>
}

export interface AttendanceAggregatedSummary {
  periodType: 'daily' | 'weekly' | 'monthly'
  periodLabel: string
  startDate: string
  endDate: string
  totalRecords: number
  present: number
  presentPct: number
  absent: number
  absentPct: number
  excused: number
  excusedPct: number
  classBreakdown: Array<{
    class_id: string
    class_name: string
    homeroom_teacher_name?: string
    present: number
    presentPct: number
    absent: number
    absentPct: number
    excused: number
    excusedPct: number
    total: number
    daysMarked: number
  }>
  absences: Array<{
    date: string
    class_id: string
    class_name: string
    student_name: string
    student_no: string
    reason: string
  }>
}

export interface ClassPopulationSummary {
  class_id: string
  class_name: string
  homeroom_teacher_name: string
  student_count: number
  percentage_of_total: number
  boys_count: number
  girls_count: number
  other_gender_count: number
  boys_percentage: number
  girls_percentage: number
}

export interface SchoolPopulationSummary {
  total_students: number
  total_classes: number
  total_boys: number
  total_girls: number
  boys_percentage: number
  girls_percentage: number
  classes: ClassPopulationSummary[]
}

export interface UnitTestSummaryItem {
  test_id: string
  class_id: string
  class_name: string
  subject_id: string
  subject_name: string
  teacher_id?: string
  teacher_name: string
  title: string
  test_date: string
  max_mark: number
  total_students: number
  marks_entered_count: number
  marks_entered_pct: number
  has_marks_entered: boolean
  average_score: number | null
  average_pct: number | null
  highest_score: number | null
  lowest_score: number | null
}

export interface SubjectTestSummary {
  subject_id: string
  subject_name: string
  tests_count: number
  tests_with_marks_count: number
  total_marks_entered: number
  average_score_pct: number | null
  teachers: string[]
}

export interface EndOfUnitTestOverview {
  total_tests: number
  total_tests_with_marks: number
  overall_average_pct: number | null
  tests_with_marks: UnitTestSummaryItem[]
  all_tests: UnitTestSummaryItem[]
  subject_summaries: SubjectTestSummary[]
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
// Data-access layer interface.
// ---------------------------------------------------------------------------

export interface Api {
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
  nextAdmissionNo(): Promise<string>
  listStudents(classId: string): Promise<Student[]>
  getStudent(id: string): Promise<Student | null>
  addStudent(classId: string, s: Omit<Student, 'id' | 'class_id'>): Promise<Student>
  updateStudent(s: Student): Promise<void>
  deleteStudent(id: string): Promise<void>

  // population summary (for Directors & leadership)
  getPopulationSummary(): Promise<SchoolPopulationSummary>

  // attendance
  listAttendance(classId: string, date: string): Promise<AttendanceRow[]>
  saveAttendance(rows: Array<Pick<AttendanceRow, 'class_id' | 'student_id' | 'attendance_date' | 'status' | 'reason'>>): Promise<void>
  listAttendanceSummary(date: string): Promise<AttendanceSummary[]>
  getAttendancePeriodSummary(period: 'daily' | 'weekly' | 'monthly', date: string): Promise<AttendanceAggregatedSummary>

  // unit tests
  listUnitTests(classId: string): Promise<UnitTest[]>
  createUnitTest(classId: string, input: { subject_id: string; title: string; test_date: string; max_mark: number }): Promise<string>
  deleteUnitTest(id: string): Promise<void>
  getUnitTestOverview(): Promise<EndOfUnitTestOverview>

  // scores
  listScoresForTest(testId: string): Promise<ScoreRow[]>
  saveScore(unit_test_id: string, student_id: string, score: number | null): Promise<void>

  // reports
  getStudentReport(studentId: string): Promise<StudentReportRow[]>
  getClassReportRows(classId: string): Promise<Record<string, StudentReportRow[]>>
}
