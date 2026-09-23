import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import ReportSheet from '../components/ReportSheet'
import { DEFAULT_REPORT_START_DATE, filterReportRows, fmtDate } from '../lib/report'
import type { ReportFilter, Student, StudentReportRow } from '../lib/types'

export default function ReportView() {
  const { studentId } = useParams<{ studentId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { school, classes } = useSchool()
  const [student, setStudent] = useState<Student | null>(null)
  const [rows, setRows] = useState<StudentReportRow[]>([])
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  // Initialize filter state from URL search params with sensible defaults
  const [filterMode, setFilterMode] = useState<'since_date' | 'all' | 'custom'>(() => {
    const m = searchParams.get('mode')
    if (m === 'all' || m === 'custom' || m === 'since_date') return m
    return 'since_date'
  })
  const [startDate, setStartDate] = useState<string>(() => {
    return searchParams.get('since') || DEFAULT_REPORT_START_DATE
  })
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>(() => {
    const raw = searchParams.get('tests')
    return raw ? raw.split(',').filter(Boolean) : []
  })

  // Keep URL parameters in sync
  const updateFilter = (newMode: 'since_date' | 'all' | 'custom', newDate: string, newTests = selectedTestIds) => {
    setFilterMode(newMode)
    setStartDate(newDate)
    setSelectedTestIds(newTests)
    const nextParams = new URLSearchParams()
    nextParams.set('mode', newMode)
    if (newDate) nextParams.set('since', newDate)
    if (newMode === 'custom' && newTests.length > 0) nextParams.set('tests', newTests.join(','))
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    if (!studentId) return
    api.getStudent(studentId).then(setStudent).catch((e) => setError(e.message))
    api.getStudentReport(studentId).then(setRows).catch((e) => setError(e.message))
  }, [studentId])

  // Filter rows and dynamically recalculate averages for shown tests only
  const currentFilter: ReportFilter = useMemo(() => ({
    mode: filterMode,
    startDate,
    selectedTestIds
  }), [filterMode, startDate, selectedTestIds])

  const filteredRows = useMemo(() => {
    return filterReportRows(rows, currentFilter)
  }, [rows, currentFilter])

  const filterNotice = useMemo(() => {
    if (filterMode === 'since_date') {
      return `Tests created on or after ${fmtDate(startDate)}`
    }
    if (filterMode === 'custom') {
      return `${selectedTestIds.length} tests selected`
    }
    return undefined
  }, [filterMode, startDate, selectedTestIds])

  const downloadPdf = async () => {
    if (!student || !school) return
    setError('')
    setDownloading(true)
    try {
      const { downloadStudentPdf } = await import('../lib/pdf')
      const cls = classes.find((c) => c.id === student.class_id)
      await downloadStudentPdf({
        student,
        school,
        className: cls?.name ?? '',
        teacherName: cls?.homeroom_teacher_name ?? '',
        filterNotice,
        rows: filteredRows
      })
    } catch (e: any) {
      setError(e.message ?? 'PDF download failed.')
    } finally {
      setDownloading(false)
    }
  }

  if (!student || !school) {
    return (
      <div className="page">
        <div className="no-print"><Link to="/reports" className="btn btn-ghost">← Back</Link></div>
        <div className="card"><p className="muted center">Loading report…</p></div>
      </div>
    )
  }

  const cls = classes.find((c) => c.id === student.class_id)

  return (
    <div className="page page-print stack" style={{ gap: '14px' }}>
      {/* Top Action & Print Bar */}
      <div className="no-print printbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Link to={`/reports${searchParams.toString() ? `?${searchParams.toString()}` : ''}`} className="btn btn-ghost btn-sm">
            ← Back to Reports
          </Link>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" disabled={downloading || filteredRows.length === 0} onClick={downloadPdf}>
            {downloading ? 'Preparing PDF…' : '⬇ Download PDF'}
          </button>
          <button className="btn btn-secondary btn-sm" disabled={filteredRows.length === 0} onClick={() => window.print()}>
            🖨 Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Scope / Test Filter Bar */}
      <div
        className="no-print card"
        style={{
          maxWidth: '210mm',
          margin: '0 auto',
          width: '100%',
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          padding: '12px 16px',
          borderRadius: '10px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b' }}>
              🎯 Report Tests:
            </span>

            <div
              className="btn-group"
              style={{
                display: 'inline-flex',
                background: '#ffffff',
                padding: '2px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1'
              }}
            >
              <button
                type="button"
                className={`btn btn-sm ${filterMode === 'since_date' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: '4px', fontWeight: 600 }}
                onClick={() => updateFilter('since_date', startDate)}
              >
                ✨ New Tests Only
              </button>
              <button
                type="button"
                className={`btn btn-sm ${filterMode === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: '4px', fontWeight: 600 }}
                onClick={() => updateFilter('all', startDate)}
              >
                📚 All Tests
              </button>
            </div>

            {filterMode === 'since_date' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                <span>From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => updateFilter('since_date', e.target.value)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '6px',
                    border: '1px solid #94a3b8',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    background: '#fff'
                  }}
                />
              </label>
            )}

            {filterMode === 'since_date' && startDate !== DEFAULT_REPORT_START_DATE && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '11px', padding: '2px 6px' }}
                onClick={() => updateFilter('since_date', DEFAULT_REPORT_START_DATE)}
              >
                Reset to 20/09/2026
              </button>
            )}
          </div>

          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: filteredRows.length > 0 ? '#047857' : '#b45309',
              background: filteredRows.length > 0 ? '#dcfce7' : '#fef3c7',
              padding: '2px 8px',
              borderRadius: '12px'
            }}
          >
            {filteredRows.length} of {rows.length} tests shown · Averages recalculated
          </span>
        </div>
      </div>

      {error && <div className="no-print notice notice-error" style={{ maxWidth: '210mm', margin: '0 auto', width: '100%' }}>{error}</div>}

      <ReportSheet
        student={student}
        school={school}
        className={cls?.name ?? ''}
        teacherName={cls?.homeroom_teacher_name ?? ''}
        rows={filteredRows}
        filterNotice={filterNotice}
      />
    </div>
  )
}
