import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/report'
import { useAuth } from '../context/AuthContext'
import { useSchool } from '../context/SchoolContext'
import { hasRole } from '../lib/permissions'
import type { ScoreRow, UnitTest } from '../lib/types'

export default function ScoreEntry() {
  const { classId, testId } = useParams<{ classId: string; testId: string }>()
  const { profile } = useAuth()
  const { school, classes } = useSchool()
  const [test, setTest] = useState<UnitTest | null>(null)
  const [rows, setRows] = useState<ScoreRow[]>([])
  const [error, setError] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const timers = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!testId) return
    api.listScoresForTest(testId).then(setRows).catch((e) => setError(e.message))
    if (classId) {
      api.listUnitTests(classId).then(async (ts) => {
        const selected = ts.find((t) => t.id === testId) ?? null
        setTest(selected)
        if (!selected || !profile) return
        const isHomeroomOfClass = hasRole(profile.role, 'homeroom_teacher', profile.additional_roles) && profile.class_id === classId
        const isLeadership = hasRole(profile.role, 'curriculum_coordinator', profile.additional_roles)
          || hasRole(profile.role, 'head_of_school', profile.additional_roles)
        const assignments = await api.listAssignments(classId).catch(() => [])
        const isAssignedSubjectTeacher = assignments.some((a) => a.teacher_id === profile.id && a.subject_id === selected.subject_id)

        setCanEdit(isHomeroomOfClass || isAssignedSubjectTeacher || isLeadership)
      }).catch(() => {})
    }
  }, [testId, classId, profile])

  const maxMark = test?.max_mark ?? 100

  const setScore = (studentId: string, value: string) => {
    const raw = value.trim()
    const score = raw === '' ? null : Math.max(0, Math.min(Number(raw) || 0, maxMark))
    setRows((prev) => prev.map((r) => (r.student_id === studentId ? { ...r, score } : r)))
    if (timers.current[studentId]) window.clearTimeout(timers.current[studentId])
    if (!canEdit) return
    timers.current[studentId] = window.setTimeout(() => {
      api.saveScore(testId!, studentId, score).catch((e) => setError(e.message))
    }, 400)
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
        <div className="row">
          <button
            className="btn btn-primary"
            disabled={downloading || !test}
            onClick={downloadMarksheet}
            title="Download PDF Class Marksheet for this subject"
          >
            {downloading ? 'Preparing Marksheet…' : '⬇ Subject Marksheet (PDF)'}
          </button>
          <Link to="/marks" className="btn btn-ghost">← Back</Link>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

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
    </div>
  )
}
