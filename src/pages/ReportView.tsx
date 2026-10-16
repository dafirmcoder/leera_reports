import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import ReportSheet from '../components/ReportSheet'
import ExamReportSheet from '../components/ExamReportSheet'
import {
  DEFAULT_REPORT_START_DATE,
  EXAM_GRADING_SCALE,
  extractExamOptions,
  filterReportRows,
  fmtDate,
  resolveLearnerSubjects
} from '../lib/report'
import type {
  Assignment,
  ClassMarksLock,
  ReportFilter,
  Student,
  StudentReportRow,
  UnitTest
} from '../lib/types'

export default function ReportView() {
  const { studentId } = useParams<{ studentId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { school, classes, subjects } = useSchool()
  const [student, setStudent] = useState<Student | null>(null)
  const [rows, setRows] = useState<StudentReportRow[]>([])
  const [unitTests, setUnitTests] = useState<UnitTest[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [allocations, setAllocations] = useState<Record<string, string[]>>({})
  const [lockInfo, setLockInfo] = useState<ClassMarksLock | null>(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  // Initialize filter state from URL search params with sensible defaults
  const [filterMode, setFilterMode] = useState<'since_date' | 'all' | 'custom'>(() => {
    const m = searchParams.get('mode')
    if (m === 'all' || m === 'custom' || m === 'since_date') return m
    return 'since_date'
  })
  const [assessmentType, setAssessmentType] = useState<'all' | 'unit_test' | 'midterm' | 'exam'>(() => {
    const t = searchParams.get('type')
    if (t === 'unit_test' || t === 'midterm' || t === 'exam' || t === 'all') return t
    return 'all'
  })
  const [startDate, setStartDate] = useState<string>(() => {
    return searchParams.get('since') || DEFAULT_REPORT_START_DATE
  })
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>(() => {
    const raw = searchParams.get('tests')
    return raw ? raw.split(',').filter(Boolean) : []
  })
  const [selectedExamTitle, setSelectedExamTitle] = useState<string>(() => {
    return searchParams.get('exam') || '__ALL_EXAMS__'
  })

  // Keep URL parameters in sync
  const updateFilter = (
    newMode: 'since_date' | 'all' | 'custom',
    newDate: string,
    newTests = selectedTestIds,
    newType: 'all' | 'unit_test' | 'midterm' | 'exam' = assessmentType,
    newExamTitle: string = selectedExamTitle
  ) => {
    setFilterMode(newMode)
    setStartDate(newDate)
    setSelectedTestIds(newTests)
    setAssessmentType(newType)
    setSelectedExamTitle(newExamTitle)
    const nextParams = new URLSearchParams()
    nextParams.set('mode', newMode)
    if (newDate) nextParams.set('since', newDate)
    if (newMode === 'custom' && newTests.length > 0) nextParams.set('tests', newTests.join(','))
    if (newType !== 'all') nextParams.set('type', newType)
    if ((newType === 'exam' || newType === 'midterm') && newExamTitle && newExamTitle !== '__ALL_EXAMS__') {
      nextParams.set('exam', newExamTitle)
    }
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    if (!studentId) return
    api.getStudent(studentId).then((st) => {
      setStudent(st)
      if (st?.class_id) {
        api.getClassMarksLock(st.class_id).then(setLockInfo).catch(() => setLockInfo(null))
        api.listUnitTests(st.class_id).then(setUnitTests).catch(() => setUnitTests([]))
        api.listAssignments(st.class_id).then(setAssignments).catch(() => setAssignments([]))
        api.getStudentSubjectAllocations(st.class_id).then(setAllocations).catch(() => setAllocations({}))
      }
    }).catch((e) => setError(e.message))
    api.getStudentReport(studentId).then(setRows).catch((e) => setError(e.message))
  }, [studentId])

  const isExamReportMode = assessmentType === 'exam' || assessmentType === 'midterm'
  const cls = classes.find((c) => c.id === student?.class_id)

  // Extract distinct exams for the dropdown selector
  const examOptions = useMemo(() => {
    const examOptionsFromUnitTests = extractExamOptions(unitTests)
    if (examOptionsFromUnitTests.length > 0) return examOptionsFromUnitTests
    const fallbackTests: UnitTest[] = rows
      .filter((r) => r.assessment_type === 'exam' || r.assessment_type === 'midterm')
      .map((r, idx) => ({
        id: r.test_id || `fallback-${idx}`,
        class_id: student?.class_id ?? '',
        subject_id: r.subject,
        subject_name: r.subject,
        title: r.title,
        test_date: r.test_date,
        max_mark: r.max_mark,
        assessment_type: r.assessment_type
      }))
    return extractExamOptions(fallbackTests)
  }, [unitTests, rows, student?.class_id])

  // Auto-select latest exam if only 1 exists or keep __ALL_EXAMS__ if valid
  useEffect(() => {
    if (!isExamReportMode) return
    if (examOptions.length === 1 && selectedExamTitle === '__ALL_EXAMS__') {
      setSelectedExamTitle(examOptions[0].title)
    }
  }, [isExamReportMode, examOptions, selectedExamTitle])

  // Resolve all subjects this learner is taking
  const learnerSubjects = useMemo(() => {
    if (!student) return []
    return resolveLearnerSubjects({
      studentId: student.id,
      className: cls?.name,
      allSubjects: subjects,
      assignments,
      allocations,
      unitTests,
      studentRows: rows
    })
  }, [student, cls?.name, subjects, assignments, allocations, unitTests, rows])

  // Filter rows and dynamically recalculate averages for shown tests only
  const currentFilter: ReportFilter = useMemo(() => ({
    mode: isExamReportMode ? 'all' : filterMode,
    startDate,
    selectedTestIds,
    assessmentType
  }), [isExamReportMode, filterMode, startDate, selectedTestIds, assessmentType])

  const filteredRows = useMemo(() => {
    return filterReportRows(rows, currentFilter)
  }, [rows, currentFilter])

  const reportTitle = useMemo(() => {
    if (isExamReportMode) return 'SCHOOL EXAM REPORT'
    if (assessmentType === 'unit_test') return 'END OF UNIT TEST REPORT'
    if (filteredRows.length > 0 && filteredRows.every((r) => r.assessment_type === 'exam' || r.assessment_type === 'midterm')) return 'SCHOOL EXAM REPORT'
    return undefined
  }, [isExamReportMode, assessmentType, filteredRows])

  const filterNotice = useMemo(() => {
    if (isExamReportMode) {
      return selectedExamTitle && selectedExamTitle !== '__ALL_EXAMS__'
        ? undefined
        : 'All Recorded School Exams'
    }
    const typeLabel = assessmentType === 'unit_test' ? 'Unit tests' : ''
    if (filterMode === 'since_date') {
      return `${typeLabel ? typeLabel + ' ' : ''}created on or after ${fmtDate(startDate)}`
    }
    if (filterMode === 'custom') {
      return `${selectedTestIds.length} tests selected${typeLabel ? ` (${typeLabel})` : ''}`
    }
    return typeLabel || undefined
  }, [isExamReportMode, selectedExamTitle, filterMode, startDate, selectedTestIds, assessmentType])

  const downloadPdf = async () => {
    if (!student || !school) return
    setError('')
    setDownloading(true)
    try {
      if (isExamReportMode) {
        const { downloadStudentExamPdf } = await import('../lib/pdf')
        await downloadStudentExamPdf({
          student,
          school,
          className: cls?.name ?? '',
          teacherName: cls?.homeroom_teacher_name ?? '',
          selectedExamTitle,
          learnerSubjects,
          filterNotice,
          rows: filteredRows
        })
      } else {
        const { downloadStudentPdf } = await import('../lib/pdf')
        await downloadStudentPdf({
          student,
          school,
          className: cls?.name ?? '',
          teacherName: cls?.homeroom_teacher_name ?? '',
          filterNotice,
          reportTitle,
          rows: filteredRows
        })
      }

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

  const canDownloadOrPrint = isExamReportMode
    ? learnerSubjects.length > 0 || filteredRows.length > 0
    : filteredRows.length > 0

  return (
    <div className="page page-print stack" style={{ gap: '14px' }}>
      {/* Top Action & Print Bar */}
      <div className="no-print printbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
          <button className="btn btn-primary btn-sm" disabled={downloading || !canDownloadOrPrint} onClick={downloadPdf}>
            {downloading ? 'Preparing PDF…' : isExamReportMode ? '⬇ Download Exam PDF' : '⬇ Download PDF'}
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!canDownloadOrPrint} onClick={() => window.print()}>
            🖨 Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Scope / Test Filter & Exam Selector Bar */}
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
              🎯 Report Mode:
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
                className={`btn btn-sm ${assessmentType === 'unit_test' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: '4px', fontWeight: 600 }}
                onClick={() => updateFilter(filterMode, startDate, selectedTestIds, 'unit_test', selectedExamTitle)}
              >
                📘 End of Unit Tests
              </button>
              <button
                type="button"
                className={`btn btn-sm ${isExamReportMode ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: '4px', fontWeight: 600 }}
                onClick={() => updateFilter('all', startDate, selectedTestIds, 'exam', selectedExamTitle)}
              >
                🎓 School Exam Report (Independent)
              </button>
              <button
                type="button"
                className={`btn btn-sm ${assessmentType === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '11.5px', padding: '3px 8px', borderRadius: '4px', fontWeight: 600 }}
                onClick={() => updateFilter(filterMode, startDate, selectedTestIds, 'all', selectedExamTitle)}
              >
                All Combined
              </button>
            </div>

            {isExamReportMode ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                <span>Select Exam:</span>
                <select
                  id="report-view-exam-selector"
                  value={selectedExamTitle}
                  onChange={(e) => updateFilter('all', startDate, selectedTestIds, 'exam', e.target.value)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '2px solid #0284c7',
                    fontSize: '12px',
                    fontWeight: 700,
                    background: '#fff',
                    color: '#0f172a'
                  }}
                >
                  <option value="__ALL_EXAMS__">
                    📚 All Recorded School Exams ({examOptions.length} exam{examOptions.length === 1 ? '' : 's'})
                  </option>
                  {examOptions.map((opt) => (
                    <option key={opt.key} value={opt.title}>
                      🎓 {opt.title} ({opt.subjectsCount} subject{opt.subjectsCount === 1 ? '' : 's'} · {fmtDate(opt.testDate)})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
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
              </>
            )}
          </div>

          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: isExamReportMode ? '#0369a1' : filteredRows.length > 0 ? '#047857' : '#b45309',
              background: isExamReportMode ? '#e0f2fe' : filteredRows.length > 0 ? '#dcfce7' : '#fef3c7',
              padding: '2px 8px',
              borderRadius: '12px'
            }}
          >
            {isExamReportMode
              ? `${learnerSubjects.length} Learner Subjects · ${EXAM_GRADING_SCALE.length}-Tier Color Psychology Scale`
              : `${filteredRows.length} of ${rows.length} tests shown · Averages recalculated`}
          </span>
        </div>
      </div>

      {error && <div className="no-print notice notice-error" style={{ maxWidth: '210mm', margin: '0 auto', width: '100%' }}>{error}</div>}

      {isExamReportMode ? (
        <ExamReportSheet
          student={student}
          school={school}
          className={cls?.name ?? ''}
          teacherName={cls?.homeroom_teacher_name ?? ''}
          selectedExamTitle={selectedExamTitle}
          learnerSubjects={learnerSubjects}
          filterNotice={filterNotice}
          rows={filteredRows}
        />
      ) : (
        <ReportSheet
          student={student}
          school={school}
          className={cls?.name ?? ''}
          teacherName={cls?.homeroom_teacher_name ?? ''}
          rows={filteredRows}
          filterNotice={filterNotice}
          reportTitle={reportTitle}
        />
      )}
    </div>
  )
}

