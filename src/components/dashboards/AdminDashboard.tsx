import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { downloadAttendanceCsv, downloadAttendanceExcel } from '../../lib/attendanceExport'
import type { AdminDashboardData } from '../../lib/types'
import LeeraLoader from '../LeeraLoader'

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function AdminDashboard() {
  const { profile } = useAuth()
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null)
  const [search, setSearch] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.getAdminDashboardData()
      setData(res)
    } catch (err: any) {
      setError(err?.message || 'Failed to load administrator dashboard data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleDownloadExcel = async () => {
    setExporting('xlsx')
    try {
      const detailed = await api.getDetailedAttendanceReport('daily', todayIso())
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
      const detailed = await api.getDetailedAttendanceReport('daily', todayIso())
      downloadAttendanceCsv(detailed)
    } catch (e: any) {
      setError(`CSV download failed: ${e.message}`)
    } finally {
      setExporting(null)
    }
  }

  const filteredClasses = useMemo(() => {
    if (!data?.classes_summary) return []
    const q = search.trim().toLowerCase()
    if (!q) return data.classes_summary
    return data.classes_summary.filter(
      (c) =>
        c.class_name.toLowerCase().includes(q) ||
        c.homeroom_teacher_name.toLowerCase().includes(q)
    )
  }, [data, search])

  const todayFormatted = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })

  if (loading) {
    return (
      <LeeraLoader
        message="Loading administrator dashboard"
        subMessage="Preparing attendance & class summaries"
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

  const todayAtt = data?.today_attendance
  const allMarked = todayAtt && todayAtt.total_classes_count > 0 && todayAtt.marked_classes_count === todayAtt.total_classes_count

  return (
    <div className="stack" style={{ gap: '24px' }}>
      {/* Welcome Banner */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: '#ffffff',
          padding: '24px 28px',
          borderRadius: '16px',
          boxShadow: '0 4px 20px rgba(15, 23, 42, 0.15)'
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '20px' }}>🏛️</span>
              <span style={{
                background: 'rgba(255,255,255,0.15)',
                color: '#e2e8f0',
                padding: '3px 10px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '0.5px'
              }}>
                ADMINISTRATION PORTAL
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#ffffff' }}>
              Welcome back, {profile?.full_name || 'Administrator'}
            </h1>
            <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '14px' }}>
              {data?.school_info.name} • {data?.school_info.academic_year} ({data?.school_info.semester})
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{
              display: 'inline-block',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#cbd5e1'
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

      {/* Metric Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px'
        }}
      >
        {/* Total Students */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Enrolled Students
            </span>
            <span style={{ fontSize: '20px' }}>👥</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a' }}>
            {data?.total_students ?? 0}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#64748b' }}>
            Registered across {data?.total_classes ?? 0} classes
          </p>
        </div>

        {/* Classes Registered */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Active Classes
            </span>
            <span style={{ fontSize: '20px' }}>🏫</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a' }}>
            {data?.total_classes ?? 0}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#64748b' }}>
            Active grade levels & homerooms
          </p>
        </div>

        {/* Today's Attendance Rate */}
        <div className="card" style={{
          padding: '20px',
          borderRadius: '12px',
          borderLeft: `4px solid ${(todayAtt?.overall_rate_pct ?? 0) >= 90 ? '#10b981' : (todayAtt?.overall_rate_pct ?? 0) >= 75 ? '#f59e0b' : '#ef4444'}`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Today's Attendance
            </span>
            <span style={{ fontSize: '20px' }}>📈</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: (todayAtt?.overall_rate_pct ?? 0) >= 90 ? '#047857' : '#b45309' }}>
            {todayAtt?.overall_rate_pct ?? 0}%
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#64748b' }}>
            {todayAtt?.present_count ?? 0} Present • {todayAtt?.absent_count ?? 0} Absent
          </p>
        </div>

        {/* Register Completion */}
        <div className="card" style={{
          padding: '20px',
          borderRadius: '12px',
          borderLeft: `4px solid ${allMarked ? '#10b981' : '#f59e0b'}`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Registers Marked
            </span>
            <span style={{ fontSize: '20px' }}>📋</span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: allMarked ? '#047857' : '#0f172a' }}>
            {todayAtt?.marked_classes_count ?? 0} / {todayAtt?.total_classes_count ?? 0}
          </div>
          <div style={{ marginTop: '6px' }}>
            <span style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: 600,
              background: allMarked ? '#dcfce7' : '#fef3c7',
              color: allMarked ? '#166534' : '#92400e'
            }}>
              {allMarked ? '✓ All Classes Completed' : `${(todayAtt?.total_classes_count ?? 0) - (todayAtt?.marked_classes_count ?? 0)} Class Pending`}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Actions Panel */}
      <div className="card" style={{ padding: '20px 24px', borderRadius: '12px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
          ⚡ Administrative Quick Actions
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleDownloadExcel}
            disabled={exporting !== null}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <span>📥</span>
            <span>{exporting === 'xlsx' ? 'Generating Excel...' : "Export Today's Attendance (Excel)"}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleDownloadCsv}
            disabled={exporting !== null}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <span>📄</span>
            <span>{exporting === 'csv' ? 'Generating CSV...' : "Export Today's Attendance (CSV)"}</span>
          </button>

          <Link
            to="/attendance"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <span>📋</span>
            <span>Open Attendance Register</span>
          </Link>

          <Link
            to="/settings"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <span>⚙️</span>
            <span>School Settings & Terms</span>
          </Link>
        </div>
      </div>

      {/* Today's Class-by-Class Attendance Monitor */}
      <div className="card" style={{ padding: '24px', borderRadius: '12px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              Today's Class Attendance Monitor
            </h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>
              Real-time daily register status for all homeroom classes
            </p>
          </div>
          <div style={{ minWidth: '220px' }}>
            <input
              type="search"
              className="input"
              placeholder="Filter by class or teacher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', fontSize: '13px' }}
            />
          </div>
        </div>

        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '12px 14px' }}>Class</th>
                <th style={{ padding: '12px 14px' }}>Homeroom Teacher</th>
                <th className="num" style={{ padding: '12px 14px' }}>Students</th>
                <th className="num" style={{ padding: '12px 14px' }}>Present</th>
                <th className="num" style={{ padding: '12px 14px' }}>Absent / Excused</th>
                <th className="num" style={{ padding: '12px 14px' }}>Rate %</th>
                <th style={{ padding: '12px 14px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredClasses.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                    No classes found matching search criteria.
                  </td>
                </tr>
              ) : (
                filteredClasses.map((cls) => (
                  <tr key={cls.class_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 14px', fontWeight: 600, color: '#0f172a' }}>
                      {cls.class_name}
                    </td>
                    <td style={{ padding: '12px 14px', color: '#475569' }}>
                      {cls.homeroom_teacher_name}
                    </td>
                    <td className="num mono" style={{ padding: '12px 14px', fontWeight: 600 }}>
                      {cls.student_count}
                    </td>
                    <td className="num mono" style={{ padding: '12px 14px', color: cls.is_marked ? '#047857' : '#94a3b8' }}>
                      {cls.is_marked ? cls.present_count : '—'}
                    </td>
                    <td className="num mono" style={{ padding: '12px 14px', color: cls.is_marked && cls.absent_count > 0 ? '#b91c1c' : '#94a3b8' }}>
                      {cls.is_marked ? cls.absent_count : '—'}
                    </td>
                    <td className="num" style={{ padding: '12px 14px' }}>
                      {cls.is_marked ? (
                        <span style={{
                          fontWeight: 700,
                          color: cls.rate_pct >= 90 ? '#047857' : cls.rate_pct >= 75 ? '#b45309' : '#b91c1c'
                        }}>
                          {cls.rate_pct}%
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <span
                        className="chip"
                        style={{
                          background: cls.is_marked ? '#dcfce7' : '#fef3c7',
                          color: cls.is_marked ? '#166534' : '#92400e',
                          fontWeight: 600,
                          fontSize: '11px'
                        }}
                      >
                        {cls.is_marked ? '✓ Marked' : '⏳ Pending'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <Link
                        to="/attendance"
                        className="btn btn-secondary btn-sm"
                        style={{ textDecoration: 'none', padding: '4px 10px', fontSize: '12px' }}
                      >
                        View Register
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* School Information Card */}
      <div className="card" style={{ padding: '20px 24px', borderRadius: '12px', background: '#f8fafc' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#334155' }}>
              🏫 School Profile & Academic Session
            </h4>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              {data?.school_info.name} • {data?.school_info.academic_year} • {data?.school_info.semester}
              {data?.school_info.motto ? ` • "${data.school_info.motto}"` : ''}
            </p>
          </div>
          <Link to="/settings" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
            Edit Settings
          </Link>
        </div>
      </div>
    </div>
  )
}
