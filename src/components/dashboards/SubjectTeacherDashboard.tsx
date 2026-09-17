import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import type { TeacherDashboardData } from '../../lib/types'

export default function SubjectTeacherDashboard() {
  const { profile } = useAuth()
  const [data, setData] = useState<TeacherDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadData = async () => {
    if (!profile?.id) return
    setLoading(true)
    setError('')
    try {
      const res = await api.getTeacherDashboardData(profile.id, null)
      setData(res)
    } catch (err: any) {
      setError(err?.message || 'Failed to load subject teacher dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [profile?.id])

  const todayFormatted = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  if (loading) {
    return (
      <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
        <p className="muted" style={{ fontSize: '15px' }}>Loading subject teacher dashboard...</p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="card alert-box" style={{ background: '#fef2f2', borderColor: '#fca5a5', padding: '24px' }}>
        <h3 style={{ color: '#991b1b', margin: '0 0 8px' }}>Dashboard Error</h3>
        <p style={{ color: '#b91c1c', margin: '0 0 16px' }}>{error}</p>
        <button type="button" className="btn btn-secondary" onClick={loadData}>
          Try Again
        </button>
      </div>
    )
  }

  const hasPending = (data?.totalPendingMarks ?? 0) > 0
  const assignments = data?.assignments ?? []

  return (
    <div className="stack" style={{ gap: '24px' }}>
      {/* Welcome Banner */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)',
          color: '#ffffff',
          padding: '24px 28px',
          borderRadius: '16px',
          boxShadow: '0 4px 20px rgba(15, 118, 110, 0.15)'
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '20px' }}>🔬</span>
              <span style={{
                background: 'rgba(255,255,255,0.15)',
                color: '#e2e8f0',
                padding: '3px 10px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '0.5px'
              }}>
                SUBJECT TEACHER
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#ffffff' }}>
              Welcome, {profile?.full_name || 'Teacher'}
            </h1>
            <p style={{ margin: '6px 0 0', color: '#ccfbf1', fontSize: '14px' }}>
              Subject Teaching & Assessment Portal • Manage Unit Tests and Scores
            </p>
          </div>
          <div>
            <span style={{
              display: 'inline-block',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#e2e8f0'
            }}>
              📅 {todayFormatted}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ background: '#fef2f2', borderColor: '#fca5a5', padding: '12px 16px', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {/* Pending Marks Alert Banner */}
      {hasPending && (
        <div
          className="card"
          style={{
            padding: '18px 24px',
            borderRadius: '14px',
            border: '2px solid #f59e0b',
            background: '#fffbeb',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '28px' }}>⏳</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#92400e' }}>
                {data?.totalPendingMarks} Test(s) Awaiting Marks Entry
              </h3>
              <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#b45309' }}>
                You have created unit tests that do not yet have student scores recorded.
              </p>
            </div>
          </div>
          <Link
            to="/marks"
            className="btn btn-primary"
            style={{
              background: '#d97706',
              borderColor: '#b45309',
              fontWeight: 600,
              textDecoration: 'none'
            }}
          >
            Enter Marks Now →
          </Link>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px'
        }}
      >
        {/* Assigned Courses */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: '4px solid #0d9488' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Assigned Classes
            </span>
            <span style={{ fontSize: '20px' }}>📚</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a' }}>
            {assignments.length}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#64748b' }}>
            Active subject assignments
          </p>
        </div>

        {/* Total Tests Created */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Unit Tests Conducted
            </span>
            <span style={{ fontSize: '20px' }}>📝</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a' }}>
            {data?.totalTestsCreated ?? 0}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#64748b' }}>
            Across all assigned classes
          </p>
        </div>

        {/* Pending Marks Count */}
        <div className="card" style={{
          padding: '20px',
          borderRadius: '12px',
          borderLeft: `4px solid ${hasPending ? '#f59e0b' : '#10b981'}`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Pending Marks
            </span>
            <span style={{ fontSize: '20px' }}>{hasPending ? '⏳' : '✓'}</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: hasPending ? '#b45309' : '#047857' }}>
            {data?.totalPendingMarks ?? 0}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#64748b' }}>
            {hasPending ? 'Tests awaiting score submission' : 'All tests scored and complete'}
          </p>
        </div>

        {/* Overall Subject Average */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Overall Average
            </span>
            <span style={{ fontSize: '20px' }}>🎯</span>
          </div>
          <div style={{
            fontSize: '28px',
            fontWeight: 800,
            color: data?.overallSubjectAveragePct !== null
              ? ((data?.overallSubjectAveragePct ?? 0) >= 70 ? '#047857' : (data?.overallSubjectAveragePct ?? 0) >= 50 ? '#b45309' : '#b91c1c')
              : '#0f172a'
          }}>
            {data?.overallSubjectAveragePct !== null ? `${data?.overallSubjectAveragePct}%` : '—'}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#64748b' }}>
            Student score average across tests
          </p>
        </div>
      </div>

      {/* Quick Action Shortcuts */}
      <div className="card" style={{ padding: '20px 24px', borderRadius: '12px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
          ⚡ Quick Actions
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <Link
            to="/marks"
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <span>📝</span>
            <span>Create New Unit Test</span>
          </Link>

          <Link
            to="/marks"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <span>📊</span>
            <span>View All Marksheets</span>
          </Link>

          <Link
            to="/reports"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <span>🖨️</span>
            <span>Student Reports</span>
          </Link>
        </div>
      </div>

      {/* Teaching Assignments & Tests Grid */}
      <div className="card" style={{ padding: '24px', borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              Your Teaching Classes & Tests
            </h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>
              Select a class below to view tests, upload exam papers, or enter marks
            </p>
          </div>
          <Link to="/marks" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
            Open Assessment Center →
          </Link>
        </div>

        {assignments.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '12px' }}>
            <p style={{ fontSize: '16px', margin: 0 }}>No classes or subjects currently assigned.</p>
            <p style={{ fontSize: '13px', margin: '6px 0 0' }}>Contact your Curriculum Coordinator or Head of School to assign your teaching courses.</p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '20px'
            }}
          >
            {assignments.map((asgn) => {
              const pendingCount = asgn.pending_marks_count
              const tests = asgn.tests ?? []

              return (
                <div
                  key={asgn.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '14px',
                    padding: '20px',
                    background: '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
                  }}
                >
                  <div>
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 700,
                          background: '#ccfbf1',
                          color: '#0f766e',
                          marginBottom: '6px'
                        }}>
                          {asgn.subject_name}
                        </span>
                        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                          {asgn.class_name}
                        </h3>
                      </div>

                      {pendingCount > 0 ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: '#fef3c7',
                          color: '#92400e'
                        }}>
                          ⏳ {pendingCount} Awaiting Marks
                        </span>
                      ) : (
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: asgn.tests_count > 0 ? '#dcfce7' : '#f1f5f9',
                          color: asgn.tests_count > 0 ? '#166534' : '#64748b'
                        }}>
                          {asgn.tests_count > 0 ? '✓ Complete' : 'No tests'}
                        </span>
                      )}
                    </div>

                    {/* Stats summary */}
                    <div style={{
                      display: 'flex',
                      gap: '20px',
                      padding: '12px 14px',
                      background: '#f8fafc',
                      borderRadius: '8px',
                      margin: '12px 0 16px'
                    }}>
                      <div>
                        <span style={{ color: '#64748b', fontSize: '11px', textTransform: 'uppercase', display: 'block' }}>Unit Tests</span>
                        <span style={{ fontWeight: 700, fontSize: '16px', color: '#0f172a' }}>{asgn.tests_count}</span>
                      </div>
                      <div>
                        <span style={{ color: '#64748b', fontSize: '11px', textTransform: 'uppercase', display: 'block' }}>With Scores</span>
                        <span style={{ fontWeight: 700, fontSize: '16px', color: '#047857' }}>{asgn.tests_with_marks_count}</span>
                      </div>
                      <div>
                        <span style={{ color: '#64748b', fontSize: '11px', textTransform: 'uppercase', display: 'block' }}>Subject Average</span>
                        <span style={{
                          fontWeight: 700,
                          fontSize: '16px',
                          color: asgn.average_pct !== null
                            ? (asgn.average_pct >= 70 ? '#047857' : asgn.average_pct >= 50 ? '#b45309' : '#b91c1c')
                            : '#94a3b8'
                        }}>
                          {asgn.average_pct !== null ? `${asgn.average_pct}%` : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Tests list drilldown */}
                    <div style={{ marginBottom: '16px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Tests in this course
                      </span>

                      {tests.length === 0 ? (
                        <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                          No tests created yet.
                        </p>
                      ) : (
                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {tests.slice(0, 4).map((t) => (
                            <div
                              key={t.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 10px',
                                background: '#ffffff',
                                border: '1px solid #f1f5f9',
                                borderRadius: '6px',
                                fontSize: '12px'
                              }}
                            >
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '170px' }}>
                                <span style={{ fontWeight: 600, color: '#1e293b' }}>{t.title}</span>
                                <div style={{ color: '#94a3b8', fontSize: '11px' }}>
                                  {t.test_date} • Max: {t.max_mark}
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {t.marks_entered ? (
                                  <span style={{
                                    padding: '2px 6px',
                                    borderRadius: '10px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    background: '#dcfce7',
                                    color: '#166534'
                                  }}>
                                    {t.average_pct !== null ? `${t.average_pct}%` : 'Scored'}
                                  </span>
                                ) : (
                                  <span style={{
                                    padding: '2px 6px',
                                    borderRadius: '10px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    background: '#fef3c7',
                                    color: '#92400e'
                                  }}>
                                    Pending
                                  </span>
                                )}

                                <Link
                                  to={`/marks/${asgn.class_id}/${t.id}`}
                                  className="btn btn-secondary btn-sm"
                                  style={{ padding: '2px 8px', fontSize: '11px', textDecoration: 'none' }}
                                >
                                  {t.marks_entered ? 'View' : 'Score'}
                                </Link>
                              </div>
                            </div>
                          ))}
                          {tests.length > 4 && (
                            <span style={{ fontSize: '11px', color: '#64748b', textAlign: 'center' }}>
                              + {tests.length - 4} more test(s)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                    <Link
                      to="/marks"
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
                    >
                      + New Test
                    </Link>
                    <Link
                      to="/marks"
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
                    >
                      All Marksheets →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
