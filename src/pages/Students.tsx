import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../lib/api'
import { buildRollNo, formatRollNo, formatStudentNo, nextStudentNo } from '../lib/report'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can, hasRole, isHomeroomTeacher } from '../lib/permissions'
import ClassPicker from '../components/ClassPicker'
import type { Student } from '../lib/types'

const empty = { student_no: '', roll_no: '', full_name: '', gender: '' }

export default function Students() {
  const { selectedClassId, setSelectedClassId, classes, school } = useSchool()
  const { profile } = useAuth()
  const [students, setStudents] = useState<Student[]>([])
  const [nextRollNo, setNextRollNo] = useState('')
  const [form, setForm] = useState(empty)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const isHos = hasRole(profile?.role, 'head_of_school', profile?.additional_roles)
  const isCoordinator = hasRole(profile?.role, 'curriculum_coordinator', profile?.additional_roles)
  const isLeadership = isHos || isCoordinator
  const isHomeroom = isHomeroomTeacher(profile, classes)

  // Find all homeroom classes for this teacher
  const myHomeroomClasses = classes.filter(
    (c) => c.id === profile?.class_id || (profile?.id && c.homeroom_teacher_id === profile?.id)
  )

  // Homeroom teachers can ONLY see their designated homeroom class.
  // Leadership (HOS & Coordinators who are not homeroom teachers) can select any class.
  let activeClassId: string | null = null
  if (isHomeroom) {
    if (myHomeroomClasses.length === 1) {
      activeClassId = myHomeroomClasses[0].id
    } else if (myHomeroomClasses.length > 1) {
      activeClassId = myHomeroomClasses.some((c) => c.id === selectedClassId)
        ? selectedClassId
        : myHomeroomClasses[0].id
    } else {
      activeClassId = profile?.class_id ?? null
    }
  } else if (isLeadership) {
    activeClassId = selectedClassId
  }

  const activeClass = classes.find((c) => c.id === activeClassId)
  const className = activeClass?.name ?? ''

  // Sync selectedClassId with homeroom class for homeroom teachers so app context stays aligned
  useEffect(() => {
    if (isHomeroom && activeClassId && selectedClassId !== activeClassId) {
      setSelectedClassId(activeClassId)
    }
  }, [isHomeroom, activeClassId, selectedClassId, setSelectedClassId])

  // Homeroom teachers manage their own roster; HOS can also manage
  const canAdd = (isHomeroom && !!activeClassId && myHomeroomClasses.some((c) => c.id === activeClassId))
    || can(profile?.role, 'addStudents', profile?.additional_roles)
    || isHos

  const reload = () => {
    if (!activeClassId) return
    api.listStudents(activeClassId).then(setStudents).catch((e) => setError(e.message))
  }

  useEffect(reload, [activeClassId])

  useEffect(() => {
    if (!canAdd || !activeClassId) {
      setNextRollNo('')
      return
    }
    api.nextRollNo(activeClassId).then(setNextRollNo).catch(() => {
      const seq = students.length + 1
      setNextRollNo(buildRollNo(className, seq, school?.academic_year))
    })
  }, [canAdd, editingId, activeClassId, className, school?.academic_year, students.length])

  const suggestedNo = useMemo(() => nextStudentNo(students.map((s) => s.student_no)), [students])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeClassId || !form.full_name.trim()) return
    setError('')
    setBusy(true)
    try {
      const studentNo = editingId
        ? (students.find((s) => s.id === editingId)?.student_no || form.student_no)
        : suggestedNo
      const rawRoll = form.roll_no.trim() || (editingId ? '' : nextRollNo)
      const rollNo = formatRollNo(rawRoll)
      if (!rollNo) {
        setError('A unique roll number is required.')
        return
      }
      if (!/^LIS-[0-9]{3}\/[0-9]+[A-Z]?\/[0-9]{2}$/i.test(rollNo)) {
        setError('Invalid Roll No format. Expected format like LIS-001/9P/26.')
        return
      }
      const payload = {
        student_no: formatStudentNo(studentNo),
        roll_no: rollNo,
        admission_no: rollNo,
        full_name: form.full_name.trim(),
        gender: form.gender
      }
      if (editingId) {
        await api.updateStudent({ id: editingId, class_id: activeClassId, ...payload })
      } else {
        await api.addStudent(activeClassId, payload)
      }
      setForm(empty)
      setEditingId(null)
      reload()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (s: Student) => {
    setEditingId(s.id)
    setForm({
      student_no: formatStudentNo(s.student_no),
      roll_no: formatRollNo(s.roll_no || s.admission_no),
      full_name: s.full_name,
      gender: s.gender
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (s: Student) => {
    if (!confirm(`Delete ${s.full_name}? Their marks will also be removed.`)) return
    setError('')
    try {
      await api.deleteStudent(s.id)
      if (editingId === s.id) { setEditingId(null); setForm(empty) }
      reload()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Pure subject teachers (who are not homeroom teachers and not leadership) must never access the students page
  if (!isLeadership && !isHomeroom) {
    return <Navigate to="/dashboard" replace />
  }

  // Waiting for classes to load
  if (classes.length === 0) {
    return (
      <div className="page">
        <p className="muted center" style={{ padding: '40px' }}>Loading students…</p>
      </div>
    )
  }

  // Homeroom teacher without a class assigned yet
  if (isHomeroom && myHomeroomClasses.length === 0) {
    return (
      <div className="page">
        <div className="card alert-box" style={{ background: '#fffbeb', borderColor: '#fde68a', padding: '28px', textAlign: 'center' }}>
          <h3 style={{ color: '#92400e', margin: '0 0 8px' }}>No Homeroom Class Assigned</h3>
          <p style={{ color: '#b45309', margin: 0 }}>
            You are registered as a homeroom teacher, but you haven't been assigned to a specific class yet.
            Please contact the Head of School to assign your homeroom class.
          </p>
        </div>
      </div>
    )
  }

  // Fallback if no active class resolved
  if (!activeClassId) {
    return (
      <div className="page">
        <div className="card alert-box" style={{ background: '#fffbeb', borderColor: '#fde68a', padding: '28px', textAlign: 'center' }}>
          <h3 style={{ color: '#92400e', margin: '0 0 8px' }}>No Class Selected</h3>
          <p style={{ color: '#b45309', margin: 0 }}>
            Please select a class to view its student roster.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2>Students{className ? ` — ${className}` : ''}</h2>
            {isHomeroom && (
              <span className="chip" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 600, fontSize: '12px' }}>
                Your Homeroom Class
              </span>
            )}
          </div>
          <p className="muted">
            {canAdd
              ? 'Your homeroom class roster. Add and manage students here.'
              : isLeadership
              ? 'Class roster management (administrative view).'
              : 'Read-only view of the class roster.'}
          </p>
        </div>
        {isHomeroom ? (
          myHomeroomClasses.length > 1 && (
            <label className="field inline classpicker">
              <span>Class</span>
              <select
                value={activeClassId ?? ''}
                onChange={(e) => setSelectedClassId(e.target.value)}
              >
                {myHomeroomClasses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )
        ) : (
          isLeadership && <ClassPicker />
        )}
      </div>

      {canAdd && (
        <form onSubmit={submit} className="card stack">
          <h3>{editingId ? 'Edit student' : 'Add student'}</h3>
          <div className="grid4">
            <label className="field"><span>Class S/N</span>
              <input
                value={editingId ? form.student_no : suggestedNo}
                readOnly
                disabled
                tabIndex={-1}
                style={{ background: '#f8fafc', cursor: 'not-allowed', color: '#475569', fontWeight: 600 }}
              />
              <small className="muted">
                {editingId ? 'Serial numbers are permanent and cannot be modified.' : 'Auto-assigned sequential serial number 1,2,3 per class.'}
              </small>
            </label>
            <label className="field"><span>Roll No. (LIS-001/9P/26)</span>
              <input
                value={form.roll_no}
                placeholder={nextRollNo}
                onChange={(e) => setForm({ ...form, roll_no: e.target.value })}
              />
              {nextRollNo && <small className="muted">Next roll number: {nextRollNo}</small>}
            </label>
            <label className="field"><span>Full name *</span>
              <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </label>
            <label className="field"><span>Gender</span>
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">—</option><option value="M">M</option><option value="F">F</option>
              </select>
            </label>
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>{editingId ? 'Save changes' : 'Add student'}</button>
            {editingId && <button type="button" className="btn btn-ghost" onClick={() => { setEditingId(null); setForm(empty) }}>Cancel</button>}
          </div>
          {error && <div className="notice notice-error">{error}</div>}
        </form>
      )}

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Class S/N</th><th>Roll No.</th><th>Full name</th><th>Gender</th>{canAdd && <th className="right">Actions</th>}</tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr><td colSpan={5} className="muted center">No students in this class yet.</td></tr>
            )}
            {students.map((s) => (
              <tr key={s.id}>
                <td className="mono">{formatStudentNo(s.student_no)}</td>
                <td className="mono">{formatRollNo(s.roll_no || s.admission_no)}</td>
                <td>{s.full_name}</td>
                <td>{s.gender || '—'}</td>
                {canAdd && (
                  <td className="right">
                    <button className="btn btn-small" onClick={() => startEdit(s)}>Edit</button>{' '}
                    <button className="btn btn-small btn-danger" onClick={() => remove(s)}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
