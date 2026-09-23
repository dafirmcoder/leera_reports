import { getSupabaseConfigError, supabase } from './supabase'
import { formatAdmissionNo, formatRollNo, formatStudentNo } from './report'
import type {
  AdminClassAttendanceSummary, AdminDashboardData, Api, Assignment, AttendanceAggregatedSummary, AttendanceRow, AttendanceStatus, AttendanceSummary,
  ClassAttendanceExportData, ClassInfo, ClassPopulationSummary, DetailedAttendanceExport,
  EndOfUnitTestOverview, Profile, Role, School,
  SchoolPopulationSummary, ScoreRow, Student, StudentReportRow, Subject,
  SubjectTestSummary, TeacherAssignmentOverview, TeacherDashboardData, TeacherTestSummary, UnitTest, UnitTestSummaryItem, UpdateUnitTestInput
} from './types'

function db() {
  const configError = getSupabaseConfigError()
  if (configError) throw configError
  return supabase
}

function readableSupabaseError(error: unknown): Error {
  if (error instanceof Error && error.message !== 'Failed to fetch') return error
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return new Error('Unable to reach Supabase. Check your internet connection and VITE_SUPABASE_URL, then try again.')
  }
  return error instanceof Error ? error : new Error('The Supabase request failed. Please try again.')
}

// In-memory cache for fast teacher dashboard navigation
const teacherDashboardCache = new Map<string, { data: TeacherDashboardData; timestamp: number }>()
const TEACHER_DASHBOARD_CACHE_TTL = 20000 // 20 seconds

export function invalidateTeacherDashboardCache() {
  teacherDashboardCache.clear()
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('Not signed in')
  return data.user.id
}

function toSchool(r: any): School {
  const semester = r.semester ?? r.term ?? '1'
  return {
    id: r.id,
    name: r.name,
    motto: r.motto,
    academic_year: r.academic_year,
    semester,
    term: semester,
    footer_text: r.footer_text,
    footer_color: r.footer_color,
    show_school_logo: r.show_school_logo,
    show_cambridge_logo: r.show_cambridge_logo
  }
}

