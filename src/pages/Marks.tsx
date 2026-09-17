import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/report'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can, hasRole } from '../lib/permissions'
import ClassPicker from '../components/ClassPicker'
import type { Assignment, UnitTest } from '../lib/types'

export default function Marks() {
  const navigate = useNavigate()
  const { selectedClassId, classes, subjects, school } = useSchool()
  const { profile } = useAuth()
  const [tests, setTests] = useState<UnitTest[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('')
  const [downloadingSubjectId, setDownloadingSubjectId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ subject_id: '', title: '', test_date: today(), max_mark: '100' })
  const [examPaperFile, setExamPaperFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const roleCanAdd = can(profile?.role, 'addMarks', profile?.additional_roles)
  const className = classes.find((c) => c.id === selectedClassId)?.name ?? ''

  const reload = () => {
    if (!selectedClassId) return
    api.listUnitTests(selectedClassId).then(setTests).catch((e) => setError(e.message))
    api.listAssignments(selectedClassId).then(setAssignments).catch(() => {})
  }

  useEffect(reload, [selectedClassId])

  const isLeadership = hasRole(profile?.role, 'head_of_school', profile?.additional_roles)
    || hasRole(profile?.role, 'curriculum_coordinator', profile?.additional_roles)
  const isHomeroom = hasRole(profile?.role, 'homeroom_teacher', profile?.additional_roles)
  const isOwnClass = isHomeroom && !!profile?.class_id && profile.class_id === selectedClassId
  const myAssignments = assignments.filter((a) => a.teacher_id === profile?.id)
  const mySubjects = isOwnClass || isLeadership
    ? subjects
    : subjects.filter((s) => myAssignments.some((a) => a.subject_id === s.id))
  const canAdd = roleCanAdd && (
    isLeadership
    || isOwnClass
    || mySubjects.length > 0
  )

  const canEditTest = (test: UnitTest) => isLeadership
    || (isOwnClass && test.class_id === profile?.class_id)
    || myAssignments.some((a) => a.class_id === test.class_id && a.subject_id === test.subject_id)
  const canDeleteTest = can(profile?.role, 'deleteTests', profile?.additional_roles)

  const openExamPaper = async (test: UnitTest) => {
    try {
      const url = test.exam_paper_url || (test.exam_paper_path && api.getExamPaperUrl ? await api.getExamPaperUrl(test.exam_paper_path) : null)
      if (url) {
        window.open(url, '_blank')
      } else {
        setError('Exam paper is not available.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to open exam paper')
    }
  }

  const downloadMarksheet = async (subjectId: string, subjectName: string) => {
    if (!selectedClassId || !school) return
    setError('')
    setDownloadingSubjectId(subjectId)
    try {
      const subjectTests = tests
        .filter((t) => t.subject_id === subjectId)
        .sort((a, b) => a.test_date.localeCompare(b.test_date))

      if (subjectTests.length === 0) {
        setError(`No unit tests found for ${subjectName} in this class.`)
        return
      }

      const students = await api.listStudents(selectedClassId)
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

      const assignment = assignments.find((a) => a.subject_id === subjectId)
      const teacherName = assignment?.teacher_name || profile?.full_name || ''

      const { downloadSubjectMarksheetPdf } = await import('../lib/pdf')
      await downloadSubjectMarksheetPdf({
        school,
        className,
        subjectName,
        teacherName,
        students,
        tests: subjectTests,
        scoresByTest
      })
    } catch (err: any) {
      setError(err?.message ?? 'Failed to download marksheet.')
    } finally {
      setDownloadingSubjectId(null)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedClassId || !form.subject_id || !form.title.trim()) {
      setError('Choose a subject and enter a unit/topic.')
      return
    }
    if (!examPaperFile) {
      setError('Please upload the sample exam paper (PDF file).')
      return
    }
    setError('')
    setBusy(true)
    try {
      const id = await api.createUnitTest(selectedClassId, {
        subject_id: form.subject_id,
        title: form.title.trim(),
        test_date: form.test_date,
        max_mark: Number(form.max_mark) || 100,
        examPaperFile
      })
      setForm({ subject_id: '', title: '', test_date: today(), max_mark: '100' })
      setExamPaperFile(null)
      setShowForm(false)
      reload()
      navigate(`/marks/${selectedClassId}/${id}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t: UnitTest) => {
    if (!canDeleteTest) {
      setError('Only coordinators and leadership can delete a unit test.')
      return
    }
    if (!confirm(`Delete "${t.subject_name} – ${t.title}"? All its scores and exam paper will be removed.`)) return
    try {
      await api.deleteUnitTest(t.id)
      reload()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // Filter tests if a subject is selected
  const visibleTests = selectedSubjectId
    ? tests.filter((t) => t.subject_id === selectedSubjectId)
    : tests

  // Group tests by subject, sorted subject-wise then topic-wise
  const subjectGroups = Array.from(new Set(visibleTests.map((t) => t.subject_id))).map((subjId) => {
    const subjTests = visibleTests.filter((t) => t.subject_id === subjId)
    const subjName = subjTests[0]?.subject_name || subjects.find((s) => s.id === subjId)?.name || 'Subject'
    subjTests.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
    return { id: subjId, name: subjName, tests: subjTests }
  })
  subjectGroups.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Unit Tests{className ? ` — ${className}` : ''}</h2>
          <p className="muted">{canAdd ? 'Every end-of-unit test you record, with its score sheet.' : 'Read-only view of recorded unit tests.'}</p>
        </div>
        <div className="row">
          <ClassPicker />
          {canAdd && (
            <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Close form' : '+ New unit test'}
            </button>
          )}
        </div>
      </div>

      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Filter by Subject:</label>
          <select
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff' }}
          >
            <option value="">All Subjects ({tests.length} tests)</option>
            {subjects.map((s) => {
              const count = tests.filter((t) => t.subject_id === s.id).length
              return (
                <option key={s.id} value={s.id}>
                  {s.name} {count > 0 ? `(${count})` : ''}
                </option>
              )
            })}
          </select>
        </div>

        {selectedSubjectId && (
          <button
            className="btn btn-primary"
            disabled={downloadingSubjectId === selectedSubjectId}
            onClick={() => {
              const subj = subjects.find((s) => s.id === selectedSubjectId)
              downloadMarksheet(selectedSubjectId, subj?.name || 'Subject')
            }}
          >
            {downloadingSubjectId === selectedSubjectId ? 'Generating PDF…' : '⬇ Download Subject Marksheet (PDF)'}
          </button>
        )}
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {showForm && canAdd && (
        <form onSubmit={submit} className="card stack">
          <h3>New unit test</h3>
          <div className="grid4">
            <label className="field"><span>Subject *</span>
              <select required value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                <option value="">Choose…</option>
                {mySubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Unit / Topic *</span>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Fractions & Decimals" />
            </label>
            <label className="field"><span>Date</span>
              <input type="date" value={form.test_date} onChange={(e) => setForm({ ...form, test_date: e.target.value })} />
            </label>
            <label className="field"><span>Max mark</span>
              <input type="number" min={1} value={form.max_mark} onChange={(e) => setForm({ ...form, max_mark: e.target.value })} />
            </label>
          </div>
          <div className="field" style={{ maxWidth: 480 }}>
            <span>Exam Paper (PDF) *</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              required
              onChange={(e) => {
                const file = e.target.files?.[0] || null
                if (file && !file.name.toLowerCase().endsWith('.pdf')) {
                  setError('Exam paper must be a PDF file (.pdf)')
                  setExamPaperFile(null)
                  e.target.value = ''
                  return
                }
                setError('')
                setExamPaperFile(file)
              }}
            />
            {examPaperFile && (
              <span style={{ fontSize: 12, color: 'var(--brand)', marginTop: 4 }}>
                Selected: {examPaperFile.name} ({(examPaperFile.size / 1024).toFixed(0)} KB)
              </span>
            )}
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create test & enter scores'}</button>
          </div>
        </form>
      )}

      {visibleTests.length === 0 && (
        <div className="card">
          <p className="muted center">No unit tests found for this selection.</p>
        </div>
      )}

      {subjectGroups.map((grp) => (
        <div key={grp.id} className="card stack" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>{grp.name}</h3>
              <span className="muted" style={{ fontSize: 13 }}>
                {grp.tests.length} unit test{grp.tests.length === 1 ? '' : 's'} recorded
              </span>
            </div>
            <button
              className="btn btn-small"
              disabled={downloadingSubjectId === grp.id}
              onClick={() => downloadMarksheet(grp.id, grp.name)}
              title="Download PDF Class Marksheet for this subject"
            >
              {downloadingSubjectId === grp.id ? 'Generating…' : '⬇ Marksheet (PDF)'}
            </button>
          </div>

          {grp.tests.map((t) => (
            <div key={t.id} className="list-row">
              <div className="list-main">
                <strong>{t.title}</strong>
                <span className="muted"> {fmtDate(t.test_date)} · Max {t.max_mark}</span>
              </div>
              <div className="list-actions">
                {(t.exam_paper_url || t.exam_paper_path) && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => openExamPaper(t)}
                    title={t.exam_paper_name ? `View ${t.exam_paper_name}` : 'View Exam Paper'}
                    style={{ background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe' }}
                  >
                    📄 Exam Paper
                  </button>
                )}{' '}
                <Link to={`/marks/${t.class_id}/${t.id}`} className="btn btn-small">Enter scores</Link>{' '}
                {canDeleteTest && <button className="btn btn-small btn-danger" onClick={() => remove(t)}>Delete</button>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
