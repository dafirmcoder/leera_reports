import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { DEFAULT_REPORT_START_DATE, filterReportRows, fmtDate, formatRollNo } from '../lib/report'
import { useSchool } from '../context/SchoolContext'
import ClassPicker from '../components/ClassPicker'
import type { ReportFilter, Student, StudentReportRow, UnitTest } from '../lib/types'

const canSaveToFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window

export default function Reports() {
  const { selectedClassId, classes, school } = useSchool()
  const [students, setStudents] = useState<Student[]>([])
  const [unitTests, setUnitTests] = useState<UnitTest[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  // Report Test Filter State
  // Default mode is 'since_date' starting on 2026-09-20 (or teacher selected start date)
  const [filterMode, setFilterMode] = useState<'since_date' | 'all' | 'custom'>('since_date')
  const [startDate, setStartDate] = useState<string>(DEFAULT_REPORT_START_DATE)
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([])
  const [showTestChecklist, setShowTestChecklist] = useState(false)

  useEffect(() => {
    if (!selectedClassId) {
      setStudents([])
      setUnitTests([])
      return
    }
    api.listStudents(selectedClassId).then(setStudents).catch((e) => setError(e.message))
    api.listUnitTests(selectedClassId).then(setUnitTests).catch(() => setUnitTests([]))
  }, [selectedClassId])

  const cls = classes.find((c) => c.id === selectedClassId)
  const filteredStudents = students.filter((s) => s.full_name.toLowerCase().includes(q.toLowerCase()))

  // Compute tests matching active filter
  const matchingTests = useMemo(() => {
    if (filterMode === 'all') return unitTests
    if (filterMode === 'since_date') {
      return unitTests.filter((t) => {
        const cDate = t.created_at ? t.created_at.slice(0, 10) : t.test_date
        return cDate >= startDate
      })
    }
    if (filterMode === 'custom') {
      return unitTests.filter((t) => selectedTestIds.includes(t.id))
    }
    return unitTests
  }, [unitTests, filterMode, startDate, selectedTestIds])

  // Group unit tests by subject for checklist view
  const testsBySubject = useMemo(() => {
    const map = new Map<string, UnitTest[]>()
    unitTests.forEach((t) => {
      const list = map.get(t.subject_name) || []
      list.push(t)
      map.set(t.subject_name, list)
    })
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [unitTests])

  // Current active filter specification
  const currentFilter: ReportFilter = useMemo(() => ({
    mode: filterMode,
    startDate,
    selectedTestIds
  }), [filterMode, startDate, selectedTestIds])

  const filterNotice = useMemo(() => {
    if (filterMode === 'since_date') {
      return `Tests created on or after ${fmtDate(startDate)}`
    }
    if (filterMode === 'custom') {
      return `${selectedTestIds.length} selected tests`
    }
    return undefined
  }, [filterMode, startDate, selectedTestIds])

  const runBulk = async (mode: 'zip' | 'folder') => {
    if (!selectedClassId || !school) return
    setBusy(true)
    setError('')
    setProgress('Preparing reports…')
    try {
      const rawRowsByStudent: Record<string, StudentReportRow[]> = await api.getClassReportRows(selectedClassId)

      // Filter rows for each student and recalculate averages dynamically
      const rowsByStudent: Record<string, StudentReportRow[]> = {}
      for (const [stId, rows] of Object.entries(rawRowsByStudent)) {
        rowsByStudent[stId] = filterReportRows(rows, currentFilter)
      }

      const opts = {
        students,
        rowsByStudent,
        school,
        className: cls?.name ?? 'Class',
        teacherName: cls?.homeroom_teacher_name ?? '',
        filterNotice,
        onProgress: (done: number, total: number) => setProgress(`Building report ${done}/${total}…`)
      }

      if (mode === 'zip') {
        setProgress(`Packing ${students.length} PDFs…`)
        const { downloadClassReportsZip } = await import('../lib/pdf')
        await downloadClassReportsZip(opts)
      } else {
        setProgress(`Saving ${students.length} PDFs to your folder…`)
        const { saveClassReportsToFolder } = await import('../lib/pdf')
        await saveClassReportsToFolder(opts)
      }
    } catch (err: any) {
      setError(err?.message ?? 'Download failed.')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  // Toggle single test selection
  const toggleTestId = (id: string) => {
    setSelectedTestIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const selectAllTests = () => {
    setSelectedTestIds(unitTests.map((t) => t.id))
  }

  const selectNoneTests = () => {
    setSelectedTestIds([])
  }

  const selectOnlyNewTests = () => {
    const newIds = unitTests
      .filter((t) => {
        const cDate = t.created_at ? t.created_at.slice(0, 10) : t.test_date
        return cDate >= startDate
      })
      .map((t) => t.id)
    setSelectedTestIds(newIds)
  }

  // Query string to pass to single student report
  const filterQueryParam = useMemo(() => {
    const params = new URLSearchParams()
    params.set('mode', filterMode)
    if (startDate) params.set('since', startDate)
    if (filterMode === 'custom' && selectedTestIds.length > 0) {
      params.set('tests', selectedTestIds.join(','))
    }
    return params.toString()
  }, [filterMode, startDate, selectedTestIds])

  return (
    <div className="page stack" style={{ gap: '20px' }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 style={{ margin: 0 }}>Reports{cls ? ` — ${cls.name}` : ''}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Preview a single report, or download every student's report as individual PDFs.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {selectedClassId && (
            <Link
              to={`/marks/class/${selectedClassId}`}
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
              title="View full tabulated marksheet for all learners and subjects"
            >
              <span>📊</span>
              <span>Tabulated Class Sheet</span>
            </Link>
          )}
          <ClassPicker />
        </div>
      </div>

      {/* Test Filter Panel: allows homeroom teachers to select which tests are included */}
      {selectedClassId && (
        <div
          className="card"
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '12px',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>🎯</span>
              <strong style={{ fontSize: '14px', color: '#0f172a' }}>Report Scope & Test Filter</strong>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: matchingTests.length > 0 ? '#047857' : '#b45309',
                background: matchingTests.length > 0 ? '#dcfce7' : '#fef3c7',
                padding: '3px 10px',
                borderRadius: '20px'
              }}
            >
              {matchingTests.length} of {unitTests.length} tests included in report
            </span>
          </div>

          <p className="muted" style={{ fontSize: '12.5px', margin: 0 }}>
            Past test results sent before 20/Sep/2026 can be excluded so results are not repeated.
            <strong> Subject and overall averages are dynamically calculated strictly for the shown tests.</strong>
          </p>

          {/* Filter Mode Buttons and Start Date Picker */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div
              className="btn-group"
              style={{
                display: 'inline-flex',
                background: '#ffffff',
                padding: '3px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1'
              }}
            >
              <button
                type="button"
                className={`btn btn-sm ${filterMode === 'since_date' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '6px', fontWeight: 600 }}
                onClick={() => setFilterMode('since_date')}
              >
                ✨ New Tests Only
              </button>
              <button
                type="button"
                className={`btn btn-sm ${filterMode === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '6px', fontWeight: 600 }}
                onClick={() => setFilterMode('all')}
              >
                📚 All Tests (Cumulative)
              </button>
              <button
                type="button"
                className={`btn btn-sm ${filterMode === 'custom' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '6px', fontWeight: 600 }}
                onClick={() => {
                  setFilterMode('custom')
                  if (selectedTestIds.length === 0) selectOnlyNewTests()
                  setShowTestChecklist(true)
                }}
              >
                ☑️ Pick Specific Tests
              </button>
            </div>

            {/* Date Picker for "New Tests Only" start date */}
            {filterMode === 'since_date' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Created on or after:</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: '1px solid #94a3b8',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: '#fff'
                    }}
                  />
                </label>

                {startDate !== DEFAULT_REPORT_START_DATE && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '3px 8px' }}
                    onClick={() => setStartDate(DEFAULT_REPORT_START_DATE)}
                  >
                    Reset to 20/09/2026
                  </button>
                )}
              </div>
            )}

            {/* Toggle Specific Tests Checklist */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '11.5px', padding: '4px 8px', marginLeft: 'auto' }}
              onClick={() => setShowTestChecklist((prev) => !prev)}
            >
              {showTestChecklist ? '▲ Hide Test Breakdown' : '▼ View Selected Tests'}
            </button>
          </div>

          {/* Expandable Test Checklist */}
          {showTestChecklist && (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px',
                marginTop: '4px',
                maxHeight: '320px',
                overflowY: 'auto'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                  Select Individual Tests for Report:
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => {
                      setFilterMode('custom')
                      selectAllTests()
                    }}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => {
                      setFilterMode('custom')
                      selectOnlyNewTests()
                    }}
                  >
                    Only Since {fmtDate(startDate)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                    onClick={() => {
                      setFilterMode('custom')
                      selectNoneTests()
                    }}
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {testsBySubject.length === 0 ? (
                <p className="muted" style={{ fontSize: '12px', margin: '8px 0' }}>
                  No unit tests recorded for this class yet.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {testsBySubject.map(([subjectName, tests]) => (
                    <div key={subjectName} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--brand)', marginBottom: '4px' }}>
                        {subjectName} ({tests.length} tests)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '6px' }}>
                        {tests.map((t) => {
                          const isNew = (t.created_at ? t.created_at.slice(0, 10) : t.test_date) >= startDate
                          const isChecked = filterMode === 'all'
                            ? true
                            : filterMode === 'since_date'
                            ? isNew
                            : selectedTestIds.includes(t.id)

                          return (
                            <label
                              key={t.id}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                fontSize: '11.5px',
                                padding: '4px 6px',
                                borderRadius: '4px',
                                background: isChecked ? '#f0fdf4' : '#fff',
                                border: '1px solid',
                                borderColor: isChecked ? '#bbf7d0' : '#e2e8f0',
                                cursor: 'pointer'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setFilterMode('custom')
                                  if (filterMode !== 'custom') {
                                    const base = filterMode === 'all'
                                      ? unitTests.map((x) => x.id)
                                      : unitTests.filter((x) => (x.created_at ? x.created_at.slice(0, 10) : x.test_date) >= startDate).map((x) => x.id)
                                    const next = isChecked ? base.filter((x) => x !== t.id) : [...base, t.id]
                                    setSelectedTestIds(next)
                                  } else {
                                    toggleTestId(t.id)
                                  }
                                }}
                                style={{ marginTop: '2px' }}
                              />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, color: '#1e293b' }}>
                                  {t.title}
                                  {isNew && (
                                    <span style={{ fontSize: '9px', fontWeight: 700, color: '#047857', background: '#dcfce7', padding: '1px 5px', borderRadius: '4px', marginLeft: '5px' }}>
                                      NEW
                                    </span>
                                  )}
                                </div>
                                <div className="muted" style={{ fontSize: '10.5px' }}>
                                  Date: {fmtDate(t.test_date)} · Max: {t.max_mark}
                                  {t.created_at && ` · Created: ${fmtDate(t.created_at.slice(0, 10))}`}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action Row: Search and Bulk Download */}
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <input
          className="search"
          style={{ maxWidth: '300px', margin: 0 }}
          placeholder="Search student name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {selectedClassId && students.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              disabled={busy || matchingTests.length === 0}
              onClick={() => runBulk('zip')}
              title={`Download ${students.length} reports containing only the ${matchingTests.length} selected tests`}
            >
              ⬇ Download all (ZIP)
            </button>
            {canSaveToFolder && (
              <button
                className="btn"
                disabled={busy || matchingTests.length === 0}
                onClick={() => runBulk('folder')}
                title={`Save ${students.length} PDFs into folder containing only the ${matchingTests.length} selected tests`}
              >
                📁 Save to folder
              </button>
            )}
          </div>
        )}
      </div>

      {progress && <div className="notice">{progress}</div>}
      {error && <div className="notice notice-error">{error}</div>}

      <div className="card">
        {filteredStudents.length === 0 && <p className="muted center">No students found.</p>}
        {filteredStudents.map((s) => (
          <Link
            key={s.id}
            to={`/reports/${s.id}?${filterQueryParam}`}
            className="list-row link"
          >
            <div className="list-main">
              <strong>{s.full_name}</strong>
              <span className="muted">
                {s.student_no}
                {(s.roll_no || s.admission_no) ? ` · Roll ${formatRollNo(s.roll_no || s.admission_no)}` : ''}
              </span>
            </div>
            <span className="btn btn-small">Open report →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
