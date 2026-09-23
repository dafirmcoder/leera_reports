import React, { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can, getTeacherHomeroomClasses, isHomeroomTeacher } from '../lib/permissions'
import LeeraLoader from '../components/LeeraLoader'
import { downloadMarksheetExcel, downloadMarksheetCsv } from '../lib/marksheetExport'
import type { Assignment, Student, UnitTest } from '../lib/types'

export default function ClassMarksheetPage() {
  const { classId } = useParams<{ classId: string }>()
  const navigate = useNavigate()
  const { classes, school } = useSchool()
  const { profile } = useAuth()

  // Marksheet broadsheet is accessible to Director, Admin, Head of School, Curriculum Coordinator, and Homeroom Teachers (for their class only)
  const canViewAllClasses =
    profile?.role === 'director' ||
    profile?.role === 'admin' ||
    Boolean(
      profile && (
        can(profile.role, 'viewDirectorDashboard', profile.additional_roles) ||
        can(profile.role, 'viewAllClasses', profile.additional_roles)
      )
    )

  const isHomeroom = isHomeroomTeacher(profile, classes)
  const myHomeroomClasses = getTeacherHomeroomClasses(profile, classes)
  const isHomeroomOnly = !canViewAllClasses && isHomeroom

  // Access check: Only leadership and homeroom teachers can access this tabulated sheet
  if (profile && !canViewAllClasses && !isHomeroom) {
    return <Navigate to="/dashboard" replace />
  }

  // Determine target class ID
  let targetClassId = ''
  if (isHomeroomOnly) {
    if (myHomeroomClasses.length > 0) {
      const match = myHomeroomClasses.find((c) => c.id === classId)
      targetClassId = match ? match.id : myHomeroomClasses[0].id
    } else if (profile?.class_id) {
      targetClassId = profile.class_id
    }
  } else {
    targetClassId = classId || classes[0]?.id || ''
  }

  const currentClassId = targetClassId
  const currentClass = classes.find((c) => c.id === currentClassId)

  // Redirect homeroom teachers if they try to access a class outside their homeroom assignment
  useEffect(() => {
    if (isHomeroomOnly && targetClassId && classId !== targetClassId) {
      navigate(`/marks/class/${targetClassId}`, { replace: true })
    }
  }, [isHomeroomOnly, targetClassId, classId, navigate])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [tests, setTests] = useState<UnitTest[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [scoresMap, setScoresMap] = useState<Record<string, Record<string, number | null>>>({})
  const [studentSearch, setStudentSearch] = useState('')
  const [displayMode, setDisplayMode] = useState<'pct' | 'raw' | 'both'>('pct')
  const [exporting, setExporting] = useState<'excel' | 'csv' | null>(null)

  const isDirector = profile?.role === 'director'

  const loadClassData = async () => {
    if (!currentClassId) return
    setLoading(true)
    setError('')
    try {
      const [studentsData, testsData, assignmentsData] = await Promise.all([
        api.listStudents(currentClassId),
        api.listUnitTests(currentClassId),
        api.listAssignments(currentClassId).catch(() => [] as Assignment[])
      ])

      // Sort tests chronologically
      const sortedTests = [...testsData].sort((a, b) =>
        a.test_date.localeCompare(b.test_date) || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
      )

      // Fetch scores for all tests in this class using optimized batch query
      const testIds = sortedTests.map((t) => t.id)
      const allScores = testIds.length > 0 ? await api.listScoresForTests(testIds) : []

      const scoreLookup: Record<string, Record<string, number | null>> = {}
      sortedTests.forEach((t) => {
        scoreLookup[t.id] = {}
      })
      allScores.forEach((sc) => {
        if (sc.score !== null && sc.score !== undefined && scoreLookup[sc.unit_test_id]) {
          scoreLookup[sc.unit_test_id][sc.student_id] = Number(sc.score)
        }
      })

      // Sort students naturally by Roll No or Name
      const sortedStudents = [...studentsData].sort((a, b) => {
        const rollA = a.roll_no || a.student_no || a.admission_no || ''
        const rollB = b.roll_no || b.student_no || b.admission_no || ''
        if (rollA && rollB) {
          const comp = rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: 'base' })
          if (comp !== 0) return comp
        }
        return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })
      })

      setStudents(sortedStudents)
      setTests(sortedTests)
      setAssignments(assignmentsData)
      setScoresMap(scoreLookup)
    } catch (err: any) {
      setError(err?.message || 'Failed to load class marksheet data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClassData()
  }, [currentClassId])

  // Group tests by subject and combine with assignments
  const subjectsWithTests = useMemo(() => {
    // Collect all unique subject IDs from assignments and tests
    const subjectMap = new Map<string, {
      subject_id: string
      subject_name: string
      teacher_name: string
      tests: UnitTest[]
    }>()

    // Add from assignments
    assignments.forEach((a) => {
      if (!subjectMap.has(a.subject_id)) {
        subjectMap.set(a.subject_id, {
          subject_id: a.subject_id,
          subject_name: a.subject_name,
          teacher_name: a.teacher_name || '',
          tests: []
        })
      }
    })

    // Add from tests
    tests.forEach((t) => {
      const existing = subjectMap.get(t.subject_id)
      if (existing) {
        existing.tests.push(t)
      } else {
        subjectMap.set(t.subject_id, {
          subject_id: t.subject_id,
          subject_name: t.subject_name || 'Subject',
          teacher_name: '',
          tests: [t]
        })
      }
    })

    // Sort subjects alphabetically
    const list = Array.from(subjectMap.values()).filter((s) => s.tests.length > 0 || assignments.some((a) => a.subject_id === s.subject_id))
    return list.sort((a, b) => a.subject_name.localeCompare(b.subject_name, undefined, { sensitivity: 'base' }))
  }, [assignments, tests])

  // Filter students if searching
  const filteredStudents = useMemo(() => {
    if (!studentSearch.trim()) return students
    const q = studentSearch.toLowerCase()
    return students.filter((s) =>
      s.full_name.toLowerCase().includes(q) ||
      (s.roll_no && s.roll_no.toLowerCase().includes(q)) ||
      (s.admission_no && s.admission_no.toLowerCase().includes(q)) ||
      (s.student_no && s.student_no.toLowerCase().includes(q))
    )
  }, [students, studentSearch])

  // Compute student scores, subject averages, and aggregate
  const studentMetrics = useMemo(() => {
    const map = new Map<string, {
      subjectAverages: Record<string, number | null>
      overallAggregatePct: number | null
    }>()

    students.forEach((st) => {
      const subjectAverages: Record<string, number | null> = {}
      const validSubjectAverages: number[] = []

      subjectsWithTests.forEach((sub) => {
        const testPcts: number[] = []
        sub.tests.forEach((t) => {
          const raw = scoresMap[t.id]?.[st.id]
          if (raw !== undefined && raw !== null && t.max_mark > 0) {
            const pct = (raw / t.max_mark) * 100
            testPcts.push(pct)
          }
        })

        if (testPcts.length > 0) {
          const avg = Number((testPcts.reduce((a, b) => a + b, 0) / testPcts.length).toFixed(1))
          subjectAverages[sub.subject_id] = avg
          validSubjectAverages.push(avg)
        } else {
          subjectAverages[sub.subject_id] = null
        }
      })

      const overall = validSubjectAverages.length > 0
        ? Number((validSubjectAverages.reduce((a, b) => a + b, 0) / validSubjectAverages.length).toFixed(1))
        : null

      map.set(st.id, { subjectAverages, overallAggregatePct: overall })
    })

    return map
  }, [students, subjectsWithTests, scoresMap])

  // Class unit test averages and overall subject averages
  const classAverages = useMemo(() => {
    const unitAverages: Record<string, number | null> = {}
    const subjectAverages: Record<string, number | null> = {}
    const allAggregates: number[] = []

    tests.forEach((t) => {
      const pcts: number[] = []
      students.forEach((st) => {
        const raw = scoresMap[t.id]?.[st.id]
        if (raw !== undefined && raw !== null && t.max_mark > 0) {
          pcts.push((raw / t.max_mark) * 100)
        }
      })
      unitAverages[t.id] = pcts.length > 0
        ? Number((pcts.reduce((a, b) => a + b, 0) / pcts.length).toFixed(1))
        : null
    })

    subjectsWithTests.forEach((sub) => {
      const avgs: number[] = []
      students.forEach((st) => {
        const avg = studentMetrics.get(st.id)?.subjectAverages[sub.subject_id]
        if (avg !== undefined && avg !== null) avgs.push(avg)
      })
      subjectAverages[sub.subject_id] = avgs.length > 0
        ? Number((avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(1))
        : null
    })

    students.forEach((st) => {
      const agg = studentMetrics.get(st.id)?.overallAggregatePct
      if (agg !== undefined && agg !== null) allAggregates.push(agg)
    })

    const classOverall = allAggregates.length > 0
      ? Number((allAggregates.reduce((a, b) => a + b, 0) / allAggregates.length).toFixed(1))
      : null

    return { unitAverages, subjectAverages, classOverall }
  }, [tests, students, subjectsWithTests, scoresMap, studentMetrics])

  const handleExportExcel = async () => {
    try {
      setExporting('excel')
      await downloadMarksheetExcel({
        className: currentClass?.name || 'Class',
        schoolName: school?.name || 'Leera International School',
        academicYear: school?.academic_year || '2026/2027',
        semester: school?.semester || '1',
        students,
        subjectsWithTests,
        scoresMap,
        studentMetrics,
        classAverages,
        displayMode
      })
    } catch (err: any) {
      console.error('Failed to export Excel marksheet:', err)
      setError(err?.message || 'Failed to generate Excel export.')
    } finally {
      setExporting(null)
    }
  }

  const handleExportCsv = () => {
    try {
      setExporting('csv')
      downloadMarksheetCsv({
        className: currentClass?.name || 'Class',
        schoolName: school?.name || 'Leera International School',
        academicYear: school?.academic_year || '2026/2027',
        semester: school?.semester || '1',
        students,
        subjectsWithTests,
        scoresMap,
        studentMetrics,
        classAverages,
        displayMode
      })
    } catch (err: any) {
      console.error('Failed to export CSV marksheet:', err)
      setError(err?.message || 'Failed to generate CSV export.')
    } finally {
      setExporting(null)
    }
  }

  if (isHomeroomOnly && !targetClassId && classes.length > 0) {
    return (
      <div className="page stack" style={{ padding: '24px' }}>
        <div className="card alert-box" style={{ background: '#fffbeb', borderColor: '#fde68a', padding: '24px' }}>
          <h3 style={{ color: '#92400e', margin: '0 0 8px' }}>No Homeroom Class Assigned</h3>
          <p style={{ color: '#b45309', margin: '0 0 16px' }}>
            You are logged in as a homeroom teacher, but you have not yet been assigned to a homeroom class in the system. Please contact the Head of School.
          </p>
          <Link to="/dashboard" className="btn btn-secondary">
            Return to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page stack class-marksheet-page" style={{ gap: '20px' }}>
      {/* Header & Navigation */}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '20px' }}>{isHomeroomOnly ? '🏫' : '📋'}</span>
            <span style={{
              background: isHomeroomOnly ? '#dcfce7' : '#e0e7ff',
              color: isHomeroomOnly ? '#166534' : '#3730a3',
              padding: '3px 10px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px'
            }}>
              {isHomeroomOnly ? 'HOMEROOM TABULATED CLASS SHEET' : 'EXECUTIVE CLASS MARKSHEET BROADSHEET'}
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800 }}>
            {currentClass?.name || 'Class'} — {isHomeroomOnly ? 'Tabulated Marksheet (All Learners & Scores)' : 'End of Unit Marksheet (Leadership View)'}
          </h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '13px' }}>
            {isHomeroomOnly
              ? `Homeroom: ${currentClass?.name || 'Your Class'} · ${school?.name || 'Leera International School'} · Academic Year ${school?.academic_year || '2026/2027'} · Semester ${school?.semester || '1'}`
              : `${school?.name || 'Leera International School'} · Academic Year ${school?.academic_year || '2026/2027'} · Semester ${school?.semester || '1'}`
            }
          </p>
        </div>

        <div className="class-marksheet-toolbar row" style={{ gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Class Switcher for Leadership / Locked Badge for Homeroom Teachers */}
          {canViewAllClasses ? (
            <label className="field inline" style={{ margin: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Class:</span>
              <select
                value={currentClassId}
                onChange={(e) => navigate(`/dashboard/marks/class/${e.target.value}`)}
                style={{ padding: '6px 12px', borderRadius: '8px', fontWeight: 600 }}
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : myHomeroomClasses.length > 1 ? (
            <label className="field inline" style={{ margin: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>My Class:</span>
              <select
                value={currentClassId}
                onChange={(e) => navigate(`/marks/class/${e.target.value}`)}
                style={{ padding: '6px 12px', borderRadius: '8px', fontWeight: 600 }}
              >
                {myHomeroomClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                padding: '5px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                color: '#1e293b'
              }}
            >
              <span>🏫</span>
              <span>Class: {currentClass?.name || 'My Class'}</span>
            </div>
          )}

          {/* Export to Excel */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={exporting !== null || loading || subjectsWithTests.length === 0}
            onClick={handleExportExcel}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Download full formatted Excel spreadsheet (.xlsx)"
          >
            <span>📊</span>
            <span>{exporting === 'excel' ? 'Exporting…' : 'Export Excel (.xlsx)'}</span>
          </button>

          {/* Export to CSV */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={exporting !== null || loading || subjectsWithTests.length === 0}
            onClick={handleExportCsv}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Download CSV spreadsheet (.csv)"
          >
            <span>📄</span>
            <span>{exporting === 'csv' ? 'Exporting…' : 'Export CSV'}</span>
          </button>

          {/* Print Sheet */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => window.print()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Print sheet or save as PDF"
          >
            <span>🖨️</span>
            <span>Print Sheet</span>
          </button>

          {isHomeroomOnly ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Link
                to="/reports"
                className="btn btn-ghost btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                ← Back to Reports
              </Link>
              <Link
                to="/dashboard"
                className="btn btn-ghost btn-sm"
              >
                Teacher Dashboard
              </Link>
            </div>
          ) : (
            <Link
              to="/dashboard/marks"
              className="btn btn-ghost btn-sm"
            >
              ← Back to Executive Dashboard
            </Link>
          )}
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {/* Summary KPI Cards */}
      <div className="grid4">
        <div className="card stat-box">
          <div className="stat-label">Class Population</div>
          <div className="stat-value">{students.length}</div>
          <div className="stat-meta">
            Homeroom: {currentClass?.homeroom_teacher_name || 'Unassigned'}
          </div>
        </div>

        <div className="card stat-box">
          <div className="stat-label">Total Subjects</div>
          <div className="stat-value">{subjectsWithTests.length}</div>
          <div className="stat-meta">Subjects recorded in this class</div>
        </div>

        <div className="card stat-box">
          <div className="stat-label">Total Unit Tests</div>
          <div className="stat-value" style={{ color: 'var(--brand)' }}>{tests.length}</div>
          <div className="stat-meta">End of unit tests set to date</div>
        </div>

        <div className="card stat-box">
          <div className="stat-label">Class Overall Average</div>
          <div className="stat-value" style={{
            color: classAverages.classOverall !== null
              ? (classAverages.classOverall >= 70 ? '#10b981' : classAverages.classOverall >= 50 ? '#f59e0b' : '#ef4444')
              : '#94a3b8'
          }}>
            {classAverages.classOverall !== null ? `${classAverages.classOverall}%` : '—'}
          </div>
          <div className="stat-meta">Average across all subjects & students</div>
        </div>
      </div>

      {/* Search and Table Filter bar */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <input
          className="search"
          style={{ maxWidth: '280px', margin: 0 }}
          placeholder="Filter by student name or roll no…"
          value={studentSearch}
          onChange={(e) => setStudentSearch(e.target.value)}
        />

        <div className="row" style={{ alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Display Mode Toggle */}
          <div className="display-mode-selector" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Marks View:</span>
            <div className="btn-group" style={{ display: 'inline-flex', background: '#f1f5f9', padding: '2px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <button
                type="button"
                className={`btn btn-sm ${displayMode === 'pct' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', fontWeight: 600 }}
                onClick={() => setDisplayMode('pct')}
              >
                % Percentage
              </button>
              <button
                type="button"
                className={`btn btn-sm ${displayMode === 'raw' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', fontWeight: 600 }}
                onClick={() => setDisplayMode('raw')}
              >
                Raw Marks
              </button>
              <button
                type="button"
                className={`btn btn-sm ${displayMode === 'both' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '3px 9px', fontSize: '11.5px', borderRadius: '6px', fontWeight: 600 }}
                onClick={() => setDisplayMode('both')}
              >
                Both (% & Raw)
              </button>
            </div>
          </div>

          <div className="muted" style={{ fontSize: '12px' }}>
            Showing {filteredStudents.length} of {students.length} students
          </div>
        </div>
      </div>

      {loading ? (
        <LeeraLoader
          message="Loading class marksheet broadsheet…"
          subMessage={`Preparing student marks and subject averages for ${currentClass?.name || 'this class'}`}
          variant="card"
        />
      ) : subjectsWithTests.length === 0 ? (
        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 8px', color: '#475569' }}>No Subjects or Tests Found</h3>
          <p className="muted" style={{ margin: 0, fontSize: '14px' }}>
            No subject assignments or unit tests have been created yet for {currentClass?.name || 'this class'}.
          </p>
        </div>
      ) : (
        /* Entire Class Sheet Table */
        <div className="card" style={{ padding: '0', overflow: 'hidden', borderRadius: '12px', border: '1px solid var(--line)', minWidth: 0, maxWidth: '100%' }}>
          <div className="mobile-scroll-hint">
            <span>👈 Swipe horizontally to view all subjects and unit scores 👉</span>
          </div>
          <div className="table-wrap class-marksheet-table-wrap" style={{ maxHeight: '75vh', overflowX: 'auto', overflowY: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', minWidth: 0, maxWidth: '100%' }}>
            <table
              className="table class-marksheet-table"
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
                {/* Level 1 Super Headers: S/N, Roll No, Student Name, Subject Names, and Overall Aggregate */}
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--line)' }}>
                  <th
                    rowSpan={2}
                    className="col-sticky col-sticky-sn"
                    style={{
                      background: '#f8fafc',
                      width: '45px',
                      minWidth: '45px',
                      padding: '8px',
                      borderRight: '1px solid var(--line)',
                      borderBottom: '2px solid #cbd5e1'
                    }}
                  >
                    S/N
                  </th>
                  <th
                    rowSpan={2}
                    className="col-sticky col-sticky-roll"
                    style={{
                      background: '#f8fafc',
                      minWidth: '95px',
                      padding: '8px',
                      borderRight: '1px solid var(--line)',
                      borderBottom: '2px solid #cbd5e1'
                    }}
                  >
                    Roll No.
                  </th>
                  <th
                    rowSpan={2}
                    className="col-sticky col-sticky-name"
                    style={{
                      background: '#f8fafc',
                      minWidth: '180px',
                      textAlign: 'left',
                      padding: '8px 12px',
                      borderRight: '2px solid #94a3b8',
                      borderBottom: '2px solid #cbd5e1'
                    }}
                  >
                    Student Name
                  </th>

                  {subjectsWithTests.map((sub) => {
                    const colSpan = Math.max(1, sub.tests.length) + 1 // unit tests count + 1 for Subject Average
                    return (
                      <th
                        key={sub.subject_id}
                        colSpan={colSpan}
                        style={{
                          textAlign: 'center',
                          padding: '8px',
                          borderRight: '2px solid #94a3b8',
                          borderBottom: '1px solid var(--line)',
                          background: '#f1f5f9',
                          color: '#0f172a',
                          fontWeight: 800,
                          letterSpacing: '0.3px'
                        }}
                      >
                        <div style={{ fontSize: '13px' }}>{sub.subject_name}</div>
                        {sub.teacher_name && (
                          <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 500, marginTop: '2px' }}>
                            Tr: {sub.teacher_name}
                          </div>
                        )}
                      </th>
                    )
                  })}

                  {/* Last Column: Aggregate View */}
                  <th
                    rowSpan={2}
                    className="col-sticky col-sticky-agg"
                    style={{
                      background: '#e0e7ff',
                      color: '#3730a3',
                      minWidth: '110px',
                      padding: '8px',
                      textAlign: 'center',
                      fontWeight: 800,
                      borderLeft: '2px solid #94a3b8',
                      borderBottom: '2px solid #cbd5e1'
                    }}
                  >
                    <div>Aggregate</div>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: '#4338ca' }}>(Overall Avg %)</div>
                  </th>
                </tr>

                {/* Level 2 Sub Headers: Unit numbers (1, 2, 3...) and Subject Average per subject */}
                <tr style={{ background: '#ffffff', borderBottom: '2px solid #cbd5e1' }}>
                  {subjectsWithTests.map((sub) => (
                    <React.Fragment key={sub.subject_id}>
                      {sub.tests.length === 0 ? (
                        <th
                          key={`${sub.subject_id}_no_tests`}
                          style={{
                            padding: '6px 8px',
                            fontSize: '11px',
                            color: '#94a3b8',
                            fontWeight: 500,
                            minWidth: '55px',
                            borderRight: '1px solid #e2e8f0',
                            borderBottom: '2px solid #cbd5e1'
                          }}
                        >
                          No tests
                        </th>
                      ) : (
                        sub.tests.map((t, idx) => (
                          <th
                            key={t.id}
                            title={`${t.title} (${t.test_date}) • Max: ${t.max_mark}`}
                            style={{
                              padding: '6px 4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              minWidth: displayMode === 'both' ? '64px' : displayMode === 'raw' ? '54px' : '46px',
                              color: '#334155',
                              borderRight: '1px solid #e2e8f0',
                              borderBottom: '2px solid #cbd5e1',
                              background: '#f8fafc',
                              cursor: 'help'
                            }}
                          >
                            <div>{idx + 1}</div>
                            {displayMode !== 'pct' && (
                              <div style={{ fontSize: '9px', fontWeight: 600, color: '#64748b' }}>/{t.max_mark}</div>
                            )}
                          </th>
                        ))
                      )}
                      {/* Subject Average column per student */}
                      <th
                        key={`${sub.subject_id}_avg`}
                        style={{
                          padding: '6px 6px',
                          fontSize: '11px',
                          fontWeight: 800,
                          minWidth: '60px',
                          color: '#0f766e',
                          background: '#f0fdf4',
                          borderRight: '2px solid #94a3b8',
                          borderBottom: '2px solid #cbd5e1'
                        }}
                      >
                        Avg (%)
                      </th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3 + subjectsWithTests.reduce((sum, s) => sum + Math.max(1, s.tests.length) + 1, 0) + 1}
                      style={{ padding: '32px', color: '#94a3b8', textAlign: 'center' }}
                    >
                      No students found in this class.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((st, sIndex) => {
                    const metrics = studentMetrics.get(st.id)
                    const overallPct = metrics?.overallAggregatePct ?? null

                    return (
                      <tr
                        key={st.id}
                        style={{
                          background: sIndex % 2 === 0 ? '#ffffff' : '#fcfdfe',
                          borderBottom: '1px solid #f1f5f9'
                        }}
                      >
                        {/* S/N */}
                        <td
                          className="col-sticky col-sticky-sn"
                          style={{
                            background: sIndex % 2 === 0 ? '#ffffff' : '#fcfdfe',
                            padding: '6px 8px',
                            fontWeight: 600,
                            color: '#64748b',
                            borderRight: '1px solid var(--line)'
                          }}
                        >
                          {sIndex + 1}
                        </td>

                        {/* Roll No */}
                        <td
                          className="mono col-sticky col-sticky-roll"
                          style={{
                            background: sIndex % 2 === 0 ? '#ffffff' : '#fcfdfe',
                            padding: '6px 8px',
                            fontSize: '11px',
                            color: '#475569',
                            borderRight: '1px solid var(--line)'
                          }}
                        >
                          {st.roll_no || st.student_no || st.admission_no || '—'}
                        </td>

                        {/* Student Name */}
                        <td
                          className="col-sticky col-sticky-name"
                          style={{
                            background: sIndex % 2 === 0 ? '#ffffff' : '#fcfdfe',
                            textAlign: 'left',
                            padding: '6px 12px',
                            fontWeight: 700,
                            color: '#1e293b',
                            borderRight: '2px solid #94a3b8',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {st.full_name}
                        </td>

                        {/* Subjects Columns & Unit Count Sub-columns */}
                        {subjectsWithTests.map((sub) => {
                          const subAvg = metrics?.subjectAverages[sub.subject_id] ?? null

                          return (
                            <React.Fragment key={sub.subject_id}>
                              {sub.tests.length === 0 ? (
                                <td
                                  key={`${st.id}_${sub.subject_id}_none`}
                                  style={{
                                    padding: '6px 4px',
                                    color: '#cbd5e1',
                                    fontSize: '11px',
                                    borderRight: '1px solid #f1f5f9'
                                  }}
                                >
                                  —
                                </td>
                              ) : (
                                sub.tests.map((t) => {
                                  const rawScore = scoresMap[t.id]?.[st.id]
                                  const hasScore = rawScore !== undefined && rawScore !== null
                                  const pct = hasScore && t.max_mark > 0
                                    ? Math.round((rawScore / t.max_mark) * 100)
                                    : null

                                  return (
                                    <td
                                      key={`${st.id}_${t.id}`}
                                      style={{
                                        padding: '6px 4px',
                                        fontSize: '11px',
                                        fontWeight: hasScore ? 600 : 400,
                                        color: hasScore ? '#0f172a' : '#cbd5e1',
                                        borderRight: '1px solid #f1f5f9',
                                        background: hasScore
                                          ? (pct! >= 70 ? 'rgba(16, 185, 129, 0.05)' : pct! >= 50 ? 'rgba(245, 158, 11, 0.05)' : 'rgba(239, 68, 68, 0.05)')
                                          : 'transparent'
                                      }}
                                      title={hasScore ? `Raw: ${rawScore}/${t.max_mark} (${pct}%)` : 'No score entered'}
                                    >
                                      {hasScore ? (
                                        displayMode === 'raw' ? (
                                          <span style={{ fontWeight: 600 }}>{rawScore}/{t.max_mark}</span>
                                        ) : displayMode === 'both' ? (
                                          <div>
                                            <span style={{ fontWeight: 700 }}>{pct}%</span>
                                            <span style={{ display: 'block', fontSize: '9px', color: '#64748b', fontWeight: 500 }}>
                                              {rawScore}/{t.max_mark}
                                            </span>
                                          </div>
                                        ) : (
                                          `${pct}%`
                                        )
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                  )
                                })
                              )}

                              {/* Subject Average per student */}
                              <td
                                key={`${st.id}_${sub.subject_id}_avg`}
                                style={{
                                  padding: '6px 6px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  color: subAvg !== null
                                    ? (subAvg >= 70 ? '#047857' : subAvg >= 50 ? '#b45309' : '#b91c1c')
                                    : '#94a3b8',
                                  background: '#f8fafc',
                                  borderRight: '2px solid #94a3b8'
                                }}
                              >
                                {subAvg !== null ? `${subAvg}%` : '—'}
                              </td>
                            </React.Fragment>
                          )
                        })}

                        {/* Last Column: Aggregate View Per Student */}
                        <td
                          className="col-sticky col-sticky-agg"
                          style={{
                            background: sIndex % 2 === 0 ? '#f0f4ff' : '#ebf0ff',
                            padding: '6px 8px',
                            fontSize: '12px',
                            fontWeight: 800,
                            color: overallPct !== null
                              ? (overallPct >= 70 ? '#15803d' : overallPct >= 50 ? '#b45309' : '#b91c1c')
                              : '#94a3b8',
                            borderLeft: '2px solid #94a3b8',
                            textAlign: 'center'
                          }}
                        >
                          {overallPct !== null ? `${overallPct}%` : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>

              {/* Table Footer: Class Averages */}
              <tfoot>
                <tr style={{ background: '#f1f5f9', borderTop: '2px solid #94a3b8', fontWeight: 800 }}>
                  <td
                    colSpan={3}
                    className="col-sticky col-sticky-foot"
                    style={{
                      background: '#f1f5f9',
                      textAlign: 'right',
                      padding: '8px 12px',
                      borderRight: '2px solid #94a3b8',
                      fontSize: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}
                  >
                    Class Average
                  </td>

                  {subjectsWithTests.map((sub) => {
                    const subClassAvg = classAverages.subjectAverages[sub.subject_id] ?? null

                    return (
                      <React.Fragment key={sub.subject_id}>
                        {sub.tests.length === 0 ? (
                          <td
                            key={`foot_${sub.subject_id}_none`}
                            style={{ padding: '8px 4px', color: '#94a3b8', borderRight: '1px solid #e2e8f0' }}
                          >
                            —
                          </td>
                        ) : (
                          sub.tests.map((t) => {
                            const unitAvg = classAverages.unitAverages[t.id] ?? null
                            return (
                              <td
                                key={`foot_${t.id}`}
                                style={{
                                  padding: '8px 4px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  color: unitAvg !== null ? '#0f172a' : '#94a3b8',
                                  borderRight: '1px solid #e2e8f0'
                                }}
                              >
                                {unitAvg !== null ? `${unitAvg}%` : '—'}
                              </td>
                            )
                          })
                        )}

                        <td
                          key={`foot_${sub.subject_id}_avg`}
                          style={{
                            padding: '8px 6px',
                            fontSize: '11px',
                            fontWeight: 800,
                            color: subClassAvg !== null
                              ? (subClassAvg >= 70 ? '#047857' : subClassAvg >= 50 ? '#b45309' : '#b91c1c')
                              : '#94a3b8',
                            background: '#e2e8f0',
                            borderRight: '2px solid #94a3b8'
                          }}
                        >
                          {subClassAvg !== null ? `${subClassAvg}%` : '—'}
                        </td>
                      </React.Fragment>
                    )
                  })}

                  {/* Aggregate Class Average */}
                  <td
                    className="col-sticky col-sticky-agg"
                    style={{
                      background: '#c7d2fe',
                      color: '#1e1b4b',
                      padding: '8px',
                      fontSize: '13px',
                      fontWeight: 800,
                      borderLeft: '2px solid #94a3b8',
                      textAlign: 'center'
                    }}
                  >
                    {classAverages.classOverall !== null ? `${classAverages.classOverall}%` : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
