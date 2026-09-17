import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/report'
import { useAuth } from '../context/AuthContext'
import { useSchool } from '../context/SchoolContext'
import { hasRole } from '../lib/permissions'
import type { ScoreRow, Student, UnitTest } from '../lib/types'

export default function ScoreEntry() {
  const { classId, testId } = useParams<{ classId: string; testId: string }>()
  const [searchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  const { profile } = useAuth()
  const { school, classes } = useSchool()
  const [test, setTest] = useState<UnitTest | null>(null)
  const [rows, setRows] = useState<ScoreRow[]>([])
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

  // Determine active view mode: 'marksheet' (read-only table) vs 'entry' (score input boxes)
  const [activeTab, setActiveTab] = useState<'marksheet' | 'entry'>(() => {
    if (viewParam === 'marksheet') return 'marksheet'
    if (viewParam === 'entry') return 'entry'
    if (isLeadership) return 'marksheet'
    return 'entry'
  })

  useEffect(() => {
    if (viewParam === 'marksheet') {
      setActiveTab('marksheet')
    } else if (viewParam === 'entry') {
      setActiveTab('entry')
    } else if (isLeadership && !viewParam) {
      setActiveTab('marksheet')
    }
  }, [viewParam, isLeadership])

  useEffect(() => {
    if (!testId) return
    api.listScoresForTest(testId).then(setRows).catch((e) => setError(e.message))
    if (classId) {
      api.listUnitTests(classId).then(async (ts) => {
        const selected = ts.find((t) => t.id === testId) ?? null
        setTest(selected)
        if (!selected || !profile) return
        const isHomeroomOfClass = hasRole(profile.role, 'homeroom_teacher', profile.additional_roles) && profile.class_id === classId
        const isLead = hasRole(profile.role, 'curriculum_coordinator', profile.additional_roles)
          || hasRole(profile.role, 'head_of_school', profile.additional_roles)
        const assignments = await api.listAssignments(classId).catch(() => [])
        const isAssignedSubjectTeacher = assignments.some((a) => a.teacher_id === profile.id && a.subject_id === selected.subject_id)

        setCanEdit(!isDirector && (isHomeroomOfClass || isAssignedSubjectTeacher || selected.created_by === profile.id || isLead))
      }).catch(() => {})
    }
  }, [testId, classId, profile, isDirector])

  useEffect(() => {
    if (!classId || !test?.subject_id) return
    let isCancelled = false
    async function loadMarksheet() {
      setLoadingMarksheet(true)
      try {
        const [allTests, students] = await Promise.all([
          api.listUnitTests(classId!),
          api.listStudents(classId!)
        ])
        const subjectTests = allTests
          .filter((t) => t.subject_id === test!.subject_id)
          .sort((a, b) => a.test_date.localeCompare(b.test_date) || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))

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

  const setScore = (studentId: string, value: string) => {
    if (!canEdit || isDirector) return
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

      const students = await api.listStudents(classId)
      if (students.length === 0) {
        setError('No students found in this class.')
        return
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

      const cls = classes.find((c) => c.id === classId)
      const className = cls?.name || 'Class'
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
            to={isDirector || viewParam === 'marksheet' ? '/dashboard/marks' : '/marks'}
            className="btn btn-ghost"
          >
            ← Back to {isDirector || viewParam === 'marksheet' ? 'Marks Summaries' : 'Tests'}
          </Link>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

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
          <p className="muted">{canEdit ? 'Scores save automatically as you type.' : 'Read-only score sheet. You can edit scores only for an assigned class subject.'}</p>
        </div>
      )}
    </div>
  )
}
