import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import ReportSheet from '../components/ReportSheet'
import type { Student, StudentReportRow } from '../lib/types'

export default function ReportView() {
  const { studentId } = useParams<{ studentId: string }>()
  const { school, classes } = useSchool()
  const [student, setStudent] = useState<Student | null>(null)
  const [rows, setRows] = useState<StudentReportRow[]>([])
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!studentId) return
    api.getStudent(studentId).then(setStudent).catch((e) => setError(e.message))
    api.getStudentReport(studentId).then(setRows).catch((e) => setError(e.message))
  }, [studentId])

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
        rows
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
    <div className="page page-print">
      <div className="no-print printbar">
        <Link to="/reports" className="btn btn-ghost">← Back</Link>
        <button className="btn btn-primary" disabled={downloading} onClick={downloadPdf}>
          {downloading ? 'Preparing PDF…' : '⬇ Download PDF'}
        </button>
        <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>
      {error && <div className="no-print notice notice-error">{error}</div>}
      <ReportSheet
        student={student}
        school={school}
        className={cls?.name ?? ''}
        teacherName={cls?.homeroom_teacher_name ?? ''}
        rows={rows}
      />
    </div>
  )
}
