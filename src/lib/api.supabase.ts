import { supabase } from './supabase'
import type {
  Api, Assignment, AttendanceAggregatedSummary, AttendanceRow, AttendanceStatus, AttendanceSummary,
  ClassAttendanceExportData, ClassInfo, ClassPopulationSummary, DetailedAttendanceExport,
  EndOfUnitTestOverview, Profile, Role, School,
  SchoolPopulationSummary, ScoreRow, Student, StudentReportRow, Subject,
  SubjectTestSummary, UnitTest, UnitTestSummaryItem
} from './types'

function db() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('Not signed in')
  return data.user.id
}

function toSchool(r: any): School {
  return {
    id: r.id,
    name: r.name,
    motto: r.motto,
    academic_year: r.academic_year,
    term: r.term,
    footer_text: r.footer_text,
    footer_color: r.footer_color,
    show_school_logo: r.show_school_logo,
    show_cambridge_logo: r.show_cambridge_logo
  }
}

function toProfile(r: any): Profile {
  return {
    id: r.id,
    email: r.email ?? '',
    full_name: r.full_name ?? '',
    role: r.role,
    additional_roles: r.additional_roles ?? [],
    school_id: r.school_id,
    class_id: r.class_id
  }
}

function toLocalIsoDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(str: string): Date {
  const parts = str.split('-').map(Number)
  return new Date(parts[0] || new Date().getFullYear(), (parts[1] || 1) - 1, parts[2] || 1)
}

