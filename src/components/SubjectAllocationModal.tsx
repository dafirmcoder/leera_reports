import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Student, Subject } from '../lib/types'
import { formatRollNo, formatStudentNo } from '../lib/report'

interface Props {
  classId: string
  className: string
  students: Student[]
  onClose: () => void
  onSaved?: () => void
}

export default function SubjectAllocationModal({
  classId,
  className,
  students,
  onClose,
  onSaved
}: Props) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [allocations, setAllocations] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)

    Promise.all([
      api.listSubjects(),
      api.listAssignments(classId).catch(() => []),
      api.getStudentSubjectAllocations(classId).catch(() => ({} as Record<string, string[]>))
    ])
      .then(([allSubs, classAssignments, savedAllocs]) => {
        if (!active) return

        // Prefer subjects assigned to this class; if none assigned yet, show all subjects
        let relevantSubjects: Subject[] = []
        if (classAssignments && classAssignments.length > 0) {
          const subIdSet = new Set(classAssignments.map((a) => a.subject_id))
          relevantSubjects = allSubs.filter((s) => subIdSet.has(s.id))
        }
        if (relevantSubjects.length === 0) {
          relevantSubjects = allSubs
        }

        setSubjects(relevantSubjects)

        // Initialize allocations:
        // If a student already has allocations saved, use them.
        // Otherwise, initialize to all relevant subjects so nothing is accidentally dropped.
        const currentAllocs: Record<string, string[]> = {}
        const hasAnySaved = Object.keys(savedAllocs).length > 0

        students.forEach((st) => {
          if (savedAllocs[st.id] !== undefined) {
            currentAllocs[st.id] = [...savedAllocs[st.id]]
          } else if (hasAnySaved) {
            // Some students were configured but this one wasn't: default to empty or all
            currentAllocs[st.id] = []
          } else {
            // First-time configuration: default to all subjects
            currentAllocs[st.id] = relevantSubjects.map((s) => s.id)
          }
        })

        setAllocations(currentAllocs)
      })
      .catch((err) => {
        if (active) setError(err.message || 'Failed to load subject allocations')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [classId, students])

  const filteredStudents = useMemo(() => {
    if (!search.trim()) return students
    const q = search.toLowerCase()
    return students.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        (s.roll_no && s.roll_no.toLowerCase().includes(q)) ||
        (s.student_no && s.student_no.toLowerCase().includes(q))
    )
  }, [students, search])

  const toggleStudentSubject = (studentId: string, subjectId: string) => {
    setAllocations((prev) => {
      const current = prev[studentId] ? [...prev[studentId]] : []
      const idx = current.indexOf(subjectId)
      if (idx >= 0) {
        current.splice(idx, 1)
      } else {
        current.push(subjectId)
      }
      return { ...prev, [studentId]: current }
    })
  }

  const setAllForStudent = (studentId: string, enable: boolean) => {
    setAllocations((prev) => ({
      ...prev,
      [studentId]: enable ? subjects.map((s) => s.id) : []
    }))
  }

  const setAllForSubject = (subjectId: string, enable: boolean) => {
    setAllocations((prev) => {
      const next = { ...prev }
      filteredStudents.forEach((st) => {
        const cur = next[st.id] ? [...next[st.id]] : []
        const has = cur.includes(subjectId)
        if (enable && !has) {
          cur.push(subjectId)
        } else if (!enable && has) {
          const idx = cur.indexOf(subjectId)
          if (idx >= 0) cur.splice(idx, 1)
        }
        next[st.id] = cur
      })
      return next
    })
  }

  const selectAllGlobal = () => {
    const allSubIds = subjects.map((s) => s.id)
    const next: Record<string, string[]> = {}
    students.forEach((st) => {
      next[st.id] = [...allSubIds]
    })
    setAllocations(next)
  }

  const clearAllGlobal = () => {
    const next: Record<string, string[]> = {}
    students.forEach((st) => {
      next[st.id] = []
    })
    setAllocations(next)
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setError('')
      setSuccessMsg('')
      await api.saveStudentSubjectAllocations(classId, allocations)
      setSuccessMsg('Subject allocations saved successfully!')
      if (onSaved) onSaved()
      setTimeout(() => {
        onClose()
      }, 700)
    } catch (err: any) {
      setError(err?.message || 'Failed to save subject allocations')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '1100px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          padding: 0
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>🎯</span>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                Subject Allocations — {className}
              </h2>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  background: '#e0e7ff',
                  color: '#3730a3',
                  padding: '2px 8px',
                  borderRadius: '12px'
                }}
              >
                Year 10+ Electives
              </span>
            </div>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '12.5px' }}>
              Assign elective/selective subjects for learners in Year 10 and above. Unallocated subjects are excluded
              from student overall averages and will not appear on their report cards.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '20px', padding: '4px 10px', lineHeight: 1 }}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Toolbar & Filter Bar */}
        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid #e2e8f0',
            background: '#ffffff',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 280px' }}>
            <input
              type="text"
              placeholder="Search student by name or roll no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                maxWidth: '320px',
                padding: '6px 12px',
                fontSize: '13px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1'
              }}
            />
            <span className="muted" style={{ fontSize: '12px' }}>
              Showing {filteredStudents.length} of {students.length} students
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ fontSize: '12px', padding: '5px 10px', border: '1px solid #cbd5e1' }}
              onClick={selectAllGlobal}
              title="Allocate all subjects to all students in this class"
            >
              ✓ Select All (All Students)
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ fontSize: '12px', padding: '5px 10px', border: '1px solid #cbd5e1' }}
              onClick={clearAllGlobal}
              title="Clear allocations for all students"
            >
              ✕ Clear All
            </button>
          </div>
        </div>

        {/* Modal Body: Allocation Matrix Table */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', maxHeight: '60vh', padding: 0 }}>
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
              <div>Loading subjects and current student allocations…</div>
            </div>
          ) : subjects.length === 0 ? (
            <div style={{ padding: '36px', textAlign: 'center', color: '#64748b' }}>
              No subjects found in the curriculum for this school.
            </div>
          ) : (
            <table
              className="table"
              style={{
                width: '100%',
                minWidth: 'max-content',
                borderCollapse: 'separate',
                borderSpacing: 0,
                fontSize: '12px',
                textAlign: 'center'
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 10 }}>
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 20,
                      background: '#f8fafc',
                      width: '45px',
                      padding: '10px 8px',
                      borderBottom: '2px solid #cbd5e1',
                      borderRight: '1px solid #e2e8f0'
                    }}
                  >
                    S/N
                  </th>
                  <th
                    style={{
                      position: 'sticky',
                      left: '45px',
                      zIndex: 20,
                      background: '#f8fafc',
                      minWidth: '220px',
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderBottom: '2px solid #cbd5e1',
                      borderRight: '2px solid #94a3b8'
                    }}
                  >
                    Student Name
                  </th>

                  {subjects.map((sub) => {
                    const enrolledCount = students.filter((st) =>
                      allocations[st.id]?.includes(sub.id)
                    ).length
                    const allEnrolled = enrolledCount === students.length && students.length > 0

                    return (
                      <th
                        key={sub.id}
                        style={{
                          padding: '8px 10px',
                          minWidth: '95px',
                          borderBottom: '2px solid #cbd5e1',
                          borderRight: '1px solid #e2e8f0',
                          background: '#f1f5f9',
                          color: '#0f172a',
                          fontWeight: 700
                        }}
                      >
                        <div style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>{sub.name}</div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            marginTop: '4px'
                          }}
                        >
                          <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                            {enrolledCount}/{students.length}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              padding: '1px 5px',
                              fontSize: '10px',
                              borderRadius: '4px',
                              background: allEnrolled ? '#fee2e2' : '#dcfce7',
                              color: allEnrolled ? '#991b1b' : '#166534',
                              fontWeight: 700
                            }}
                            onClick={() => setAllForSubject(sub.id, !allEnrolled)}
                            title={allEnrolled ? `Deselect ${sub.name} for all` : `Select ${sub.name} for all`}
                          >
                            {allEnrolled ? 'None' : 'All'}
                          </button>
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>

              <tbody>
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={2 + subjects.length}
                      style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}
                    >
                      No students found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((st, idx) => {
                    const stAllocs = allocations[st.id] || []
                    const count = stAllocs.length
                    const totalSubs = subjects.length

                    return (
                      <tr
                        key={st.id}
                        style={{
                          background: idx % 2 === 0 ? '#ffffff' : '#fcfdfe',
                          borderBottom: '1px solid #f1f5f9'
                        }}
                      >
                        {/* S/N */}
                        <td
                          style={{
                            position: 'sticky',
                            left: 0,
                            zIndex: 5,
                            background: idx % 2 === 0 ? '#ffffff' : '#fcfdfe',
                            padding: '8px',
                            fontWeight: 600,
                            color: '#64748b',
                            borderRight: '1px solid #e2e8f0'
                          }}
                        >
                          {idx + 1}
                        </td>

                        {/* Student Info */}
                        <td
                          style={{
                            position: 'sticky',
                            left: '45px',
                            zIndex: 5,
                            background: idx % 2 === 0 ? '#ffffff' : '#fcfdfe',
                            textAlign: 'left',
                            padding: '8px 12px',
                            borderRight: '2px solid #94a3b8'
                          }}
                        >
                          <div style={{ fontWeight: 700, color: '#1e293b' }}>{st.full_name}</div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginTop: '2px'
                            }}
                          >
                            <span className="mono" style={{ fontSize: '10.5px', color: '#64748b' }}>
                              {formatRollNo(st.roll_no || st.admission_no) || formatStudentNo(st.student_no) || '—'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: '8px',
                                  background: count > 0 ? '#dcfce7' : '#fee2e2',
                                  color: count > 0 ? '#15803d' : '#b91c1c'
                                }}
                              >
                                {count}/{totalSubs}
                              </span>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: '0 4px', fontSize: '9.5px', color: '#2563eb' }}
                                onClick={() => setAllForStudent(st.id, count < totalSubs)}
                              >
                                {count < totalSubs ? 'All' : 'Clear'}
                              </button>
                            </div>
                          </div>
                        </td>

                        {/* Checkbox columns for each subject */}
                        {subjects.map((sub) => {
                          const isChecked = stAllocs.includes(sub.id)

                          return (
                            <td
                              key={sub.id}
                              style={{
                                padding: '6px',
                                borderRight: '1px solid #f1f5f9',
                                background: isChecked ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                cursor: 'pointer'
                              }}
                              onClick={() => toggleStudentSubject(st.id, sub.id)}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleStudentSubject(st.id, sub.id)}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  cursor: 'pointer',
                                  width: '16px',
                                  height: '16px',
                                  accentColor: '#059669'
                                }}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div>
            {error && <span style={{ color: '#dc2626', fontSize: '13px', fontWeight: 600 }}>⚠️ {error}</span>}
            {successMsg && <span style={{ color: '#16a34a', fontSize: '13px', fontWeight: 600 }}>✓ {successMsg}</span>}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || loading}
              style={{ fontWeight: 700, padding: '7px 20px' }}
            >
              {saving ? 'Saving Allocations…' : 'Save Allocations'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
