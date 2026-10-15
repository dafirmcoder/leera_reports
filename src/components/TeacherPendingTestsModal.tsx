import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtDate } from '../lib/report'
import { ROLE_LABEL } from '../lib/permissions'
import type { TeacherAssignmentTestSummary, TeacherTestSummary, UnitTestSummaryItem } from '../lib/types'

interface TeacherPendingTestsModalProps {
  teacher: TeacherTestSummary
  allTests: UnitTestSummaryItem[]
  teacherAssignments?: TeacherAssignmentTestSummary[]
  initialTab?: 'pending' | 'all'
  onClose: () => void
}

export default function TeacherPendingTestsModal({
  teacher,
  allTests,
  teacherAssignments = [],
  initialTab = 'pending',
  onClose
}: TeacherPendingTestsModalProps) {
  const [tab, setTab] = useState<'pending' | 'all'>(initialTab)

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Set of class_id + subject_id pairs assigned to this teacher
  const assignedPairs = useMemo(() => {
    return new Set(
      teacherAssignments
        .filter((as) => as.teacher_id === teacher.teacher_id)
        .map((as) => `${as.class_id}_${as.subject_id}`)
    )
  }, [teacherAssignments, teacher.teacher_id])

  // Filter all tests belonging strictly to this teacher
  const teacherTests = useMemo(() => {
    return allTests.filter((t) => {
      // 1. Direct teacher_id match
      if (t.teacher_id && t.teacher_id === teacher.teacher_id) return true

      // 2. Direct teacher_name match (never match Unassigned)
      if (t.teacher_name && t.teacher_name !== 'Unassigned' && t.teacher_name === teacher.teacher_name) return true

      // 3. Class-subject assignment match for this teacher (excluding tests explicitly claimed by another teacher)
      const key = `${t.class_id}_${t.subject_id}`
      if (assignedPairs.has(key)) {
        if (!t.teacher_id || t.teacher_id === teacher.teacher_id) return true
        if (t.teacher_name === teacher.teacher_name) return true
      }

      return false
    })
  }, [allTests, teacher.teacher_id, teacher.teacher_name, assignedPairs])

  // Tests that have pending marks (either no marks entered at all, or fewer marks entered than total enrolled students)
  const pendingTests = useMemo(() => {
    return teacherTests.filter(
      (t) => !t.has_marks_entered || (t.total_students > 0 && t.marks_entered_count < t.total_students)
    )
  }, [teacherTests])

  const displayedTests = tab === 'pending' ? pendingTests : teacherTests

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 980,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          borderRadius: 12,
          padding: 0,
          overflow: 'hidden',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#f8fafc'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
                👨‍🏫 Assessments & Marks: {teacher.teacher_name}
              </h3>
              <span className="role-tag" style={{ fontSize: '11px' }}>
                {ROLE_LABEL[teacher.role] || teacher.role}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              Classes: <strong>{teacher.class_names.join(', ') || 'None'}</strong> · Subjects:{' '}
              <strong>{teacher.subjects.join(', ') || 'None'}</strong>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={onClose}
            style={{ fontSize: 18, lineHeight: 1, padding: '4px 8px' }}
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Filter Tabs & Summary Bar */}
        <div
          style={{
            padding: '10px 20px',
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setTab('pending')}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: tab === 'pending' ? 700 : 500,
                backgroundColor: tab === 'pending' ? '#f59e0b' : '#f8fafc',
                color: tab === 'pending' ? '#ffffff' : '#475569',
                border: '1px solid',
                borderColor: tab === 'pending' ? '#d97706' : '#cbd5e1',
                cursor: 'pointer'
              }}
            >
              ⏳ Pending Marks ({pendingTests.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('all')}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: tab === 'all' ? 700 : 500,
                backgroundColor: tab === 'all' ? '#1e293b' : '#f8fafc',
                color: tab === 'all' ? '#ffffff' : '#475569',
                border: '1px solid',
                borderColor: tab === 'all' ? '#0f172a' : '#cbd5e1',
                cursor: 'pointer'
              }}
            >
              All Tests ({teacherTests.length})
            </button>
          </div>

          <div style={{ fontSize: 12, color: '#64748b' }}>
            {pendingTests.length > 0 ? (
              <span style={{ color: '#d97706', fontWeight: 600 }}>
                ⚠️ {pendingTests.length} test{pendingTests.length === 1 ? '' : 's'} awaiting marks entry
              </span>
            ) : (
              <span style={{ color: '#166534', fontWeight: 600 }}>
                ✓ All recorded tests have student marks entered!
              </span>
            )}
          </div>
        </div>

        {/* Modal Table Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {displayedTests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
              {tab === 'pending' ? (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
                  <strong style={{ fontSize: 15, color: '#0f172a' }}>No pending marks!</strong>
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                    All tests created for {teacher.teacher_name} have complete marks recorded for enrolled students.
                  </p>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                  <strong style={{ fontSize: 15, color: '#0f172a' }}>No tests found</strong>
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                    No unit tests or exams are currently recorded for this teacher.
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Subject</th>
                    <th>Type</th>
                    <th>Topic / Assessment Title</th>
                    <th>Test Date</th>
                    <th className="num">Max Mark</th>
                    <th className="num">Marks Entered</th>
                    <th className="num">Avg Score</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedTests.map((t) => {
                    const isExam = t.assessment_type === 'exam' || t.assessment_type === 'midterm'
                    const hasNoMarks = !t.has_marks_entered || t.marks_entered_count === 0
                    const isPartial = !hasNoMarks && t.total_students > 0 && t.marks_entered_count < t.total_students

                    return (
                      <tr key={t.test_id}>
                        <td>
                          <span className="chip" style={{ fontWeight: 600, fontSize: '12px' }}>
                            {t.class_name}
                          </span>
                        </td>
                        <td>
                          <span
                            className="role-tag"
                            style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 600, fontSize: '12px' }}
                          >
                            {t.subject_name}
                          </span>
                        </td>
                        <td>
                          <span
                            className="chip"
                            style={{
                              background: isExam ? '#ffedd5' : '#dbeafe',
                              color: isExam ? '#c2410c' : '#1d4ed8',
                              fontWeight: 600,
                              fontSize: '11px'
                            }}
                          >
                            {isExam ? '📝 School Exam' : '📘 Unit Test'}
                          </span>
                        </td>
                        <td>
                          <strong>{t.title}</strong>
                        </td>
                        <td className="mono" style={{ fontSize: '12px' }}>
                          {t.test_date ? fmtDate(t.test_date) : '—'}
                        </td>
                        <td className="num mono font-bold">{t.max_mark}</td>
                        <td className="num">
                          <span
                            className="chip"
                            style={{
                              background: hasNoMarks ? '#fee2e2' : isPartial ? '#fef3c7' : '#dcfce7',
                              color: hasNoMarks ? '#991b1b' : isPartial ? '#92400e' : '#166534',
                              fontWeight: 700,
                              fontSize: '11px'
                            }}
                          >
                            {hasNoMarks
                              ? `⏳ 0 / ${t.total_students} (0%)`
                              : isPartial
                              ? `⚠️ ${t.marks_entered_count} / ${t.total_students} (${t.marks_entered_pct}%)`
                              : `✓ ${t.marks_entered_count} / ${t.total_students} (100%)`}
                          </span>
                        </td>
                        <td className="num">
                          {t.average_pct !== null ? (
                            <span
                              style={{
                                fontWeight: 700,
                                color:
                                  t.average_pct >= 65
                                    ? '#10b981'
                                    : t.average_pct >= 50
                                    ? '#d97706'
                                    : '#dc2626'
                              }}
                            >
                              {t.average_pct}%
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="right">
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <Link
                              to={`/marks/${t.class_id}/${t.test_id}?view=entry`}
                              className="btn btn-small btn-primary"
                              style={{ padding: '3px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
                              title="Open test to enter or update marks"
                            >
                              Enter Marks →
                            </Link>
                            <Link
                              to={`/marks/${t.class_id}/${t.test_id}?view=marksheet`}
                              className="btn btn-small btn-secondary"
                              style={{ padding: '3px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
                              title="View read-only marksheet table"
                            >
                              Sheet
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span className="muted" style={{ fontSize: '12px' }}>
            Showing <strong>{displayedTests.length}</strong> assessment
            {displayedTests.length === 1 ? '' : 's'}. Click <strong>Enter Marks →</strong> to record scores.
          </span>
          <button type="button" className="btn btn-secondary btn-small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
