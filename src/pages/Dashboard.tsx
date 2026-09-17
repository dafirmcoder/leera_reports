import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/report'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { ROLE_LABEL } from '../lib/permissions'
import { downloadAttendanceCsv, downloadAttendanceExcel } from '../lib/attendanceExport'
import type {
  AttendanceAggregatedSummary,
  EndOfUnitTestOverview,
  SchoolPopulationSummary,
  TeacherTestSummary
} from '../lib/types'

const today = () => new Date().toISOString().slice(0, 10)

interface DashboardProps {
  section?: 'overview' | 'population' | 'attendance' | 'marks' | 'teachers'
}

export default function Dashboard({ section = 'overview' }: DashboardProps) {
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
      const [popData, testsData] = await Promise.all([
        api.getPopulationSummary(),
        api.getUnitTestOverview()
      ])
      setPopulation(popData)
      setTestOverview(testsData)
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

  // Filtered unit tests, sorted strictly Class-wise -> Subject-wise -> Topic-wise
  const filteredTests = useMemo(() => {
    if (!testOverview) return []
    const source = onlyWithMarks ? testOverview.tests_with_marks : testOverview.all_tests
    const filtered = source.filter((t) => {
      if (filterClassId !== 'all' && t.class_id !== filterClassId) return false
      if (filterSubjectId !== 'all' && t.subject_id !== filterSubjectId) return false
      if (testSearch.trim()) {
        const q = testSearch.toLowerCase()
        const matchTitle = t.title.toLowerCase().includes(q)
        const matchSubj = t.subject_name.toLowerCase().includes(q)
        const matchTeacher = t.teacher_name.toLowerCase().includes(q)
        const matchClass = t.class_name.toLowerCase().includes(q)
        if (!matchTitle && !matchSubj && !matchTeacher && !matchClass) return false
      }
      return true
    })

    return filtered.sort((a, b) => {
      const classComp = a.class_name.localeCompare(b.class_name, undefined, { numeric: true, sensitivity: 'base' })
      if (classComp !== 0) return classComp
      const subjectComp = a.subject_name.localeCompare(b.subject_name, undefined, { numeric: true, sensitivity: 'base' })
      if (subjectComp !== 0) return subjectComp
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    })
  }, [testOverview, onlyWithMarks, filterClassId, filterSubjectId, testSearch])

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
              Showing {filteredTests.length} test{filteredTests.length === 1 ? '' : 's'} (Sorted Class → Subject → Topic)
            </span>
          </div>

          {/* Detailed Tests Table */}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Subject</th>
                  <th>Teacher</th>
                  <th>Unit / Topic</th>
                  <th>Exam Paper</th>
                  <th>Date</th>
                  <th className="num">Marks Entered</th>
                  <th className="num">Class Avg (%)</th>
                  <th className="num">Score Range</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTests.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="muted center" style={{ padding: '24px' }}>
                      {onlyWithMarks
                        ? 'No unit tests with marks entered match your filters.'
                        : 'No unit tests found.'}
                    </td>
                  </tr>
                ) : (
                  filteredTests.map((t) => (
                    <tr key={t.test_id}>
                      <td><strong>{t.class_name}</strong></td>
                      <td><span className="role-tag" style={{ background: '#e0f2fe', color: '#0369a1' }}>{t.subject_name}</span></td>
                      <td>{t.teacher_name}</td>
                      <td><strong>{t.title}</strong></td>
                      <td>
                        {t.exam_paper_url ? (
                          <a
                            href={t.exam_paper_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="chip"
                            style={{
                              background: '#e0e7ff',
                              color: '#3730a3',
                              borderColor: '#c7d2fe',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                            title={t.exam_paper_name ? `View ${t.exam_paper_name}` : 'Open Exam Paper PDF'}
                          >
                            📄 PDF
                          </a>
                        ) : (
                          <span className="muted" style={{ fontSize: '12px' }}>—</span>
                        )}
                      </td>
                      <td className="mono">{fmtDate(t.test_date)}</td>
                      <td className="num">
                        <span className="chip" style={{
                          background: t.marks_entered_count === t.total_students && t.total_students > 0 ? '#dcfce7' : t.has_marks_entered ? '#fef3c7' : '#f1f5f9',
                          color: t.marks_entered_count === t.total_students && t.total_students > 0 ? '#166534' : t.has_marks_entered ? '#92400e' : '#64748b'
                        }}>
                          {t.marks_entered_count} / {t.total_students} ({t.marks_entered_pct}%)
                        </span>
                      </td>
                      <td className="num">
                        {t.average_pct !== null ? (
                          <span style={{ fontWeight: 700, color: t.average_pct >= 70 ? '#1f8a5f' : t.average_pct >= 50 ? '#d97706' : '#dc2626' }}>
                            {t.average_pct}% <small className="muted">({t.average_score}/{t.max_mark})</small>
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num mono" style={{ fontSize: '12px' }}>
                        {t.lowest_score !== null && t.highest_score !== null
                          ? `${t.lowest_score} – ${t.highest_score}`
                          : '—'}
                      </td>
                      <td className="right">
                        <Link to={`/marks/${t.class_id}/${t.test_id}?view=marksheet`} className="btn btn-small">
                          View Sheet →
                        </Link>
                      </td>
                    </tr>
                  ))
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
