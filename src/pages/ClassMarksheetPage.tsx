import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import type { Assignment, Student, UnitTest } from '../lib/types'

export default function ClassMarksheetPage() {
  const { classId } = useParams<{ classId: string }>()
  const navigate = useNavigate()
  const { classes, school } = useSchool()
  const { profile } = useAuth()

  // This class marksheet broadsheet style is strictly for the Director
  if (profile && profile.role !== 'director') {
    return <Navigate to="/dashboard" replace />
  }

  const currentClassId = classId || classes[0]?.id || ''
  const currentClass = classes.find((c) => c.id === currentClassId)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [tests, setTests] = useState<UnitTest[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [scoresMap, setScoresMap] = useState<Record<string, Record<string, number | null>>>({})
  const [studentSearch, setStudentSearch] = useState('')

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

      // Fetch scores for all tests in this class
      const allScores = await Promise.all(
        sortedTests.map((t) => api.listScoresForTest(t.id).catch(() => []))
      )

      const scoreLookup: Record<string, Record<string, number | null>> = {}
      sortedTests.forEach((t, idx) => {
        scoreLookup[t.id] = {}
        allScores[idx].forEach((sc) => {
          if (sc.score !== null && sc.score !== undefined) {
            scoreLookup[t.id][sc.student_id] = Number(sc.score)
          }
        })
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

  return (
    <div className="page stack" style={{ gap: '20px' }}>
      {/* Header & Navigation */}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '20px' }}>📋</span>
            <span style={{
              background: '#e0e7ff',
              color: '#3730a3',
              padding: '3px 10px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px'
            }}>
              DIRECTOR'S CLASS MARKSHEET BROADSHEET
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800 }}>
            {currentClass?.name || 'Class'} — End of Unit Marksheet (Director View)
          </h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '13px' }}>
            {school?.name || 'Leera International School'} · Academic Year {school?.academic_year || '2026/2027'} · Semester {school?.semester || '1'}
          </p>
        </div>

        <div className="row" style={{ gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Class Switcher */}
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

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => window.print()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <span>🖨️</span>
            <span>Print Sheet</span>
          </button>

          <Link
            to="/dashboard/marks"
            className="btn btn-ghost btn-sm"
          >
            ← Back to Executive Dashboard
          </Link>
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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <input
          className="search"
          style={{ maxWidth: '280px', margin: 0 }}
          placeholder="Filter by student name or roll no…"
          value={studentSearch}
          onChange={(e) => setStudentSearch(e.target.value)}
        />
        <div className="muted" style={{ fontSize: '12px' }}>
          Showing {filteredStudents.length} of {students.length} students · Unit sub-columns show student percentage scores (%)
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
          <p className="muted" style={{ fontSize: '14px' }}>Loading class marksheet broadsheet...</p>
        </div>
      ) : subjectsWithTests.length === 0 ? (
        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 8px', color: '#475569' }}>No Subjects or Tests Found</h3>
          <p className="muted" style={{ margin: 0, fontSize: '14px' }}>
            No subject assignments or unit tests have been created yet for {currentClass?.name || 'this class'}.
          </p>
        </div>
      ) : (
        /* Entire Class Sheet Table */
        <div className="card" style={{ padding: '0', overflow: 'hidden', borderRadius: '12px', border: '1px solid var(--line)' }}>
          <div className="table-wrap" style={{ maxHeight: '75vh', overflowX: 'auto', overflowY: 'auto' }}>
            <table
              className="table"
              style={{
                width: '100%',
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
                    style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 3,
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
                    style={{
                      position: 'sticky',
                      left: '45px',
                      zIndex: 3,
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
                    style={{
                      position: 'sticky',
                      left: '140px',
                      zIndex: 3,
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
                    style={{
                      position: 'sticky',
                      right: 0,
                      zIndex: 3,
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
                    <>
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
                              minWidth: '46px',
                              color: '#334155',
                              borderRight: '1px solid #e2e8f0',
                              borderBottom: '2px solid #cbd5e1',
                              background: '#f8fafc',
                              cursor: 'help'
                            }}
                          >
                            {idx + 1}
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
                    </>
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
                          style={{
                            position: 'sticky',
                            left: 0,
                            zIndex: 2,
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
                          className="mono"
                          style={{
                            position: 'sticky',
                            left: '45px',
                            zIndex: 2,
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
                          style={{
                            position: 'sticky',
                            left: '140px',
                            zIndex: 2,
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
                            <>
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
                                      {hasScore ? `${pct}%` : '—'}
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
                            </>
                          )
                        })}

                        {/* Last Column: Aggregate View Per Student */}
                        <td
                          style={{
                            position: 'sticky',
                            right: 0,
                            zIndex: 2,
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
                    style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 3,
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
                      <>
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
                      </>
                    )
                  })}

                  {/* Aggregate Class Average */}
                  <td
                    style={{
                      position: 'sticky',
                      right: 0,
                      zIndex: 3,
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
