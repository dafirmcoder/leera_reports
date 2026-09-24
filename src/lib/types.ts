// Shared domain types for the Leera End-of-Unit Reports app (v2).

export type Role =
  | 'pending'
  | 'admin'
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
  semester: string
  term?: string
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
  roll_no: string
  admission_no?: string
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
  created_by?: string
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
  exam_paper_url?: string | null
  exam_paper_name?: string | null
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

export interface TeacherTestSummary {
  teacher_id: string
  teacher_name: string
  role: Role
  class_names: string[]
  subjects: string[]
  tests_count: number
  tests_with_marks_count: number
  tests_with_marks_pct: number
  total_marks_entered: number
  average_score_pct: number | null
  last_submission_date: string | null
}

export interface EndOfUnitTestOverview {
  total_tests: number
  total_tests_with_marks: number
  overall_average_pct: number | null
  tests_with_marks: UnitTestSummaryItem[]
  all_tests: UnitTestSummaryItem[]
  subject_summaries: SubjectTestSummary[]
  teacher_summaries: TeacherTestSummary[]
}

export interface TeacherAssignmentOverview {
  id: string
  class_id: string
  class_name: string
  subject_id: string
  subject_name: string
  tests_count: number
  tests_with_marks_count: number
  pending_marks_count: number
  average_pct: number | null
  latest_test_title?: string
  latest_test_date?: string
  latest_test_id?: string
  tests?: {
    id: string
    title: string
    test_date: string
    max_mark: number
    marks_entered: boolean
    marks_entered_count: number
    total_students: number
    average_pct: number | null
  }[]
}

export interface TeacherDashboardData {
  homeroomClass?: {
    id: string
    name: string
    student_count: number
    boys_count: number
    girls_count: number
  } | null
  todayAttendance?: {
    marked: boolean
    present_count: number
    absent_count: number
    total_count: number
    rate_pct: number
  } | null
  homeroomTestsCount: number
  homeroomReportsCount: number
  assignments: TeacherAssignmentOverview[]
  totalTestsCreated: number
  totalPendingMarks: number
  overallSubjectAveragePct: number | null
}

export interface AdminClassAttendanceSummary {
  class_id: string
  class_name: string
  homeroom_teacher_name: string
  student_count: number
  present_count: number
  absent_count: number
  rate_pct: number
  is_marked: boolean
}

export interface AdminDashboardData {
  school_info: {
    name: string
    academic_year: string
    semester: string
    motto?: string
  }
  total_students: number
  total_classes: number
  today_attendance: {
    marked_classes_count: number
    total_classes_count: number
    overall_rate_pct: number
    present_count: number
    absent_count: number
  }
  classes_summary: AdminClassAttendanceSummary[]
}

export interface UnitTest {
  id: string
  class_id: string
  subject_id: string
  subject_name: string
  title: string
  test_date: string // ISO yyyy-mm-dd
  max_mark: number
  exam_paper_url?: string | null
  exam_paper_path?: string | null
  exam_paper_name?: string | null
  created_by?: string | null
  created_at?: string
}

export interface UpdateUnitTestInput {
  title?: string
  test_date?: string
  max_mark?: number
  examPaperFile?: File | null
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
  test_id?: string
  created_at?: string
  subject: string
  title: string
  test_date: string
  score: number
  max_mark: number
}

export interface ReportFilter {
  mode: 'since_date' | 'all' | 'custom'
  startDate?: string // ISO 'YYYY-MM-DD', default '2026-09-20'
  selectedTestIds?: string[]
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

export interface ClassAttendanceExportData {
  classInfo: ClassInfo
  students: Student[]
  dates: string[]
  dateLabels: string[]
  dayNames: string[]
  attendanceRecords: Record<string, AttendanceStatus> // key `${student_id}_${date}` -> status
}

export interface DetailedAttendanceExport {
  periodType: 'daily' | 'weekly' | 'monthly'
  startDate: string
  endDate: string
  periodLabel: string
  dates: string[]
  dateLabels: string[]
  dayNames: string[]
  schoolName: string
  classesData: ClassAttendanceExportData[]
  summary: AttendanceAggregatedSummary
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
  listAssignments(classId?: string): Promise<Assignment[]>
  assignTeacher(classId: string, subjectId: string, teacherId: string): Promise<void>
  removeAssignment(id: string): Promise<void>

