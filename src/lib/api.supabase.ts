import { supabase } from './supabase'
import type {
  Api, Assignment, ClassInfo, Profile, Role, School, ScoreRow,
  Student, StudentReportRow, Subject, UnitTest
} from './types'

function db() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

async function uid(): Promise<string> {
  const { data } = await supabase!.auth.getUser()
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
    school_id: r.school_id,
    class_id: r.class_id
  }
}

export const supabaseApi: Api = {
  mode: 'supabase',

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
    const { data, error } = await db().from('subjects').insert({ name, sort_order: 0 }).select().single()
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
      .select('id, name, homeroom_teacher_id, homeroom:profiles!classes_homeroom_teacher_id_fkey(full_name)')
      .order('name', { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      homeroom_teacher_id: r.homeroom_teacher_id,
      homeroom_teacher_name: r.homeroom?.full_name ?? ''
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

  async setRole(userId: string, role: Role, classId: string | null): Promise<void> {
    const schoolId = (await this.getProfile())?.school_id
    const { error } = await db()
      .from('profiles')
      .update({ role, class_id: classId ?? null, school_id: schoolId })
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
    if (error) throw new Error(error.message)
    return { id: data.id, class_id: classId, ...s }
  },

  async updateStudent(s: Student): Promise<void> {
    const { error } = await db().from('students')
      .update({ student_no: s.student_no, admission_no: s.admission_no, full_name: s.full_name, gender: s.gender })
      .eq('id', s.id)
    if (error) throw new Error(error.message)
  },

  async deleteStudent(id: string): Promise<void> {
    const { error } = await db().from('scores').delete().eq('student_id', id)
    if (error) throw new Error(error.message)
    const { error: e2 } = await db().from('students').delete().eq('id', id)
    if (e2) throw new Error(e2.message)
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