function toStudent(r: any): Student {
  const roll = formatRollNo(r.roll_no ?? r.admission_no ?? '')
  return {
    id: r.id,
    class_id: r.class_id,
    student_no: formatStudentNo(r.student_no) || String(r.student_no ?? ''),
    roll_no: roll,
    admission_no: roll,
    full_name: r.full_name ?? '',
    gender: r.gender ?? ''
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
    const sem = s.semester ?? s.term ?? '1'
    const updatePayload: Record<string, any> = {
      name: s.name,
      motto: s.motto,
      academic_year: s.academic_year,
      footer_text: s.footer_text,
      footer_color: s.footer_color,
      show_school_logo: s.show_school_logo,
      show_cambridge_logo: s.show_cambridge_logo
    }
    let { error } = await db().from('schools').update({ ...updatePayload, semester: sem }).eq('id', s.id)
    if (error && (error.code === '42703' || error.message.includes('semester'))) {
      const retry = await db().from('schools').update({ ...updatePayload, term: sem }).eq('id', s.id)
      error = retry.error
    }
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
    const [classesRes, profilesRes] = await Promise.all([
      db()
        .from('classes')
        .select('id, name, homeroom_teacher_id')
        .order('name', { ascending: true }),
      db()
        .from('profiles')
        .select('id, full_name, class_id, role, additional_roles')
    ])

    if (classesRes.error) throw new Error(classesRes.error.message)

    const profiles = profilesRes.data ?? []
    const profileById = new Map<string, string>()
    const homeroomByClassId = new Map<string, { id: string; name: string }>()

    for (const p of profiles) {
      if (p.id && p.full_name) {
        profileById.set(p.id, p.full_name)
      }
      const isHomeroom =
        p.role === 'homeroom_teacher' ||
        (Array.isArray(p.additional_roles) && p.additional_roles.includes('homeroom_teacher'))
      if (p.class_id && isHomeroom) {
        homeroomByClassId.set(p.class_id, { id: p.id, name: p.full_name || '' })
      }
    }

    return (classesRes.data ?? []).map((r: any) => {
      const explicitName = r.homeroom_teacher_id ? profileById.get(r.homeroom_teacher_id) : undefined
      const fallback = homeroomByClassId.get(r.id)

      const teacherId = r.homeroom_teacher_id || fallback?.id || null
      const teacherName = explicitName || fallback?.name || ''

      return {
        id: r.id,
        name: r.name,
        homeroom_teacher_id: teacherId,
        homeroom_teacher_name: teacherName
      }
    })
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

    if (role === 'homeroom_teacher' && classId) {
      await db().from('classes').update({ homeroom_teacher_id: userId }).eq('id', classId)
    } else if (role !== 'homeroom_teacher') {
      await db().from('classes').update({ homeroom_teacher_id: null }).eq('homeroom_teacher_id', userId)
    }
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

  async nextAdmissionNo(classId?: string): Promise<string> {
    return this.nextRollNo(classId)
  },

  async nextRollNo(classId?: string): Promise<string> {
    try {
      if (classId) {
        const { data, error } = await db().rpc('next_roll_no', { p_class_id: classId })
        if (!error && data) return data
      }
      const { data, error } = await db().rpc('next_admission_no', classId ? { p_class_id: classId } : {})
      if (!error && data) return data
      if (error) {
        const fallback = await db().rpc('next_admission_no')
        if (!fallback.error && fallback.data) return fallback.data
      }
    } catch {
      // ignore
    }
    return '1'
  },

  async listAssignments(classId?: string): Promise<Assignment[]> {
    let query = db()
      .from('class_subject_teachers')
      .select('id, class_id, subject_id, teacher_id, subjects(name), profiles!class_subject_teachers_teacher_id_fkey(full_name), classes(name)')
    if (classId) {
      query = query.eq('class_id', classId)
    }
    const { data, error } = await query
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
    const list = (data ?? []).map(toStudent)
    return list.sort((a, b) =>
      (a.student_no || '').localeCompare(b.student_no || '', undefined, { numeric: true }) ||
      a.full_name.localeCompare(b.full_name)
    )
  },

  async getStudent(id: string): Promise<Student | null> {
    const { data } = await db().from('students').select('*').eq('id', id).maybeSingle()
    if (!data) return null
    return toStudent(data)
  },

  async addStudent(classId: string, s: Omit<Student, 'id' | 'class_id'>): Promise<Student> {
    const formattedNo = formatStudentNo(s.student_no) || s.student_no
    const rawRoll = (s.roll_no || s.admission_no || '').trim()
    const formattedRoll = formatRollNo(rawRoll) || rawRoll
    let insertPayload: Record<string, any> = {
      class_id: classId,
      student_no: formattedNo,
      roll_no: formattedRoll,
      full_name: s.full_name.trim(),
      gender: s.gender
    }
    let { data, error } = await db().from('students').insert(insertPayload).select().single()
    if (error && (error.code === '42703' || error.message.includes('roll_no'))) {
      insertPayload = {
        class_id: classId,
        student_no: formattedNo,
        admission_no: formattedRoll,
        full_name: s.full_name.trim(),
        gender: s.gender
      }
      const retry = await db().from('students').insert(insertPayload).select().single()
      data = retry.data
      error = retry.error
    }
    if (error) {
      if (error.code === '23505' && (error.message.includes('unique_idx') || error.message.includes('roll_no') || error.message.includes('admission_no'))) {
        throw new Error('Roll number already exists. Enter a different number.')
      }
      throw new Error(error.message)
    }
    return toStudent(data)
  },

  async updateStudent(s: Student): Promise<void> {
    // Exclude student_no so teachers or clients cannot alter the assigned serial number
    const rawRoll = (s.roll_no || s.admission_no || '').trim()
    const formattedRoll = formatRollNo(rawRoll) || rawRoll
    let { error } = await db().from('students')
      .update({ roll_no: formattedRoll, full_name: s.full_name.trim(), gender: s.gender })
      .eq('id', s.id)
    if (error && (error.code === '42703' || error.message.includes('roll_no'))) {
      const retry = await db().from('students')
        .update({ admission_no: formattedRoll, full_name: s.full_name.trim(), gender: s.gender })
        .eq('id', s.id)
      error = retry.error
    }
    if (error) {
      if (error.code === '23505' && (error.message.includes('unique_idx') || error.message.includes('roll_no') || error.message.includes('admission_no'))) {
        throw new Error('Roll number already exists. Enter a different number.')
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
    try {
      await uid()
      const { data, error } = await db()
        .from('attendance')
        .upsert(rows, { onConflict: 'class_id,student_id,attendance_date' })
        .select('id')
      if (error) throw new Error(error.message)
      if (!data || data.length !== rows.length) {
        throw new Error('Attendance was not saved for every student. Please try again.')
      }
      invalidateTeacherDashboardCache()
    } catch (error) {
      throw readableSupabaseError(error)
    }

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
      .select('id, class_id, subject_id, title, test_date, max_mark, created_by, created_at, exam_paper_url, exam_paper_path, exam_paper_name, subjects(name)')
      .eq('class_id', classId)
    if (error) throw new Error(error.message)
    const list = (data ?? []).map((r: any) => ({
      id: r.id, class_id: r.class_id, subject_id: r.subject_id,
      subject_name: r.subjects?.name ?? '—', title: r.title,
      test_date: r.test_date, max_mark: Number(r.max_mark),
      created_by: r.created_by ?? null,
      created_at: r.created_at ?? undefined,
      exam_paper_url: r.exam_paper_url ?? null,
      exam_paper_path: r.exam_paper_path ?? null,
      exam_paper_name: r.exam_paper_name ?? null
    }))
    // Sort subject-wise, then topic-wise
    return list.sort((a, b) => {
      const subjectComp = a.subject_name.localeCompare(b.subject_name, undefined, { numeric: true, sensitivity: 'base' })
      if (subjectComp !== 0) return subjectComp
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    })
  },

  async createUnitTest(
    classId: string,
    input: { subject_id: string; title: string; test_date: string; max_mark: number; examPaperFile?: File | null }
  ): Promise<string> {
    const d = db()
    const { examPaperFile, ...testData } = input
    let exam_paper_url: string | null = null
    let exam_paper_path: string | null = null
    let exam_paper_name: string | null = null

    const { data, error } = await d.from('unit_tests').insert({
      class_id: classId,
      ...testData
    }).select().single()
    if (error) throw new Error(error.message)
    const testId = data.id as string

    if (examPaperFile) {
      try {
        const sanitizedName = examPaperFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        exam_paper_path = `${classId}/${testId}/${Date.now()}_${sanitizedName}`
        exam_paper_name = examPaperFile.name

        const { error: uploadErr } = await d.storage
          .from('exam-papers')
          .upload(exam_paper_path, examPaperFile, {
            cacheControl: '3600',
            upsert: true,
            contentType: 'application/pdf'
          })

        if (uploadErr) {
          console.error('Failed to upload exam paper:', uploadErr)
        } else {
          const { data: pubData } = d.storage.from('exam-papers').getPublicUrl(exam_paper_path)
          exam_paper_url = pubData?.publicUrl || null

          await d.from('unit_tests').update({
            exam_paper_url,
            exam_paper_path,
            exam_paper_name
          }).eq('id', testId)
        }
      } catch (uploadEx) {
        console.error('Error handling exam paper upload:', uploadEx)
      }
    }

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

  async updateUnitTest(id: string, input: UpdateUnitTestInput): Promise<void> {
    const d = db()
    const { data: testData, error: fetchErr } = await d
      .from('unit_tests')
      .select('id, class_id, exam_paper_path')
      .eq('id', id)
      .single()
    if (fetchErr) throw new Error(fetchErr.message)

    const updatePayload: Record<string, any> = {}
    if (input.title !== undefined) updatePayload.title = input.title.trim()
    if (input.test_date !== undefined) updatePayload.test_date = input.test_date
    if (input.max_mark !== undefined) updatePayload.max_mark = Number(input.max_mark)

    if (input.examPaperFile) {
      const sanitizedName = input.examPaperFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const exam_paper_path = `${testData.class_id}/${id}/${Date.now()}_${sanitizedName}`
      const exam_paper_name = input.examPaperFile.name

      const { error: uploadErr } = await d.storage
        .from('exam-papers')
        .upload(exam_paper_path, input.examPaperFile, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'application/pdf'
        })

      if (uploadErr) throw new Error(`Failed to upload exam paper: ${uploadErr.message}`)

      const { data: pubData } = d.storage.from('exam-papers').getPublicUrl(exam_paper_path)
      updatePayload.exam_paper_url = pubData?.publicUrl || null
      updatePayload.exam_paper_path = exam_paper_path
      updatePayload.exam_paper_name = exam_paper_name

      // Remove old exam paper if path changed
      if (testData.exam_paper_path && testData.exam_paper_path !== exam_paper_path) {
        d.storage.from('exam-papers').remove([testData.exam_paper_path]).catch(() => {})
      }
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateErr } = await d.from('unit_tests').update(updatePayload).eq('id', id)
      if (updateErr) throw new Error(updateErr.message)
    }
  },

  async deleteUnitTest(id: string): Promise<void> {
    const d = db()
    const { data: testData } = await d.from('unit_tests').select('exam_paper_path').eq('id', id).maybeSingle()
    if (testData?.exam_paper_path) {
      try {
        await d.storage.from('exam-papers').remove([testData.exam_paper_path])
      } catch (err) {
        console.error('Failed to remove exam paper from storage:', err)
      }
    }
    const { error } = await d.from('unit_tests').delete().eq('id', id)
    if (error) throw new Error(error.message)
    invalidateTeacherDashboardCache()
  },

  async getExamPaperUrl(pathOrUrl: string): Promise<string> {
    if (!pathOrUrl) return ''
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl
    }
    const { data, error } = await db().storage.from('exam-papers').createSignedUrl(pathOrUrl, 3600)
    if (!error && data?.signedUrl) return data.signedUrl
    const { data: pubData } = db().storage.from('exam-papers').getPublicUrl(pathOrUrl)
    return pubData?.publicUrl || ''
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

  async listScoresForTests(testIds: string[]): Promise<ScoreRow[]> {
    if (!testIds || testIds.length === 0) return []
    const chunkSize = 50
    if (testIds.length <= chunkSize) {
      const { data, error } = await db()
        .from('scores')
        .select('id, unit_test_id, student_id, score, students(full_name, student_no)')
        .in('unit_test_id', testIds)
      if (error) throw new Error(error.message)
      return (data ?? []).map((r: any) => ({
        id: r.id, unit_test_id: r.unit_test_id, student_id: r.student_id,
        student_name: r.students?.full_name ?? '—', student_no: r.students?.student_no ?? '',
        score: r.score === null || r.score === undefined ? null : Number(r.score)
      }))
    }
    const chunks: string[][] = []
    for (let i = 0; i < testIds.length; i += chunkSize) {
      chunks.push(testIds.slice(i, i + chunkSize))
    }
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const { data, error } = await db()
          .from('scores')
          .select('id, unit_test_id, student_id, score, students(full_name, student_no)')
          .in('unit_test_id', chunk)
        if (error) throw new Error(error.message)
        return (data ?? []).map((r: any) => ({
          id: r.id, unit_test_id: r.unit_test_id, student_id: r.student_id,
          student_name: r.students?.full_name ?? '—', student_no: r.students?.student_no ?? '',
          score: r.score === null || r.score === undefined ? null : Number(r.score)
        }))
      })
    )
    return results.flat()
  },

  async saveScore(unit_test_id: string, student_id: string, score: number | null): Promise<void> {
    const { error } = await db()
      .from('scores')
      .upsert({ unit_test_id, student_id, score }, { onConflict: 'unit_test_id,student_id' })
    if (error) throw new Error(error.message)
    invalidateTeacherDashboardCache()
  },

  async getStudentReport(studentId: string): Promise<StudentReportRow[]> {
    const { data, error } = await db()
      .from('scores')
      .select('score, unit_tests!inner(id, title, test_date, created_at, max_mark, subjects!inner(name))')
      .eq('student_id', studentId)
      .not('score', 'is', null)
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({
      test_id: r.unit_tests.id,
      created_at: r.unit_tests.created_at,
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
      db().from('students').select('id, class_id, full_name, student_no, gender')
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
      const d = String(r.attendance_date || '').slice(0, 10)
      if (r.student_id && d && r.status) {
        attendanceRecords[`${r.student_id}_${d}`] = r.status as AttendanceStatus
      }
    }

    const studentsByClass = new Map<string, Student[]>()
    for (const s of (allStudents ?? []) as any[]) {
      const arr = studentsByClass.get(s.class_id) ?? []
      arr.push(toStudent(s))
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
      profiles,
      { data: assignmentsData, error: aErr },
      { data: testsData, error: tErr },
      { data: scoresData, error: sErr },
      { data: studentsData, error: stErr }
    ] = await Promise.all([
      this.listClasses(),
      this.listSubjects(),
      this.listProfiles().catch(() => [] as Profile[]),
      db().from('class_subject_teachers').select('id, class_id, subject_id, teacher_id, profiles!class_subject_teachers_teacher_id_fkey(id, full_name)'),
      db().from('unit_tests').select('id, class_id, subject_id, created_by, title, test_date, max_mark, exam_paper_url, exam_paper_path, exam_paper_name, subjects(name), classes(name)'),
      db().from('scores').select('unit_test_id, student_id, score'),
      db().from('students').select('id, class_id')
    ])

    if (aErr) throw new Error(aErr.message)
    if (tErr) throw new Error(tErr.message)
    if (sErr) throw new Error(sErr.message)
    if (stErr) throw new Error(stErr.message)

    const classMap = new Map<string, string>()
    const classHomeroomMap = new Map<string, string>()
    const classHomeroomIdMap = new Map<string, string>()
    for (const c of classes) {
      classMap.set(c.id, c.name)
      if (c.homeroom_teacher_name) classHomeroomMap.set(c.id, c.homeroom_teacher_name)
      if (c.homeroom_teacher_id) classHomeroomIdMap.set(c.id, c.homeroom_teacher_id)
    }

    const assignmentMap = new Map<string, string>()
    const assignmentIdMap = new Map<string, string>()
    for (const a of (assignmentsData ?? []) as any[]) {
      const key = `${a.class_id}_${a.subject_id}`
      const name = a.profiles?.full_name
      if (name) assignmentMap.set(key, name)
      if (a.teacher_id) assignmentIdMap.set(key, a.teacher_id)
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

    const all_tests: UnitTestSummaryItem[] = (testsData ?? [])
      .filter((t: any) => t.subjects?.name && !t.subjects.name.toLowerCase().includes('unknown'))
      .map((t: any) => {
      const maxMark = Number(t.max_mark) || 100
      const enteredMarks = scoresByTest.get(t.id) ?? []
      const marksCount = enteredMarks.length
      const totalStudents = studentsByClass.get(t.class_id) ?? 0
      const hasMarks = marksCount > 0
      const avgScore = hasMarks ? enteredMarks.reduce((a, b) => a + b, 0) / marksCount : null
      const avgPct = avgScore !== null && maxMark > 0 ? Number(((avgScore / maxMark) * 100).toFixed(1)) : null
      const highest = hasMarks ? Math.max(...enteredMarks) : null
      const lowest = hasMarks ? Math.min(...enteredMarks) : null
      const creator = profiles.find((pr) => pr.id === t.created_by)
      const assignedTeacherId = assignmentIdMap.get(`${t.class_id}_${t.subject_id}`)
      const assignedTeacherName = assignmentMap.get(`${t.class_id}_${t.subject_id}`)
      const teacherId = assignedTeacherId || t.created_by || classHomeroomIdMap.get(t.class_id)
      const teacherName = assignedTeacherName
        || (creator?.full_name ? creator.full_name : null)
        || classHomeroomMap.get(t.class_id)
        || 'Unassigned'

      return {
        test_id: t.id,
        class_id: t.class_id,
        class_name: t.classes?.name ?? classMap.get(t.class_id) ?? 'Class',
        subject_id: t.subject_id,
        subject_name: t.subjects?.name ?? 'Subject',
        teacher_id: teacherId,
        created_by: t.created_by,
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
        lowest_score: lowest,
        exam_paper_url: t.exam_paper_url ?? null,
        exam_paper_name: t.exam_paper_name ?? null
      }
    })

    // Sort class-wise, subject-wise, topic-wise
    all_tests.sort((a, b) => {
      const classComp = a.class_name.localeCompare(b.class_name, undefined, { numeric: true, sensitivity: 'base' })
      if (classComp !== 0) return classComp
      const subjectComp = a.subject_name.localeCompare(b.subject_name, undefined, { numeric: true, sensitivity: 'base' })
      if (subjectComp !== 0) return subjectComp
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
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
        teachers: Array.from(entry.teachers).sort()
      }
    }).filter((s) => s.tests_count > 0 || s.tests_with_marks_count > 0)
    subject_summaries.sort((a, b) => a.subject_name.localeCompare(b.subject_name, undefined, { numeric: true, sensitivity: 'base' }))

    // Build teacher summary
    const subjectMapById = new Map<string, string>()
    for (const s of subjects) subjectMapById.set(s.id, s.name)

    const teacherProfiles = profiles.filter((p) =>
      p.role === 'homeroom_teacher' ||
      p.role === 'subject_teacher' ||
      p.role === 'curriculum_coordinator' ||
      p.additional_roles?.includes('homeroom_teacher') ||
      p.additional_roles?.includes('subject_teacher') ||
      p.additional_roles?.includes('curriculum_coordinator')
    )

    const teacherProfileIds = new Set(teacherProfiles.map((p) => p.id))
    for (const a of (assignmentsData ?? []) as any[]) {
      if (a.teacher_id && !teacherProfileIds.has(a.teacher_id)) {
        teacherProfiles.push({
          id: a.teacher_id,
          full_name: a.profiles?.full_name || 'Teacher',
          email: '',
          role: 'subject_teacher',
          additional_roles: [],
          school_id: null,
          class_id: null
        })
        teacherProfileIds.add(a.teacher_id)
      }
    }

    const teacher_summaries: TeacherTestSummary[] = teacherProfiles.map((p) => {
      const teacherName = p.full_name || p.email || 'Teacher'

      const classNamesSet = new Set<string>()
      const subjectsSet = new Set<string>()

      for (const a of (assignmentsData ?? []) as any[]) {
        if (a.teacher_id === p.id) {
          const cName = classMap.get(a.class_id)
          if (cName) classNamesSet.add(cName)
          const sName = subjectMapById.get(a.subject_id)
          if (sName) subjectsSet.add(sName)
        }
      }

      for (const c of classes) {
        if (c.homeroom_teacher_id === p.id || p.class_id === c.id) {
          classNamesSet.add(c.name)
        }
      }

      const teacherTests = all_tests.filter((t) => {
        if (t.created_by === p.id) return true
        if (t.teacher_id === p.id) return true
        const key = `${t.class_id}_${t.subject_id}`
        const assignedTeacherId = assignmentIdMap.get(key)
        if (assignedTeacherId) return assignedTeacherId === p.id
        const hrId = classHomeroomIdMap.get(t.class_id)
        if (hrId) return hrId === p.id
        return t.teacher_name === teacherName
      })

      const testsCount = teacherTests.length
      const withMarks = teacherTests.filter((t) => t.has_marks_entered)
      const testsWithMarksCount = withMarks.length
      const testsWithMarksPct = testsCount > 0 ? Number(((testsWithMarksCount / testsCount) * 100).toFixed(1)) : 0
      const totalMarksEntered = withMarks.reduce((sum, t) => sum + t.marks_entered_count, 0)
      const validAvgPcts = withMarks.filter((t) => t.average_pct !== null).map((t) => t.average_pct!)
      const avgPct = validAvgPcts.length > 0 ? Number((validAvgPcts.reduce((a, b) => a + b, 0) / validAvgPcts.length).toFixed(1)) : null

      const sortedByDate = [...withMarks].sort((a, b) => (b.test_date || '').localeCompare(a.test_date || ''))
      const lastSubmissionDate = sortedByDate.length > 0 ? sortedByDate[0].test_date : null

      for (const t of teacherTests) {
        if (t.subject_name) subjectsSet.add(t.subject_name)
        if (t.class_name) classNamesSet.add(t.class_name)
      }

      return {
        teacher_id: p.id,
        teacher_name: teacherName,
        role: p.role,
        class_names: Array.from(classNamesSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
        subjects: Array.from(subjectsSet).sort(),
        tests_count: testsCount,
        tests_with_marks_count: testsWithMarksCount,
        tests_with_marks_pct: testsWithMarksPct,
        total_marks_entered: totalMarksEntered,
        average_score_pct: avgPct,
        last_submission_date: lastSubmissionDate
      }
    })

    teacher_summaries.sort((a, b) => a.teacher_name.localeCompare(b.teacher_name))

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
      subject_summaries,
      teacher_summaries
    }
  },

  async getClassReportRows(classId: string): Promise<Record<string, StudentReportRow[]>> {
    const students = await this.listStudents(classId)
    const ids = students.map((s) => s.id)
    if (ids.length === 0) return {}
    const { data, error } = await db()
      .from('scores')
      .select('student_id, score, unit_tests!inner(id, title, test_date, created_at, max_mark, subjects!inner(name))')
      .in('student_id', ids)
      .not('score', 'is', null)
    if (error) throw new Error(error.message)
    const out: Record<string, StudentReportRow[]> = {}
    for (const r of (data ?? []) as any[]) {
      const row: StudentReportRow = {
        test_id: r.unit_tests.id,
        created_at: r.unit_tests.created_at,
        subject: r.unit_tests.subjects.name,
        title: r.unit_tests.title,
        test_date: r.unit_tests.test_date,
        score: Number(r.score),
        max_mark: Number(r.unit_tests.max_mark)
      }
      ;(out[r.student_id] ??= []).push(row)
    }
    return out
  },

  async getTeacherDashboardData(teacherId: string, homeroomClassId?: string | null): Promise<TeacherDashboardData> {
    const cacheKey = `${teacherId}_${homeroomClassId || ''}`
    const cached = teacherDashboardCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < TEACHER_DASHBOARD_CACHE_TTL) {
      return cached.data
    }

    const today = toLocalIsoDate(new Date())

    // Phase 1: Parallel fetch of initial resources in one concurrent batch
    const [
      classes,
      assignmentsRes,
      createdTestsRes,
      studentsCountRes
    ] = await Promise.all([
      this.listClasses(),
      db()
        .from('class_subject_teachers')
        .select('id, class_id, subject_id, classes(name), subjects(name)')
        .eq('teacher_id', teacherId),
      db()
        .from('unit_tests')
        .select('id, class_id, subject_id, classes(name), subjects(name)')
        .eq('created_by', teacherId),
      db().from('students').select('class_id')
    ])

    if (assignmentsRes.error) throw new Error(assignmentsRes.error.message)

    // Determine homeroom class
    let hrClass = classes.find((c) => c.id === homeroomClassId)
    if (!hrClass && teacherId) {
      hrClass = classes.find((c) => c.homeroom_teacher_id === teacherId)
    }

    // Build assignment pairs
    const assignedPairs = (assignmentsRes.data ?? [])
      .filter((a: any) => a.subjects?.name && !a.subjects.name.toLowerCase().includes('unknown'))
      .map((a: any) => ({
        id: a.id,
        class_id: a.class_id,
        class_name: a.classes?.name || 'Class',
        subject_id: a.subject_id,
        subject_name: a.subjects.name
      }))

    for (const ct of (createdTestsRes.data ?? []) as any[]) {
      const sName = ct.subjects?.name
      if (!sName || sName.toLowerCase().includes('unknown')) continue
      if (!assignedPairs.some((p) => p.class_id === ct.class_id && p.subject_id === ct.subject_id)) {
        assignedPairs.push({
          id: `${ct.class_id}_${ct.subject_id}`,
          class_id: ct.class_id,
          class_name: ct.classes?.name || 'Class',
          subject_id: ct.subject_id,
          subject_name: sName
        })
      }
    }

    // Map student counts per class in memory
    const studentsPerClassMap = new Map<string, number>()
    for (const st of (studentsCountRes.data ?? []) as any[]) {
      studentsPerClassMap.set(st.class_id, (studentsPerClassMap.get(st.class_id) ?? 0) + 1)
    }

    const assignedClassIds = Array.from(new Set(assignedPairs.map((p) => p.class_id)))
    const assignedSubjectIds = Array.from(new Set(assignedPairs.map((p) => p.subject_id)))

    // Phase 2: Parallel fetch of Homeroom data AND All Unit Tests in ONE batch
    const homeroomPromise = hrClass
      ? Promise.all([
          db().from('students').select('id, full_name, gender').eq('class_id', hrClass.id),
          db().from('attendance').select('status').eq('class_id', hrClass.id).eq('attendance_date', today),
          db().from('unit_tests').select('id', { count: 'exact', head: true }).eq('class_id', hrClass.id),
          db().from('scores').select('student_id, unit_tests!inner(class_id)').eq('unit_tests.class_id', hrClass.id).not('score', 'is', null)
        ])
      : Promise.resolve([
          { data: [] as any[], error: null },
          { data: [] as any[], error: null },
          { count: 0, error: null },
          { data: [] as any[], error: null }
        ])

    const testsPromise = (assignedClassIds.length > 0 && assignedSubjectIds.length > 0)
      ? db()
          .from('unit_tests')
          .select('id, class_id, subject_id, title, test_date, max_mark')
          .in('class_id', assignedClassIds)
          .in('subject_id', assignedSubjectIds)
          .order('test_date', { ascending: false })
      : Promise.resolve({ data: [] as any[], error: null })

    const [
      [hrStudentsRes, attRes, tCountRes, scoredStudentsRes],
      allTestsRes
    ] = await Promise.all([
      homeroomPromise,
      testsPromise
    ])

    if (allTestsRes.error) throw new Error(allTestsRes.error.message)

    // Process Homeroom Data
    let homeroomClassInfo: TeacherDashboardData['homeroomClass'] = null
    let todayAttendanceInfo: TeacherDashboardData['todayAttendance'] = null
    let homeroomTestsCount = 0
    let homeroomReportsCount = 0

    if (hrClass) {
      const students = hrStudentsRes.data ?? []
      const isBoy = (g: string) => g?.trim().toUpperCase() === 'M' || g?.trim().toLowerCase().startsWith('m')
      const isGirl = (g: string) => g?.trim().toUpperCase() === 'F' || g?.trim().toLowerCase().startsWith('f')
      const boys = students.filter((s: any) => isBoy(s.gender)).length
      const girls = students.filter((s: any) => isGirl(s.gender)).length

      homeroomClassInfo = {
        id: hrClass.id,
        name: hrClass.name,
        student_count: students.length,
        boys_count: boys,
        girls_count: girls
      }

      const attRows = attRes.data ?? []
      if (attRows.length > 0) {
        const present = attRows.filter((r: any) => r.status === 'P').length
        const absent = attRows.filter((r: any) => r.status === 'A' || r.status === 'E').length
        const total = attRows.length
        const rate = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0
        todayAttendanceInfo = {
          marked: true,
          present_count: present,
          absent_count: absent,
          total_count: total,
          rate_pct: rate
        }
      } else {
        todayAttendanceInfo = {
          marked: false,
          present_count: 0,
          absent_count: 0,
          total_count: students.length,
          rate_pct: 0
        }
      }

      homeroomTestsCount = tCountRes.count ?? 0

      if (scoredStudentsRes.data) {
        const distinctScored = new Set(scoredStudentsRes.data.map((s: any) => s.student_id))
        homeroomReportsCount = distinctScored.size
      }
    }

    // Phase 3: Fetch all scores for matching tests in ONE bulk query
    const retrievedTests = (allTestsRes.data ?? []) as any[]
    const pairKeys = new Set(assignedPairs.map((p) => `${p.class_id}__${p.subject_id}`))
    const matchingTests = retrievedTests.filter((t) => pairKeys.has(`${t.class_id}__${t.subject_id}`))
    const allTestIds = matchingTests.map((t) => t.id)

    const allScoresRes = allTestIds.length > 0
      ? await db().from('scores').select('unit_test_id, score').in('unit_test_id', allTestIds).not('score', 'is', null)
      : { data: [] }

    // Index scores by unit_test_id in memory
    const scoresByTest = new Map<string, number[]>()
    for (const sc of (allScoresRes.data ?? []) as any[]) {
      const arr = scoresByTest.get(sc.unit_test_id) ?? []
      arr.push(Number(sc.score))
      scoresByTest.set(sc.unit_test_id, arr)
    }

    // Index tests by pair key
    const testsByPair = new Map<string, any[]>()
    for (const t of matchingTests) {
      const key = `${t.class_id}__${t.subject_id}`
      const arr = testsByPair.get(key) ?? []
      arr.push(t)
      testsByPair.set(key, arr)
    }

    // Build Assignment Overviews in-memory
    const assignmentsOverview: TeacherAssignmentOverview[] = []
    let totalTestsCreated = 0
    let totalPendingMarks = 0
    const allValidAverages: number[] = []

    for (const pair of assignedPairs) {
      const classStudentCount = studentsPerClassMap.get(pair.class_id) ?? 0
      const pairKey = `${pair.class_id}__${pair.subject_id}`
      const tests = testsByPair.get(pairKey) ?? []

      let testsWithMarksCount = 0
      let pendingCount = 0
      const assignmentAverages: number[] = []

      const testsOverview = tests.map((t: any) => {
        const scores = scoresByTest.get(t.id) ?? []
        const hasScores = scores.length > 0
        const marksCount = scores.length
        let avgPct: number | null = null
        if (hasScores && t.max_mark > 0) {
          const totalScore = scores.reduce((sum, val) => sum + val, 0)
          avgPct = Number(((totalScore / (scores.length * Number(t.max_mark))) * 100).toFixed(1))
          assignmentAverages.push(avgPct)
          allValidAverages.push(avgPct)
        }

        const marksEntered = hasScores
        if (marksEntered) {
          testsWithMarksCount++
        } else {
          pendingCount++
        }

        return {
          id: t.id,
          title: t.title,
          test_date: t.test_date,
          max_mark: Number(t.max_mark),
          marks_entered: marksEntered,
          marks_entered_count: marksCount,
          total_students: classStudentCount,
          average_pct: avgPct
        }
      })

      const assignmentAvgPct = assignmentAverages.length > 0
        ? Number((assignmentAverages.reduce((a, b) => a + b, 0) / assignmentAverages.length).toFixed(1))
        : null

      totalTestsCreated += tests.length
      totalPendingMarks += pendingCount

      assignmentsOverview.push({
        id: pair.id || `${pair.class_id}_${pair.subject_id}`,
        class_id: pair.class_id,
        class_name: pair.class_name,
        subject_id: pair.subject_id,
        subject_name: pair.subject_name,
        tests_count: tests.length,
        tests_with_marks_count: testsWithMarksCount,
        pending_marks_count: pendingCount,
        average_pct: assignmentAvgPct,
        latest_test_title: tests[0]?.title,
        latest_test_date: tests[0]?.test_date,
        latest_test_id: tests[0]?.id,
        tests: testsOverview
      })
    }

    const overallSubjectAveragePct = allValidAverages.length > 0
      ? Number((allValidAverages.reduce((a, b) => a + b, 0) / allValidAverages.length).toFixed(1))
      : null

    const result: TeacherDashboardData = {
      homeroomClass: homeroomClassInfo,
      todayAttendance: todayAttendanceInfo,
      homeroomTestsCount,
      homeroomReportsCount,
      assignments: assignmentsOverview,
      totalTestsCreated,
      totalPendingMarks,
      overallSubjectAveragePct
    }

    teacherDashboardCache.set(cacheKey, { data: result, timestamp: Date.now() })
    return result
  },

  async getAdminDashboardData(): Promise<AdminDashboardData> {
    const today = toLocalIsoDate(new Date())
    const [school, classes, { data: studentsData, error: sErr }, { data: attData, error: aErr }] = await Promise.all([
      this.getSchool(),
      this.listClasses(),
      db().from('students').select('id, class_id'),
      db().from('attendance').select('class_id, status').eq('attendance_date', today)
    ])

    if (sErr) throw new Error(sErr.message)
    if (aErr) throw new Error(aErr.message)

    const allStudents = studentsData ?? []
    const total_students = allStudents.length
    const total_classes = classes.length

    const studentsByClass = new Map<string, number>()
    for (const s of allStudents as any[]) {
      studentsByClass.set(s.class_id, (studentsByClass.get(s.class_id) ?? 0) + 1)
    }

    const attByClass = new Map<string, { present: number; absent: number; total: number }>()
    for (const a of (attData ?? []) as any[]) {
      const cur = attByClass.get(a.class_id) ?? { present: 0, absent: 0, total: 0 }
      cur.total++
      if (a.status === 'P') cur.present++
      else if (a.status === 'A' || a.status === 'E') cur.absent++
      attByClass.set(a.class_id, cur)
    }

    let marked_classes_count = 0
    let totalPresent = 0
    let totalAbsent = 0
    let totalMarkedStudents = 0

    const classes_summary: AdminClassAttendanceSummary[] = classes.map((cls: ClassInfo) => {
      const count = studentsByClass.get(cls.id) ?? 0
      const att = attByClass.get(cls.id)
      const isMarked = Boolean(att && att.total > 0)
      const present = att ? att.present : 0
      const absent = att ? att.absent : 0
      const rate = count > 0 && isMarked ? Number(((present / count) * 100).toFixed(1)) : 0

      if (isMarked) {
        marked_classes_count++
        totalPresent += present
        totalAbsent += absent
        totalMarkedStudents += count
      }

      return {
        class_id: cls.id,
        class_name: cls.name,
        homeroom_teacher_name: cls.homeroom_teacher_name || 'Unassigned',
        student_count: count,
        present_count: present,
        absent_count: absent,
        rate_pct: rate,
        is_marked: isMarked
      }
    })

    const overall_rate_pct = totalMarkedStudents > 0
      ? Number(((totalPresent / totalMarkedStudents) * 100).toFixed(1))
      : 0

    return {
      school_info: {
        name: school?.name || 'School',
        academic_year: school?.academic_year || '2026/2027',
        semester: school?.semester || 'Term 1',
        motto: school?.motto || ''
      },
      total_students,
      total_classes,
      today_attendance: {
        marked_classes_count,
        total_classes_count: total_classes,
        overall_rate_pct,
        present_count: totalPresent,
        absent_count: totalAbsent
      },
      classes_summary
    }
  }
}