  // students
  nextAdmissionNo(classId?: string): Promise<string>
  nextRollNo(classId?: string): Promise<string>
  listStudents(classId: string): Promise<Student[]>
  getStudent(id: string): Promise<Student | null>
  addStudent(classId: string, s: Omit<Student, 'id' | 'class_id'>): Promise<Student>
  updateStudent(s: Student): Promise<void>
  reallocateStudent(studentId: string, targetClassId: string): Promise<void>
  deleteStudent(id: string): Promise<void>

  // population summary (for Directors & leadership)
  getPopulationSummary(): Promise<SchoolPopulationSummary>

  // attendance
  listAttendance(classId: string, date: string): Promise<AttendanceRow[]>
  saveAttendance(rows: Array<Pick<AttendanceRow, 'class_id' | 'student_id' | 'attendance_date' | 'status' | 'reason'>>): Promise<void>
  listAttendanceSummary(date: string): Promise<AttendanceSummary[]>
  getAttendancePeriodSummary(period: 'daily' | 'weekly' | 'monthly', date: string): Promise<AttendanceAggregatedSummary>
  getDetailedAttendanceReport(period: 'daily' | 'weekly' | 'monthly', date: string): Promise<DetailedAttendanceExport>

  // unit tests
  listUnitTests(classId: string): Promise<UnitTest[]>
  createUnitTest(classId: string, input: { subject_id: string; title: string; test_date: string; max_mark: number; examPaperFile?: File | null }): Promise<string>
  updateUnitTest(id: string, input: UpdateUnitTestInput): Promise<void>
  deleteUnitTest(id: string): Promise<void>
  getUnitTestOverview(): Promise<EndOfUnitTestOverview>
  getExamPaperUrl?(pathOrUrl: string): Promise<string>

  // scores
  listScoresForTest(testId: string): Promise<ScoreRow[]>
  listScoresForTests(testIds: string[]): Promise<ScoreRow[]>
  saveScore(unit_test_id: string, student_id: string, score: number | null): Promise<void>

  // reports
  getStudentReport(studentId: string): Promise<StudentReportRow[]>
  getClassReportRows(classId: string): Promise<Record<string, StudentReportRow[]>>

  // planning & curriculum
  listCurriculumSchemes(framework?: string): Promise<CurriculumScheme[]>
  getCurriculumSchemeWithDetails(schemeId: string): Promise<{ scheme: CurriculumScheme; topics: CurriculumTopic[]; objectives: CurriculumObjective[] } | null>
  saveCurriculumScheme(input: {
    framework: string
    subject_code: string
    subject_name: string
    year_group: string
    title: string
    syllabus_years?: string
    topics: Array<{ code?: string; title: string; sequence: number; is_challenge?: boolean; description?: string }>
    objectives: Array<{ topic_title?: string; code: string; text: string; subtopic?: string; challenge_title?: string; sequence: number }>
  }): Promise<string>
  seedCambridgeFrameworks(): Promise<{ schemesCreated: number }>
  deleteCurriculumScheme(schemeId: string): Promise<void>
  clearCurriculumLibrary(): Promise<void>

  // teacher timetables & schedule slots
  getTeacherTimetable(teacherId?: string): Promise<{ timetable: TeacherTimetable | null; slots: TeacherScheduleSlot[] }>
  saveTeacherScheduleSlots(slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>>, fileName?: string): Promise<void>

