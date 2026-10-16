import { Fragment } from 'react'
import { buildReport, fmtDate, fmtPct, formatRollNo } from '../lib/report'
import type { School, Student, StudentReportRow } from '../lib/types'

export interface ReportHeaderProps {
  school: School
  student: Student
  className: string
  teacherName: string
  titleText: string
  printedDate: string
  filterNotice?: string
  examName?: string
  subjectsLabel?: string
}

export function ReportHeader({
  school,
  student,
  className,
  teacherName,
  titleText,
  printedDate,
  filterNotice,
  examName,
  subjectsLabel
}: ReportHeaderProps) {
  const rollDisplay = formatRollNo(student.roll_no || student.admission_no) || '—'
  const semesterDisplay = school.semester || school.term || '—'

  return (
    <>
      <div className="report-header">
        {school.show_school_logo && <img src="/logos/school-logo.png" alt="" className="logo logo-left" />}
        {school.show_cambridge_logo && <img src="/logos/cambridge-logo.png" alt="" className="logo logo-right" />}
        <div className="report-title-block">
          <h1>{school.name}</h1>
          {school.motto && <div className="motto">{school.motto}</div>}
        </div>
      </div>

      <div className="report-band">{titleText}</div>

      <div className="report-info-card">
        <div className="report-info-grid">
          <div className="report-info-cell report-info-cell-wide">
            <span className="report-info-label">Learner Name</span>
            <span className="report-info-value report-info-name">{student.full_name}</span>
          </div>
          <div className="report-info-cell">
            <span className="report-info-label">Roll Number</span>
            <span className="report-info-value">{rollDisplay}</span>
          </div>
          <div className="report-info-cell">
            <span className="report-info-label">Class</span>
            <span className="report-info-value">{className || '—'}</span>
          </div>
          <div className="report-info-cell">
            <span className="report-info-label">Academic Year</span>
            <span className="report-info-value">{school.academic_year || '—'}</span>
          </div>

          <div className="report-info-cell report-info-cell-wide">
            <span className="report-info-label">Homeroom Teacher</span>
            <span className="report-info-value">{teacherName || '—'}</span>
          </div>
          <div className="report-info-cell">
            <span className="report-info-label">Subjects</span>
            <span className="report-info-value">{subjectsLabel || 'All Class Subjects'}</span>
          </div>
          <div className="report-info-cell">
            <span className="report-info-label">Semester / Term</span>
            <span className="report-info-value">{semesterDisplay}</span>
          </div>
          <div className="report-info-cell">
            <span className="report-info-label">Date Printed</span>
            <span className="report-info-value">{printedDate}</span>
          </div>
        </div>

        {(examName || filterNotice) && (
          <div className="report-info-meta-strip">
            {examName && (
              <div className="report-info-meta-item">
                <span className="report-info-label">Examination:</span>
                <span className="report-info-value">{examName}</span>
              </div>
            )}
            {filterNotice && (
              <div className="report-info-meta-item">
                <span className="report-info-label">Scope:</span>
                <span className="report-info-value">{filterNotice}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export interface ReportFooterProps {
  school: School
}

export function ReportFooter({ school }: ReportFooterProps) {
  return (
    <div className="report-footer" style={{ background: school.footer_color }}>
      {school.footer_text}
    </div>
  )
}

interface Props {
  student: Student
  school: School
  className: string
  teacherName: string
  rows: StudentReportRow[]
  filterNotice?: string
  reportTitle?: string
}

export default function ReportSheet({ student, school, className, teacherName, rows, filterNotice, reportTitle }: Props) {
  const report = buildReport(rows)
  const printedDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const isAllExam = rows.length > 0 && rows.every((r) => r.assessment_type === 'exam' || r.assessment_type === 'midterm')
  const titleText = reportTitle || (isAllExam ? 'EXAM REPORT' : 'END OF UNIT TEST REPORT')
  const subjectsLabel = `${report.subjects.length} Subject${report.subjects.length === 1 ? '' : 's'}`

  return (
    <div className="report-sheet">
      <ReportHeader
        school={school}
        student={student}
        className={className}
        teacherName={teacherName}
        titleText={titleText}
        printedDate={printedDate}
        filterNotice={filterNotice}
        subjectsLabel={subjectsLabel}
      />

      <table className="report-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Unit / Topic</th>
            <th>Date</th>
            <th className="c">Score</th>
            <th className="c">Out of (Max)</th>
            <th className="c">Mark %</th>
          </tr>
        </thead>
        <tbody>
          {report.subjects.length === 0 && (
            <tr>
              <td colSpan={6} className="muted center pad">No end-of-unit tests recorded yet for this student.</td>
            </tr>
          )}
          {report.subjects.map((s, idx) => {
            // rowSpan always includes the average row (shown for all subjects, even single-test)
            const rowSpan = s.rows.length + 1
            return (
              <Fragment key={s.name}>
                {s.rows.map((r, ri) => (
                  <tr key={ri}>
                    {ri === 0 && (
                      <td className="subject-cell" rowSpan={rowSpan}>{s.name}</td>
                    )}
                    <td>{r.title}</td>
                    <td className="c">{fmtDate(r.test_date)}</td>
                    <td className="c">{r.score !== null && r.score !== undefined ? r.score : '—'}</td>
                    <td className="c">{r.max_mark}</td>
                    <td className="c" style={{ color: (r.score !== null && r.score !== undefined && ((r.score / (r.max_mark || 1)) * 100) >= 65) ? '#15803d' : undefined, fontWeight: (r.score !== null && r.score !== undefined && ((r.score / (r.max_mark || 1)) * 100) >= 65) ? 600 : undefined }}>
                      {r.score !== null && r.score !== undefined ? fmtPct((r.score / r.max_mark) * 100) : '—'}
                    </td>
                  </tr>
                ))}
                {/* Subject Average row — always shown, even when there is only one test */}
                <tr className="avg-row">
                  <td colSpan={2}>Subject Average</td>
                  <td className="c">{s.totalScore}</td>
                  <td className="c">{s.totalMax}</td>
                  <td className="c" style={{ color: s.average >= 65 ? '#15803d' : undefined, fontWeight: 700 }}>
                    {fmtPct(s.average)}
                  </td>
                </tr>
                {idx < report.subjects.length - 1 && (
                  <tr className="spacer-row"><td colSpan={6} /></tr>
                )}
              </Fragment>
            )
          })}
          {report.subjects.length > 0 && (
            <tr className="overall-row">
              <td colSpan={6} style={{ color: report.overall >= 65 ? '#15803d' : undefined }}>
                Overall Average: {fmtPct(report.overall)}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <ReportFooter school={school} />
    </div>
  )
}

