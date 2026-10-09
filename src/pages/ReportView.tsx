import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { isCoordinatorOrLeadership } from '../lib/permissions'
import ReportSheet from '../components/ReportSheet'
import { DEFAULT_REPORT_START_DATE, filterReportRows, fmtDate } from '../lib/report'
import type { ClassMarksLock, ReportFilter, Student, StudentReportRow } from '../lib/types'

export default function ReportView() {
  const { studentId } = useParams<{ studentId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { school, classes } = useSchool()
  const { profile } = useAuth()
  const [student, setStudent] = useState<Student | null>(null)
  const [rows, setRows] = useState<StudentReportRow[]>([])
  const [lockInfo, setLockInfo] = useState<ClassMarksLock | null>(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  // Initialize filter state from URL search params with sensible defaults
  const [filterMode, setFilterMode] = useState<'since_date' | 'all' | 'custom'>(() => {
    const m = searchParams.get('mode')
    if (m === 'all' || m === 'custom' || m === 'since_date') return m
    return 'since_date'
  })
  const [assessmentType, setAssessmentType] = useState<'all' | 'unit_test' | 'midterm'>(() => {
    const t = searchParams.get('type')
    if (t === 'unit_test' || t === 'midterm' || t === 'all') return t
    return 'all'
  })
  const [startDate, setStartDate] = useState<string>(() => {
    return searchParams.get('since') || DEFAULT_REPORT_START_DATE
  })
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>(() => {
    const raw = searchParams.get('tests')
    return raw ? raw.split(',').filter(Boolean) : []
  })

  // Keep URL parameters in sync
  const updateFilter = (newMode: 'since_date' | 'all' | 'custom', newDate: string, newTests = selectedTestIds, newType = assessmentType) => {
    setFilterMode(newMode)
    setStartDate(newDate)
    setSelectedTestIds(newTests)
    setAssessmentType(newType)
    const nextParams = new URLSearchParams()
    nextParams.set('mode', newMode)
    if (newDate) nextParams.set('since', newDate)
    if (newMode === 'custom' && newTests.length > 0) nextParams.set('tests', newTests.join(','))
    if (newType !== 'all') nextParams.set('type', newType)
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    if (!studentId) return
    api.getStudent(studentId).then((st) => {
      setStudent(st)
      if (st?.class_id) {
        api.getClassMarksLock(st.class_id).then(setLockInfo).catch(() => setLockInfo(null))
      }
    }).catch((e) => setError(e.message))
    api.getStudentReport(studentId).then(setRows).catch((e) => setError(e.message))
  }, [studentId])

  // Filter rows and dynamically recalculate averages for shown tests only
  const currentFilter: ReportFilter = useMemo(() => ({
    mode: filterMode,
    startDate,
    selectedTestIds,
    assessmentType
  }), [filterMode, startDate, selectedTestIds, assessmentType])

  const filteredRows = useMemo(() => {
    return filterReportRows(rows, currentFilter)
  }, [rows, currentFilter])

  const reportTitle = useMemo(() => {
    if (assessmentType === 'midterm') return 'MIDTERM EXAM REPORT'
    if (assessmentType === 'unit_test') return 'END OF UNIT TEST REPORT'
    if (filteredRows.length > 0 && filteredRows.every((r) => r.assessment_type === 'midterm')) return 'MIDTERM EXAM REPORT'
    return undefined
  }, [assessmentType, filteredRows])

  const filterNotice = useMemo(() => {
    const typeLabel = assessmentType === 'midterm' ? 'Midterm exams' : assessmentType === 'unit_test' ? 'Unit tests' : ''
    if (filterMode === 'since_date') {
      return `${typeLabel ? typeLabel + ' ' : ''}created on or after ${fmtDate(startDate)}`
    }
    if (filterMode === 'custom') {
      return `${selectedTestIds.length} tests selected${typeLabel ? ` (${typeLabel})` : ''}`
    }
    return typeLabel || undefined
  }, [filterMode, startDate, selectedTestIds, assessmentType])

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
        reportTitle,
        rows: filteredRows
      })

      // Lock class marks once report is downloaded
      if (student.class_id) {
        try {
          await api.lockClassMarks(student.class_id, 'Report downloaded by Homeroom Teacher')
          const updated = await api.getClassMarksLock(student.class_id)
          setLockInfo(updated)
        } catch (lErr) {
          console.warn('Could not lock class marks:', lErr)
        }
      }
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
          {lockInfo?.is_locked && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#991b1b',
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                padding: '3px 8px',
                borderRadius: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Marks for existing tests are locked for subject teachers because reports have been downloaded"
            >
              <span>🔒</span>
              <span>Marks Locked</span>
            </span>
          )}
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
                className={`btn btn-sm ${assessmentType === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11.5px', padding: '3px 8px', borderRadius: '4px', fontWeight: 600 }}
                onClick={() => updateFilter(filterMode, startDate, selectedTestIds, 'all')}
              >
                All
              </button>
              <button
                type="button"
                className={`btn btn-sm ${assessmentType === 'unit_test' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11.5px', padding: '3px 8px', borderRadius: '4px', fontWeight: 600 }}
                onClick={() => updateFilter(filterMode, startDate, selectedTestIds, 'unit_test')}
              >
                📘 Unit Tests
              </button>
              <button
                type="button"
                className={`btn btn-sm ${assessmentType === 'midterm' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11.5px', padding: '3px 8px', borderRadius: '4px', fontWeight: 600 }}
                onClick={() => updateFilter(filterMode, startDate, selectedTestIds, 'midterm')}
              >
                📑 Midterm
              </button>
            </div>

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
        reportTitle={reportTitle}
      />
    </div>
  )
}
