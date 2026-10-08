import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate, isYear10OrAbove } from '../lib/report'
import { useAuth } from '../context/AuthContext'
import { useSchool } from '../context/SchoolContext'
import { hasRole, isCoordinatorOrLeadership } from '../lib/permissions'
import type { ClassMarksLock, ScoreRow, Student, UnitTest } from '../lib/types'

export default function ScoreEntry() {
  const { classId, testId } = useParams<{ classId: string; testId: string }>()
  const [searchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  const { profile } = useAuth()
  const { school, classes } = useSchool()
  const [test, setTest] = useState<UnitTest | null>(null)
  const [rows, setRows] = useState<ScoreRow[]>([])
  const [lockInfo, setLockInfo] = useState<ClassMarksLock | null>(null)
  const [error, setError] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [marksheetData, setMarksheetData] = useState<{
    students: Student[]
    subjectTests: UnitTest[]
    scoresByTest: Record<string, Record<string, number | null>>
  } | null>(null)
  const [loadingMarksheet, setLoadingMarksheet] = useState(false)
  const timers = useRef<Record<string, number>>({})

  const isDirector = hasRole(profile?.role, 'director', profile?.additional_roles)
  const isHeadOfSchool = hasRole(profile?.role, 'head_of_school', profile?.additional_roles)
  const isCoordinator = hasRole(profile?.role, 'curriculum_coordinator', profile?.additional_roles)
  const isLeadership = isDirector || isHeadOfSchool || isCoordinator
  const isCoordinatorLead = isCoordinatorOrLeadership(profile)

  // Determine active view mode: 'marksheet' (read-only table) vs 'entry' (score input boxes)
  const [activeTab, setActiveTab] = useState<'marksheet' | 'entry'>(() => {
    if (viewParam === 'marksheet') return 'marksheet'
    if (viewParam === 'entry') return 'entry'
    if (isDirector) return 'marksheet'
    return 'entry'
  })

  useEffect(() => {
    if (viewParam === 'marksheet') {
      setActiveTab('marksheet')
    } else if (viewParam === 'entry') {
      setActiveTab('entry')
    } else if (isDirector && !viewParam) {
      setActiveTab('marksheet')
    }
  }, [viewParam, isDirector])

  useEffect(() => {
    if (!testId) return
    api.listScoresForTest(testId).then(setRows).catch((e) => setError(e.message))
    if (classId) {
      api.listUnitTests(classId).then(async (ts) => {
        const selected = ts.find((t) => t.id === testId) ?? null
        setTest(selected)
        if (!selected || !profile) return

        const lock = await api.getClassMarksLock(classId).catch(() => null)
        setLockInfo(lock)

        const isLead = isCoordinatorOrLeadership(profile)
        const isHomeroomOfClass = hasRole(profile.role, 'homeroom_teacher', profile.additional_roles) && profile.class_id === classId
        const assignments = await api.listAssignments(classId).catch(() => [])
        const isAssignedSubjectTeacher = assignments.some((a) => a.teacher_id === profile.id && a.subject_id === selected.subject_id)

        const isTestLockedForTeacher = Boolean(
          lock?.is_locked &&
          !isLead &&
          (!selected.created_at || !lock.locked_at || new Date(selected.created_at).getTime() <= new Date(lock.locked_at).getTime())
        )

        setCanEdit(
          !isDirector &&
          !isTestLockedForTeacher &&
          (isHomeroomOfClass || isAssignedSubjectTeacher || selected.created_by === profile.id || isLead)
        )
      }).catch(() => {})
    }
  }, [testId, classId, profile, isDirector])

  useEffect(() => {
    if (!classId || !test?.subject_id) return
    let isCancelled = false
    async function loadMarksheet() {
      setLoadingMarksheet(true)
      try {
        const [allTests, allStudents, allocs] = await Promise.all([
          api.listUnitTests(classId!),
          api.listStudents(classId!),
          api.getStudentSubjectAllocations(classId!).catch(() => ({} as Record<string, string[]>))
        ])
        const subjectTests = allTests
          .filter((t) => t.subject_id === test!.subject_id)
          .sort((a, b) => a.test_date.localeCompare(b.test_date) || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))

        const currentCls = classes.find((c) => c.id === classId)
        const isSenior = isYear10OrAbove(currentCls?.name)
        const hasConfigured = Object.values(allocs).some((arr) => Array.isArray(arr) && arr.length > 0)

        let students = allStudents
        if (isSenior && hasConfigured && test?.subject_id) {
          students = allStudents.filter((st) => {
            const arr = allocs[st.id]
            return Array.isArray(arr) && arr.includes(test.subject_id)
          })
        }

        const scoresPerTest = await Promise.all(
          subjectTests.map((t) => api.listScoresForTest(t.id).catch(() => []))
        )

        const scoresByTest: Record<string, Record<string, number | null>> = {}
        subjectTests.forEach((t, idx) => {
          scoresByTest[t.id] = {}
          scoresPerTest[idx].forEach((r) => {
            scoresByTest[t.id][r.student_id] = r.score
          })
        })

        if (!isCancelled) {
          setMarksheetData({ students, subjectTests, scoresByTest })
        }
      } catch (err: any) {
        if (!isCancelled) setError(err.message)
      } finally {
        if (!isCancelled) setLoadingMarksheet(false)
      }
    }
    loadMarksheet()
    return () => { isCancelled = true }
  }, [classId, test?.subject_id])

  const maxMark = test?.max_mark ?? 100

  const isCurrentTestLocked = Boolean(
    lockInfo?.is_locked &&
    !isCoordinatorLead &&
    (!test?.created_at || !lockInfo.locked_at || new Date(test.created_at).getTime() <= new Date(lockInfo.locked_at).getTime())
  )

  const setScore = (studentId: string, value: string) => {
    if (!canEdit || isDirector) return
    if (isCurrentTestLocked) {
      setError('Marks for this test are locked because reports have been downloaded. Only Curriculum Coordinators can make changes.')
      return
    }
    const raw = value.trim()
    const score = raw === '' ? null : Math.max(0, Math.min(Number(raw) || 0, maxMark))
    setRows((prev) => prev.map((r) => (r.student_id === studentId ? { ...r, score } : r)))
    if (timers.current[studentId]) window.clearTimeout(timers.current[studentId])
    timers.current[studentId] = window.setTimeout(() => {
      api.saveScore(testId!, studentId, score).catch((e) => setError(e.message))
    }, 400)
  }

  const openExamPaper = async (paperTest?: UnitTest | null) => {
    const t = paperTest || test
    if (!t) return
    try {
      const url = t.exam_paper_url || (t.exam_paper_path && api.getExamPaperUrl ? await api.getExamPaperUrl(t.exam_paper_path) : null)
      if (url) {
        window.open(url, '_blank')
      } else {
        setError('Exam paper is not available.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to open exam paper')
    }
  }

  const downloadMarksheet = async () => {
    if (!classId || !test || !school) return
    setError('')
    setDownloading(true)
    try {
      const allTests = await api.listUnitTests(classId)
      const subjectTests = allTests
        .filter((t) => t.subject_id === test.subject_id)
        .sort((a, b) => a.test_date.localeCompare(b.test_date))

      if (subjectTests.length === 0) {
        setError('No unit tests found for this subject in this class.')
        return
      }

      let students = await api.listStudents(classId)
      if (students.length === 0) {
        setError('No students found in this class.')
        return
      }

      const cls = classes.find((c) => c.id === classId)
      const className = cls?.name || 'Class'
      if (isYear10OrAbove(className)) {
        const allocs = await api.getStudentSubjectAllocations(classId).catch(() => ({} as Record<string, string[]>))
        const hasConfigured = Object.values(allocs).some((arr) => Array.isArray(arr) && arr.length > 0)
        if (hasConfigured && test.subject_id) {
          students = students.filter((st) => {
            const arr = allocs[st.id]
            return Array.isArray(arr) && arr.includes(test.subject_id)
          })
        }
      }

      const scoresPerTest = await Promise.all(
        subjectTests.map((t) => api.listScoresForTest(t.id).catch(() => []))
      )

      const scoresByTest: Record<string, Record<string, number | null>> = {}
      subjectTests.forEach((t, idx) => {
        scoresByTest[t.id] = {}
        scoresPerTest[idx].forEach((r) => {
          scoresByTest[t.id][r.student_id] = r.score
        })
      })

      const assignments = await api.listAssignments(classId).catch(() => [])
      const assignment = assignments.find((a) => a.subject_id === test.subject_id)
      const teacherName = assignment?.teacher_name || profile?.full_name || ''

      const { downloadSubjectMarksheetPdf } = await import('../lib/pdf')
      await downloadSubjectMarksheetPdf({
        school,
        className,
        subjectName: test.subject_name,
        teacherName,
        students,
        tests: subjectTests,
        scoresByTest
      })
    } catch (err: any) {
      setError(err?.message ?? 'Failed to download subject marksheet.')
    } finally {
      setDownloading(false)
    }
  }

  const isReadOnlyMarksheet = isDirector || activeTab === 'marksheet'
  const entered = rows.filter((r) => r.score !== null).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>{test ? `${test.subject_name} — ${test.title}` : 'Score sheet'}</h2>
          <p className="muted">
            {test && `${fmtDate(test.test_date)} · Max ${maxMark} · ${entered}/${rows.length} entered`}
          </p>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {(test?.exam_paper_url || test?.exam_paper_path) && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => openExamPaper(test)}
              title={test.exam_paper_name ? `View ${test.exam_paper_name}` : 'View Exam Paper'}
              style={{ background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe' }}
            >
              📄 Exam Paper
            </button>
          )}
          <button
            className="btn btn-primary"
            disabled={downloading || !test}
            onClick={downloadMarksheet}
            title="Download PDF Class Marksheet for this subject"
          >
            {downloading ? 'Preparing Marksheet…' : '⬇ Subject Marksheet (PDF)'}
          </button>
          <Link
            to={isDirector || viewParam === 'marksheet' ? '/dashboard/marks' : `/marks?classId=${classId}&subjectId=${test?.subject_id || ''}`}
            className="btn btn-ghost"
          >
            ← Back to {isDirector || viewParam === 'marksheet' ? 'Marks Summaries' : 'Tests'}
          </Link>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {/* Marks Lock Banners */}
      {lockInfo?.is_locked && !isCoordinatorLead && isCurrentTestLocked && (
        <div
          style={{
            background: '#fff1f2',
            border: '1.5px solid #fda4af',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
        >
          <span style={{ fontSize: '24px' }}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, color: '#9f1239', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Marks Locked (Read-Only)</span>
              <span style={{ fontSize: '11px', background: '#ffe4e6', color: '#9f1239', padding: '1px 6px', borderRadius: '10px' }}>Reports Generated</span>
            </div>
            <div style={{ fontSize: '12.5px', color: '#881337', marginTop: '2px' }}>
              The homeroom teacher has downloaded reports for this class. Marks for this existing test are locked and cannot be edited by subject teachers. If a mark change is needed, please ask the Curriculum Coordinator to unlock this class.
            </div>
          </div>
        </div>
      )}

      {lockInfo?.is_locked && !isCoordinatorLead && !isCurrentTestLocked && (
        <div
          style={{
            background: '#ecfdf5',
            border: '1.5px solid #a7f3d0',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
        >
          <span style={{ fontSize: '24px' }}>✨</span>
          <div>
            <div style={{ fontWeight: 700, color: '#065f46', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>New Test (Open for Grading)</span>
              <span style={{ fontSize: '11px', background: '#d1fae5', color: '#065f46', padding: '1px 6px', borderRadius: '10px' }}>Editable</span>
            </div>
            <div style={{ fontSize: '12.5px', color: '#047857', marginTop: '2px' }}>
              This test was created after reports were downloaded for this class. You can record and edit marks for this test normally.
            </div>
          </div>
        </div>
      )}

      {lockInfo?.is_locked && isCoordinatorLead && (
        <div
          style={{
            background: '#eff6ff',
            border: '1.5px solid #93c5fd',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '22px' }}>🔒</span>
            <div>
              <div style={{ fontWeight: 700, color: '#1e40af', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Marks Locked for Subject Teachers</span>
                <span style={{ fontSize: '11px', background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: '10px' }}>Coordinator Override Active</span>
              </div>
              <div style={{ fontSize: '12px', color: '#1e3a8a', marginTop: '2px' }}>
                Reports were downloaded{lockInfo.locked_at ? ` on ${new Date(lockInfo.locked_at).toLocaleDateString()}` : ''}{lockInfo.locked_by_name ? ` by ${lockInfo.locked_by_name}` : ''}. You have coordinator privileges to edit scores or unlock the class for teachers.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ borderColor: '#3b82f6', color: '#1d4ed8', fontWeight: 600, background: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onClick={async () => {
              if (!confirm('Unlock marks for this class? Subject teachers will be able to edit scores again.')) return
              try {
                await api.unlockClassMarks(classId!)
                const updated = await api.getClassMarksLock(classId!)
                setLockInfo(updated)
                setCanEdit(true)
              } catch (e: any) {
                setError(e.message)
              }
            }}
          >
            <span>🔓</span>
            <span>Unlock Class Marks</span>
          </button>
        </div>
      )}

      {/* Tab Switch: allowed for teachers and coordinators who have edit permissions */}
      {canEdit && !isDirector && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            className={`btn btn-small ${isReadOnlyMarksheet ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('marksheet')}
          >
            📊 Marksheet Overview (Read-Only)
          </button>
          <button
            type="button"
            className={`btn btn-small ${!isReadOnlyMarksheet ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('entry')}
          >
            ✏️ Enter Scores
          </button>
        </div>
      )}

      {isReadOnlyMarksheet ? (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h3>Subject Marksheet Overview</h3>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {isLeadership ? 'Executive view' : 'Read-only overview'} of all student performance across unit tests in {test?.subject_name}
              </p>
            </div>
            {test && (test.exam_paper_url || test.exam_paper_path) && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => openExamPaper(test)}
                style={{ background: '#e0e7ff', color: '#3730a3' }}
              >
                📄 View Current Exam Paper
              </button>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Student No.</th>
                  {marksheetData?.subjectTests.map((t) => (
                    <th key={t.id} className="num" title={t.title}>
                      <div>{t.title}</div>
                      <div className="muted" style={{ fontSize: 11, fontWeight: 'normal' }}>
                        Max {t.max_mark}
                        {(t.exam_paper_url || t.exam_paper_path) && (
                          <button
                            type="button"
                            onClick={() => openExamPaper(t)}
                            title="View Exam Paper"
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 2px' }}
                          >
                            📄
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Avg %</th>
                </tr>
              </thead>
              <tbody>
                {marksheetData?.students.map((st) => {
                  let studentEarned = 0
                  let studentMax = 0
                  let testsTaken = 0

                  return (
                    <tr key={st.id}>
                      <td><strong>{st.full_name}</strong></td>
                      <td className="mono">{st.student_no}</td>
                      {marksheetData.subjectTests.map((t) => {
                        const sc = marksheetData.scoresByTest[t.id]?.[st.id]
                        const isCurrent = t.id === testId
                        if (sc !== null && sc !== undefined) {
                          studentEarned += sc
                          studentMax += t.max_mark
                          testsTaken++
                        }
                        return (
                          <td
                            key={t.id}
                            className="num"
                            style={isCurrent ? { background: '#f8fafc', fontWeight: 600 } : undefined}
                          >
                            {sc === null || sc === undefined ? (
                              <span className="muted">—</span>
                            ) : (
                              <span>
                                {sc} <span className="muted" style={{ fontSize: 11 }}>({((sc / t.max_mark) * 100).toFixed(0)}%)</span>
                              </span>
                            )}
                          </td>
                        )
                      })}
                      <td className="num">
                        {testsTaken > 0 ? (
                          <strong>{studentEarned} / {studentMax}</strong>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        {testsTaken > 0 && studentMax > 0 ? (
                          <span className="pill pill-success" style={{ fontWeight: 600 }}>
                            {((studentEarned / studentMax) * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {(!marksheetData?.students || marksheetData.students.length === 0) && (
                  <tr>
                    <td colSpan={3 + (marksheetData?.subjectTests.length || 0)} className="muted center">
                      {loadingMarksheet ? 'Loading marksheet…' : 'No students found in this class.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted">Read-only marksheet overview. Total and average scores are computed across all subject tests.</p>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Student</th><th>Student No.</th><th className="num">Score</th><th className="num">Mark %</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student_id}>
                  <td>{r.student_name}</td>
                  <td className="mono">{r.student_no}</td>
                  <td className="num">
                    <input
                      type="number" min={0} max={maxMark} step="any" className="score-input"
                      disabled={!canEdit}
                      title={
                        isDirector
                          ? 'View only'
                          : isCurrentTestLocked
                          ? '🔒 Scores locked: Marks for this existing test cannot be edited after reports download.'
                          : undefined
                      }
                      value={r.score === null ? '' : String(r.score)}
                      onChange={(e) => setScore(r.student_id, e.target.value)}
                      inputMode="decimal"
                    />
                  </td>
                  <td className="num">
                    {r.score === null ? <span className="muted">—</span> : `${((r.score / maxMark) * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="muted center">No students yet — add students first.</td></tr>
              )}
            </tbody>
          </table>
          <p className="muted">
            {canEdit
              ? 'Scores save automatically as you type.'
              : lockInfo?.is_locked
              ? '🔒 Scores locked: The homeroom teacher has downloaded reports for this class. Only Curriculum Coordinators can make changes.'
              : 'Read-only score sheet. You can edit scores only for an assigned class subject.'}
          </p>
        </div>
      )}
    </div>
  )
}
