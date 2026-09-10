import type {
  Api, Assignment, ClassInfo, Profile, Role, School, ScoreRow,
  Student, StudentReportRow, Subject, UnitTest
} from './types'
import type { AttendanceRow } from './types'
import { DEMO_PERSONAS } from './auth'
import { hasRole } from './permissions'

// localStorage-backed implementation (demo mode) with seeded multi-class data
// and one persona per role, so every role can be tested.

interface DemoDB {
  school: School
  profiles: Profile[]
  classes: ClassInfo[]
  subjects: Subject[]
  students: Student[]
  unitTests: UnitTest[]
  scores: ScoreRow[]
  assignments: Assignment[]
  attendance: AttendanceRow[]
}

const KEY = 'leera_demo_db_v2'

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function currentEmail(): string {
  try {
    return JSON.parse(localStorage.getItem('leera_demo_user') ?? '{}').email ?? ''
  } catch {
    return ''
  }
}

function currentProfile(db: DemoDB): Profile {
  const email = currentEmail()
  const profile = db.profiles.find((p) => p.email === email) ?? db.profiles[0]
  return { ...profile, additional_roles: profile.additional_roles ?? [] }
}

function seed(): DemoDB {
  const school: School = {
    id: uid(),
    name: 'Leera International School',
    motto: 'Knowledge - Character - Service',
    academic_year: '2026/2027',
    term: '1',
    footer_text: 'Email: info@leeraschool.ac.tz   |   Website: www.leeraschool.ac.tz   |   Contact: +255776047665',
    footer_color: '#1F8A5F',
    show_school_logo: true,
    show_cambridge_logo: true
  }

  const c8: ClassInfo = { id: uid(), name: 'Year 8 - Lower Secondary', homeroom_teacher_id: 'p_homeroom', homeroom_teacher_name: 'Ms. Amina Mwinyi' }
  const c9: ClassInfo = { id: uid(), name: 'Year 9 - Lower Secondary', homeroom_teacher_id: null, homeroom_teacher_name: '' }

  const subjects: Subject[] = [
    'English', 'Mathematics', 'Science', 'Kiswahili', 'History', 'Geography',
    'Biology', 'Chemistry', 'Physics'
  ].map((name, i) => ({ id: `subj_${i}`, name, sort_order: i + 1 }))

  const profiles: Profile[] = [
    { id: 'p_director', email: DEMO_PERSONAS[0].email, full_name: 'Dr. A. Director', role: 'director', additional_roles: [], school_id: school.id, class_id: null },
    { id: 'p_hos', email: DEMO_PERSONAS[1].email, full_name: 'Mr. H. Head', role: 'head_of_school', additional_roles: [], school_id: school.id, class_id: null },
    { id: 'p_cc', email: DEMO_PERSONAS[2].email, full_name: 'Ms. C. Curriculum', role: 'curriculum_coordinator', additional_roles: [], school_id: school.id, class_id: null },
    { id: 'p_homeroom', email: DEMO_PERSONAS[3].email, full_name: 'Ms. Amina Mwinyi', role: 'homeroom_teacher', additional_roles: [], school_id: school.id, class_id: c8.id },
    { id: 'p_teacher', email: DEMO_PERSONAS[4].email, full_name: 'Mr. J. Subject', role: 'subject_teacher', additional_roles: [], school_id: school.id, class_id: null }
  ]

  const students: Student[] = []
  const mk = (classId: string, no: string, adm: string, name: string, g: string): Student =>
    ({ id: uid(), class_id: classId, student_no: no, admission_no: adm, full_name: name, gender: g })
  const y8 = [
    ['ST-001', '1001', 'Amina Hassan', 'F'], ['ST-002', '1002', 'Baraka John', 'M'],
    ['ST-003', '1003', 'Neema Charles', 'F'], ['ST-004', '1004', 'David Petro', 'M'],
    ['ST-005', '1005', 'Zawadi Juma', 'F'], ['ST-006', '1006', 'Emmanuel David', 'M']
  ]
  y8.forEach(([no, adm, name, g]) => students.push(mk(c8.id, no, adm, name, g)))
  students.push(mk(c9.id, 'ST-001', '2001', 'Grace Mushi', 'F'))
  students.push(mk(c9.id, 'ST-002', '2002', 'Joseph Kileo', 'M'))

  const subjId = (n: string) => subjects.find((s) => s.name === n)!.id

  const unitTests: UnitTest[] = []
  const scores: ScoreRow[] = []
  const mkTest = (classId: string, subject: string, title: string, date: string, max: number, marks: Record<string, number>) => {
    const testId = uid()
    unitTests.push({ id: testId, class_id: classId, subject_id: subjId(subject), subject_name: subject, title, test_date: date, max_mark: max })
    for (const st of students.filter((s) => s.class_id === classId)) {
      scores.push({ id: uid(), unit_test_id: testId, student_id: st.id, score: marks[st.student_no] ?? null })
    }
  }
  mkTest(c8.id, 'English', 'Story Writing', '2026-09-05', 50, { 'ST-001': 42, 'ST-002': 35, 'ST-003': 47, 'ST-004': 30, 'ST-005': 44, 'ST-006': 38 })
  mkTest(c8.id, 'Mathematics', 'Fractions & Decimals', '2026-09-02', 50, { 'ST-001': 40, 'ST-002': 45, 'ST-003': 38, 'ST-004': 41, 'ST-005': 36, 'ST-006': 48 })
  mkTest(c8.id, 'Mathematics', 'Geometry Basics', '2026-08-18', 40, { 'ST-001': 33, 'ST-002': 30, 'ST-003': 35, 'ST-004': 28, 'ST-005': 32, 'ST-006': 37 })
  mkTest(c8.id, 'Science', 'Living Things', '2026-08-08', 60, { 'ST-001': 52, 'ST-002': 47, 'ST-003': 55, 'ST-004': 44, 'ST-005': 50, 'ST-006': 58 })
  mkTest(c9.id, 'Science', 'Forces', '2026-08-20', 50, { 'ST-001': 40, 'ST-002': 44 })

  const assignments: Assignment[] = [
    { id: uid(), class_id: c8.id, class_name: c8.name, subject_id: subjId('Mathematics'), subject_name: 'Mathematics', teacher_id: 'p_teacher', teacher_name: 'Mr. J. Subject' },
    { id: uid(), class_id: c9.id, class_name: c9.name, subject_id: subjId('Science'), subject_name: 'Science', teacher_id: 'p_teacher', teacher_name: 'Mr. J. Subject' }
  ]

  return { school, profiles, classes: [c8, c9], subjects, students, unitTests, scores, assignments, attendance: [] }
}

