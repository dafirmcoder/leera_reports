import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../lib/api'
import { buildRollNo, formatRollNo, formatStudentNo, nextStudentNo } from '../lib/report'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can, hasRole, isHomeroomTeacher } from '../lib/permissions'
import ClassPicker from '../components/ClassPicker'
import type { Student } from '../lib/types'

const empty = { class_id: '', student_no: '', roll_no: '', full_name: '', gender: '' }

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
  const canReallocate = isHos || isCoordinator || can(profile?.role, 'reallocateStudents', profile?.additional_roles)

  const [reallocatingStudent, setReallocatingStudent] = useState<Student | null>(null)
  const [targetClassId, setTargetClassId] = useState<string>('')
  const [reallocateBusy, setReallocateBusy] = useState(false)
  const [reallocateSuccess, setReallocateSuccess] = useState('')

  // Find all homeroom classes for this teacher
  const myHomeroomClasses = classes.filter(
    (c) => c.id === profile?.class_id || (profile?.id && c.homeroom_teacher_id === profile?.id)
  )

  const isPureHomeroom = isHomeroom && !isLeadership

  // Pure homeroom teachers can ONLY see their designated homeroom class.
  // Leadership (HOS & Coordinators, including those who are also homeroom teachers) can select any class.
  let activeClassId: string | null = null
  if (isLeadership) {
    activeClassId = selectedClassId || (myHomeroomClasses[0]?.id || classes[0]?.id || null)
  } else if (isHomeroom) {
    if (myHomeroomClasses.length === 1) {
      activeClassId = myHomeroomClasses[0].id
    } else if (myHomeroomClasses.length > 1) {
      activeClassId = myHomeroomClasses.some((c) => c.id === selectedClassId)
        ? selectedClassId
        : myHomeroomClasses[0].id
    } else {
      activeClassId = profile?.class_id ?? null
    }
  }

  const activeClass = classes.find((c) => c.id === activeClassId)
  const className = activeClass?.name ?? ''

  // Sync selectedClassId with homeroom class strictly for pure homeroom teachers
  useEffect(() => {
    if (isPureHomeroom && activeClassId && selectedClassId !== activeClassId) {
      setSelectedClassId(activeClassId)
    }
  }, [isPureHomeroom, activeClassId, selectedClassId, setSelectedClassId])

  // Leadership can manage any roster; homeroom teachers manage their own roster
  const canAdd = isLeadership
    || (isHomeroom && !!activeClassId && myHomeroomClasses.some((c) => c.id === activeClassId))
    || can(profile?.role, 'addStudents', profile?.additional_roles)

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
        const destClassId = (canReallocate && form.class_id) ? form.class_id : activeClassId
        if (destClassId && destClassId !== activeClassId) {
          await api.updateStudent({ id: editingId, class_id: destClassId, ...payload })
          const targetName = classes.find((c) => c.id === destClassId)?.name || 'new class'
          setReallocateSuccess(`${form.full_name} (${rollNo}) has been successfully reallocated to ${targetName}. Their roll number has been preserved.`)
        } else {
          await api.updateStudent({ id: editingId, class_id: activeClassId, ...payload })
        }
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
      class_id: s.class_id,
      student_no: formatStudentNo(s.student_no),
      roll_no: formatRollNo(s.roll_no || s.admission_no),
      full_name: s.full_name,
      gender: s.gender
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openReallocate = (s: Student) => {
    setError('')
    setReallocateSuccess('')
    setReallocatingStudent(s)
    const otherClass = classes.find((c) => c.id !== s.class_id)
    setTargetClassId(otherClass?.id || '')
  }

  const handleReallocate = async (e: FormEvent) => {
    e.preventDefault()
    if (!reallocatingStudent || !targetClassId || targetClassId === reallocatingStudent.class_id) return
    setReallocateBusy(true)
    setError('')
    try {
      const targetClass = classes.find((c) => c.id === targetClassId)
      await api.reallocateStudent(reallocatingStudent.id, targetClassId)
      const targetName = targetClass?.name || 'new class'
      setReallocateSuccess(`${reallocatingStudent.full_name} (${reallocatingStudent.roll_no || reallocatingStudent.admission_no}) has been successfully reallocated to ${targetName}. Their roll number has been preserved.`)
      setReallocatingStudent(null)
      reload()
    } catch (err: any) {
      setError(err?.message || 'Failed to reallocate student.')
    } finally {
      setReallocateBusy(false)
    }
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
  if (isPureHomeroom && myHomeroomClasses.length === 0) {
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
            {isHomeroom && myHomeroomClasses.some((c) => c.id === activeClassId) && (
              <span className="chip" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 600, fontSize: '12px' }}>
                Your Homeroom Class
              </span>
            )}
            {isCoordinator && (
              <span className="chip" style={{ background: '#fdf2f8', color: '#9d174d', fontWeight: 600, fontSize: '12px' }}>
                Coordinator View
              </span>
            )}
          </div>
          <p className="muted">
            {isLeadership
              ? 'Class roster management and student reallocation.'
              : 'Your homeroom class roster. Add and manage students here.'}
          </p>
        </div>
        {isLeadership ? (
          <ClassPicker />
        ) : isHomeroom && myHomeroomClasses.length > 1 ? (
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
        ) : null}
      </div>

      {reallocateSuccess && (
        <div
          className="card"
          style={{
            background: '#f0fdf4',
            borderColor: '#86efac',
            padding: '12px 16px',
            color: '#166534',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>✅</span>
            <span>{reallocateSuccess}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setReallocateSuccess('')}
            style={{ color: '#166534' }}
          >
            ✕
          </button>
        </div>
      )}

      {canAdd && (
        <form onSubmit={submit} className="card stack">
          <h3>{editingId ? 'Edit student' : 'Add student'}</h3>
          <div className="grid4">
            {editingId && canReallocate && (
              <label className="field">
                <span>Class / Homeroom</span>
                <select
                  value={form.class_id || activeClassId}
                  onChange={(e) => setForm({ ...form, class_id: e.target.value })}
                  style={{ fontWeight: 600 }}
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.id === activeClassId ? '(Current Class)' : ''}
                    </option>
                  ))}
                </select>
                <small className="muted">
                  Reallocates learner to another class. Roll number is preserved.
                </small>
              </label>
            )}
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
            <tr>
              <th>Class S/N</th>
              <th>Roll No.</th>
              <th>Full name</th>
              <th>Gender</th>
              {(canAdd || canReallocate) && <th className="right">Actions</th>}
            </tr>
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
                {(canAdd || canReallocate) && (
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    {canReallocate && (
                      <button
                        type="button"
                        className="btn btn-small"
                        style={{
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          borderColor: '#bfdbfe',
                          fontWeight: 600,
                          marginRight: '6px'
                        }}
                        onClick={() => openReallocate(s)}
                        title="Reallocate student to another class without changing their roll number"
                      >
                        ⇄ Reallocate
                      </button>
                    )}
                    {canAdd && (
                      <>
                        <button className="btn btn-small" onClick={() => startEdit(s)}>Edit</button>{' '}
                        <button className="btn btn-small btn-danger" onClick={() => remove(s)}>Delete</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reallocate Student Modal Dialog */}
      {reallocatingStudent && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !reallocateBusy) setReallocatingStudent(null)
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              borderRadius: '16px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              background: '#ffffff'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: '#dbeafe',
                  color: '#1d4ed8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '22px'
                }}
              >
                ⇄
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                  Reallocate Student
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  Move learner to another class without altering details
                </p>
              </div>
            </div>

            <form onSubmit={handleReallocate} className="stack" style={{ gap: '16px' }}>
              {/* Learner Info Box */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '14px 16px'
                }}
              >
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                    Learner Name:
                  </span>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                    {reallocatingStudent.full_name}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '24px' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                      Roll Number:
                    </span>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#2563eb', fontFamily: 'monospace' }}>
                      {reallocatingStudent.roll_no || reallocatingStudent.admission_no}
                    </div>
                  </div>
                  <div>
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                      Current Class:
                    </span>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#475569' }}>
                      {className || 'Current Class'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Destination Class Selection */}
              <label className="field" style={{ margin: 0 }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: '#1e293b' }}>
                  Target Destination Class *
                </span>
                <select
                  required
                  value={targetClassId}
                  onChange={(e) => setTargetClassId(e.target.value)}
                  style={{
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    fontWeight: 600
                  }}
                >
                  <option value="" disabled>Select destination class…</option>
                  {classes
                    .filter((c) => c.id !== reallocatingStudent.class_id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.homeroom_teacher_name ? `(Tr: ${c.homeroom_teacher_name})` : ''}
                      </option>
                    ))}
                </select>
                <small className="muted" style={{ fontSize: '12px', color: '#059669', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px' }}>
                  <span>✓</span>
                  <span>
                    Roll number (<strong>{reallocatingStudent.roll_no || reallocatingStudent.admission_no}</strong>) will be preserved.
                  </span>
                </small>
              </label>

              {/* Modal Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={reallocateBusy}
                  onClick={() => setReallocatingStudent(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={reallocateBusy || !targetClassId || targetClassId === reallocatingStudent.class_id}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  {reallocateBusy ? 'Reallocating…' : 'Confirm Reallocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
