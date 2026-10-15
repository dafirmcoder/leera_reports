import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtDate } from '../lib/report'
import { ROLE_LABEL } from '../lib/permissions'
import type { TeacherAssignmentTestSummary } from '../lib/types'

interface Props {
  summaries: TeacherAssignmentTestSummary[]
  classes?: Array<{ id: string; name: string }>
  subjects?: Array<{ id: string; name: string }>
  title?: string
  subtitle?: string
}

export default function TeacherAssignmentTestSummaryTable({
  summaries,
  classes = [],
  subjects = [],
  title = '👨‍🏫 Coordinator Summary: Tests Count per Teacher by Class & Subject',
  subtitle = 'Breakdown of Unit Tests and School Exams set per teacher for each assigned class-subject combination.'
}: Props) {
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'with_tests' | 'no_tests' | 'pending_marks'>('all')

  const filtered = useMemo(() => {
    return summaries.filter((item) => {
      if (classFilter !== 'all' && item.class_id !== classFilter) return false
      if (subjectFilter !== 'all' && item.subject_id !== subjectFilter) return false

      if (statusFilter === 'with_tests' && item.total_tests_count === 0) return false
      if (statusFilter === 'no_tests' && item.total_tests_count > 0) return false
      if (statusFilter === 'pending_marks') {
        const hasPending = item.total_tests_count > item.tests_with_marks_count
        if (!hasPending) return false
      }

      if (search.trim()) {
        const q = search.toLowerCase()
        const matchTeacher = item.teacher_name.toLowerCase().includes(q)
        const matchClass = item.class_name.toLowerCase().includes(q)
        const matchSubj = item.subject_name.toLowerCase().includes(q)
        if (!matchTeacher && !matchClass && !matchSubj) return false
      }

      return true
    })
  }, [summaries, classFilter, subjectFilter, statusFilter, search])

  // Aggregated totals across currently filtered items
  const stats = useMemo(() => {
    let totalUnitTests = 0
    let totalExams = 0
    let totalTests = 0
    let totalWithMarks = 0

    filtered.forEach((item) => {
      totalUnitTests += item.unit_tests_count
      totalExams += item.exams_count
      totalTests += item.total_tests_count
      totalWithMarks += item.tests_with_marks_count
    })

    const completionRate = totalTests > 0
      ? Number(((totalWithMarks / totalTests) * 100).toFixed(1))
      : 0

    return {
      combinationsCount: filtered.length,
      totalUnitTests,
      totalExams,
      totalTests,
      totalWithMarks,
      completionRate
    }
  }, [filtered])

  const handleExportCsv = () => {
    const headers = [
      'Teacher',
      'Role',
      'Class',
      'Subject',
      'Unit Tests',
      'School Exams',
      'Total Tests',
      'Tests With Marks',
      'Completion %',
      'Marks Entered Count',
      'Average Score %',
      'Last Test Date'
    ]

    const rows = filtered.map((item) => [
      `"${item.teacher_name.replace(/"/g, '""')}"`,
      `"${item.role ? ROLE_LABEL[item.role] || item.role : ''}"`,
      `"${item.class_name.replace(/"/g, '""')}"`,
      `"${item.subject_name.replace(/"/g, '""')}"`,
      item.unit_tests_count,
      item.exams_count,
      item.total_tests_count,
      item.tests_with_marks_count,
      `${item.tests_with_marks_pct}%`,
      item.total_marks_entered,
      item.average_score_pct !== null ? `${item.average_score_pct}%` : '',
      item.last_submission_date || ''
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `coordinator_teacher_test_counts_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="card stack" style={{ gap: '16px' }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h3 style={{ fontSize: '17px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{title}</span>
          </h3>
          <p className="muted" style={{ fontSize: '13px', margin: '4px 0 0' }}>
            {subtitle}
          </p>
        </div>
        <div className="row" style={{ gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title="Export filtered teacher test counts summary to CSV"
          >
            <span>📥</span>
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid4" style={{ gap: '12px' }}>
        <div className="card stat-box" style={{ padding: '12px 16px' }}>
          <div className="stat-label">Assigned Combinations</div>
          <div className="stat-value" style={{ fontSize: '20px' }}>{stats.combinationsCount}</div>
          <div className="stat-meta">Class-Subject pairs assigned</div>
        </div>

        <div className="card stat-box" style={{ padding: '12px 16px' }}>
          <div className="stat-label">Total Unit Tests Set</div>
          <div className="stat-value" style={{ fontSize: '20px', color: '#2563eb' }}>{stats.totalUnitTests}</div>
          <div className="stat-meta">End-of-unit tests</div>
        </div>

        <div className="card stat-box" style={{ padding: '12px 16px' }}>
          <div className="stat-label">Total School Exams Set</div>
          <div className="stat-value" style={{ fontSize: '20px', color: '#ea580c' }}>{stats.totalExams}</div>
          <div className="stat-meta">Midterms and end-of-term exams</div>
        </div>

        <div className="card stat-box" style={{ padding: '12px 16px' }}>
          <div className="stat-label">Overall Tests / Marks Status</div>
          <div className="stat-value" style={{ fontSize: '20px', color: stats.completionRate >= 80 ? '#16a34a' : stats.completionRate >= 50 ? '#d97706' : '#dc2626' }}>
            {stats.totalWithMarks} / {stats.totalTests}
          </div>
          <div className="stat-meta">
            {stats.totalTests > 0 ? `${stats.completionRate}% tests with marks` : 'No tests created yet'}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <input
          className="search"
          style={{ maxWidth: '280px', margin: 0 }}
          placeholder="Filter teacher, class, subject…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="row" style={{ gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {classes.length > 0 && (
            <label className="field inline" style={{ margin: 0 }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Class:</span>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                <option value="all">All Classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}

          {subjects.length > 0 && (
            <label className="field inline" style={{ margin: 0 }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Subject:</span>
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                <option value="all">All Subjects</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}

          <div className="btn-group" style={{ display: 'inline-flex', background: '#f1f5f9', padding: '2px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px' }}
              onClick={() => setStatusFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === 'with_tests' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px' }}
              onClick={() => setStatusFilter('with_tests')}
            >
              Has Tests
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === 'pending_marks' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px' }}
              onClick={() => setStatusFilter('pending_marks')}
            >
              Pending Marks
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusFilter === 'no_tests' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px' }}
              onClick={() => setStatusFilter('no_tests')}
            >
              No Tests
            </button>
          </div>

          <span className="muted" style={{ fontSize: '12px' }}>
            Showing {filtered.length} of {summaries.length}
          </span>
        </div>
      </div>

      {/* Main Table */}
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '12.5px' }}>
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Class</th>
              <th>Subject</th>
              <th className="num" title="Number of End-of-Unit tests created">📘 Unit Tests</th>
              <th className="num" title="Number of School Exams / Midterms created">📝 School Exams</th>
              <th className="num" title="Total assessments created">📊 Total Tests</th>
              <th className="num">Marks Completed</th>
              <th className="num">Average Score</th>
              <th>Last Test Date</th>
              <th className="right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="muted center" style={{ padding: '28px' }}>
                  No teacher class-subject assignment records found matching your filters.
                </td>
              </tr>
            ) : (
              filtered.map((item) => {
                const hasTests = item.total_tests_count > 0
                const isFullyGraded = hasTests && item.tests_with_marks_count === item.total_tests_count
                const key = `${item.teacher_id}_${item.class_id}_${item.subject_id}`

                return (
                  <tr key={key}>
                    <td>
                      <div>
                        <strong>{item.teacher_name}</strong>
                        {item.role && (
                          <div style={{ marginTop: '2px' }}>
                            <span className="role-tag" style={{ fontSize: '10px', padding: '1px 5px' }}>
                              {ROLE_LABEL[item.role] || item.role}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="chip" style={{ fontSize: '11.5px', fontWeight: 600 }}>
                        {item.class_name}
                      </span>
                    </td>
                    <td>
                      <span className="role-tag" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11.5px', fontWeight: 600 }}>
                        {item.subject_name}
                      </span>
                    </td>
                    <td className="num mono" style={{ fontWeight: 700, color: item.unit_tests_count > 0 ? '#1d4ed8' : '#94a3b8' }}>
                      {item.unit_tests_count}
                    </td>
                    <td className="num mono" style={{ fontWeight: 700, color: item.exams_count > 0 ? '#c2410c' : '#94a3b8' }}>
                      {item.exams_count}
                    </td>
                    <td className="num mono" style={{ fontWeight: 800, fontSize: '13px' }}>
                      {item.total_tests_count}
                    </td>
                    <td className="num">
                      <span
                        className="chip"
                        style={{
                          background: !hasTests ? '#f1f5f9' : isFullyGraded ? '#dcfce7' : '#fef3c7',
                          color: !hasTests ? '#64748b' : isFullyGraded ? '#166534' : '#92400e',
                          fontWeight: 700,
                          fontSize: '11px'
                        }}
                      >
                        {item.tests_with_marks_count} / {item.total_tests_count} ({item.tests_with_marks_pct}%)
                      </span>
                    </td>
                    <td className="num">
                      {item.average_score_pct !== null ? (
                        <span style={{
                          fontWeight: 700,
                          color: item.average_score_pct >= 65 ? '#15803d' : item.average_score_pct >= 50 ? '#d97706' : '#dc2626'
                        }}>
                          {item.average_score_pct}%
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: '12px' }}>
                      {item.last_submission_date ? fmtDate(item.last_submission_date) : <span className="muted">—</span>}
                    </td>
                    <td className="right">
                      <Link
                        to={`/dashboard/marks/class/${item.class_id}`}
                        className="btn btn-small btn-secondary"
                        style={{ fontSize: '11px', padding: '3px 8px' }}
                        title={`View tabulated broadsheet for ${item.class_name}`}
                      >
                        Tabulated Sheet →
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