function load(): DemoDB {
  const raw = localStorage.getItem(KEY)
  if (raw) {
    try { return JSON.parse(raw) as DemoDB } catch { /* reseed */ }
  }
  const db = seed()
  localStorage.setItem(KEY, JSON.stringify(db))
  return db
}

function save(db: DemoDB): void {
  localStorage.setItem(KEY, JSON.stringify(db))
}

export const demoApi: Api = {
  mode: 'demo',

  async getProfile() {
    return { ...currentProfile(load()) }
  },

  async getSchool() {
    return { ...load().school }
  },

  async saveSchool(s: School) {
    const db = load()
    db.school = { ...s }
    save(db)
  },

  async listSubjects() {
    return [...load().subjects].sort((a, b) => a.sort_order - b.sort_order)
  },

  async addSubject(name: string) {
    const db = load()
    const s: Subject = { id: uid(), name, sort_order: db.subjects.length + 1 }
    db.subjects.push(s)
    save(db)
    return s
  },

  async updateSubject(s: Subject) {
    const db = load()
    const i = db.subjects.findIndex((x) => x.id === s.id)
    if (i >= 0) db.subjects[i] = { ...s }
    save(db)
  },

  async deleteSubject(id: string) {
    const db = load()
    db.subjects = db.subjects.filter((s) => s.id !== id)
    const tids = db.unitTests.filter((t) => t.subject_id === id).map((t) => t.id)
    db.unitTests = db.unitTests.filter((t) => t.subject_id !== id)
    db.scores = db.scores.filter((sc) => !tids.includes(sc.unit_test_id))
    db.assignments = db.assignments.filter((a) => a.subject_id !== id)
    save(db)
  },

  async listClasses() {
    const db = load()
    const me = currentProfile(db)
    if (hasRole(me.role, 'director', me.additional_roles) || hasRole(me.role, 'head_of_school', me.additional_roles) || hasRole(me.role, 'curriculum_coordinator', me.additional_roles)) {
      return [...db.classes]
    }
    const ids = new Set(
      db.assignments.filter((a) => a.teacher_id === me.id).map((a) => a.class_id)
    )
    if (me.class_id) ids.add(me.class_id)
    return db.classes.filter((c) => ids.has(c.id))
  },

  async createClass(name: string) {
    const db = load()
    db.classes.push({ id: uid(), name, homeroom_teacher_id: null, homeroom_teacher_name: '' })
    save(db)
  },

  async deleteClass(id: string) {
    const db = load()
    db.classes = db.classes.filter((c) => c.id !== id)
    const tids = db.unitTests.filter((t) => t.class_id === id).map((t) => t.id)
    db.unitTests = db.unitTests.filter((t) => t.class_id !== id)
    db.scores = db.scores.filter((sc) => !tids.includes(sc.unit_test_id))
    db.students = db.students.filter((s) => s.class_id !== id)
    db.assignments = db.assignments.filter((a) => a.class_id !== id)
    db.profiles = db.profiles.map((p) => (p.class_id === id ? { ...p, class_id: null } : p))
    save(db)
  },

  async setHomeroomTeacher(classId: string, teacherId: string | null) {
    const db = load()
    db.profiles = db.profiles.map((p) => (p.class_id === classId ? { ...p, class_id: null } : p))
    const t = db.classes.find((c) => c.id === classId)
    if (t) {
      t.homeroom_teacher_id = teacherId
      t.homeroom_teacher_name = teacherId ? db.profiles.find((p) => p.id === teacherId)?.full_name ?? '' : ''
    }
    if (teacherId) {
      const p = db.profiles.find((x) => x.id === teacherId)
      if (p) p.class_id = classId
    }
    save(db)
  },

  async listProfiles() {
    return load().profiles.map((p) => ({ ...p, additional_roles: p.additional_roles ?? [] }))
  },

  async setRole(userId: string, role: Role, classId: string | null, additionalRoles: Role[] = []) {
    const db = load()
    const p = db.profiles.find((x) => x.id === userId)
    if (p) {
      p.role = role
      p.additional_roles = additionalRoles
      p.class_id = classId ?? null
      p.school_id = db.school.id
    }
    save(db)
  },

  async inviteUser(input) {
    const db = load()
    db.profiles.push({
      id: uid(),
      email: input.email,
      full_name: input.full_name,
      role: input.role,
      additional_roles: input.additional_roles ?? [],
      school_id: db.school.id,
      class_id: input.class_id ?? null
    })
    save(db)
  },

  async deleteTeacher(userId: string) {
    const db = load()
    db.profiles = db.profiles.filter((p) => p.id !== userId)
    db.assignments = db.assignments.filter((a) => a.teacher_id !== userId)
    db.classes = db.classes.map((c) => c.homeroom_teacher_id === userId
      ? { ...c, homeroom_teacher_id: null, homeroom_teacher_name: '' }
      : c)
    save(db)
  },

  async listAttendance(classId: string, date: string) {
    const db = load()
    return db.attendance.filter((a) => a.class_id === classId && a.attendance_date === date)
  },

  async saveAttendance(rows) {
    const db = load()
    for (const row of rows) {
      if (row.status === 'A' && !row.reason.trim()) throw new Error('An absence reason is required')
      db.attendance = db.attendance.filter((a) => !(a.class_id === row.class_id && a.student_id === row.student_id && a.attendance_date === row.attendance_date))
      const student = db.students.find((s) => s.id === row.student_id)
      db.attendance.push({ ...row, id: uid(), student_name: student?.full_name ?? '', student_no: student?.student_no ?? '' })
    }
    save(db)
  },

  async listAttendanceSummary(date: string) {
    const db = load()
    return db.classes.map((c) => {
      const rows = db.attendance.filter((a) => a.class_id === c.id && a.attendance_date === date)
      return {
        class_id: c.id, class_name: c.name, date,
        present: rows.filter((r) => r.status === 'P').length,
        absent: rows.filter((r) => r.status === 'A').length,
        excused: rows.filter((r) => r.status === 'E').length,
        total: rows.length,
        absences: rows.filter((r) => r.status === 'A').map((r) => ({ student_name: r.student_name, student_no: r.student_no, reason: r.reason }))
      }
    })
  },

  async listAssignments(classId: string) {
    const db = load()
    const me = currentProfile(db)
    let list = db.assignments.filter((a) => a.class_id === classId)
    if (hasRole(me.role, 'subject_teacher', me.additional_roles)
      || (hasRole(me.role, 'homeroom_teacher', me.additional_roles) && me.class_id !== classId)) {
      list = list.filter((a) => a.teacher_id === me.id)
    }
    return list
  },

  async assignTeacher(classId: string, subjectId: string, teacherId: string) {
    const db = load()
    const cls = db.classes.find((c) => c.id === classId)
    const subj = db.subjects.find((s) => s.id === subjectId)
    const t = db.profiles.find((p) => p.id === teacherId)
    db.assignments.push({
      id: uid(), class_id: classId, class_name: cls?.name ?? '',
      subject_id: subjectId, subject_name: subj?.name ?? '',
      teacher_id: teacherId, teacher_name: t?.full_name ?? ''
    })
    save(db)
  },

  async removeAssignment(id: string) {
    const db = load()
    db.assignments = db.assignments.filter((a) => a.id !== id)
    save(db)
  },

  async nextAdmissionNo() {
    const db = load()
    let max = 0
    for (const student of db.students) {
      const value = Number.parseInt(student.admission_no.trim(), 10)
      if (Number.isFinite(value)) max = Math.max(max, value)
    }
    return String(max + 1)
  },

  async listStudents(classId: string) {
    return load().students
      .filter((s) => s.class_id === classId)
      .sort((a, b) => a.student_no.localeCompare(b.student_no))
  },

  async getStudent(id: string) {
    return load().students.find((s) => s.id === id) ?? null
  },

  async addStudent(classId: string, s) {
    const db = load()
    if (db.students.some((student) => student.admission_no.trim() === s.admission_no.trim())) {
      throw new Error('Admission number already exists. Enter a unique number.')
    }
    const student: Student = { id: uid(), class_id: classId, ...s }
    db.students.push(student)
    save(db)
    return student
  },

  async updateStudent(s: Student) {
    const db = load()
    if (db.students.some((student) => student.id !== s.id && student.admission_no.trim() === s.admission_no.trim())) {
      throw new Error('Admission number already exists. Enter a unique number.')
    }
    const i = db.students.findIndex((x) => x.id === s.id)
    if (i >= 0) db.students[i] = { ...s }
    save(db)
  },

  async deleteStudent(id: string) {
    const db = load()
    db.students = db.students.filter((s) => s.id !== id)
    db.scores = db.scores.filter((sc) => sc.student_id !== id)
    save(db)
  },

  async listUnitTests(classId: string) {
    const db = load()
    const me = currentProfile(db)
    let tests = db.unitTests.filter((t) => t.class_id === classId)
    const isOwnClass = me.class_id === classId
    if (!isOwnClass && (hasRole(me.role, 'subject_teacher', me.additional_roles)
      || hasRole(me.role, 'homeroom_teacher', me.additional_roles))) {
      const mine = new Set(db.assignments.filter((a) => a.teacher_id === me.id && a.class_id === classId).map((a) => a.subject_id))
      tests = tests.filter((t) => mine.has(t.subject_id))
    }
    return [...tests].sort((a, b) => b.test_date.localeCompare(a.test_date))
  },

  async createUnitTest(classId: string, input) {
    const db = load()
    const id = uid()
    const subj = db.subjects.find((s) => s.id === input.subject_id)
    db.unitTests.push({
      id, class_id: classId, subject_id: input.subject_id, subject_name: subj?.name ?? '—',
      title: input.title, test_date: input.test_date, max_mark: input.max_mark
    })
    for (const st of db.students.filter((s) => s.class_id === classId)) {
      db.scores.push({ id: uid(), unit_test_id: id, student_id: st.id, score: null })
    }
    save(db)
    return id
  },

  async deleteUnitTest(id: string) {
    const db = load()
    db.unitTests = db.unitTests.filter((t) => t.id !== id)
    db.scores = db.scores.filter((sc) => sc.unit_test_id !== id)
    save(db)
  },

  async listScoresForTest(testId: string) {
    const db = load()
    return db.scores
      .filter((sc) => sc.unit_test_id === testId)
      .map((sc) => {
        const st = db.students.find((s) => s.id === sc.student_id)
        return { ...sc, student_name: st?.full_name ?? '—', student_no: st?.student_no ?? '' }
      })
      .sort((a, b) => (a.student_no ?? '').localeCompare(b.student_no ?? ''))
  },

  async saveScore(unit_test_id: string, student_id: string, score: number | null) {
    const db = load()
    const existing = db.scores.find((sc) => sc.unit_test_id === unit_test_id && sc.student_id === student_id)
    if (existing) existing.score = score
    else db.scores.push({ id: uid(), unit_test_id, student_id, score })
    save(db)
  },

  async getStudentReport(studentId: string) {
    const db = load()
    const rows: StudentReportRow[] = []
    for (const sc of db.scores) {
      if (sc.student_id !== studentId || sc.score === null || sc.score === undefined) continue
      const t = db.unitTests.find((x) => x.id === sc.unit_test_id)
      if (!t) continue
      rows.push({ subject: t.subject_name, title: t.title, test_date: t.test_date, score: Number(sc.score), max_mark: t.max_mark })
    }
    return rows
  },

  async getClassReportRows(classId: string) {
    const db = load()
    const out: Record<string, StudentReportRow[]> = {}
    for (const sc of db.scores) {
      const st = db.students.find((s) => s.id === sc.student_id)
      if (!st || st.class_id !== classId) continue
      if (sc.score === null || sc.score === undefined) continue
      const t = db.unitTests.find((x) => x.id === sc.unit_test_id)
      if (!t) continue
      ;(out[st.id] ??= []).push({ subject: t.subject_name, title: t.title, test_date: t.test_date, score: Number(sc.score), max_mark: t.max_mark })
    }
    return out
  }
}
