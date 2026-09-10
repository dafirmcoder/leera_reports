import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useSchool } from '../context/SchoolContext'
import { can } from '../lib/permissions'
import ClassPicker from '../components/ClassPicker'
import type { AttendanceRow, AttendanceStatus, AttendanceSummary, Student } from '../lib/types'

const today = () => new Date().toISOString().slice(0, 10)
type AttendanceEntry = Omit<AttendanceRow, 'status'> & { status: AttendanceStatus | '' }

export default function Attendance() {
  const { profile } = useAuth()
  const { classes, selectedClassId } = useSchool()
  const [date, setDate] = useState(today())
  const [students, setStudents] = useState<Student[]>([])
  const [rows, setRows] = useState<AttendanceEntry[]>([])
  const [summaries, setSummaries] = useState<AttendanceSummary[]>([])
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const canMark = can(profile?.role, 'markAttendance', profile?.additional_roles)
  const canMarkPast = can(profile?.role, 'markPastAttendance', profile?.additional_roles)
  const canViewAll = can(profile?.role, 'viewAllClasses', profile?.additional_roles)
  const selectedClass = classes.find((c) => c.id === selectedClassId)
  const entryClassId = canViewAll ? selectedClassId : profile?.class_id ?? selectedClassId

  const loadEntry = async () => {
    if (!entryClassId || !canMark) return
    try {
      const [studentList, existing] = await Promise.all([
        api.listStudents(entryClassId),
        api.listAttendance(entryClassId, date)
      ])
      setStudents(studentList)
      setRows(studentList.map((student) => {
        const saved = existing.find((row) => row.student_id === student.id)
        return saved ?? {
          class_id: entryClassId,
          student_id: student.id,
          student_name: student.full_name,
          student_no: student.student_no,
          attendance_date: date,
          status: '',
          reason: ''
        }
      }))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const loadSummary = async () => {
    if (!canViewAll) return
    try {
      setSummaries(await api.listAttendanceSummary(date))
    } catch (e: any) {
      setError(e.message)
    }
  }

  useEffect(() => { loadEntry() }, [entryClassId, date, canMark])
  useEffect(() => { loadSummary() }, [date, canViewAll])

  const setStatus = (studentId: string, status: AttendanceStatus | '') => {
    setRows((current) => current.map((row) => row.student_id === studentId
      ? { ...row, status, reason: status === 'A' ? row.reason : '' }
      : row))
  }

  const setReason = (studentId: string, reason: string) => {
    setRows((current) => current.map((row) => row.student_id === studentId ? { ...row, reason } : row))
  }

  const save = async () => {
    const unmarked = rows.find((row) => !row.status)
    if (unmarked) {
      setError(`Select an attendance status for ${unmarked.student_name}.`)
      return
    }
    const missingReason = rows.find((row) => row.status === 'A' && !row.reason.trim())
    if (missingReason) {
      setError(`Enter an absence reason for ${missingReason.student_name}.`)
      return
    }
    setError('')
    setInfo('')
    setBusy(true)
    try {
      await api.saveAttendance(rows.map(({ class_id, student_id, attendance_date, status, reason }) => ({ class_id, student_id, attendance_date, status: status as AttendanceStatus, reason })))
      setInfo('Attendance saved.')
      await loadSummary()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const totals = useMemo(() => ({
    present: rows.filter((row) => row.status === 'P').length,
    absent: rows.filter((row) => row.status === 'A').length,
    excused: rows.filter((row) => row.status === 'E').length
  }), [rows])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Attendance</h2>
          <p className="muted">Mark P for present, A for absent, or E for excused.</p>
        </div>
        <label className="field"><span>Date</span><input type="date" value={canMarkPast ? date : today()} max={today()} disabled={!canMarkPast} onChange={(e) => setDate(e.target.value)} /></label>
      </div>

      {canMark && (
        <section className="card stack">
          <div className="row">
            <div><h3>{selectedClass?.name ?? 'Your class'}</h3><p className="muted">Homeroom attendance entry</p></div>
            {canViewAll || !profile?.class_id ? <ClassPicker /> : null}
          </div>
          <div className="row"><span className="chip">P: {totals.present}</span><span className="chip">A: {totals.absent}</span><span className="chip">E: {totals.excused}</span></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Student</th><th>No.</th><th>Status</th><th>Reason for absence</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.student_id}>
                <td>{row.student_name}</td><td className="mono">{row.student_no}</td>
                <td><select value={row.status} onChange={(e) => setStatus(row.student_id, e.target.value as AttendanceStatus | '')}><option value="">Select…</option><option value="P">P — Present</option><option value="A">A — Absent</option><option value="E">E — Excused</option></select></td>
                <td><input value={row.reason} disabled={row.status !== 'A'} placeholder={row.status === 'A' ? 'Required' : '—'} onChange={(e) => setReason(row.student_id, e.target.value)} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          <button className="btn btn-primary" disabled={busy || rows.length === 0} onClick={save}>{busy ? 'Saving…' : 'Save attendance'}</button>
        </section>
      )}

      {canViewAll && <section className="card stack">
        <h3>Attendance summary — {date}</h3>
        {summaries.length === 0 && <p className="muted center">No attendance has been saved for this date.</p>}
        {summaries.map((summary) => <div key={summary.class_id} className="stack">
          <div className="list-row"><strong>{summary.class_name}</strong><span className="muted">Present {summary.present} · Absent {summary.absent} · Excused {summary.excused} · Total {summary.total}</span></div>
          {summary.absences.length > 0 && <table className="table"><thead><tr><th>Absent student</th><th>No.</th><th>Reason</th></tr></thead><tbody>{summary.absences.map((absence) => <tr key={`${summary.class_id}-${absence.student_no}`}><td>{absence.student_name}</td><td className="mono">{absence.student_no}</td><td>{absence.reason}</td></tr>)}</tbody></table>}
        </div>)}
      </section>}

      {error && <div className="notice notice-error">{error}</div>}
      {info && <div className="notice notice-ok">{info}</div>}
    </div>
  )
}
