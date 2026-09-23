import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useSchool } from '../../context/SchoolContext'
import type { TeacherDashboardData } from '../../lib/types'
import LeeraLoader from '../LeeraLoader'

export default function HomeroomTeacherDashboard() {
  const { profile } = useAuth()
  const { setSelectedClassId } = useSchool()
  const [data, setData] = useState<TeacherDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadData = async () => {
    if (!profile?.id) return
    setLoading(true)
    setError('')
    try {
      const res = await api.getTeacherDashboardData(profile.id, profile.class_id)
      setData(res)
    } catch (err: any) {
      setError(err?.message || 'Failed to load homeroom teacher dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [profile?.id, profile?.class_id])

  const todayFormatted = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  if (loading) {
    return (
      <LeeraLoader
        message="Loading teacher dashboard"
        subMessage="Preparing classes, attendance & unit tests"
      />
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

  const hr = data?.homeroomClass
  const att = data?.todayAttendance
  const isAttMarked = att?.marked ?? false

  return (
    <div className="stack" style={{ gap: '24px' }}>
      {/* Welcome Banner */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1e1b4b 100%)',
          color: '#ffffff',
          padding: '24px 28px',
          borderRadius: '16px',
          boxShadow: '0 4px 20px rgba(30, 58, 138, 0.15)'
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '20px' }}>🏫</span>
              <span style={{
                background: 'rgba(255,255,255,0.15)',
                color: '#e2e8f0',
                padding: '3px 10px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '0.5px'
              }}>
                HOMEROOM TEACHER
              </span>
              {hr && (
                <span style={{
                  background: 'rgba(59, 130, 246, 0.5)',
                  color: '#ffffff',
                  padding: '3px 10px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: 600
                }}>
                  Class: {hr.name}
                </span>
              )}
            </div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#ffffff' }}>
              Welcome, {profile?.full_name || 'Teacher'}
            </h1>
            <p style={{ margin: '6px 0 0', color: '#cbd5e1', fontSize: '14px' }}>
              {hr ? `Homeroom Advisor for ${hr.name}` : 'Homeroom Teacher Dashboard'}
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

      {/* Attendance Status Callout Banner */}
      {hr && (
        <div
          className="card"
          style={{
            padding: '20px 24px',
            borderRadius: '14px',
            border: isAttMarked ? '1px solid #86efac' : '2px solid #f59e0b',
            background: isAttMarked ? '#f0fdf4' : '#fffbeb'
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: isAttMarked ? '#dcfce7' : '#fef3c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px'
              }}>
                {isAttMarked ? '✅' : '⚠️'}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: isAttMarked ? '#166534' : '#92400e' }}>
                  {isAttMarked ? "Today's Attendance is Recorded" : "Today's Attendance Has Not Been Taken!"}
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: isAttMarked ? '#15803d' : '#b45309' }}>
                  {isAttMarked
                    ? `${hr.name}: ${att?.present_count ?? 0} Present, ${att?.absent_count ?? 0} Absent (${att?.rate_pct ?? 0}% Attendance)`
                    : `Please record morning attendance for ${hr.name} (${hr.student_count} students).`}
                </p>
              </div>
            </div>
            <div>
              <Link
                to="/attendance"
                className={`btn ${isAttMarked ? 'btn-secondary' : 'btn-primary'}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  textDecoration: 'none',
                  fontWeight: 600,
                  background: isAttMarked ? undefined : '#d97706',
                  borderColor: isAttMarked ? undefined : '#b45309'
                }}
              >
                <span>{isAttMarked ? 'Review / Edit Register' : 'Take Attendance Now →'}</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Primary Homeroom Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px'
        }}
      >
        {/* Class Students Roster */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: '4px solid #2563eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Class Students
            </span>
            <span style={{ fontSize: '20px' }}>👥</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a' }}>
            {hr?.student_count ?? 0}
          </div>
          <p style={{ margin: '6px 0 10px', fontSize: '12px', color: '#64748b' }}>
            👦 {hr?.boys_count ?? 0} Boys • 👧 {hr?.girls_count ?? 0} Girls
          </p>
          <Link to="/students" style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>
            Manage Roster →
          </Link>
        </div>

        {/* Today's Attendance Rate */}
        <div className="card" style={{
          padding: '20px',
          borderRadius: '12px',
          borderLeft: `4px solid ${isAttMarked ? '#10b981' : '#f59e0b'}`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Today's Attendance
            </span>
            <span style={{ fontSize: '20px' }}>📈</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: isAttMarked ? '#047857' : '#b45309' }}>
            {isAttMarked ? `${att?.rate_pct ?? 0}%` : 'Pending'}
          </div>
          <p style={{ margin: '6px 0 10px', fontSize: '12px', color: '#64748b' }}>
            {isAttMarked ? `${att?.present_count ?? 0} Present • ${att?.absent_count ?? 0} Absent` : 'Not submitted today'}
          </p>
          <Link to="/attendance" style={{ fontSize: '12px', fontWeight: 600, color: isAttMarked ? '#047857' : '#b45309', textDecoration: 'none' }}>
            {isAttMarked ? 'View Register →' : 'Take Attendance →'}
          </Link>
        </div>

        {/* Unit Tests */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Unit Tests
            </span>
            <span style={{ fontSize: '20px' }}>📝</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a' }}>
            {(data?.totalTestsCreated && data.totalTestsCreated > 0) ? data.totalTestsCreated : (data?.homeroomTestsCount ?? 0)}
          </div>
          <p style={{ margin: '6px 0 10px', fontSize: '12px', color: '#64748b' }}>
            {data?.totalTestsCreated && data.totalTestsCreated > 0
              ? `${data.totalTestsCreated} created in subjects you teach`
              : 'Across all class subjects'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
            <Link to="/marks" style={{ fontSize: '12px', fontWeight: 600, color: '#8b5cf6', textDecoration: 'none' }}>
              View Marksheets →
            </Link>
            {hr && (
              <Link to={`/marks/class/${hr.id}`} style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>
                📊 Tabulated Sheet →
              </Link>
            )}
          </div>
        </div>

        {/* Student Reports */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: '4px solid #06b6d4' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Term Reports
            </span>
            <span style={{ fontSize: '20px' }}>🖨️</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a' }}>
            {data?.homeroomReportsCount ?? 0} / {hr?.student_count ?? 0}
          </div>
          <p style={{ margin: '6px 0 10px', fontSize: '12px', color: '#64748b' }}>
            Students with assessment scores
          </p>
          <Link to="/reports" style={{ fontSize: '12px', fontWeight: 600, color: '#06b6d4', textDecoration: 'none' }}>
            Generate Report Cards →
          </Link>
        </div>
      </div>

      {/* Homeroom Tabulated Scoresheet Callout Banner */}
      {hr && (
        <div
          className="card"
          style={{
            padding: '20px 24px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)',
            border: '1px solid #bfdbfe',
            boxShadow: '0 2px 10px rgba(59, 130, 246, 0.08)'
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '52px',
                height: '52px',
                borderRadius: '14px',
                background: '#ffffff',
                border: '1px solid #dbeafe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '26px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
              }}>
                📊
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                    {hr.name} — Tabulated Marksheet View
                  </h3>
                  <span style={{ fontSize: '11px', fontWeight: 700, background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '12px' }}>
                    BROADSHEET
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#475569' }}>
                  Full tabulated sheet for your class showing all {hr.student_count} learners, all subjects, unit test scores, subject averages & overall performance.
                </p>
              </div>
            </div>
            <div>
              <Link
                to={`/marks/class/${hr.id}`}
                className="btn btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  textDecoration: 'none',
                  fontWeight: 600,
                  padding: '10px 18px',
                  borderRadius: '10px'
                }}
              >
                <span>Open Tabulated Sheet →</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Quick Action Shortcuts */}
      <div className="card" style={{ padding: '20px 24px', borderRadius: '12px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
          ⚡ Quick Shortcuts
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <Link
            to="/attendance"
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <span>📋</span>
            <span>Take Today's Attendance</span>
          </Link>

          <Link
            to="/students"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <span>👥</span>
            <span>View Student Roster</span>
          </Link>

          {hr && (
            <Link
              to={`/marks/class/${hr.id}`}
              className="btn btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                textDecoration: 'none',
                background: '#eff6ff',
                borderColor: '#bfdbfe',
                color: '#1d4ed8',
                fontWeight: 600
              }}
            >
              <span>📊</span>
              <span>Class Tabulated Sheet</span>
            </Link>
          )}

          <Link
            to="/marks"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <span>📝</span>
            <span>Class Marksheets</span>
          </Link>

          <Link
            to="/reports"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <span>🖨️</span>
            <span>Student Report Cards</span>
          </Link>
        </div>
      </div>

      {/* Subjects You Teach (Dual Role Support) */}
      <div className="card" style={{ padding: '24px', borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              📚 Subjects You Teach
            </h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>
              Subject assignments, End of Unit tests, and marks entry progress
            </p>
          </div>
          <Link
            to="/marks?action=new"
            className="btn btn-secondary btn-sm"
            style={{ textDecoration: 'none' }}
          >
            + Create Unit Test
          </Link>
        </div>

        {(!data?.assignments || data.assignments.length === 0) ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px' }}>
            <p style={{ margin: 0 }}>You are not currently assigned to teach any specific subject courses.</p>
            <p style={{ margin: '4px 0 0', fontSize: '12px' }}>Subject assignments are managed by the Curriculum Coordinator.</p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px'
            }}
          >
            {data.assignments
              .filter((asgn) => asgn.subject_name && !asgn.subject_name.toLowerCase().includes('unknown'))
              .map((asgn) => {
              const hasPending = asgn.pending_marks_count > 0

              return (
                <div
                  key={asgn.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '16px',
                    background: '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                      <div>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: '#e0f2fe',
                          color: '#0369a1',
                          marginBottom: '4px'
                        }}>
                          {asgn.subject_name}
                        </span>
                        <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
                          {asgn.class_name}
                        </h4>
                      </div>

                      {hasPending ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: '#fef3c7',
                          color: '#92400e'
                        }}>
                          ⏳ {asgn.pending_marks_count} Awaiting Marks
                        </span>
                      ) : (
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: asgn.tests_count > 0 ? '#dcfce7' : '#f1f5f9',
                          color: asgn.tests_count > 0 ? '#166534' : '#64748b'
                        }}>
                          {asgn.tests_count > 0 ? '✓ Complete' : 'No tests yet'}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '16px', margin: '12px 0', fontSize: '13px' }}>
                      <div>
                        <span style={{ color: '#64748b', fontSize: '11px', textTransform: 'uppercase' }}>Tests</span>
                        <div style={{ fontWeight: 700, fontSize: '16px', color: '#0f172a' }}>{asgn.tests_count}</div>
                      </div>
                      <div>
                        <span style={{ color: '#64748b', fontSize: '11px', textTransform: 'uppercase' }}>Avg Score</span>
                        <div style={{
                          fontWeight: 700,
                          fontSize: '16px',
                          color: asgn.average_pct !== null
                            ? (asgn.average_pct >= 70 ? '#10b981' : asgn.average_pct >= 50 ? '#f59e0b' : '#ef4444')
                            : '#94a3b8'
                        }}>
                          {asgn.average_pct !== null ? `${asgn.average_pct}%` : '—'}
                        </div>
                      </div>
                    </div>

                    {asgn.latest_test_title && (
                      <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#64748b' }}>
                        Latest: <strong>{asgn.latest_test_title}</strong> {asgn.latest_test_date ? `(${asgn.latest_test_date})` : ''}
                      </p>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                    <Link
                      to={`/marks?classId=${asgn.class_id}&subjectId=${asgn.subject_id}`}
                      className="btn btn-secondary btn-sm"
                      style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
                      onClick={() => setSelectedClassId(asgn.class_id)}
                    >
                      View Tests
                    </Link>
                    <Link
                      to={`/marks?classId=${asgn.class_id}&subjectId=${asgn.subject_id}`}
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}
                      onClick={() => setSelectedClassId(asgn.class_id)}
                    >
                      Enter Marks
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
