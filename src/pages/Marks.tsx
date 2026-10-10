import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/report'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can, hasRole, isCoordinatorOrLeadership } from '../lib/permissions'
import ClassPicker from '../components/ClassPicker'
import CoordinatorMarksOverview from '../components/CoordinatorMarksOverview'
import type { Assignment, ClassMarksLock, UnitTest, AssessmentType } from '../lib/types'

export default function Marks() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { selectedClassId, classes, subjects, school, setSelectedClassId } = useSchool()
  const { profile } = useAuth()
  const [tests, setTests] = useState<UnitTest[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [lockInfo, setLockInfo] = useState<ClassMarksLock | null>(null)
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('')
  const [selectedAssessmentType, setSelectedAssessmentType] = useState<'all' | 'unit_test' | 'midterm' | 'exam'>('all')
  const [downloadingSubjectId, setDownloadingSubjectId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [uploadingForTestId, setUploadingForTestId] = useState<string | null>(null)
  const quickUploadRef = useRef<HTMLInputElement | null>(null)
  const targetTestForUpload = useRef<UnitTest | null>(null)
  const [form, setForm] = useState<{ subject_id: string; title: string; test_date: string; max_mark: string; assessment_type: AssessmentType }>({
    subject_id: '',
    title: '',
    test_date: today(),
    max_mark: '100',
    assessment_type: 'unit_test'
  })
  const [examPaperFile, setExamPaperFile] = useState<File | null>(null)
  const [editingTest, setEditingTest] = useState<UnitTest | null>(null)
  const [editForm, setEditForm] = useState<{ title: string; test_date: string; max_mark: string; assessment_type: AssessmentType }>({
    title: '',
    test_date: today(),
    max_mark: '100',
    assessment_type: 'unit_test'
  })
  const [editExamFile, setEditExamFile] = useState<File | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [busy, setBusy] = useState(false)

  // One-Button School-Wide Exam Modal State
  const [showSchoolExamModal, setShowSchoolExamModal] = useState(false)
  const [schoolExamSemester, setSchoolExamSemester] = useState('1')
  const [schoolExamName, setSchoolExamName] = useState('')
  const [schoolExamDate, setSchoolExamDate] = useState(today())
  const [schoolExamMaxMark, setSchoolExamMaxMark] = useState('100')
  const [creatingSchoolExam, setCreatingSchoolExam] = useState(false)

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
    if (!selectedClassId) {
      setTests([])
      setAssignments([])
      setLockInfo(null)
      return
    }
    api.listUnitTests(selectedClassId).then(setTests).catch((e) => setError(e.message))
    api.listAssignments(selectedClassId).then(setAssignments).catch(() => {})
    api.getClassMarksLock(selectedClassId).then(setLockInfo).catch(() => setLockInfo(null))
  }

  useEffect(reload, [selectedClassId])

  const isCoordinatorLead = isCoordinatorOrLeadership(profile)
  const isClassLocked = Boolean(lockInfo?.is_locked)

  // A test is locked if:
  // 1. It is explicitly locked individually (t.is_locked), OR
  // 2. The whole class is locked and this test was created before the class lock timestamp.
  const isTestLocked = (t: UnitTest) => {
    if (isCoordinatorLead) return false // Coordinators/HOS can always edit and unlock
    if (t.is_locked) return true
    if (!lockInfo?.is_locked) return false
    if (!lockInfo.locked_at || !t.created_at) return true
    return new Date(t.created_at).getTime() <= new Date(lockInfo.locked_at).getTime()
  }

  const toggleLockTest = async (t: UnitTest) => {
    if (!isCoordinatorLead) {
      setError('Only Curriculum Coordinators and the Head of School can lock or unlock specific exams.')
      return
    }
    setError('')
    try {
      if (t.is_locked) {
        await api.unlockUnitTest(t.id)
        setSuccessMsg(`"${t.title}" marks unlocked successfully. Subject teachers can now enter marks.`)
      } else {
        await api.lockUnitTest(t.id, 'Locked by Leadership')
        setSuccessMsg(`"${t.title}" marks locked successfully. Teachers cannot modify scores.`)
      }
      reload()
    } catch (err: any) {
      setError(err.message || 'Failed to toggle exam lock.')
    }
  }

  const handleCreateSchoolExam = async (e: FormEvent) => {
    e.preventDefault()
    if (!schoolExamName.trim()) {
      setError('Please enter the exam name.')
      return
    }
    setError('')
    setCreatingSchoolExam(true)
    try {
      const res = await api.createSchoolExamAcrossAllClasses({
        title: schoolExamName.trim(),
        semester: schoolExamSemester,
        test_date: schoolExamDate,
        max_mark: Number(schoolExamMaxMark) || 100
      })
      setSuccessMsg(`Exam "${schoolExamName.trim()}" successfully created for all ${res.classesCount} classes and ${res.subjectsCount} subjects (${res.testsCreated} exam records generated)! Teachers can now set max marks, upload exam PDFs, and enter scores.`)
      setShowSchoolExamModal(false)
      setSchoolExamName('')
      reload()
    } catch (err: any) {
      setError(err.message || 'Failed to create school exam.')
    } finally {
      setCreatingSchoolExam(false)
    }
  }

  const isLeadership = hasRole(profile?.role, 'head_of_school', profile?.additional_roles)
    || hasRole(profile?.role, 'curriculum_coordinator', profile?.additional_roles)
    || hasRole(profile?.role, 'admin', profile?.additional_roles)
  const isHomeroom = hasRole(profile?.role, 'homeroom_teacher', profile?.additional_roles)
  const isOwnClass = isHomeroom && !!profile?.class_id && profile.class_id === selectedClassId
  const myAssignments = assignments.filter((a) => a.teacher_id === profile?.id)
  const mySubjects = isOwnClass || isLeadership
    ? subjects
    : subjects.filter((s) => myAssignments.some((a) => a.subject_id === s.id))

  const canCreateLeadershipExams = isLeadership

  // Teachers create End of Unit Tests; Leadership can create any exam (Unit Test, Midterm, School Exam)
  const canAdd = roleCanAdd && (
    isLeadership
    || isOwnClass
    || mySubjects.length > 0
  )

  const canEditTest = (test: UnitTest) => !isTestLocked(test) && (
    isLeadership
    || (isOwnClass && test.class_id === profile?.class_id)
    || myAssignments.some((a) => a.class_id === test.class_id && a.subject_id === test.subject_id)
    || test.created_by === profile?.id
  )
  const canDeleteTest = (test: UnitTest) => !isTestLocked(test) && can(profile?.role, 'deleteTests', profile?.additional_roles)

  const triggerUploadForTest = (t: UnitTest) => {
    targetTestForUpload.current = t
    quickUploadRef.current?.click()
  }

  const handleQuickUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const t = targetTestForUpload.current
    if (!file || !t) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Exam paper must be a PDF file (.pdf)')
      e.target.value = ''
      return
    }
    setError('')
    setUploadingForTestId(t.id)
    try {
      await api.updateUnitTest(t.id, { examPaperFile: file })
      reload()
    } catch (err: any) {
      setError(err.message || 'Failed to upload exam paper PDF.')
    } finally {
      setUploadingForTestId(null)
      targetTestForUpload.current = null
      if (quickUploadRef.current) quickUploadRef.current.value = ''
    }
  }

  const startEditing = (t: UnitTest) => {
    setEditingTest(t)
    setEditForm({
      title: t.title,
      test_date: t.test_date,
      max_mark: String(t.max_mark),
      assessment_type: t.assessment_type || 'unit_test'
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
    if (editingTest && isTestLocked(editingTest)) {
      setError('Marks and assessments for this test are locked because reports have been downloaded. Only Curriculum Coordinators can edit tests.')
      return
    }
    if (!editingTest || !editForm.title.trim()) {
      setError('Title / Topic name cannot be empty.')
      return
    }
    if (!canCreateLeadershipExams && editForm.assessment_type !== 'unit_test' && editingTest.assessment_type !== editForm.assessment_type) {
      setError('Only the Head of School and Curriculum Coordinators can set or change assessment type to Midterm or School Exam. Teachers only create End of Unit Tests.')
      return
    }
    setError('')
    setEditBusy(true)
    try {
      await api.updateUnitTest(editingTest.id, {
        title: editForm.title.trim(),
        test_date: editForm.test_date,
        max_mark: Number(editForm.max_mark) || 100,
        assessment_type: editForm.assessment_type,
        examPaperFile: editExamFile
      })
      setEditingTest(null)
      setEditExamFile(null)
      reload()
    } catch (err: any) {
      setError(err.message || 'Failed to update test.')
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
      setError('Choose a subject and enter an assessment title / unit topic.')
      return
    }
    if (!canCreateLeadershipExams && form.assessment_type !== 'unit_test') {
      setError('Teachers can only create End of Unit Tests. Midterm and other exams must be created by the Head of School or Curriculum Coordinators.')
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
        assessment_type: form.assessment_type,
        examPaperFile: examPaperFile || null
      })
      setForm({ subject_id: '', title: '', test_date: today(), max_mark: '100', assessment_type: 'unit_test' })
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
    if (isTestLocked(t)) {
      setError('Marks and assessments for this test are locked because reports have been downloaded. Only Curriculum Coordinators can delete tests.')
      return
    }
    if (!canDeleteTest(t)) {
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

  const totalUnitTestsCount = tests.filter((t) => (t.assessment_type || 'unit_test') === 'unit_test').length
  const totalMidtermsCount = tests.filter((t) => t.assessment_type === 'midterm').length
  const totalExamsCount = tests.filter((t) => t.assessment_type === 'exam').length

  // Filter tests if a subject and/or assessment type is selected
  const visibleTests = tests.filter((t) => {
    if (selectedSubjectId && t.subject_id !== selectedSubjectId) return false
    if (selectedAssessmentType !== 'all' && (t.assessment_type || 'unit_test') !== selectedAssessmentType) return false
    return true
  })

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
          <h2>Assessments & Scores{className ? ` — ${className}` : ''}</h2>
          <p className="muted">{canAdd ? 'Manage end-of-unit tests and school-wide exams, upload question papers, and record scores.' : 'Read-only view of recorded unit tests and exams.'}</p>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {canCreateLeadershipExams && (
            <button
              type="button"
              className="btn btn-primary"
              style={{
                background: 'linear-gradient(135deg, #4338ca 0%, #6366f1 100%)',
                borderColor: '#4338ca',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 6px rgba(99, 102, 241, 0.35)'
              }}
              onClick={() => {
                setSchoolExamSemester(school?.semester || '1')
                setShowSchoolExamModal(true)
              }}
              title="Leadership One-Button Exam Creation: Schedules an exam for all classes and all subjects at once"
            >
              <span>🏛️</span>
              <span>Create School Exam</span>
            </button>
          )}
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
            <button className="btn btn-secondary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Close form' : '+ New Unit Test'}
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="notice notice-success" style={{ marginBottom: 14 }}>
          {successMsg}
          <button type="button" className="btn btn-ghost btn-small" style={{ marginLeft: 8 }} onClick={() => setSuccessMsg('')}>✕</button>
        </div>
      )}

      {/* Marks Lock Notification */}
      {selectedClassId && lockInfo?.is_locked && (
        <div
          style={{
            background: isCoordinatorLead ? '#eff6ff' : '#fff1f2',
            border: `1.5px solid ${isCoordinatorLead ? '#93c5fd' : '#fda4af'}`,
            borderRadius: '12px',
            padding: '14px 18px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>🔒</span>
            <div>
              <div style={{ fontWeight: 700, color: isCoordinatorLead ? '#1e40af' : '#9f1239', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Marks Locked for Existing Tests</span>
                <span style={{ fontSize: '11px', background: isCoordinatorLead ? '#dbeafe' : '#ffe4e6', color: isCoordinatorLead ? '#1e40af' : '#9f1239', padding: '1px 8px', borderRadius: '10px' }}>
                  {isCoordinatorLead ? 'Coordinator Access' : 'Existing Tests Locked'}
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: isCoordinatorLead ? '#1e3a8a' : '#881337' }}>
                Reports for {className || 'this class'} were downloaded{lockInfo.locked_at ? ` on ${new Date(lockInfo.locked_at).toLocaleDateString()}` : ''}{lockInfo.locked_by_name ? ` by ${lockInfo.locked_by_name}` : ''}. Marks for tests created prior to download are locked. You can still create new tests and enter marks for them.
              </p>
            </div>
          </div>
          {isCoordinatorLead && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ borderColor: '#3b82f6', color: '#1d4ed8', fontWeight: 600, background: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={async () => {
                if (!confirm(`Unlock marks and assessments for ${className || 'this class'}? Subject teachers will be able to edit scores and tests again.`)) return
                try {
                  await api.unlockClassMarks(selectedClassId)
                  reload()
                } catch (e: any) {
                  setError(e.message)
                }
              }}
            >
              <span>🔓</span>
              <span>Unlock Class Marks</span>
            </button>
          )}
        </div>
      )}

      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', background: 'var(--bg-subtle, #f1f5f9)', padding: '3px', borderRadius: '8px', border: '1px solid var(--line, #e2e8f0)', gap: '2px' }}>
            <button
              type="button"
              className="btn btn-small"
              style={{
                background: selectedAssessmentType === 'all' ? '#ffffff' : 'transparent',
                color: selectedAssessmentType === 'all' ? 'var(--fg, #0f172a)' : 'var(--muted, #64748b)',
                boxShadow: selectedAssessmentType === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                fontWeight: selectedAssessmentType === 'all' ? 700 : 500,
                border: 'none',
                cursor: 'pointer'
              }}
              onClick={() => setSelectedAssessmentType('all')}
            >
              All ({tests.length})
            </button>
            <button
              type="button"
              className="btn btn-small"
              style={{
                background: selectedAssessmentType === 'unit_test' ? '#ffffff' : 'transparent',
                color: selectedAssessmentType === 'unit_test' ? '#0369a1' : 'var(--muted, #64748b)',
                boxShadow: selectedAssessmentType === 'unit_test' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                fontWeight: selectedAssessmentType === 'unit_test' ? 700 : 500,
                border: 'none',
                cursor: 'pointer'
              }}
              onClick={() => setSelectedAssessmentType('unit_test')}
            >
              📘 Unit Tests ({totalUnitTestsCount})
            </button>
            <button
              type="button"
              className="btn btn-small"
              style={{
                background: selectedAssessmentType === 'exam' ? '#ffffff' : 'transparent',
                color: selectedAssessmentType === 'exam' ? '#c2410c' : 'var(--muted, #64748b)',
                boxShadow: selectedAssessmentType === 'exam' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                fontWeight: selectedAssessmentType === 'exam' ? 700 : 500,
                border: 'none',
                cursor: 'pointer'
              }}
              onClick={() => setSelectedAssessmentType('exam')}
            >
              📝 School Exams ({totalExamsCount})
            </button>
          </div>

          <div className="row" style={{ alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Subject:</label>
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

      {/* Hidden file input for quick exam paper upload */}
      <input
        type="file"
        ref={quickUploadRef}
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={handleQuickUpload}
      />

      {showForm && canAdd && (
        <form onSubmit={submit} className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>
              {form.assessment_type === 'midterm'
                ? 'New Midterm Exam'
                : form.assessment_type === 'exam'
                ? 'New School / Terminal Exam'
                : 'New End of Unit Test'}
            </h3>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Class: <strong>{className}</strong></span>
          </div>

          <div className="field">
            <span style={{ fontWeight: 600, fontSize: 13 }}>Assessment Type *</span>
            {!canCreateLeadershipExams ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '2px solid #0284c7',
                  background: '#f0f9ff',
                  color: '#0369a1',
                  fontWeight: 600,
                  fontSize: 13
                }}>
                  📘 End of Unit Test
                </div>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  (Teachers create End of Unit Tests. Midterm and school exams are scheduled by Leadership)
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: form.assessment_type === 'unit_test' ? '2px solid #0284c7' : '1px solid #cbd5e1',
                  background: form.assessment_type === 'unit_test' ? '#f0f9ff' : '#fff',
                  boxShadow: form.assessment_type === 'unit_test' ? '0 1px 3px rgba(2,132,199,0.15)' : 'none'
                }}>
                  <input
                    type="radio"
                    name="create_assessment_type"
                    value="unit_test"
                    checked={form.assessment_type === 'unit_test'}
                    onChange={() => setForm({ ...form, assessment_type: 'unit_test' })}
                  />
                  <span style={{ fontWeight: 600, color: '#0369a1' }}>📘 End of Unit Test</span>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: form.assessment_type === 'exam' ? '2px solid #ea580c' : '1px solid #cbd5e1',
                  background: form.assessment_type === 'exam' ? '#fff7ed' : '#fff',
                  boxShadow: form.assessment_type === 'exam' ? '0 1px 3px rgba(234,88,12,0.15)' : 'none'
                }}>
                  <input
                    type="radio"
                    name="create_assessment_type"
                    value="exam"
                    checked={form.assessment_type === 'exam'}
                    onChange={() => setForm({ ...form, assessment_type: 'exam' })}
                  />
                  <span style={{ fontWeight: 700, color: '#c2410c' }}>📝 School Exam (Leadership)</span>
                </label>
              </div>
            )}
          </div>
          <div className="grid4">
            <label className="field"><span>Subject *</span>
              <select required value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                <option value="">Choose…</option>
                {mySubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{form.assessment_type === 'unit_test' ? 'Unit / Topic *' : 'Exam Title (Any name of your choice) *'}</span>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={
                  form.assessment_type === 'midterm'
                    ? 'e.g. Midterm Exam - Semester 1'
                    : form.assessment_type === 'exam'
                    ? 'e.g. End of Term Exam, Mock Exam, Checkpoint Paper'
                    : 'e.g. Fractions & Decimals'
                }
              />
            </label>
            <label className="field"><span>Date</span>
              <input type="date" value={form.test_date} onChange={(e) => setForm({ ...form, test_date: e.target.value })} />
            </label>
            <label className="field"><span>Max mark</span>
              <input type="number" min={1} value={form.max_mark} onChange={(e) => setForm({ ...form, max_mark: e.target.value })} />
            </label>
          </div>
          <div className="field" style={{ maxWidth: 480 }}>
            <span>Exam Paper (PDF) <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>(Required before entering marks)</span></span>
            <input
              type="file"
              accept="application/pdf,.pdf"
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
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create assessment & enter scores'}</button>
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
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <strong>{t.title}</strong>
                  {t.assessment_type === 'exam' || t.assessment_type === 'midterm' ? (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#ffedd5', color: '#c2410c', border: '1px solid #fed7aa', fontWeight: 700 }}>
                      📝 School Exam
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontWeight: 600 }}>
                      📘 Unit Test
                    </span>
                  )}
                  {t.is_locked ? (
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', fontWeight: 600 }} title="Locked individually by Leadership">
                      🔒 Exam Locked
                    </span>
                  ) : isTestLocked(t) ? (
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>
                      🔒 Class Locked
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#ecfdf5', color: '#065f46', fontWeight: 600 }}>
                      🔓 Open
                    </span>
                  )}
                </div>
                <span className="muted"> {fmtDate(t.test_date)} · Max {t.max_mark}</span>
              </div>
              <div className="list-actions">
                {isCoordinatorLead && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => toggleLockTest(t)}
                    title={t.is_locked ? "Click to unlock marks entry for teachers" : "Click to lock marks entry for teachers"}
                    style={{
                      background: t.is_locked ? '#fef2f2' : '#f0fdf4',
                      color: t.is_locked ? '#991b1b' : '#166534',
                      borderColor: t.is_locked ? '#fecaca' : '#bbf7d0',
                      fontWeight: 600
                    }}
                  >
                    {t.is_locked ? '🔓 Unlock Exam' : '🔒 Lock Exam'}
                  </button>
                )}
                {(t.exam_paper_url || t.exam_paper_path) ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => openExamPaper(t)}
                      title={t.exam_paper_name ? `View ${t.exam_paper_name}` : 'View Exam Paper'}
                      style={{ background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe' }}
                    >
                      📄 Exam Paper
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => triggerUploadForTest(t)}
                      disabled={uploadingForTestId === t.id}
                      title="Replace exam paper PDF"
                      style={{ background: '#f8fafc', color: '#475569', borderColor: '#cbd5e1' }}
                    >
                      🔄 {uploadingForTestId === t.id ? 'Uploading…' : 'Replace PDF'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => triggerUploadForTest(t)}
                    disabled={uploadingForTestId === t.id}
                    title="Teachers are required to upload a PDF copy of this exam paper before recording marks"
                    style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a', fontWeight: 700 }}
                  >
                    ⚠️ {uploadingForTestId === t.id ? 'Uploading PDF…' : 'Upload PDF (Required)'}
                  </button>
                )}{' '}
                <Link
                  to={`/marks/${t.class_id}/${t.id}?view=${isTestLocked(t) ? 'marksheet' : 'entry'}`}
                  className="btn btn-small btn-primary"
                >
                  {isTestLocked(t) ? 'View scores' : 'Enter scores'}
                </Link>{' '}
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
                {canDeleteTest(t) && <button className="btn btn-small btn-danger" onClick={() => remove(t)}>Delete</button>}
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
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '12px'
        }}>
          <form
            onSubmit={submitEdit}
            className="card stack"
            style={{
              maxWidth: 480,
              width: '100%',
              maxHeight: 'calc(100vh - 32px)',
              display: 'flex',
              flexDirection: 'column',
              background: '#fff',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              borderRadius: 12,
              padding: 0,
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                Update Assessment — {editingTest.subject_name}
              </h3>
              <button type="button" className="btn btn-ghost btn-small" onClick={cancelEditing} style={{ padding: '2px 8px' }}>✕</button>
            </div>

            {/* Scrollable Body */}
            <div style={{ padding: '16px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>Assessment Type *</span>
                {!canCreateLeadershipExams ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      fontWeight: 600,
                      fontSize: 12.5
                    }}>
                      {editForm.assessment_type === 'exam' || editForm.assessment_type === 'midterm' ? '📝 School Exam' : '📘 End of Unit Test'}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>(Managed by Leadership)</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      padding: '5px 12px',
                      borderRadius: 6,
                      border: editForm.assessment_type === 'unit_test' ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      background: editForm.assessment_type === 'unit_test' ? '#f0f9ff' : '#fff',
                      fontSize: 12.5
                    }}>
                      <input
                        type="radio"
                        name="edit_assessment_type"
                        value="unit_test"
                        checked={editForm.assessment_type === 'unit_test'}
                        onChange={() => setEditForm({ ...editForm, assessment_type: 'unit_test' })}
                      />
                      <span style={{ fontWeight: 600, color: '#0369a1' }}>📘 Unit Test</span>
                    </label>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      padding: '5px 12px',
                      borderRadius: 6,
                      border: editForm.assessment_type === 'exam' ? '2px solid #ea580c' : '1px solid #cbd5e1',
                      background: editForm.assessment_type === 'exam' ? '#fff7ed' : '#fff',
                      fontSize: 12.5
                    }}>
                      <input
                        type="radio"
                        name="edit_assessment_type"
                        value="exam"
                        checked={editForm.assessment_type === 'exam'}
                        onChange={() => setEditForm({ ...editForm, assessment_type: 'exam' })}
                      />
                      <span style={{ fontWeight: 700, color: '#c2410c' }}>📝 School Exam</span>
                    </label>
                  </div>
                )}
              </div>

              <label className="field">
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{editForm.assessment_type === 'unit_test' ? 'Unit / Topic Name *' : 'Exam Title *'}</span>
                <input
                  required
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  placeholder={editForm.assessment_type === 'exam' ? 'e.g. Midterm Examination, Final Term Exam' : 'e.g. Fractions & Decimals'}
                  style={{ padding: '6px 10px', fontSize: 13 }}
                />
              </label>

              <div className="grid2">
                <label className="field">
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>Date</span>
                  <input
                    type="date"
                    value={editForm.test_date}
                    onChange={(e) => setEditForm({ ...editForm, test_date: e.target.value })}
                    style={{ padding: '6px 10px', fontSize: 13 }}
                  />
                </label>
                <label className="field">
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>Max Mark</span>
                  <input
                    type="number"
                    min={1}
                    value={editForm.max_mark}
                    onChange={(e) => setEditForm({ ...editForm, max_mark: e.target.value })}
                    style={{ padding: '6px 10px', fontSize: 13 }}
                  />
                </label>
              </div>

              <div className="field">
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Exam Paper (PDF)</span>
                {(editingTest.exam_paper_url || editingTest.exam_paper_path) ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                      📄 <strong>{editingTest.exam_paper_name || 'Current Exam Paper'}</strong>
                    </span>
                    <button
                      type="button"
                      className="btn btn-small btn-ghost"
                      onClick={() => openExamPaper(editingTest)}
                      style={{ fontSize: 11.5, padding: '2px 8px' }}
                    >
                      Preview
                    </button>
                  </div>
                ) : (
                  <div style={{ padding: '6px 10px', background: '#fffbeb', borderRadius: 6, border: '1px solid #fef3c7', fontSize: 12, color: '#92400e' }}>
                    ⚠️ No exam paper attached yet.
                  </div>
                )}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  style={{ marginTop: 4, fontSize: 12 }}
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
                  <span style={{ fontSize: 11.5, color: 'var(--brand)', marginTop: 2 }}>
                    Selected: {editExamFile.name} ({(editExamFile.size / 1024).toFixed(0)} KB)
                  </span>
                )}
              </div>
            </div>

            {/* Sticky Accessible Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <button type="button" className="btn btn-ghost btn-small" onClick={cancelEditing} disabled={editBusy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={editBusy}>
                {editBusy ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Leadership One-Button School-Wide Exam Creation Modal */}
      {showSchoolExamModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100,
          padding: '12px'
        }}>
          <form
            onSubmit={handleCreateSchoolExam}
            className="card stack"
            style={{
              maxWidth: 460,
              width: '100%',
              maxHeight: 'calc(100vh - 32px)',
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              borderRadius: 12,
              padding: 0,
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', padding: '12px 18px', background: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>🏛️</span>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1e1b4b' }}>
                  Create School-Wide Exam
                </h3>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setShowSchoolExamModal(false)}
                disabled={creatingSchoolExam}
                style={{ fontSize: 14, padding: '2px 8px' }}
              >
                ✕
              </button>
            </div>

            {/* Scrollable Form Body */}
            <div style={{ padding: '14px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 11 }}>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
                Schedules this exam across <strong>all classes and all subjects</strong> at once.
              </p>

              <div className="field">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>Semester *</span>
                <select
                  required
                  value={schoolExamSemester}
                  onChange={(e) => setSchoolExamSemester(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 13 }}
                >
                  <option value="1">Semester 1</option>
                  <option value="2">Semester 2</option>
                </select>
              </div>

              <div className="field">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>Exam Name (Any name of your choice) *</span>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Midterm Examination, Final Term Exam, Mock Exam"
                  value={schoolExamName}
                  onChange={(e) => setSchoolExamName(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 13 }}
                />
              </div>

              <div className="grid2">
                <div className="field">
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>Exam Date</span>
                  <input
                    type="date"
                    value={schoolExamDate}
                    onChange={(e) => setSchoolExamDate(e.target.value)}
                    style={{ padding: '6px 10px', fontSize: 13 }}
                  />
                </div>
                <div className="field">
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>Default Max Mark</span>
                  <input
                    type="number"
                    min={1}
                    value={schoolExamMaxMark}
                    onChange={(e) => setSchoolExamMaxMark(e.target.value)}
                    style={{ padding: '6px 10px', fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 11.5,
                color: '#475569',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6
              }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>ℹ️</span>
                <span>
                  <strong>Subject Teachers will:</strong> Upload their exam PDF and can adjust their subject's Max Mark before recording scores.
                </span>
              </div>
            </div>

            {/* Sticky Accessible Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setShowSchoolExamModal(false)}
                disabled={creatingSchoolExam}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-small"
                disabled={creatingSchoolExam || !schoolExamName.trim()}
                style={{
                  background: 'linear-gradient(135deg, #4338ca 0%, #6366f1 100%)',
                  borderColor: '#4338ca',
                  fontWeight: 700
                }}
              >
                {creatingSchoolExam ? 'Creating…' : 'Create for All Classes'}
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