export const supabaseApi: Api = {
  async getProfile(): Promise<Profile | null> {
    const id = await uid()
    const { data } = await db().from('profiles').select('*').eq('id', id).maybeSingle()
    return data ? toProfile(data) : null
  },

  async getSchool(): Promise<School | null> {
    const { data } = await db().from('schools').select('*').limit(1).maybeSingle()
    return data ? toSchool(data) : null
  },

  async saveSchool(s: School): Promise<void> {
    const { error } = await db().from('schools').update({
      name: s.name, motto: s.motto, academic_year: s.academic_year, term: s.term,
      footer_text: s.footer_text, footer_color: s.footer_color,
      show_school_logo: s.show_school_logo, show_cambridge_logo: s.show_cambridge_logo
    }).eq('id', s.id)
    if (error) throw new Error(error.message)
  },

  async listSubjects(): Promise<Subject[]> {
    const { data, error } = await db().from('subjects').select('*').order('sort_order', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, sort_order: r.sort_order }))
  },

  async addSubject(name: string): Promise<Subject> {
    const schoolId = (await this.getProfile())?.school_id
    if (!schoolId) throw new Error('Your account is not assigned to a school')
    const { data, error } = await db().from('subjects').insert({ name, school_id: schoolId, sort_order: 0 }).select().single()
    if (error) throw new Error(error.message)
    return { id: data.id, name, sort_order: 0 }
  },

  async updateSubject(s: Subject): Promise<void> {
    const { error } = await db().from('subjects').update({ name: s.name }).eq('id', s.id)
    if (error) throw new Error(error.message)
  },

  async deleteSubject(id: string): Promise<void> {
    const { error } = await db().from('subjects').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },

  async listClasses(): Promise<ClassInfo[]> {
    const { data, error } = await db()
      .from('classes')
      .select('id, name, homeroom_teacher_id')
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)

    const teacherIds = (data ?? [])
      .map((r: any) => r.homeroom_teacher_id)
      .filter(Boolean)
    const teacherNames = new Map<string, string>()
    if (teacherIds.length > 0) {
      const { data: profiles, error: profileError } = await db()
        .from('profiles')
        .select('id, full_name')
        .in('id', teacherIds)
      if (profileError) throw new Error(profileError.message)
      for (const profile of profiles ?? []) teacherNames.set(profile.id, profile.full_name ?? '')
    }

    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      homeroom_teacher_id: r.homeroom_teacher_id,
      homeroom_teacher_name: teacherNames.get(r.homeroom_teacher_id) ?? ''
    }))
  },

  async createClass(name: string): Promise<void> {
    const schoolId = (await this.getProfile())?.school_id
    if (!schoolId) throw new Error('Your account is not assigned to a school')
    const { error } = await db().from('classes').insert({ name, school_id: schoolId })
    if (error) throw new Error(error.message)
  },

  async deleteClass(id: string): Promise<void> {
    const { error } = await db().from('classes').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },

  async setHomeroomTeacher(classId: string, teacherId: string | null): Promise<void> {
    const { error } = await db().from('classes').update({ homeroom_teacher_id: teacherId }).eq('id', classId)
    if (error) throw new Error(error.message)
    // keep profiles.class_id in sync
    const { error: e2 } = await db().from('profiles').update({ class_id: null }).eq('class_id', classId)
    if (e2) throw new Error(e2.message)
    if (teacherId) {
      const { error: e3 } = await db().from('profiles').update({ class_id: classId }).eq('id', teacherId)
      if (e3) throw new Error(e3.message)
    }
  },

  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await db().from('profiles').select('*').order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map(toProfile)
  },

  async setRole(userId: string, role: Role, classId: string | null, additionalRoles: Role[] = []): Promise<void> {
    const schoolId = (await this.getProfile())?.school_id
    const { error } = await db()
      .from('profiles')
      .update({ role, additional_roles: additionalRoles, class_id: classId ?? null, school_id: schoolId })
      .eq('id', userId)
    if (error) throw new Error(error.message)
  },

  async inviteUser(input): Promise<void> {
    const { data: { session } } = await supabase!.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Not signed in')
    const url = import.meta.env.VITE_SUPABASE_URL as string
    const res = await fetch(`${url}/functions/v1/invite-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(input)
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Invite failed — is the invite-user edge function deployed?')
  },

  async deleteTeacher(userId: string): Promise<void> {
    const { data: { session } } = await supabase!.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Not signed in')
    const url = import.meta.env.VITE_SUPABASE_URL as string
    const res = await fetch(`${url}/functions/v1/invite-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'delete_teacher', user_id: userId })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Teacher deletion failed')
  },

  async nextAdmissionNo(): Promise<string> {
    const { data, error } = await db().rpc('next_admission_no')
    if (error) throw new Error(error.message)
    return data ?? '1'
  },

  async listAssignments(classId: string): Promise<Assignment[]> {
    const { data, error } = await db()
      .from('class_subject_teachers')
      .select('id, class_id, subject_id, teacher_id, subjects(name), profiles!class_subject_teachers_teacher_id_fkey(full_name), classes(name)')
      .eq('class_id', classId)
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({
      id: r.id,
      class_id: r.class_id,
      class_name: r.classes?.name ?? '',
      subject_id: r.subject_id,
      subject_name: r.subjects?.name ?? '',
      teacher_id: r.teacher_id,
      teacher_name: r.profiles?.full_name ?? ''
    }))
  },

  async assignTeacher(classId: string, subjectId: string, teacherId: string): Promise<void> {
    const { error } = await db()
      .from('class_subject_teachers')
      .insert({ class_id: classId, subject_id: subjectId, teacher_id: teacherId })
    if (error) throw new Error(error.message)
  },

  async removeAssignment(id: string): Promise<void> {
    const { error } = await db().from('class_subject_teachers').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },

  async listStudents(classId: string): Promise<Student[]> {
    const { data, error } = await db()
      .from('students').select('*').eq('class_id', classId)
      .order('student_no', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({
      id: r.id, class_id: r.class_id, student_no: r.student_no,
      admission_no: r.admission_no, full_name: r.full_name, gender: r.gender
    }))
  },

  async getStudent(id: string): Promise<Student | null> {
    const { data } = await db().from('students').select('*').eq('id', id).maybeSingle()
    if (!data) return null
    return { id: data.id, class_id: data.class_id, student_no: data.student_no, admission_no: data.admission_no, full_name: data.full_name, gender: data.gender }
  },

  async addStudent(classId: string, s): Promise<Student> {
    const { data, error } = await db().from('students').insert({ class_id: classId, ...s }).select().single()
    if (error) {
      if (error.code === '23505' && error.message.includes('students_admission_no_unique_idx')) {
        throw new Error('Admission number already exists. Enter a different number.')
      }
      throw new Error(error.message)
    }
    return { id: data.id, class_id: classId, ...s }
  },

  async updateStudent(s: Student): Promise<void> {
    const { error } = await db().from('students')
      .update({ student_no: s.student_no, admission_no: s.admission_no, full_name: s.full_name, gender: s.gender })
      .eq('id', s.id)
    if (error) {
      if (error.code === '23505' && error.message.includes('students_admission_no_unique_idx')) {
        throw new Error('Admission number already exists. Enter a different number.')
      }
      throw new Error(error.message)
    }
  },

  async deleteStudent(id: string): Promise<void> {
    const { error } = await db().from('scores').delete().eq('student_id', id)
    if (error) throw new Error(error.message)
    const { error: e2 } = await db().from('students').delete().eq('id', id)
    if (e2) throw new Error(e2.message)
  },

  async listAttendance(classId: string, date: string): Promise<AttendanceRow[]> {
    const { data, error } = await db()
      .from('attendance')
      .select('id, class_id, student_id, attendance_date, status, reason, students(full_name, student_no)')
      .eq('class_id', classId)
      .eq('attendance_date', date)
      .order('student_no', { foreignTable: 'students', ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({
      id: r.id, class_id: r.class_id, student_id: r.student_id,
      student_name: r.students?.full_name ?? '', student_no: r.students?.student_no ?? '',
      attendance_date: r.attendance_date, status: r.status, reason: r.reason ?? ''
    }))
  },

  async saveAttendance(rows): Promise<void> {
    if (rows.length === 0) return
    const { error } = await db().from('attendance').upsert(rows, { onConflict: 'class_id,student_id,attendance_date' })
    if (error) throw new Error(error.message)

    // Trigger leadership notifications
    try {
      const classId = rows[0]?.class_id
      if (classId) {
        const [profile, classes] = await Promise.all([
          this.getProfile(),
          this.listClasses().catch(() => [])
        ])
        const cls = classes.find((c) => c.id === classId)
        const className = cls?.name || 'Homeroom'
        const teacherName = profile?.full_name || 'Teacher'
        const present = rows.filter((r) => r.status === 'P').length
        const absent = rows.filter((r) => r.status === 'A').length
        const excused = rows.filter((r) => r.status === 'E').length

        const { notifyLeadershipOnAttendance } = await import('./notifications')
        notifyLeadershipOnAttendance(className, teacherName, present, absent, excused).catch(() => {})
      }
    } catch {
      // Non-blocking notification dispatch
    }
  },

  async listAttendanceSummary(date: string): Promise<AttendanceSummary[]> {
    const { data, error } = await db()
      .from('attendance')
      .select('class_id, attendance_date, status, reason, students(full_name, student_no), classes(name)')
      .eq('attendance_date', date)
    if (error) throw new Error(error.message)
    const grouped = new Map<string, AttendanceSummary>()
    for (const r of (data ?? []) as any[]) {
      const summary: AttendanceSummary = grouped.get(r.class_id) ?? {
        class_id: r.class_id, class_name: r.classes?.name ?? '', date,
        present: 0, absent: 0, excused: 0, total: 0, absences: []
      }
      summary.total += 1
      if (r.status === 'P') summary.present += 1
      if (r.status === 'A') {
        summary.absent += 1
        summary.absences.push({ student_name: r.students?.full_name ?? '', student_no: r.students?.student_no ?? '', reason: r.reason ?? '' })
      }
      if (r.status === 'E') summary.excused += 1
      grouped.set(r.class_id, summary)
    }
    return [...grouped.values()].sort((a, b) => a.class_name.localeCompare(b.class_name))
  },

  async listUnitTests(classId: string): Promise<UnitTest[]> {
    const { data, error } = await db()
      .from('unit_tests')
      .select('id, class_id, subject_id, title, test_date, max_mark, subjects(name)')
      .eq('class_id', classId)
      .order('test_date', { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({
      id: r.id, class_id: r.class_id, subject_id: r.subject_id,
      subject_name: r.subjects?.name ?? '—', title: r.title,
      test_date: r.test_date, max_mark: Number(r.max_mark)
    }))
  },

  async createUnitTest(classId: string, input): Promise<string> {
    const d = db()
    const { data, error } = await d.from('unit_tests').insert({ class_id: classId, ...input }).select().single()
    if (error) throw new Error(error.message)
    const testId = data.id as string
    const { data: students, error: serr } = await d.from('students').select('id').eq('class_id', classId)
    if (serr) throw new Error(serr.message)
    if (students && students.length > 0) {
      const { error: ierr } = await d.from('scores').insert(
        students.map((st: any) => ({ unit_test_id: testId, student_id: st.id, score: null }))
      )
      if (ierr) throw new Error(ierr.message)
    }
    return testId
  },

  async deleteUnitTest(id: string): Promise<void> {
    const { error } = await db().from('unit_tests').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },

  async listScoresForTest(testId: string): Promise<ScoreRow[]> {
    const { data, error } = await db()
      .from('scores')
      .select('id, unit_test_id, student_id, score, students(full_name, student_no)')
      .eq('unit_test_id', testId)
      .order('student_no', { foreignTable: 'students', ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({
      id: r.id, unit_test_id: r.unit_test_id, student_id: r.student_id,
      student_name: r.students?.full_name ?? '—', student_no: r.students?.student_no ?? '',
      score: r.score === null || r.score === undefined ? null : Number(r.score)
    }))
  },

  async saveScore(unit_test_id: string, student_id: string, score: number | null): Promise<void> {
    const { error } = await db()
      .from('scores')
      .upsert({ unit_test_id, student_id, score }, { onConflict: 'unit_test_id,student_id' })
    if (error) throw new Error(error.message)
  },

  async getStudentReport(studentId: string): Promise<StudentReportRow[]> {
    const { data, error } = await db()
      .from('scores')
      .select('score, unit_tests!inner(id, title, test_date, max_mark, subjects!inner(name))')
      .eq('student_id', studentId)
      .not('score', 'is', null)
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({
      subject: r.unit_tests.subjects.name,
      title: r.unit_tests.title,
      test_date: r.unit_tests.test_date,
      score: Number(r.score),
      max_mark: Number(r.unit_tests.max_mark)
    }))
  },

  async getPopulationSummary(): Promise<SchoolPopulationSummary> {
    const [classes, { data: studentsData, error }] = await Promise.all([
      this.listClasses(),
      db().from('students').select('id, class_id, full_name, student_no, admission_no, gender')
    ])
    if (error) throw new Error(error.message)

    const students = studentsData ?? []
    const total_students = students.length
    const total_classes = classes.length

    const isBoy = (g: string) => g?.trim().toUpperCase() === 'M' || g?.trim().toLowerCase().startsWith('m')
    const isGirl = (g: string) => g?.trim().toUpperCase() === 'F' || g?.trim().toLowerCase().startsWith('f')

    const total_boys = students.filter((s: any) => isBoy(s.gender)).length
    const total_girls = students.filter((s: any) => isGirl(s.gender)).length
    const boys_percentage = total_students > 0 ? Number(((total_boys / total_students) * 100).toFixed(1)) : 0
    const girls_percentage = total_students > 0 ? Number(((total_girls / total_students) * 100).toFixed(1)) : 0

    const classSummaries: ClassPopulationSummary[] = classes.map((c) => {
      const classStudents = students.filter((s: any) => s.class_id === c.id)
      const count = classStudents.length
      const boys = classStudents.filter((s: any) => isBoy(s.gender)).length
      const girls = classStudents.filter((s: any) => isGirl(s.gender)).length
      const other = count - (boys + girls)

      return {
        class_id: c.id,
        class_name: c.name,
        homeroom_teacher_name: c.homeroom_teacher_name || 'Unassigned',
        student_count: count,
        percentage_of_total: total_students > 0 ? Number(((count / total_students) * 100).toFixed(1)) : 0,
        boys_count: boys,
        girls_count: girls,
        other_gender_count: other,
        boys_percentage: count > 0 ? Number(((boys / count) * 100).toFixed(1)) : 0,
        girls_percentage: count > 0 ? Number(((girls / count) * 100).toFixed(1)) : 0
      }
    })

    return {
      total_students,
      total_classes,
      total_boys,
      total_girls,
      boys_percentage,
      girls_percentage,
      classes: classSummaries
    }
  },

  async getAttendancePeriodSummary(period: 'daily' | 'weekly' | 'monthly', date: string): Promise<AttendanceAggregatedSummary> {
    let startDate = date
    let endDate = date
    let periodLabel = date

    if (period === 'daily') {
      startDate = date
      endDate = date
      const d = parseLocalDate(date)
      periodLabel = isNaN(d.getTime()) ? date : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    } else if (period === 'weekly') {
      const d = parseLocalDate(date)
      const day = d.getDay() // 0 = Sun, 1 = Mon ...
      const diffToMon = day === 0 ? -6 : 1 - day
      const mon = new Date(d)
      mon.setDate(d.getDate() + diffToMon)
      const sun = new Date(mon)
      sun.setDate(mon.getDate() + 6)
      startDate = toLocalIsoDate(mon)
      endDate = toLocalIsoDate(sun)
      periodLabel = `${mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${sun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    } else if (period === 'monthly') {
      const parts = date.split('-')
      const year = Number(parts[0]) || new Date().getFullYear()
      const month = Number(parts[1]) || (new Date().getMonth() + 1)
      const firstDay = new Date(year, month - 1, 1)
      const lastDay = new Date(year, month, 0)
      startDate = `${year}-${String(month).padStart(2, '0')}-01`
      endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
      periodLabel = firstDay.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    }

    const [classes, { data, error }] = await Promise.all([
      this.listClasses(),
      db()
        .from('attendance')
        .select('id, class_id, attendance_date, status, reason, students(full_name, student_no), classes(name)')
        .gte('attendance_date', startDate)
        .lte('attendance_date', endDate)
    ])
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as any[]
    const totalRecords = rows.length
    const present = rows.filter((r) => r.status === 'P').length
    const absent = rows.filter((r) => r.status === 'A').length
    const excused = rows.filter((r) => r.status === 'E').length

    const presentPct = totalRecords > 0 ? Number(((present / totalRecords) * 100).toFixed(1)) : 0
    const absentPct = totalRecords > 0 ? Number(((absent / totalRecords) * 100).toFixed(1)) : 0
    const excusedPct = totalRecords > 0 ? Number(((excused / totalRecords) * 100).toFixed(1)) : 0

    const absences = rows
      .filter((r) => r.status === 'A')
      .map((r) => ({
        date: r.attendance_date,
        class_id: r.class_id,
        class_name: r.classes?.name ?? '',
        student_name: r.students?.full_name ?? '—',
        student_no: r.students?.student_no ?? '',
        reason: r.reason ?? ''
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.class_name.localeCompare(b.class_name) || a.student_name.localeCompare(b.student_name))

    const classBreakdown = classes.map((c) => {
      const cRows = rows.filter((r) => r.class_id === c.id)
      const cTotal = cRows.length
      const cPres = cRows.filter((r) => r.status === 'P').length
      const cAbs = cRows.filter((r) => r.status === 'A').length
      const cExc = cRows.filter((r) => r.status === 'E').length
      const days = new Set(cRows.map((r) => r.attendance_date)).size

      return {
        class_id: c.id,
        class_name: c.name,
        homeroom_teacher_name: c.homeroom_teacher_name || 'Unassigned',
        present: cPres,
        presentPct: cTotal > 0 ? Number(((cPres / cTotal) * 100).toFixed(1)) : 0,
        absent: cAbs,
        absentPct: cTotal > 0 ? Number(((cAbs / cTotal) * 100).toFixed(1)) : 0,
        excused: cExc,
        excusedPct: cTotal > 0 ? Number(((cExc / cTotal) * 100).toFixed(1)) : 0,
        total: cTotal,
        daysMarked: days
      }
    })

    return {
      periodType: period,
      periodLabel,
      startDate,
      endDate,
      totalRecords,
      present,
      presentPct,
      absent,
      absentPct,
      excused,
      excusedPct,
      classBreakdown,
      absences
    }
  },

  async getDetailedAttendanceReport(period: 'daily' | 'weekly' | 'monthly', date: string): Promise<DetailedAttendanceExport> {
    const summary = await this.getAttendancePeriodSummary(period, date)
    const school = await this.getSchool().catch(() => null)
    const schoolName = school?.name || 'Leera International School'

    // Determine the list of dates in the period (focusing on weekdays Mon-Fri for school attendance)
    const dates: string[] = []
    const dateLabels: string[] = []
    const dayNames: string[] = []

    const start = parseLocalDate(summary.startDate)
    const end = parseLocalDate(summary.endDate)

    const cur = new Date(start)
    while (cur <= end) {
      const day = cur.getDay() // 0 = Sun, 6 = Sat
      if (period === 'daily' || (day >= 1 && day <= 5)) {
        const iso = toLocalIsoDate(cur)
        dates.push(iso)

        // Format label: e.g. "Mon 07-Sep"
        const weekdayShort = cur.toLocaleDateString('en-GB', { weekday: 'short' })
        const dayNum = String(cur.getDate()).padStart(2, '0')
        const monthShort = cur.toLocaleDateString('en-GB', { month: 'short' })
        dateLabels.push(`${weekdayShort} ${dayNum}-${monthShort}`)

        const weekdayFull = cur.toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase()
        dayNames.push(weekdayFull)
      }
      cur.setDate(cur.getDate() + 1)
    }

    const [classes, { data: allStudents, error: stErr }, { data: attData, error: attErr }] = await Promise.all([
      this.listClasses(),
      db().from('students').select('*').order('student_no', { ascending: true }),
      db()
        .from('attendance')
        .select('class_id, student_id, attendance_date, status, reason')
        .gte('attendance_date', summary.startDate)
        .lte('attendance_date', summary.endDate)
    ])

    if (stErr) throw new Error(stErr.message)
    if (attErr) throw new Error(attErr.message)

    const attendanceRecords: Record<string, AttendanceStatus> = {}
    for (const r of (attData ?? []) as any[]) {
      if (r.student_id && r.attendance_date && r.status) {
        attendanceRecords[`${r.student_id}_${r.attendance_date}`] = r.status as AttendanceStatus
      }
    }

    const studentsByClass = new Map<string, Student[]>()
    for (const s of (allStudents ?? []) as any[]) {
      const arr = studentsByClass.get(s.class_id) ?? []
      arr.push({
        id: s.id,
        class_id: s.class_id,
        student_no: s.student_no ?? '',
        admission_no: s.admission_no ?? '',
        full_name: s.full_name ?? '',
        gender: s.gender ?? ''
      })
      studentsByClass.set(s.class_id, arr)
    }

    const classesData: ClassAttendanceExportData[] = classes.map((cls) => {
      const studs = (studentsByClass.get(cls.id) ?? []).sort((a, b) =>
        (a.student_no || '').localeCompare(b.student_no || '', undefined, { numeric: true }) ||
        a.full_name.localeCompare(b.full_name)
      )
      return {
        classInfo: cls,
        students: studs,
        dates,
        dateLabels,
        dayNames,
        attendanceRecords
      }
    })

    return {
      periodType: period,
      startDate: summary.startDate,
      endDate: summary.endDate,
      periodLabel: summary.periodLabel,
      dates,
      dateLabels,
      dayNames,
      schoolName,
      classesData,
      summary
    }
  },

  async getUnitTestOverview(): Promise<EndOfUnitTestOverview> {
    const [
      classes,
      subjects,
      { data: assignmentsData, error: aErr },
      { data: testsData, error: tErr },
      { data: scoresData, error: sErr },
      { data: studentsData, error: stErr }
    ] = await Promise.all([
      this.listClasses(),
      this.listSubjects(),
      db().from('class_subject_teachers').select('class_id, subject_id, teacher_id, profiles!class_subject_teachers_teacher_id_fkey(full_name)'),
      db().from('unit_tests').select('id, class_id, subject_id, title, test_date, max_mark, subjects(name), classes(name)').order('test_date', { ascending: false }),
      db().from('scores').select('unit_test_id, student_id, score'),
      db().from('students').select('id, class_id')
    ])

    if (aErr) throw new Error(aErr.message)
    if (tErr) throw new Error(tErr.message)
    if (sErr) throw new Error(sErr.message)
    if (stErr) throw new Error(stErr.message)

    const classMap = new Map<string, string>()
    const classHomeroomMap = new Map<string, string>()
    for (const c of classes) {
      classMap.set(c.id, c.name)
      if (c.homeroom_teacher_name) classHomeroomMap.set(c.id, c.homeroom_teacher_name)
    }

    const assignmentMap = new Map<string, string>()
    for (const a of (assignmentsData ?? []) as any[]) {
      const key = `${a.class_id}_${a.subject_id}`
      const name = a.profiles?.full_name
      if (name) assignmentMap.set(key, name)
    }

    const studentsByClass = new Map<string, number>()
    for (const st of (studentsData ?? []) as any[]) {
      studentsByClass.set(st.class_id, (studentsByClass.get(st.class_id) ?? 0) + 1)
    }

    const scoresByTest = new Map<string, number[]>()
    for (const sc of (scoresData ?? []) as any[]) {
      if (sc.score !== null && sc.score !== undefined) {
        const arr = scoresByTest.get(sc.unit_test_id) ?? []
        arr.push(Number(sc.score))
        scoresByTest.set(sc.unit_test_id, arr)
      }
    }

    const all_tests: UnitTestSummaryItem[] = (testsData ?? []).map((t: any) => {
      const maxMark = Number(t.max_mark) || 100
      const enteredMarks = scoresByTest.get(t.id) ?? []
      const marksCount = enteredMarks.length
      const totalStudents = studentsByClass.get(t.class_id) ?? 0
      const hasMarks = marksCount > 0
      const avgScore = hasMarks ? enteredMarks.reduce((a, b) => a + b, 0) / marksCount : null
      const avgPct = avgScore !== null && maxMark > 0 ? Number(((avgScore / maxMark) * 100).toFixed(1)) : null
      const highest = hasMarks ? Math.max(...enteredMarks) : null
      const lowest = hasMarks ? Math.min(...enteredMarks) : null
      const teacherName = assignmentMap.get(`${t.class_id}_${t.subject_id}`) || classHomeroomMap.get(t.class_id) || 'Unassigned'

      return {
        test_id: t.id,
        class_id: t.class_id,
        class_name: t.classes?.name ?? classMap.get(t.class_id) ?? 'Class',
        subject_id: t.subject_id,
        subject_name: t.subjects?.name ?? 'Subject',
        teacher_name: teacherName,
        title: t.title,
        test_date: t.test_date,
        max_mark: maxMark,
        total_students: totalStudents,
        marks_entered_count: marksCount,
        marks_entered_pct: totalStudents > 0 ? Number(((marksCount / totalStudents) * 100).toFixed(1)) : (hasMarks ? 100 : 0),
        has_marks_entered: hasMarks,
        average_score: avgScore !== null ? Number(avgScore.toFixed(1)) : null,
        average_pct: avgPct,
        highest_score: highest,
        lowest_score: lowest
      }
    })

    const tests_with_marks = all_tests.filter((t) => t.has_marks_entered)

    // Aggregate by subject
    const subjectMap = new Map<string, { tests: UnitTestSummaryItem[]; teachers: Set<string> }>()
    for (const sub of subjects) {
      subjectMap.set(sub.id, { tests: [], teachers: new Set() })
    }
    for (const t of all_tests) {
      const entry = subjectMap.get(t.subject_id) ?? { tests: [], teachers: new Set() }
      entry.tests.push(t)
      if (t.teacher_name && t.teacher_name !== 'Unassigned') entry.teachers.add(t.teacher_name)
      subjectMap.set(t.subject_id, entry)
    }

    const subject_summaries: SubjectTestSummary[] = subjects.map((sub) => {
      const entry = subjectMap.get(sub.id) ?? { tests: [], teachers: new Set() }
      const tests = entry.tests
      const withMarks = tests.filter((t) => t.has_marks_entered)
      const totalMarksEntered = withMarks.reduce((sum, t) => sum + t.marks_entered_count, 0)
      const validAvgPcts = withMarks.filter((t) => t.average_pct !== null).map((t) => t.average_pct!)
      const avgPct = validAvgPcts.length > 0 ? Number((validAvgPcts.reduce((a, b) => a + b, 0) / validAvgPcts.length).toFixed(1)) : null

      return {
        subject_id: sub.id,
        subject_name: sub.name,
        tests_count: tests.length,
        tests_with_marks_count: withMarks.length,
        total_marks_entered: totalMarksEntered,
        average_score_pct: avgPct,
        teachers: Array.from(entry.teachers)
      }
    }).filter((s) => s.tests_count > 0 || s.tests_with_marks_count > 0)

    const testsWithAvgPct = tests_with_marks.filter((t) => t.average_pct !== null)
    const overall_average_pct = testsWithAvgPct.length > 0
      ? Number((testsWithAvgPct.reduce((sum, t) => sum + t.average_pct!, 0) / testsWithAvgPct.length).toFixed(1))
      : null

    return {
      total_tests: all_tests.length,
      total_tests_with_marks: tests_with_marks.length,
      overall_average_pct,
      tests_with_marks,
      all_tests,
      subject_summaries
    }
  },

  async getClassReportRows(classId: string): Promise<Record<string, StudentReportRow[]>> {
    const students = await this.listStudents(classId)
    const ids = students.map((s) => s.id)
    if (ids.length === 0) return {}
    const { data, error } = await db()
      .from('scores')
      .select('student_id, score, unit_tests!inner(id, title, test_date, max_mark, subjects!inner(name))')
      .in('student_id', ids)
      .not('score', 'is', null)
    if (error) throw new Error(error.message)
    const out: Record<string, StudentReportRow[]> = {}
    for (const r of (data ?? []) as any[]) {
      const row: StudentReportRow = {
        subject: r.unit_tests.subjects.name,
        title: r.unit_tests.title,
        test_date: r.unit_tests.test_date,
        score: Number(r.score),
        max_mark: Number(r.unit_tests.max_mark)
      }
      ;(out[r.student_id] ??= []).push(row)
    }
    return out
  }
}