  // work plans
  listWorkPlans(filter?: { teacherId?: string; classId?: string; subjectId?: string; semester?: string }): Promise<WorkPlan[]>
  getWorkPlan(id: string): Promise<WorkPlan | null>
  createWorkPlan(input: { subject_id: string; class_id: string; scheme_id?: string | null; semester?: string; academic_year?: string; resources?: string; notes?: string }): Promise<string>
  updateWorkPlan(id: string, updates: Partial<WorkPlan>): Promise<void>
  saveWorkPlanWeeks(workPlanId: string, weeks: Array<{
    id?: string
    sequence: number
    week_label: string
    month_label?: string
    start_date?: string | null
    end_date?: string | null
    is_instructional: boolean
    event_label?: string
    topic_id?: string | null
    topic_title?: string
    challenge_title?: string
    subtopic_title?: string
    lessons_per_week: number
    remarks?: string
    objectives?: Array<{ objective_id?: string | null; code_snapshot: string; text_snapshot: string; is_met?: boolean }>
  }>): Promise<void>
  importWorkPlan(input: ImportWorkPlanInput): Promise<ImportWorkPlanResult>
  submitWorkPlan(id: string): Promise<void>
  reviewWorkPlan(id: string, status: 'approved' | 'returned', comment: string): Promise<void>
  deleteWorkPlan(id: string): Promise<void>

  // lesson plans
  listLessonPlans(filter?: { teacherId?: string; classId?: string; subjectId?: string; date?: string }): Promise<LessonPlan[]>
  getLessonPlan(id: string): Promise<LessonPlan | null>
  createLessonPlan(input: {
    subject_id: string
    class_id: string
    work_plan_week_id?: string | null
    schedule_slot_id?: string | null
    lesson_date: string
    start_time?: string | null
    end_time?: string | null
    topic_title: string
    challenge_title?: string
    subtopic_title?: string
    main_teaching_activity?: string
    assessment_ideas?: string
    resources?: string
    differentiation?: string
    boys_attendance?: number | null
    girls_attendance?: number | null
    reflection_remarks?: string
    objectives?: Array<{ objective_id?: string | null; code_snapshot: string; text_snapshot: string }>
  }): Promise<string>
  updateLessonPlan(id: string, updates: Partial<LessonPlan> & {
    objectives?: Array<{ objective_id?: string | null; code_snapshot: string; text_snapshot: string }>
  }): Promise<void>
  submitLessonPlan(id: string): Promise<void>
  reviewLessonPlan(id: string, status: 'approved' | 'returned', comment: string): Promise<void>
  deleteLessonPlan(id: string): Promise<void>

