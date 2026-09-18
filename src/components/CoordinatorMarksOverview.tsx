import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtDate } from '../lib/report'
import type { ClassInfo, EndOfUnitTestOverview, Subject } from '../lib/types'

interface CoordinatorMarksOverviewProps {
  classes: ClassInfo[]
  subjects: Subject[]
  onSelectClassAndSubject?: (classId: string, subjectId?: string) => void
}

export default function CoordinatorMarksOverview({
  classes,
  subjects,
  onSelectClassAndSubject
}: CoordinatorMarksOverviewProps) {
  const [data, setData] = useState<EndOfUnitTestOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [testSearch, setTestSearch] = useState('')
  const [filterClassId, setFilterClassId] = useState('all')
  const [filterSubjectId, setFilterSubjectId] = useState('all')
  const [onlyWithMarks, setOnlyWithMarks] = useState(false)
  const [teacherSearch, setTeacherSearch] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const overview = await api.getUnitTestOverview()
      setData(overview)
    } catch (err: any) {
      setError(err?.message || 'Failed to load school-wide marks overview.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Filtered unit tests, sorted strictly Class-wise -> Subject-wise -> Topic-wise
  const filteredTests = useMemo(() => {
    if (!data) return []
    const source = onlyWithMarks ? data.tests_with_marks : data.all_tests
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
  }, [data, onlyWithMarks, filterClassId, filterSubjectId, testSearch])

  // Filtered teachers summary
  const filteredTeachers = useMemo(() => {
    if (!data?.teacher_summaries) return []
    if (!teacherSearch.trim()) return data.teacher_summaries
    const q = teacherSearch.toLowerCase()
    return data.teacher_summaries.filter((t) =>
      t.teacher_name.toLowerCase().includes(q) ||
      t.class_names.some((c) => c.toLowerCase().includes(q)) ||
      t.subjects.some((s) => s.toLowerCase().includes(q))
    )
  }, [data?.teacher_summaries, teacherSearch])

  if (loading && !data) {
    return (
      <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>Loading school-wide marks overview...</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card alert-box" style={{ background: '#fef2f2', borderColor: '#fca5a5', padding: '20px' }}>
        <h4 style={{ color: '#991b1b', margin: '0 0 8px' }}>Error Loading Overview</h4>
        <p style={{ color: '#b91c1c', margin: '0 0 12px' }}>{error}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={loadData}>
          Try Again
        </button>
      </div>
    )
  }

  const totalTests = data?.total_tests ?? 0
  const totalWithMarks = data?.total_tests_with_marks ?? 0
  const totalPending = totalTests - totalWithMarks
  const avgPct = data?.overall_average_pct

  return (
    <div className="stack" style={{ gap: '20px' }}>
      {/* KPI Stats Row */}
      <div className="grid4">
        <div className="card stat-box">
          <div className="stat-label">Total Unit Tests Recorded</div>
          <div className="stat-value">{totalTests}</div>
          <div className="stat-meta">Across all classes & subjects</div>
        </div>

        <div className="card stat-box">
          <div className="stat-label">Tests With Marks Entered</div>
          <div className="stat-value" style={{ color: '#10b981' }}>{totalWithMarks}</div>
          <div className="stat-meta">
            {totalTests > 0 ? `${((totalWithMarks / totalTests) * 100).toFixed(0)}% completion rate` : '0%'}
          </div>
        </div>

        <div className="card stat-box">
          <div className="stat-label">Tests Awaiting Scores</div>
          <div className="stat-value" style={{ color: totalPending > 0 ? '#f59e0b' : '#10b981' }}>
            {totalPending}
          </div>
          <div className="stat-meta">
            {totalPending > 0 ? 'Pending teacher entry' : 'All marks submitted'}
          </div>
        </div>

        <div className="card stat-box">
          <div className="stat-label">School-Wide Average</div>
          <div className="stat-value" style={{
            color: avgPct !== null && avgPct !== undefined
              ? (avgPct >= 70 ? '#10b981' : avgPct >= 50 ? '#f59e0b' : '#ef4444')
              : '#94a3b8'
          }}>
            {avgPct !== null && avgPct !== undefined ? `${avgPct}%` : '—'}
          </div>
          <div className="stat-meta">Average across all scored tests</div>
        </div>
      </div>

      {/* Subject Summary Cards */}
      {data && data.subject_summaries.length > 0 && (
        <div className="card stack" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px' }}>📊 Subject Performance Breakdown</h3>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: '13px' }}>
                Summary of unit tests and average score percentages by subject
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={loadData}>
              🔄 Refresh
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '12px',
              marginTop: '12px'
            }}
          >
            {data.subject_summaries.map((sub) => (
              <div
                key={sub.subject_id}
                style={{
                  background: '#f8fafc',
                  border: '1px solid var(--line)',
                  padding: '14px',
                  borderRadius: '10px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <strong style={{ fontSize: '15px', color: 'var(--teal)' }}>{sub.subject_name}</strong>
                  <span className="chip" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11px' }}>
                    {sub.tests_with_marks_count} scored test{sub.tests_with_marks_count === 1 ? '' : 's'}
                  </span>
                </div>
                <div style={{ marginTop: '8px', fontSize: '13px' }}>
                  <div>
                    <strong>Average Score: </strong>
                    <span style={{
                      fontWeight: 700,
                      color: sub.average_score_pct !== null
                        ? (sub.average_score_pct >= 70 ? '#10b981' : sub.average_score_pct >= 50 ? '#d97706' : '#dc2626')
                        : '#94a3b8'
                    }}>
                      {sub.average_score_pct !== null ? `${sub.average_score_pct}%` : '—'}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                    Teacher(s): {sub.teachers.length > 0 ? sub.teachers.join(', ') : 'Assigned teachers'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Teachers Summary Table */}
      {data && data.teacher_summaries && data.teacher_summaries.length > 0 && (
        <section className="card stack" style={{ padding: '20px' }}>
          <div className="page-head" style={{ marginBottom: 0 }}>
            <div>
              <h3 style={{ fontSize: '16px', margin: 0 }}>👩‍🏫 Teachers Mark Entry & Performance Tracking</h3>
              <p className="muted" style={{ fontSize: '13px', margin: '2px 0 0' }}>
                Unit tests issued, marks completion status, score averages, and pending marks per teacher
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
                  <th>Assigned Classes</th>
                  <th>Subjects</th>
                  <th className="num">Tests Created</th>
                  <th className="num">With Marks</th>
                  <th className="num">Average Score</th>
                  <th className="num">Pending Marks</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeachers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted center" style={{ padding: '20px' }}>
                      No teachers match your search.
                    </td>
                  </tr>
                ) : (
                  filteredTeachers.map((t) => {
                    const pendingTests = Math.max(0, t.tests_count - t.tests_with_marks_count)
                    const isFullyScored = pendingTests === 0 && t.tests_count > 0
                    return (
                      <tr key={t.teacher_id}>
                        <td><strong>{t.teacher_name}</strong></td>
                        <td style={{ fontSize: '13px' }}>{t.class_names.join(', ') || '—'}</td>
                        <td style={{ fontSize: '13px' }}>
                          {t.subjects.map((s) => (
                            <span key={s} className="role-tag" style={{ marginRight: 4, marginBottom: 2 }}>{s}</span>
                          ))}
                        </td>
                        <td className="num font-bold">{t.tests_count}</td>
                        <td className="num">
                          <span className="chip" style={{
                            background: isFullyScored ? '#dcfce7' : t.tests_with_marks_count > 0 ? '#fef3c7' : '#f1f5f9',
                            color: isFullyScored ? '#166534' : t.tests_with_marks_count > 0 ? '#92400e' : '#64748b'
                          }}>
                            {t.tests_with_marks_count} ({t.tests_with_marks_pct}%)
                          </span>
                        </td>
                        <td className="num">
                          {t.average_score_pct !== null ? (
                            <span style={{ fontWeight: 700, color: t.average_score_pct >= 70 ? '#10b981' : t.average_score_pct >= 50 ? '#d97706' : '#dc2626' }}>
                              {t.average_score_pct}%
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="num">
                          {pendingTests > 0 ? (
                            <span style={{ color: '#d97706', fontWeight: 700 }}>
                              ⏳ {pendingTests}
                            </span>
                          ) : (
                            <span style={{ color: '#10b981' }}>✓ 0</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${isFullyScored ? 'badge-success' : pendingTests > 0 ? 'badge-warning' : 'badge-neutral'}`}>
                            {isFullyScored ? 'All Scored' : pendingTests > 0 ? 'Pending Scores' : 'No Tests'}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* School-Wide Detailed Tests Registry */}
      <section className="card stack" style={{ padding: '20px' }}>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h3 style={{ fontSize: '16px', margin: 0 }}>📝 School-Wide Unit Tests Registry</h3>
            <p className="muted" style={{ fontSize: '13px', margin: '2px 0 0' }}>
              All tests sorted Class-wise, Subject-wise, and Topic-wise. Direct access to score entry and marksheets.
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

        {/* Filters */}
        <div className="row" style={{ gap: '10px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="search"
            style={{ maxWidth: '240px', margin: 0 }}
            placeholder="Search topic, subject, teacher, class…"
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
            Showing {filteredTests.length} test{filteredTests.length === 1 ? '' : 's'}
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
                    <td>
                      {onSelectClassAndSubject ? (
                        <button
                          type="button"
                          onClick={() => onSelectClassAndSubject(t.class_id, t.subject_id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            color: 'var(--brand)',
                            fontWeight: 700,
                            textDecoration: 'underline'
                          }}
                          title="Open in Class Unit Tests view"
                        >
                          {t.class_name}
                        </button>
                      ) : (
                        <strong>{t.class_name}</strong>
                      )}
                    </td>
                    <td>
                      <span className="role-tag" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                        {t.subject_name}
                      </span>
                    </td>
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
                        <span style={{ fontWeight: 700, color: t.average_pct >= 70 ? '#10b981' : t.average_pct >= 50 ? '#d97706' : '#dc2626' }}>
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
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <Link
                          to={`/marks/${t.class_id}/${t.test_id}?view=entry`}
                          className="btn btn-small btn-primary"
                          title="Enter student scores"
                        >
                          Scores
                        </Link>
                        <Link
                          to={`/marks/${t.class_id}/${t.test_id}?view=marksheet`}
                          className="btn btn-small"
                          title="View read-only marksheet table"
                        >
                          Sheet
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
