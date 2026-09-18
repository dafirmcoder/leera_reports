import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/report'
import { useSchool } from '../../context/SchoolContext'
import { useAuth } from '../../context/AuthContext'
import { ROLE_LABEL } from '../../lib/permissions'
import { downloadAttendanceCsv, downloadAttendanceExcel } from '../../lib/attendanceExport'
import type {
  AttendanceAggregatedSummary,
  EndOfUnitTestOverview,
  SchoolPopulationSummary,
  TeacherTestSummary,
  Assignment
} from '../../lib/types'

const today = () => new Date().toISOString().slice(0, 10)

interface DashboardProps {
  section?: 'overview' | 'population' | 'attendance' | 'marks' | 'teachers'
}

export default function ExecutiveDashboard({ section = 'overview' }: DashboardProps) {
  const { school, classes, subjects } = useSchool()
  const { profile } = useAuth()

  // State
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Population
  const [population, setPopulation] = useState<SchoolPopulationSummary | null>(null)

  // Attendance
  const [attendancePeriod, setAttendancePeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [selectedDate, setSelectedDate] = useState(today())
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceAggregatedSummary | null>(null)
  const [loadingAttendance, setLoadingAttendance] = useState(false)
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null)

  const handleDownloadExcel = async () => {
    setExporting('xlsx')
    try {
      const detailed = await api.getDetailedAttendanceReport(attendancePeriod, selectedDate)
      await downloadAttendanceExcel(detailed)
    } catch (e: any) {
      setError(`Excel download failed: ${e.message}`)
    } finally {
      setExporting(null)
    }
  }

  const handleDownloadCsv = async () => {
    setExporting('csv')
    try {
      const detailed = await api.getDetailedAttendanceReport(attendancePeriod, selectedDate)
      downloadAttendanceCsv(detailed)
    } catch (e: any) {
      setError(`CSV download failed: ${e.message}`)
    } finally {
      setExporting(null)
    }
  }

  // End of Unit Tests & Teachers
  const [testOverview, setTestOverview] = useState<EndOfUnitTestOverview | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [onlyWithMarks, setOnlyWithMarks] = useState(false)
  const [filterClassId, setFilterClassId] = useState<string>('all')
  const [filterSubjectId, setFilterSubjectId] = useState<string>('all')
  const [testSearch, setTestSearch] = useState('')
  const [teacherSearch, setTeacherSearch] = useState('')

  // Load initial overall data
  const loadOverallData = async () => {
    setLoading(true)
    setError('')
    try {
      const [popData, testsData, assignmentsData] = await Promise.all([
        api.getPopulationSummary(),
        api.getUnitTestOverview(),
        api.listAssignments().catch(() => [] as Assignment[])
      ])
      setPopulation(popData)
      setTestOverview(testsData)
      setAssignments(assignmentsData)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load executive summary data.')
    } finally {
      setLoading(false)
    }
  }

  // Load attendance summary when period or date changes
  const loadAttendance = async () => {
    setLoadingAttendance(true)
    try {
      const attData = await api.getAttendancePeriodSummary(attendancePeriod, selectedDate)
      setAttendanceSummary(attData)
    } catch (err: any) {
      console.error(err)
    } finally {
      setLoadingAttendance(false)
    }
  }

  useEffect(() => {
    loadOverallData()
  }, [])

  useEffect(() => {
    loadAttendance()
  }, [attendancePeriod, selectedDate])

  // Quick date jump helpers
  const setQuickDate = (type: 'today' | 'yesterday' | 'this_week' | 'this_month') => {
    const now = new Date()
    if (type === 'today') {
      setSelectedDate(today())
      setAttendancePeriod('daily')
    } else if (type === 'yesterday') {
      const y = new Date()
      y.setDate(now.getDate() - 1)
      setSelectedDate(y.toISOString().slice(0, 10))
      setAttendancePeriod('daily')
    } else if (type === 'this_week') {
      setSelectedDate(today())
      setAttendancePeriod('weekly')
    } else if (type === 'this_month') {
      setSelectedDate(today())
      setAttendancePeriod('monthly')
    }
  }

  // Dynamic header title based on leadership role
  const dashboardTitle = useMemo(() => {
    if (profile?.role === 'director') return "Director's Executive Summary"
    if (profile?.role === 'head_of_school') return "Head of School Dashboard"
    if (profile?.role === 'curriculum_coordinator') return "Curriculum Coordinator Dashboard"
    return "Executive Dashboard"
  }, [profile?.role])

  // Group tests and assignments by Class and Subject for the End of Unit Tests Summary
  const classUnitTestsSummary = useMemo(() => {
    const allTests = testOverview?.all_tests || []

    return classes.map((c) => {
      const classAssignments = assignments.filter((a) => a.class_id === c.id)
      const classTests = allTests.filter((t) => t.class_id === c.id)

      // Map of subjectId -> { subjectId, subjectName, teacherName, testsCount, testsWithMarksCount, latestDate }
      const subjectMap = new Map<string, {
        subjectId: string
        subjectName: string
        teacherName: string
        testsCount: number
        testsWithMarksCount: number
        latestDate: string | null
      }>()

      // 1. Seed from assignments
      classAssignments.forEach((a) => {
        const sName = a.subject_name || subjects.find((s) => s.id === a.subject_id)?.name
        if (!sName || sName.toLowerCase().includes('unknown')) return
        if (!subjectMap.has(a.subject_id)) {
          subjectMap.set(a.subject_id, {
            subjectId: a.subject_id,
            subjectName: sName,
            teacherName: a.teacher_name || '',
            testsCount: 0,
            testsWithMarksCount: 0,
            latestDate: null
          })
        }
      })

      // 2. Add or update from tests
      classTests.forEach((t) => {
        const sName = t.subject_name || subjects.find((s) => s.id === t.subject_id)?.name
        if (!sName || sName.toLowerCase().includes('unknown')) return
        let entry = subjectMap.get(t.subject_id)
        if (!entry) {
          entry = {
            subjectId: t.subject_id,
            subjectName: sName,
            teacherName: t.teacher_name || '',
            testsCount: 0,
            testsWithMarksCount: 0,
            latestDate: null
          }
          subjectMap.set(t.subject_id, entry)
        }
        entry.testsCount += 1
        if (t.has_marks_entered) {
          entry.testsWithMarksCount += 1
        }
        if (!entry.teacherName && t.teacher_name) {
          entry.teacherName = t.teacher_name
        }
        if (t.test_date) {
          if (!entry.latestDate || t.test_date > entry.latestDate) {
            entry.latestDate = t.test_date
          }
        }
      })

      const classSubjects = Array.from(subjectMap.values()).sort((a, b) =>
        a.subjectName.localeCompare(b.subjectName, undefined, { numeric: true, sensitivity: 'base' })
      )

      const totalTestsCount = classSubjects.reduce((sum, s) => sum + s.testsCount, 0)
      const totalTestsWithMarksCount = classSubjects.reduce((sum, s) => sum + s.testsWithMarksCount, 0)

      let latestClassDate: string | null = null
      classSubjects.forEach((s) => {
        if (s.latestDate && (!latestClassDate || s.latestDate > latestClassDate)) {
          latestClassDate = s.latestDate
        }
      })

      return {
        classId: c.id,
        className: c.name,
        subjects: classSubjects,
        totalTestsCount,
        totalTestsWithMarksCount,
        latestClassDate
      }
    }).sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true, sensitivity: 'base' }))
  }, [classes, assignments, testOverview, subjects])

  // Filtered classes summary for Section 3
  const filteredClassSummaries = useMemo(() => {
    return classUnitTestsSummary.filter((item) => {
      if (filterClassId !== 'all' && item.classId !== filterClassId) {
        return false
      }

      if (filterSubjectId !== 'all') {
        const hasSubj = item.subjects.some((s) => s.subjectId === filterSubjectId)
        if (!hasSubj) return false
      }

      if (onlyWithMarks && item.totalTestsWithMarksCount === 0) {
        return false
      }

      if (testSearch.trim()) {
        const q = testSearch.toLowerCase()
        const matchClass = item.className.toLowerCase().includes(q)
        const matchSubj = item.subjects.some((s) => s.subjectName.toLowerCase().includes(q))
        const matchTeacher = item.subjects.some((s) => s.teacherName.toLowerCase().includes(q))
        if (!matchClass && !matchSubj && !matchTeacher) {
          return false
        }
      }

      return true
    })
  }, [classUnitTestsSummary, filterClassId, filterSubjectId, onlyWithMarks, testSearch])

  // Filtered teachers summary
  const filteredTeachers = useMemo(() => {
    if (!testOverview?.teacher_summaries) return []
    if (!teacherSearch.trim()) return testOverview.teacher_summaries
    const q = teacherSearch.toLowerCase()
    return testOverview.teacher_summaries.filter((t) =>
      t.teacher_name.toLowerCase().includes(q) ||
      t.class_names.some((c) => c.toLowerCase().includes(q)) ||
      t.subjects.some((s) => s.toLowerCase().includes(q))
    )
  }, [testOverview?.teacher_summaries, teacherSearch])

  const activeSection = section || 'overview'

  return (
    <div className="page stack" style={{ gap: '20px' }}>
      {/* Header */}
      <div className="page-head">
        <div>
          <h2>{dashboardTitle}</h2>
          <p className="muted">
            {school?.name || 'Leera International School'} · Academic Year {school?.academic_year || '2026/2027'} · Semester {school?.semester || school?.term || '1'}
          </p>
        </div>
        <div className="row">
          <button className="btn btn-small" onClick={() => { loadOverallData(); loadAttendance(); }}>
            🔄 Refresh data
          </button>
        </div>
      </div>

      {/* Sub-menu / Segmented Navigation Tabs */}
      <div className="seg" style={{ margin: 0, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        <Link
          to="/dashboard"
          className={`seg-btn ${activeSection === 'overview' ? 'active' : ''}`}
        >
          📊 Overview
        </Link>
        <Link
          to="/dashboard/population"
          className={`seg-btn ${activeSection === 'population' ? 'active' : ''}`}
        >
          👥 Population
        </Link>
        <Link
          to="/dashboard/attendance"
          className={`seg-btn ${activeSection === 'attendance' ? 'active' : ''}`}
        >
          📅 Attendance
        </Link>
        <Link
          to="/dashboard/marks"
          className={`seg-btn ${activeSection === 'marks' ? 'active' : ''}`}
        >
          📝 Marks Summaries
        </Link>
        <Link
          to="/dashboard/teachers"
          className={`seg-btn ${activeSection === 'teachers' ? 'active' : ''}`}
        >
          👩‍🏫 Teachers Summary
        </Link>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      {/* Top High-level KPI Cards */}
      {(activeSection === 'overview' || activeSection === 'marks' || activeSection === 'teachers') && (
        <div className="grid4">
          <div className="card stat-box">
            <div className="stat-label">Total Student Population</div>
            <div className="stat-value">{population?.total_students ?? '—'}</div>
            <div className="stat-meta">
              Across {population?.total_classes ?? 0} classes · 👦 {population?.boys_percentage ?? 0}% Boys · 👧 {population?.girls_percentage ?? 0}% Girls
            </div>
          </div>

          <div className="card stat-box">
            <div className="stat-label">
              {attendancePeriod === 'daily' ? 'Attendance (Selected Day)' : attendancePeriod === 'weekly' ? 'Weekly Attendance' : 'Monthly Attendance'}
            </div>
            <div className="stat-value" style={{ color: (attendanceSummary?.presentPct ?? 0) >= 90 ? 'var(--green)' : '#d97706' }}>
              {attendanceSummary ? `${attendanceSummary.presentPct}%` : '—'}
            </div>
            <div className="stat-meta">
              {attendanceSummary ? `${attendanceSummary.present} Present · ${attendanceSummary.absent} Absent · ${attendanceSummary.excused} Excused` : 'Loading…'}
            </div>
          </div>

          <div className="card stat-box">
            <div className="stat-label">Unit Tests with Marks</div>
            <div className="stat-value" style={{ color: 'var(--teal)' }}>
              {testOverview ? `${testOverview.total_tests_with_marks} / ${testOverview.total_tests}` : '—'}
            </div>
            <div className="stat-meta">
              {testOverview && testOverview.total_tests > 0
                ? `${((testOverview.total_tests_with_marks / testOverview.total_tests) * 100).toFixed(0)}% of tests have marks entered`
                : 'No tests recorded'}
            </div>
          </div>

          <div className="card stat-box">
            <div className="stat-label">School-wide Unit Test Avg</div>
            <div className="stat-value" style={{ color: 'var(--green-dark)' }}>
              {testOverview?.overall_average_pct !== null && testOverview?.overall_average_pct !== undefined
                ? `${testOverview.overall_average_pct}%`
                : '—'}
            </div>
            <div className="stat-meta">Average across all scored unit tests</div>
          </div>
        </div>
      )}

      {/* SECTION 1: ATTENDANCE SUMMARIES */}
      {(activeSection === 'overview' || activeSection === 'attendance') && (
        <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '17px' }}>📅 Attendance Summaries & Percentages</h3>
            <p className="muted" style={{ fontSize: '13px', margin: 0 }}>
              Daily, Weekly, and Monthly breakdown with present, absent, and excused percentages.
            </p>
          </div>

          <div className="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
            <div className="seg" style={{ margin: 0 }}>
              <button
                type="button"
                className={`seg-btn ${attendancePeriod === 'daily' ? 'active' : ''}`}
                onClick={() => setAttendancePeriod('daily')}
              >
                Daily
              </button>
              <button
                type="button"
                className={`seg-btn ${attendancePeriod === 'weekly' ? 'active' : ''}`}
                onClick={() => setAttendancePeriod('weekly')}
              >
                Weekly
              </button>
              <button
                type="button"
                className={`seg-btn ${attendancePeriod === 'monthly' ? 'active' : ''}`}
                onClick={() => setAttendancePeriod('monthly')}
              >
                Monthly
              </button>
            </div>

            <div className="row" style={{ gap: '6px' }}>
              <button
                type="button"
                className="btn btn-small"
                style={{ background: '#1f8a5f', color: '#ffffff', fontWeight: 600 }}
                disabled={exporting !== null}
                onClick={handleDownloadExcel}
              >
                {exporting === 'xlsx' ? '⏳ Generating…' : '📥 Download Excel (.xlsx)'}
              </button>
              <button
                type="button"
                className="btn btn-small"
                disabled={exporting !== null}
                onClick={handleDownloadCsv}
              >
                {exporting === 'csv' ? '⏳ Generating…' : '📄 Download CSV (.csv)'}
              </button>
            </div>
          </div>
        </div>

        {/* Period Selector Controls */}
        <div className="row" style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', gap: '12px' }}>
          <label className="field inline" style={{ margin: 0 }}>
            <span>
              {attendancePeriod === 'daily' ? 'Date:' : attendancePeriod === 'weekly' ? 'Week containing:' : 'Month containing:'}
            </span>
            <input
              type={attendancePeriod === 'monthly' ? 'month' : 'date'}
              value={attendancePeriod === 'monthly' ? selectedDate.slice(0, 7) : selectedDate}
              onChange={(e) => {
                const val = e.target.value
                setSelectedDate(attendancePeriod === 'monthly' ? `${val}-01` : val)
              }}
              max={today()}
            />
          </label>

          <span className="muted">| Quick pick:</span>
          <button type="button" className="btn btn-small" onClick={() => setQuickDate('today')}>Today</button>
          <button type="button" className="btn btn-small" onClick={() => setQuickDate('this_week')}>This Week</button>
          <button type="button" className="btn btn-small" onClick={() => setQuickDate('this_month')}>This Month</button>

          <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--teal)', fontSize: '13px' }}>
            Period: {attendanceSummary?.periodLabel || '…'}
          </span>
        </div>

        {loadingAttendance && <p className="muted center">Loading attendance summary…</p>}

        {!loadingAttendance && attendanceSummary && (
          <>
            {/* Overall Attendance Metric Bar */}
            <div className="row" style={{ gap: '12px', background: '#f1f7f4', padding: '12px 16px', borderRadius: '10px' }}>
              <div className="grow">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                  <span><strong>School Attendance Health:</strong> {attendanceSummary.presentPct}% Present</span>
                  <span className="muted">{attendanceSummary.totalRecords} total student records</span>
                </div>
                <div style={{ height: '10px', width: '100%', background: '#e2e8f0', borderRadius: '5px', overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${attendanceSummary.presentPct}%`, background: '#1f8a5f' }} title={`Present: ${attendanceSummary.presentPct}%`} />
                  <div style={{ width: `${attendanceSummary.excusedPct}%`, background: '#94a3b8' }} title={`Excused: ${attendanceSummary.excusedPct}%`} />
                  <div style={{ width: `${attendanceSummary.absentPct}%`, background: '#ef4444' }} title={`Absent: ${attendanceSummary.absentPct}%`} />
                </div>
              </div>
              <div className="row" style={{ gap: '8px' }}>
                <span className="chip" style={{ background: '#dcfce7', color: '#166534', borderColor: '#bbf7d0' }}>
                  ✅ Present: {attendanceSummary.present} ({attendanceSummary.presentPct}%)
                </span>
                <span className="chip" style={{ background: '#fee2e2', color: '#991b1b', borderColor: '#fecaca' }}>
                  ❌ Absent: {attendanceSummary.absent} ({attendanceSummary.absentPct}%)
                </span>
                <span className="chip" style={{ background: '#f1f5f9', color: '#475569', borderColor: '#e2e8f0' }}>
                  ℹ️ Excused: {attendanceSummary.excused} ({attendanceSummary.excusedPct}%)
                </span>
              </div>
            </div>

            {/* Class by Class Attendance Table */}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Homeroom Teacher</th>
                    {attendancePeriod !== 'daily' && <th className="num">Days Marked</th>}
                    <th className="num">Present (%)</th>
                    <th className="num">Absent (%)</th>
                    <th className="num">Excused (%)</th>
                    <th className="num">Total Records</th>
                    <th style={{ width: '140px' }}>Attendance Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceSummary.classBreakdown.length === 0 && (
                    <tr><td colSpan={8} className="muted center">No classes registered.</td></tr>
                  )}
                  {attendanceSummary.classBreakdown.map((c) => (
                    <tr key={c.class_id}>
                      <td><strong>{c.class_name}</strong></td>
                      <td className="muted">{c.homeroom_teacher_name}</td>
                      {attendancePeriod !== 'daily' && <td className="num mono">{c.daysMarked}</td>}
                      <td className="num">
                        <span style={{ color: '#1f8a5f', fontWeight: 600 }}>{c.present}</span>
                        <span className="muted" style={{ fontSize: '12px' }}> ({c.presentPct}%)</span>
                      </td>
                      <td className="num">
                        <span style={{ color: c.absent > 0 ? '#dc2626' : 'inherit', fontWeight: c.absent > 0 ? 600 : 400 }}>{c.absent}</span>
                        <span className="muted" style={{ fontSize: '12px' }}> ({c.absentPct}%)</span>
                      </td>
                      <td className="num">
                        <span>{c.excused}</span>
                        <span className="muted" style={{ fontSize: '12px' }}> ({c.excusedPct}%)</span>
                      </td>
                      <td className="num mono">{c.total}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ flex: 1, height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ width: `${c.presentPct}%`, height: '100%', background: c.presentPct >= 90 ? '#1f8a5f' : c.presentPct >= 75 ? '#d97706' : '#ef4444' }} />
                          </div>
                          <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '38px' }}>{c.presentPct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Absences Log */}
            {attendanceSummary.absences.length > 0 ? (
              <div className="stack" style={{ marginTop: '10px' }}>
                <h4 style={{ margin: '8px 0 4px', fontSize: '14px', color: '#991b1b' }}>
                  ⚠️ Recorded Student Absences ({attendanceSummary.absences.length})
                </h4>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Class</th>
                        <th>Student Name</th>
                        <th>Student No.</th>
                        <th>Reason for Absence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendanceSummary.absences.map((a, idx) => (
                        <tr key={`${a.date}-${a.student_no}-${idx}`}>
                          <td className="mono">{fmtDate(a.date)}</td>
                          <td><strong>{a.class_name}</strong></td>
                          <td>{a.student_name}</td>
                          <td className="mono">{a.student_no}</td>
                          <td><span className="chip" style={{ background: '#fee2e2', color: '#991b1b' }}>{a.reason || 'No reason provided'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="muted center" style={{ padding: '12px 0' }}>
                🎉 No student absences recorded in this period!
              </p>
            )}
          </>
        )}
        </section>
      )}

      {/* SECTION 2: POPULATION NUMBERS WITH % PER CLASS */}
      {(activeSection === 'overview' || activeSection === 'population') && (
        <section className="card stack">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h3 style={{ fontSize: '17px' }}>👥 School Population Numbers & Class Percentages</h3>
            <p className="muted" style={{ fontSize: '13px', margin: 0 }}>
              Total enrolled student population, percentage share per class, and gender breakdown.
            </p>
          </div>
          <div className="row">
            <span className="chip" style={{ background: '#eff6ff', color: '#1e40af', borderColor: '#bfdbfe' }}>
              Total: {population?.total_students ?? 0} Students
            </span>
            <span className="chip" style={{ background: '#fdf2f8', color: '#9d174d', borderColor: '#fbcfe8' }}>
              Girls: {population?.total_girls ?? 0} ({population?.girls_percentage ?? 0}%)
            </span>
            <span className="chip" style={{ background: '#ecfeff', color: '#155e75', borderColor: '#a5f3fc' }}>
              Boys: {population?.total_boys ?? 0} ({population?.boys_percentage ?? 0}%)
            </span>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Class Name</th>
                <th>Homeroom Teacher</th>
                <th className="num">Students Enrolled</th>
                <th style={{ width: '180px' }}>% of School Population</th>
                <th className="num">Boys (Count & %)</th>
                <th className="num">Girls (Count & %)</th>
              </tr>
            </thead>
            <tbody>
              {!population || population.classes.length === 0 ? (
                <tr><td colSpan={6} className="muted center">No class population data available.</td></tr>
              ) : (
                population.classes.map((c) => (
                  <tr key={c.class_id}>
                    <td><strong>{c.class_name}</strong></td>
                    <td className="muted">{c.homeroom_teacher_name}</td>
                    <td className="num mono" style={{ fontSize: '15px', fontWeight: 700 }}>
                      {c.student_count}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ flex: 1, height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${c.percentage_of_total}%`, height: '100%', background: 'var(--teal)' }} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 700, minWidth: '42px' }}>
                          {c.percentage_of_total}%
                        </span>
                      </div>
                    </td>
                    <td className="num">
                      <span style={{ color: '#0369a1', fontWeight: 600 }}>{c.boys_count}</span>
                      <span className="muted" style={{ fontSize: '12px' }}> ({c.boys_percentage}%)</span>
                    </td>
                    <td className="num">
                      <span style={{ color: '#be185d', fontWeight: 600 }}>{c.girls_count}</span>
                      <span className="muted" style={{ fontSize: '12px' }}> ({c.girls_percentage}%)</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {population && population.total_students > 0 && (
              <tfoot>
                <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                  <td>TOTAL / SCHOOL OVERALL</td>
                  <td className="muted">{population.total_classes} Classes</td>
                  <td className="num mono" style={{ fontSize: '16px', color: 'var(--teal)' }}>
                    {population.total_students}
                  </td>
                  <td>100.0%</td>
                  <td className="num" style={{ color: '#0369a1' }}>
                    {population.total_boys} ({population.boys_percentage}%)
                  </td>
                  <td className="num" style={{ color: '#be185d' }}>
                    {population.total_girls} ({population.girls_percentage}%)
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        </section>
      )}

      {/* SECTION 3: END OF UNIT TESTS & MARKS SUMMARIES */}
      {(activeSection === 'overview' || activeSection === 'marks') && (
        <section className="card stack">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <div>
              <h3 style={{ fontSize: '17px', margin: 0 }}>📝 End of Unit Tests & Marks Summaries</h3>
              <p className="muted" style={{ fontSize: '13px', margin: '4px 0 0' }}>
                Sorted Class-wise, Subject-wise, and Topic-wise. View scores, average percentages, and sample exam paper PDFs.
              </p>
            </div>

            <div className="row">
              <label className="check" style={{ fontWeight: 600, color: 'var(--teal)' }}>
                <input
                  type="checkbox"
                  checked={onlyWithMarks}
                  onChange={(e) => setOnlyWithMarks(e.target.checked)}
                />
                <span>Show ONLY tests with marks entered</span>
              </label>
            </div>
          </div>

          {/* Subject Summary Cards */}
          {testOverview && testOverview.subject_summaries.length > 0 && (
            <div className="grid3" style={{ marginTop: '8px' }}>
              {testOverview.subject_summaries.map((sub) => (
                <div key={sub.subject_id} style={{ background: '#f8fafc', border: '1px solid var(--line)', padding: '12px', borderRadius: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <strong style={{ fontSize: '15px', color: 'var(--teal)' }}>{sub.subject_name}</strong>
                    <span className="chip" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11px' }}>
                      {sub.tests_with_marks_count} scored test{sub.tests_with_marks_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '13px' }}>
                    <div><strong>Average Score:</strong> {sub.average_score_pct !== null ? `${sub.average_score_pct}%` : '—'}</div>
                    <div className="muted" style={{ fontSize: '12px', marginTop: '3px' }}>
                      Teacher(s): {sub.teachers.length > 0 ? sub.teachers.join(', ') : 'Assigned teachers'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="row" style={{ gap: '10px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="search"
              style={{ maxWidth: '240px', margin: 0 }}
              placeholder="Search topic, subject, teacher…"
              value={testSearch}
              onChange={(e) => setTestSearch(e.target.value)}
            />

            <label className="field inline" style={{ margin: 0 }}>
              <span>Class:</span>
              <select value={filterClassId} onChange={(e) => setFilterClassId(e.target.value)}>
                <option value="all">All Classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="field inline" style={{ margin: 0 }}>
              <span>Subject:</span>
              <select value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)}>
                <option value="all">All Subjects</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>

            <span className="muted" style={{ marginLeft: 'auto', fontSize: '13px' }}>
              Showing {filteredClassSummaries.length} class{filteredClassSummaries.length === 1 ? '' : 'es'}
            </span>
          </div>

          {/* Detailed Tests Table: Exact 6 Columns Requested */}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: '130px' }}>Class</th>
                  <th style={{ minWidth: '180px' }}>Subjects</th>
                  <th style={{ minWidth: '180px' }}>Teacher</th>
                  <th style={{ minWidth: '150px', textAlign: 'center' }}>Number of Unit Tests</th>
                  <th style={{ minWidth: '110px' }}>Date</th>
                  <th style={{ minWidth: '120px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredClassSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted center" style={{ padding: '32px' }}>
                      {onlyWithMarks
                        ? 'No classes with marks entered match your filters.'
                        : 'No classes or unit tests found matching your filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredClassSummaries.map((item) => {
                    const displaySubjects = filterSubjectId === 'all'
                      ? item.subjects
                      : item.subjects.filter((s) => s.subjectId === filterSubjectId)

                    const rowCount = Math.max(1, displaySubjects.length)

                    if (displaySubjects.length === 0) {
                      return (
                        <tr key={item.classId} style={{ borderBottom: '2px solid #cbd5e1' }}>
                          <td style={{ verticalAlign: 'middle', padding: '12px', background: '#f8fafc', fontWeight: 700 }}>
                            <div style={{ fontSize: '15px', color: '#0f172a' }}>{item.className}</div>
                            <div className="muted" style={{ fontSize: '11px', marginTop: '2px', fontWeight: 500 }}>
                              Total Tests: 0
                            </div>
                          </td>
                          <td className="muted" style={{ fontStyle: 'italic', verticalAlign: 'middle' }}>
                            No subjects assigned
                          </td>
                          <td className="muted" style={{ verticalAlign: 'middle' }}>—</td>
                          <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                            <span className="chip" style={{ background: '#f1f5f9', color: '#64748b' }}>0 tests</span>
                          </td>
                          <td className="muted" style={{ verticalAlign: 'middle' }}>—</td>
                          <td className="right" style={{ verticalAlign: 'middle' }}>
                            <Link
                              to={`/dashboard/marks/class/${item.classId}`}
                              className="btn btn-small"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                            >
                              <span>View Sheet</span>
                              <span>→</span>
                            </Link>
                          </td>
                        </tr>
                      )
                    }

                    return displaySubjects.map((s, idx) => {
                      const isLastSubject = idx === displaySubjects.length - 1
                      return (
                        <tr
                          key={`${item.classId}_${s.subjectId}`}
                          style={{
                            borderBottom: isLastSubject ? '2px solid #94a3b8' : '1px solid #f1f5f9',
                            background: idx % 2 === 0 ? '#ffffff' : '#fafafa'
                          }}
                        >
                          {/* 1. Class (spans all subjects of this class) */}
                          {idx === 0 && (
                            <td
                              rowSpan={rowCount}
                              style={{
                                verticalAlign: 'top',
                                padding: '14px 12px',
                                background: '#f8fafc',
                                borderRight: '1px solid var(--line)',
                                borderBottom: '2px solid #94a3b8',
                                fontWeight: 700
                              }}
                            >
                              <div style={{ fontSize: '15px', color: '#0f172a', fontWeight: 800 }}>{item.className}</div>
                              <div style={{ marginTop: '6px' }}>
                                <span className="chip" style={{
                                  background: item.totalTestsCount > 0 ? '#e0e7ff' : '#f1f5f9',
                                  color: item.totalTestsCount > 0 ? '#3730a3' : '#64748b',
                                  fontSize: '11px',
                                  fontWeight: 700
                                }}>
                                  {item.totalTestsCount} Total Test{item.totalTestsCount === 1 ? '' : 's'}
                                </span>
                              </div>
                            </td>
                          )}

                          {/* 2. Subjects (lists the subjects in each class) */}
                          <td style={{ verticalAlign: 'middle', padding: '10px 12px' }}>
                            <span
                              className="role-tag"
                              style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 700, fontSize: '12px' }}
                            >
                              {s.subjectName}
                            </span>
                          </td>

                          {/* 3. Teacher (aligns a teacher to a subject in that class) */}
                          <td style={{ verticalAlign: 'middle', padding: '10px 12px' }}>
                            {s.teacherName ? (
                              <span style={{ fontWeight: 600, color: '#334155' }}>{s.teacherName}</span>
                            ) : (
                              <span className="muted" style={{ fontStyle: 'italic' }}>Unassigned</span>
                            )}
                          </td>

                          {/* 4. Number of unit tests */}
                          <td style={{ verticalAlign: 'middle', textAlign: 'center', padding: '10px 12px' }}>
                            <span
                              className="chip"
                              style={{
                                background: s.testsCount > 0 ? '#dcfce7' : '#f1f5f9',
                                color: s.testsCount > 0 ? '#166534' : '#64748b',
                                fontWeight: 700
                              }}
                            >
                              {s.testsCount} {s.testsCount === 1 ? 'unit test' : 'unit tests'}
                            </span>
                          </td>

                          {/* 5. Date */}
                          <td className="mono" style={{ verticalAlign: 'middle', padding: '10px 12px', fontSize: '12px' }}>
                            {s.latestDate ? (
                              <span>{fmtDate(s.latestDate)}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>

                          {/* 6. Action (View Sheet directs to the entire class sheet) */}
                          {idx === 0 && (
                            <td
                              rowSpan={rowCount}
                              style={{
                                verticalAlign: 'middle',
                                textAlign: 'right',
                                padding: '14px 12px',
                                borderLeft: '1px solid var(--line)',
                                borderBottom: '2px solid #94a3b8'
                              }}
                            >
                              <Link
                                to={`/dashboard/marks/class/${item.classId}`}
                                className="btn btn-small"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  whiteSpace: 'nowrap',
                                  fontWeight: 700
                                }}
                              >
                                <span>View Sheet</span>
                                <span>→</span>
                              </Link>
                            </td>
                          )}
                        </tr>
                      )
                    })
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SECTION 4: TEACHERS SUMMARY */}
      {(activeSection === 'overview' || activeSection === 'teachers') && (
        <section className="card stack">
          <div className="page-head" style={{ marginBottom: 0 }}>
            <div>
              <h3 style={{ fontSize: '17px', margin: 0 }}>👩‍🏫 Teachers Mark Entry & Performance Summary</h3>
              <p className="muted" style={{ fontSize: '13px', margin: '4px 0 0' }}>
                Overview of tests issued, marks completion status, score averages, and last submission dates per teacher.
              </p>
            </div>
            <div className="row">
              <input
                className="search"
                style={{ maxWidth: '240px', margin: 0 }}
                placeholder="Search teacher, class, subject…"
                value={teacherSearch}
                onChange={(e) => setTeacherSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Role</th>
                  <th>Assigned Classes</th>
                  <th>Subjects</th>
                  <th className="num">Tests Set</th>
                  <th className="num">Marks Completed</th>
                  <th className="num">Total Marks Entered</th>
                  <th className="num">Average Score</th>
                  <th>Last Submission</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeachers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="muted center" style={{ padding: '24px' }}>
                      No teacher records found.
                    </td>
                  </tr>
                ) : (
                  filteredTeachers.map((t) => (
                    <tr key={t.teacher_id}>
                      <td><strong>{t.teacher_name}</strong></td>
                      <td>
                        <span className="role-tag" style={{ fontSize: '11px' }}>
                          {ROLE_LABEL[t.role] || t.role}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {t.class_names.length > 0 ? (
                            t.class_names.map((cn) => (
                              <span key={cn} className="chip" style={{ fontSize: '11px', padding: '2px 6px' }}>
                                {cn}
                              </span>
                            ))
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {t.subjects.length > 0 ? (
                            t.subjects.map((sn) => (
                              <span key={sn} className="role-tag" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11px' }}>
                                {sn}
                              </span>
                            ))
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </div>
                      </td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{t.tests_count}</td>
                      <td className="num">
                        <span className="chip" style={{
                          background: t.tests_count > 0 && t.tests_with_marks_pct === 100 ? '#dcfce7' : t.tests_with_marks_count > 0 ? '#fef3c7' : '#f1f5f9',
                          color: t.tests_count > 0 && t.tests_with_marks_pct === 100 ? '#166534' : t.tests_with_marks_count > 0 ? '#92400e' : '#64748b'
                        }}>
                          {t.tests_with_marks_count} / {t.tests_count} ({t.tests_with_marks_pct}%)
                        </span>
                      </td>
                      <td className="num mono">{t.total_marks_entered}</td>
                      <td className="num">
                        {t.average_score_pct !== null ? (
                          <span style={{ fontWeight: 700, color: t.average_score_pct >= 70 ? '#1f8a5f' : t.average_score_pct >= 50 ? '#d97706' : '#dc2626' }}>
                            {t.average_score_pct}%
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: '12px' }}>
                        {t.last_submission_date ? fmtDate(t.last_submission_date) : <span className="muted">No marks yet</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
