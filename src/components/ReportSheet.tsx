import { Fragment } from 'react'
import { buildReport, fmtDate, fmtPct } from '../lib/report'
import type { School, Student, StudentReportRow } from '../lib/types'

interface Props {
  student: Student
  school: School
  className: string
  teacherName: string
  rows: StudentReportRow[]
}

export default function ReportSheet({ student, school, className, teacherName, rows }: Props) {
  const report = buildReport(rows)
  const printedDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="report-sheet">
      <div className="report-header">
        {school.show_school_logo && <img src="/logos/school-logo.png" alt="" className="logo logo-left" />}
        {school.show_cambridge_logo && <img src="/logos/cambridge-logo.png" alt="" className="logo logo-right" />}
        <div className="report-title-block">
          <h1>{school.name}</h1>
          {school.motto && <div className="motto">{school.motto}</div>}
        </div>
      </div>

      <div className="report-band">END OF UNIT TEST REPORT</div>

      <div className="report-info">
        <div><span className="lbl">Student:</span> {student.full_name}</div>
        <div>
          <span className="lbl">Admission No.:</span> {student.admission_no || '—'}
          <span className="sep">·</span>
          <span className="lbl">Class:</span> {className || '—'}
        </div>
        <div>
          <span className="lbl">Term:</span> {school.term}
          <span className="sep">·</span>
          <span className="lbl">Academic Year:</span> {school.academic_year}
        </div>
        <div>
          <span className="lbl">Teacher:</span> {teacherName || '—'}
          <span className="sep">·</span>
          <span className="lbl">Printed:</span> {printedDate}
        </div>
      </div>

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
            const rowSpan = s.rows.length + (s.count > 1 ? 1 : 0)
            return (
              <Fragment key={s.name}>
                {s.rows.map((r, ri) => (
                  <tr key={ri}>
                    {ri === 0 && (
                      <td className="subject-cell" rowSpan={rowSpan}>{s.name}</td>
                    )}
                    <td>{r.title}</td>
                    <td className="c">{fmtDate(r.test_date)}</td>
                    <td className="c">{r.score}</td>
                    <td className="c">{r.max_mark}</td>
                    <td className="c">{fmtPct((r.score / r.max_mark) * 100)}</td>
                  </tr>
                ))}
                {s.count > 1 && (
                  <tr className="avg-row">
                    <td colSpan={2}>Subject Average</td>
                    <td className="c">{s.totalScore}</td>
                    <td className="c">{s.totalMax}</td>
                    <td className="c">{fmtPct(s.average)}</td>
                  </tr>
                )}
                {idx < report.subjects.length - 1 && (
                  <tr className="spacer-row"><td colSpan={6} /></tr>
                )}
              </Fragment>
            )
          })}
          {report.subjects.length > 0 && (
            <tr className="overall-row">
              <td colSpan={6}>Overall Average: {fmtPct(report.overall)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="report-footer" style={{ background: school.footer_color }}>
        {school.footer_text}
      </div>
    </div>
  )
}
