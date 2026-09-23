import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/report'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can, hasRole } from '../lib/permissions'
import ClassPicker from '../components/ClassPicker'
import CoordinatorMarksOverview from '../components/CoordinatorMarksOverview'
import type { Assignment, UnitTest } from '../lib/types'

export default function Marks() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { selectedClassId, classes, subjects, school, setSelectedClassId } = useSchool()
  const { profile } = useAuth()
  const [tests, setTests] = useState<UnitTest[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('')
  const [downloadingSubjectId, setDownloadingSubjectId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ subject_id: '', title: '', test_date: today(), max_mark: '100' })
  const [examPaperFile, setExamPaperFile] = useState<File | null>(null)
  const [editingTest, setEditingTest] = useState<UnitTest | null>(null)
  const [editForm, setEditForm] = useState({ title: '', test_date: today(), max_mark: '100' })
  const [editExamFile, setEditExamFile] = useState<File | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const urlClassId = searchParams.get('classId')
  const urlSubjectId = searchParams.get('subjectId')
  const urlAction = searchParams.get('action')
  const isCoordinator = hasRole(profile?.role, 'curriculum_coordinator', profile?.additional_roles)

  const [coordinatorView, setCoordinatorView] = useState<'class_tests' | 'school_overview'>(() => {
    if (searchParams.get('tab') === 'overview' && !searchParams.get('classId')) return 'school_overview'
    return 'class_tests'
  })

  // Synchronize classId from URL param (e.g. clicked from teacher dashboard card)
  useEffect(() => {
    if (urlClassId && urlClassId !== selectedClassId && classes.some((c) => c.id === urlClassId)) {
      setSelectedClassId(urlClassId)
      setCoordinatorView('class_tests')
    }
  }, [urlClassId, classes, selectedClassId, setSelectedClassId])

  // Synchronize subjectId from URL param
  useEffect(() => {
    if (urlSubjectId && subjects.some((s) => s.id === urlSubjectId)) {
      setSelectedSubjectId(urlSubjectId)
      setCoordinatorView('class_tests')
    }
  }, [urlSubjectId, subjects])

  // Open creation modal if action=new
  useEffect(() => {
    if (urlAction === 'new') {
      setShowForm(true)
      if (urlSubjectId) {
        setForm((prev) => ({ ...prev, subject_id: urlSubjectId }))
      }
    }
  }, [urlAction, urlSubjectId])

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
    || test.created_by === profile?.id
  const canDeleteTest = can(profile?.role, 'deleteTests', profile?.additional_roles)

  const startEditing = (t: UnitTest) => {
    setEditingTest(t)
    setEditForm({
      title: t.title,
      test_date: t.test_date,
      max_mark: String(t.max_mark)
    })
    setEditExamFile(null)
    setError('')
  }

  const cancelEditing = () => {
    setEditingTest(null)
    setEditExamFile(null)
  }

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editingTest || !editForm.title.trim()) {
      setError('Unit / Topic name cannot be empty.')
      return
    }
    setError('')
    setEditBusy(true)
    try {
      await api.updateUnitTest(editingTest.id, {
        title: editForm.title.trim(),
        test_date: editForm.test_date,
        max_mark: Number(editForm.max_mark) || 100,
        examPaperFile: editExamFile
      })
      setEditingTest(null)
      setEditExamFile(null)
      reload()
    } catch (err: any) {
      setError(err.message || 'Failed to update unit test.')
    } finally {
      setEditBusy(false)
    }
  }

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
      {/* Curriculum Coordinator Banner & View Switcher */}
      {isCoordinator && (
        <div style={{
          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
          color: '#ffffff',
          padding: '16px 20px',
          borderRadius: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '20px',
          boxShadow: '0 2px 8px rgba(30, 27, 75, 0.2)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>👑</span>
              <span style={{
                background: 'rgba(255,255,255,0.18)',
                padding: '3px 10px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.5px'
              }}>
                CURRICULUM COORDINATOR ASSESSMENT CENTER
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#c7d2fe' }}>
              Coordinator oversight: review school-wide marks summaries or manage class-level unit tests and scores.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: coordinatorView === 'class_tests' ? '#ffffff' : 'rgba(255,255,255,0.15)',
                color: coordinatorView === 'class_tests' ? '#1e1b4b' : '#ffffff',
                fontWeight: coordinatorView === 'class_tests' ? 700 : 500,
                border: 'none',
                cursor: 'pointer'
              }}
              onClick={() => {
                setCoordinatorView('class_tests')
                setSearchParams((prev) => {
                  const p = new URLSearchParams(prev)
                  p.delete('tab')
                  return p
                })
              }}
            >
              📋 Class Unit Tests
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: coordinatorView === 'school_overview' ? '#ffffff' : 'rgba(255,255,255,0.15)',
                color: coordinatorView === 'school_overview' ? '#1e1b4b' : '#ffffff',
                fontWeight: coordinatorView === 'school_overview' ? 700 : 500,
                border: 'none',
                cursor: 'pointer'
              }}
              onClick={() => {
                setCoordinatorView('school_overview')
                setSearchParams((prev) => {
                  const p = new URLSearchParams(prev)
                  p.set('tab', 'overview')
                  return p
                })
              }}
            >
              📊 School-Wide Marks Overview
            </button>
          </div>
        </div>
      )}

      {isCoordinator && coordinatorView === 'school_overview' ? (
        <CoordinatorMarksOverview
          classes={classes}
          subjects={subjects}
          onSelectClassAndSubject={(cId, sId) => {
            setSelectedClassId(cId)
            if (sId) setSelectedSubjectId(sId)
            setCoordinatorView('class_tests')
            setSearchParams((prev) => {
              const p = new URLSearchParams(prev)
              p.set('classId', cId)
              if (sId) p.set('subjectId', sId)
              p.delete('tab')
              return p
            })
          }}
        />
      ) : (
        <>
          <div className="page-head">
        <div>
          <h2>Unit Tests{className ? ` — ${className}` : ''}</h2>
          <p className="muted">{canAdd ? 'Every end-of-unit test you record, with its score sheet.' : 'Read-only view of recorded unit tests.'}</p>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: '8px' }}>
          {selectedClassId && (
            <Link
              to={`/marks/class/${selectedClassId}`}
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
              title="View full tabulated scoresheet for this class"
            >
              <span>📊</span>
              <span>Tabulated Sheet</span>
            </Link>
          )}
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
                {(t.exam_paper_url || t.exam_paper_path) ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => openExamPaper(t)}
                    title={t.exam_paper_name ? `View ${t.exam_paper_name}` : 'View Exam Paper'}
                    style={{ background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe' }}
                  >
                    📄 Exam Paper
                  </button>
                ) : (
                  <span
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontWeight: 600 }}
                    title="No exam paper uploaded. Click Update to attach PDF."
                  >
                    ⚠️ Missing PDF
                  </span>
                )}{' '}
                <Link to={`/marks/${t.class_id}/${t.id}?view=entry`} className="btn btn-small btn-primary">Enter scores</Link>{' '}
                {canEditTest(t) && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => startEditing(t)}
                    style={{ background: '#f1f5f9', color: '#0f172a', borderColor: '#cbd5e1' }}
                  >
                    ✏️ Update
                  </button>
                )}{' '}
                {canDeleteTest && <button className="btn btn-small btn-danger" onClick={() => remove(t)}>Delete</button>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {editingTest && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 16
        }}>
          <form onSubmit={submitEdit} className="card stack" style={{ maxWidth: 540, width: '100%', background: '#fff', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Update Unit Test — {editingTest.subject_name}</h3>
              <button type="button" className="btn btn-ghost btn-small" onClick={cancelEditing}>✕</button>
            </div>

            <label className="field">
              <span>Unit / Topic Name *</span>
              <input
                required
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                placeholder="e.g. Fractions & Decimals"
              />
            </label>

            <div className="grid2">
              <label className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={editForm.test_date}
                  onChange={(e) => setEditForm({ ...editForm, test_date: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Max Mark</span>
                <input
                  type="number"
                  min={1}
                  value={editForm.max_mark}
                  onChange={(e) => setEditForm({ ...editForm, max_mark: e.target.value })}
                />
              </label>
            </div>

            <div className="field">
              <span>Exam Paper (PDF)</span>
              {(editingTest.exam_paper_url || editingTest.exam_paper_path) ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>📄 <strong>{editingTest.exam_paper_name || 'Current Exam Paper'}</strong></span>
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    onClick={() => openExamPaper(editingTest)}
                    style={{ fontSize: 12, padding: '2px 8px' }}
                  >
                    Preview
                  </button>
                </div>
              ) : (
                <div style={{ padding: '8px 12px', background: '#fffbeb', borderRadius: 6, border: '1px solid #fef3c7', marginBottom: 6, fontSize: 13, color: '#92400e' }}>
                  ⚠️ No exam paper attached yet. Upload sample exam paper PDF below:
                </div>
              )}
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null
                  if (file && !file.name.toLowerCase().endsWith('.pdf')) {
                    setError('Exam paper must be a PDF file (.pdf)')
                    setEditExamFile(null)
                    e.target.value = ''
                    return
                  }
                  setError('')
                  setEditExamFile(file)
                }}
              />
              {editExamFile && (
                <span style={{ fontSize: 12, color: 'var(--brand)', marginTop: 4 }}>
                  Selected: {editExamFile.name} ({(editExamFile.size / 1024).toFixed(0)} KB)
                </span>
              )}
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-ghost" onClick={cancelEditing} disabled={editBusy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={editBusy}>
                {editBusy ? 'Saving Changes…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
        </>
      )}
    </div>
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