  // dashboard
  getTeacherDashboardData(teacherId: string, homeroomClassId?: string | null): Promise<TeacherDashboardData>
  getAdminDashboardData(): Promise<AdminDashboardData>
}

// ------------------------------------------------------------------
// Planning & Curriculum Domain Models
// ------------------------------------------------------------------

export type CurriculumFrameworkCode =
  | 'CAMBRIDGE_PRIMARY'
  | 'CAMBRIDGE_LOWER_SECONDARY'
  | 'CAMBRIDGE_IGCSE'
  | 'CAMBRIDGE_AS_A_LEVEL'
  | 'NATIONAL'
  | 'OTHER'

export interface CurriculumScheme {
  id: string
  school_id: string | null
  framework: string
  subject_code: string
  subject_name: string
  year_group: string
  title: string
  syllabus_years: string
  is_active: boolean
  topics_count?: number
  objectives_count?: number
  created_at?: string
}

export interface CurriculumTopic {
  id: string
  scheme_id: string
  code: string
  title: string
  sequence: number
  is_challenge: boolean
  description: string
  objectives?: CurriculumObjective[]
}

export interface CurriculumObjective {
  id: string
  scheme_id: string
  topic_id: string | null
  code: string
  text: string
  subtopic: string
  challenge_title: string
  sequence: number
}

export interface TeacherTimetable {
  id: string
  school_id: string | null
  teacher_id: string
  file_name: string
  academic_year: string
  semester: string
  is_active: boolean
  created_at?: string
}

export interface TeacherScheduleSlot {
  id?: string
  timetable_id?: string
  teacher_id?: string
  class_id: string | null
  subject_id: string | null
  class_name: string
  subject_name: string
  day_of_week: number // 0 = Mon, 4 = Fri
  period_number: number
  start_time: string // "08:00"
  end_time: string   // "08:45"
  room: string
}

export type PlanStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'returned' | 'archived'

export interface WorkPlan {
  id: string
  school_id: string
  subject_id: string
  class_id: string
  teacher_id: string
  scheme_id: string | null
  academic_year: string
  semester: string
  status: PlanStatus
  revision: number
  resources: string
  notes: string
  submitted_at: string | null
  approved_at: string | null
  reviewer_id: string | null
  review_comment: string
  created_at: string
  updated_at: string
  subject_name?: string
  class_name?: string
  teacher_name?: string
  scheme_title?: string
  weeks?: WorkPlanWeek[]
}

export interface WorkPlanWeek {
  id: string
  work_plan_id: string
  sequence: number
  week_label: string
  month_label: string
  start_date: string | null
  end_date: string | null
  is_instructional: boolean
  event_label: string
  topic_id: string | null
  topic_title: string
  challenge_title: string
  subtopic_title: string
  lessons_per_week: number
  remarks: string
  objectives?: WorkPlanWeekObjective[]
}

export interface WorkPlanWeekObjective {
  id: string
  work_plan_week_id: string
  objective_id: string | null
  code_snapshot: string
  text_snapshot: string
  is_met: boolean
  met_at: string | null
}

export interface LessonPlan {
  id: string
  school_id: string
  teacher_id: string
  subject_id: string
  class_id: string
  work_plan_week_id: string | null
  schedule_slot_id: string | null
  lesson_date: string
  start_time: string | null
  end_time: string | null
  topic_title: string
  challenge_title: string
  subtopic_title: string
  main_teaching_activity: string
  assessment_ideas: string
  resources: string
  differentiation: string
  boys_attendance: number | null
  girls_attendance: number | null
  reflection_remarks: string
  status: 'draft' | 'submitted' | 'approved' | 'returned'
  revision: number
  submitted_at: string | null
  approved_at: string | null
  reviewer_id: string | null
  review_comment: string
  created_at: string
  updated_at: string
  subject_name?: string
  class_name?: string
  teacher_name?: string
  objectives?: LessonPlanObjective[]
}

export interface LessonPlanObjective {
  id: string
  lesson_plan_id: string
  objective_id: string | null
  code_snapshot: string
  text_snapshot: string
}

export interface WorkPlanCoverageStats {
  total_objectives: number
  planned_objectives: number
  covered_percent: number
  total_topics: number
  covered_topics: number
  total_lessons: number
}

export interface ParsedWorkPlanObjective {
  code: string
  text: string
  is_met: boolean
  topic_title?: string
  challenge_title?: string
}

export interface ParsedWorkPlanWeek {
  sequence: number
  week_label: string
  month_label?: string
  term_dates?: string
  start_date?: string | null
  end_date?: string | null
  is_instructional: boolean
  event_label?: string
  topic_title?: string
  challenge_title?: string
  subtopic_title?: string
  lessons_per_week?: number
  remarks?: string
  objectives: ParsedWorkPlanObjective[]
  is_commed?: boolean
}

export interface ParsedWorkPlan {
  raw_text: string
  title: string
  framework?: string
  subject_code?: string
  subject_name?: string
  class_name?: string
  teacher_name?: string
  academic_year?: string
  semester?: string
  needs_subject_code: boolean
  weeks: ParsedWorkPlanWeek[]
  resources?: string
  notes?: string
}

export interface ImportWorkPlanInput {
  class_id: string
  subject_id: string
  subject_code: string
  framework?: string
  academic_year?: string
  semester?: string
  resources?: string
  notes?: string
  scheme_id?: string | null
  weeks: ParsedWorkPlanWeek[]
}

export interface ImportWorkPlanResult {
  workPlanId: string
  schemeId: string
  objectivesIngested: number
  objectivesSkipped: number
  weeksCount: number
  commedWeeksCount: number
}

