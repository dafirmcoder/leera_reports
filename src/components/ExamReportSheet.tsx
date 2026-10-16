import { buildExamReport, EXAM_GRADING_SCALE, fmtPct } from '../lib/report'
import type { School, Student, StudentReportRow } from '../lib/types'
import { ReportFooter, ReportHeader } from './ReportSheet'

export interface ExamReportSheetProps {
  student: Student
  school: School
  className: string
  teacherName: string
  rows: StudentReportRow[]
  learnerSubjects?: string[]
  selectedExamTitle?: string
  filterNotice?: string
}

export default function ExamReportSheet({
  student,
  school,
  className,
  teacherName,
  rows,
  learnerSubjects = [],
  selectedExamTitle,
  filterNotice
}: ExamReportSheetProps) {
  const examReport = buildExamReport({
    rows,
    learnerSubjects,
    selectedExamTitle
  })

  const printedDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })

  const activeExamLabel =
    selectedExamTitle && selectedExamTitle !== '__ALL_EXAMS__'
      ? selectedExamTitle
      : examReport.examTitle || 'School Examination'

  const bandTitle =
    selectedExamTitle && selectedExamTitle !== '__ALL_EXAMS__'
      ? `SCHOOL EXAM REPORT — ${selectedExamTitle.toUpperCase()}`
      : 'SCHOOL EXAM REPORT'

  const subjectsLabel = `${examReport.subjects.length} Subject${examReport.subjects.length === 1 ? '' : 's'}`

  return (
    <div className="report-sheet exam-report-sheet">
      <ReportHeader
        school={school}
        student={student}
        className={className}
        teacherName={teacherName}
        titleText={bandTitle}
        printedDate={printedDate}
        examName={activeExamLabel}
        filterNotice={filterNotice}
        subjectsLabel={subjectsLabel}
      />

      {/* Learner Subjects & Exam Scores Table */}
      <table className="report-table exam-scores-table">
        <thead>
          <tr>
            <th style={{ width: '40%' }}>Subject</th>
            <th className="c" style={{ width: '16%' }}>Score</th>
            <th className="c" style={{ width: '14%' }}>Grade</th>
            <th className="c" style={{ width: '30%' }}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {examReport.subjects.length === 0 && (
            <tr>
              <td colSpan={4} className="muted center pad">
                No subjects or exam records found for this learner.
              </td>
            </tr>
          )}

          {examReport.subjects.map((sub) => {
            const gInfo = sub.gradeInfo
            const hasScore = sub.score !== null && sub.score !== undefined

            return (
              <tr key={sub.subjectName} className="exam-subject-row">
                <td className="exam-subject-cell">{sub.subjectName}</td>

                {/* Score Column */}
                <td
                  className="c exam-score-cell"
                  style={{
                    color: gInfo ? gInfo.textColor : '#64748b',
                    fontWeight: hasScore ? 700 : 500
                  }}
                >
                  {hasScore ? fmtPct(sub.score!) : '—'}
                </td>

                {/* Grade Column with Color Psychology */}
                <td
                  className="c exam-grade-cell"
                  style={{
                    backgroundColor: gInfo ? gInfo.bgColor : '#f8fafc',
                    color: gInfo ? gInfo.textColor : '#94a3b8',
                    fontWeight: 800
                  }}
                >
                  {gInfo ? (
                    <span
                      className="exam-grade-pill"
                      style={{
                        backgroundColor: gInfo.bgColor,
                        color: gInfo.textColor,
                        borderColor: gInfo.borderColor
                      }}
                    >
                      {gInfo.grade}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>

                {/* Remarks Column with Color Psychology */}
                <td
                  className="c exam-remark-cell"
                  style={{
                    backgroundColor: gInfo ? gInfo.bgColor : '#f8fafc',
                    color: gInfo ? gInfo.textColor : '#94a3b8',
                    fontWeight: 700
                  }}
                >
                  {gInfo ? (
                    <span
                      className="exam-remark-pill"
                      style={{
                        color: gInfo.textColor
                      }}
                    >
                      {gInfo.remark}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            )
          })}

          {/* Overall Average & Grade Summary Row */}
          {examReport.subjects.length > 0 && (
            <tr className="exam-overall-row">
              <td className="exam-overall-label">
                Overall Exam Average ({examReport.scoredCount} / {examReport.totalSubjects} Subjects)
              </td>
              <td
                className="c exam-overall-score"
                style={{
                  color: examReport.overallGrade ? examReport.overallGrade.textColor : '#1f4e5f'
                }}
              >
                {examReport.overallAverage !== null ? fmtPct(examReport.overallAverage) : '—'}
              </td>
              <td
                className="c exam-overall-grade"
                style={{
                  backgroundColor: examReport.overallGrade ? examReport.overallGrade.bgColor : '#ddebf1',
                  color: examReport.overallGrade ? examReport.overallGrade.textColor : '#1f4e5f'
                }}
              >
                {examReport.overallGrade ? examReport.overallGrade.grade : '—'}
              </td>
              <td
                className="c exam-overall-remark"
                style={{
                  backgroundColor: examReport.overallGrade ? examReport.overallGrade.bgColor : '#ddebf1',
                  color: examReport.overallGrade ? examReport.overallGrade.textColor : '#1f4e5f'
                }}
              >
                {examReport.overallGrade ? examReport.overallGrade.remark : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Grading System Scales Shown Below the Scores Table */}
      <div className="exam-grading-scale-box">
        <div className="exam-grading-scale-title">
          GRADING SYSTEM SCALE &amp; PERFORMANCE DESCRIPTORS
        </div>
        <div className="exam-grading-scale-grid">
          {EXAM_GRADING_SCALE.map((item) => (
            <div
              key={item.grade}
              className="exam-scale-card"
              style={{
                backgroundColor: item.bgColor,
                borderColor: item.borderColor,
                color: item.textColor
              }}
            >
              <div className="exam-scale-top">
                <span
                  className="exam-scale-grade-badge"
                  style={{
                    backgroundColor: '#ffffff',
                    color: item.textColor,
                    borderColor: item.borderColor
                  }}
                >
                  {item.grade}
                </span>
                <span className="exam-scale-range">
                  {item.rangeLabel}
                </span>
              </div>
              <div className="exam-scale-remark">{item.remark}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Signatures (Left: Coordinator first, Head of School below) & Official Stamp Square Box (Right) */}
      <div className="exam-endorsement-section">
        <div className="exam-signatures-stack">
          <div className="exam-signature-block">
            <div className="exam-signature-space" />
            <div className="exam-signature-line" />
            <div className="exam-signature-title">Academic Coordinator&apos;s Signature</div>
          </div>

          <div className="exam-signature-block">
            <div className="exam-signature-space" />
            <div className="exam-signature-line" />
            <div className="exam-signature-title">Head of School&apos;s Signature</div>
          </div>
        </div>

        <div className="exam-stamp-wrapper">
          <div className="exam-stamp-square-box">
            <span className="exam-stamp-label">OFFICIAL STAMP</span>
          </div>
        </div>
      </div>

      <ReportFooter school={school} />
    </div>
  )
}
