import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { fmtDate } from '../lib/report'
import { useAuth } from '../context/AuthContext'
import { useSchool } from '../context/SchoolContext'
import { can } from '../lib/permissions'
import ClassPicker from '../components/ClassPicker'
import type { AttendanceAggregatedSummary, AttendanceRow, AttendanceStatus, Student } from '../lib/types'

const today = () => new Date().toISOString().slice(0, 10)
type AttendanceEntry = Omit<AttendanceRow, 'status'> & { status: AttendanceStatus | '' }

export default function Attendance() {
  const { profile } = useAuth()
  const { classes, selectedClassId } = useSchool()
  const [date, setDate] = useState(today())
  const [students, setStudents] = useState<Student[]>([])
  const [rows, setRows] = useState<AttendanceEntry[]>([])
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [aggregatedSummary, setAggregatedSummary] = useState<AttendanceAggregatedSummary | null>(null)
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
      const summary = await api.getAttendancePeriodSummary(period, date)
      setAggregatedSummary(summary)
    } catch (e: any) {
      setError(e.message)
    }
  }

  useEffect(() => { loadEntry() }, [entryClassId, date, canMark])
  useEffect(() => { loadSummary() }, [date, period, canViewAll])

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
      setInfo('Attendance saved successfully.')
      await loadSummary()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const totals = useMemo(() => {
    const p = rows.filter((row) => row.status === 'P').length
    const a = rows.filter((row) => row.status === 'A').length
    const e = rows.filter((row) => row.status === 'E').length
    const tot = rows.length
    return {
      present: p,
      absent: a,
      excused: e,
      presentPct: tot > 0 ? ((p / tot) * 100).toFixed(1) : '0',
      absentPct: tot > 0 ? ((a / tot) * 100).toFixed(1) : '0',
      excusedPct: tot > 0 ? ((e / tot) * 100).toFixed(1) : '0'
    }
  }, [rows])

  return (
    <div className="page stack" style={{ gap: '16px' }}>
      <div className="page-head">
        <div>
          <h2>Attendance</h2>
          <p className="muted">Mark P for present, A for absent, or E for excused.</p>
        </div>
        <div className="row">
          <label className="field inline">
            <span>Date:</span>
            <input
              type={period === 'monthly' ? 'month' : 'date'}
              value={period === 'monthly' ? date.slice(0, 7) : (canMarkPast || canViewAll ? date : today())}
              max={today()}
              disabled={!canMarkPast && !canViewAll}
              onChange={(e) => {
                const val = e.target.value
                setDate(period === 'monthly' ? `${val}-01` : val)
              }}
            />
          </label>
        </div>
      </div>

      {canMark && (
        <section className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3>{selectedClass?.name ?? 'Your class'}</h3>
              <p className="muted" style={{ fontSize: '13px', margin: 0 }}>Homeroom attendance entry for {fmtDate(date)}</p>
            </div>
            {canViewAll || !profile?.class_id ? <ClassPicker /> : null}
          </div>
          <div className="row">
            <span className="chip" style={{ background: '#dcfce7', color: '#166534', borderColor: '#bbf7d0' }}>
              Present: {totals.present} ({totals.presentPct}%)
            </span>
            <span className="chip" style={{ background: '#fee2e2', color: '#991b1b', borderColor: '#fecaca' }}>
              Absent: {totals.absent} ({totals.absentPct}%)
            </span>
            <span className="chip" style={{ background: '#f1f5f9', color: '#475569', borderColor: '#e2e8f0' }}>
              Excused: {totals.excused} ({totals.excusedPct}%)
            </span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>No.</th>
                  <th>Status</th>
                  <th>Reason for absence</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="muted center">No students enrolled in this class.</td></tr>
                )}
                {rows.map((row) => (
                  <tr key={row.student_id}>
                    <td><strong>{row.student_name}</strong></td>
                    <td className="mono">{row.student_no}</td>
                    <td>
                      <select
                        value={row.status}
                        onChange={(e) => setStatus(row.student_id, e.target.value as AttendanceStatus | '')}
                      >
                        <option value="">Select…</option>
                        <option value="P">P — Present</option>
                        <option value="A">A — Absent</option>
                        <option value="E">E — Excused</option>
                      </select>
                    </td>
                    <td>
                      <input
                        value={row.reason}
                        disabled={row.status !== 'A'}
                        placeholder={row.status === 'A' ? 'Enter reason (Required)' : '—'}
                        onChange={(e) => setReason(row.student_id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="btn btn-primary"
            disabled={busy || rows.length === 0}
            onClick={save}
          >
            {busy ? 'Saving…' : 'Save attendance'}
          </button>
        </section>
      )}

      {/* Leadership Summaries: Daily, Weekly, Monthly with % */}
      {canViewAll && (
        <section className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3>📊 School Attendance Summaries ({aggregatedSummary?.periodLabel ?? date})</h3>
              <p className="muted" style={{ fontSize: '13px', margin: 0 }}>
                Aggregated attendance rates and percentage statistics.
              </p>
            </div>

            <div className="seg" style={{ margin: 0 }}>
              <button
                type="button"
                className={`seg-btn ${period === 'daily' ? 'active' : ''}`}
                onClick={() => setPeriod('daily')}
              >
                Daily
              </button>
              <button
                type="button"
                className={`seg-btn ${period === 'weekly' ? 'active' : ''}`}
                onClick={() => setPeriod('weekly')}
              >
                Weekly
              </button>
              <button
                type="button"
                className={`seg-btn ${period === 'monthly' ? 'active' : ''}`}
                onClick={() => setPeriod('monthly')}
              >
                Monthly
              </button>
            </div>
          </div>

          {aggregatedSummary && (
            <>
              {/* Overall Rate Banner */}
              <div className="row" style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, color: 'var(--teal)' }}>
                  Total Attendance Health: {aggregatedSummary.presentPct}% Present
                </span>
                <div className="row" style={{ gap: '8px' }}>
                  <span className="chip" style={{ background: '#dcfce7', color: '#166534' }}>
                    Present: {aggregatedSummary.present} ({aggregatedSummary.presentPct}%)
                  </span>
                  <span className="chip" style={{ background: '#fee2e2', color: '#991b1b' }}>
                    Absent: {aggregatedSummary.absent} ({aggregatedSummary.absentPct}%)
                  </span>
                  <span className="chip" style={{ background: '#f1f5f9', color: '#475569' }}>
                    Excused: {aggregatedSummary.excused} ({aggregatedSummary.excusedPct}%)
                  </span>
                </div>
              </div>

              {/* Class Breakdown Table */}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Homeroom Teacher</th>
                      {period !== 'daily' && <th className="num">Days Marked</th>}
                      <th className="num">Present (%)</th>
                      <th className="num">Absent (%)</th>
                      <th className="num">Excused (%)</th>
                      <th className="num">Total Records</th>
                      <th style={{ width: '130px' }}>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregatedSummary.classBreakdown.length === 0 ? (
                      <tr><td colSpan={8} className="muted center">No attendance data found for this period.</td></tr>
                    ) : (
                      aggregatedSummary.classBreakdown.map((c) => (
                        <tr key={c.class_id}>
                          <td><strong>{c.class_name}</strong></td>
                          <td className="muted">{c.homeroom_teacher_name}</td>
                          {period !== 'daily' && <td className="num mono">{c.daysMarked}</td>}
                          <td className="num">
                            <span style={{ color: '#1f8a5f', fontWeight: 600 }}>{c.present}</span>
                            <span className="muted" style={{ fontSize: '12px' }}> ({c.presentPct}%)</span>
                          </td>
                          <td className="num">
                            <span style={{ color: c.absent > 0 ? '#dc2626' : 'inherit', fontWeight: c.absent > 0 ? 600 : 400 }}>{c.absent}</span>
                            <span className="muted" style={{ fontSize: '12px' }}> ({c.absentPct}%)</span>
                          </td>
                          <td className="num">
                            <span>{c.excused}</span>
                            <span className="muted" style={{ fontSize: '12px' }}> ({c.excusedPct}%)</span>
                          </td>
                          <td className="num mono">{c.total}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${c.presentPct}%`, height: '100%', background: c.presentPct >= 90 ? '#1f8a5f' : c.presentPct >= 75 ? '#d97706' : '#ef4444' }} />
                              </div>
                              <span style={{ fontSize: '11px', fontWeight: 700 }}>{c.presentPct}%</span>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Absences List */}
              {aggregatedSummary.absences.length > 0 && (
                <div className="stack" style={{ marginTop: '10px' }}>
                  <h4 style={{ margin: '8px 0 4px', fontSize: '14px', color: '#991b1b' }}>
                    Absences Recorded in this Period ({aggregatedSummary.absences.length})
                  </h4>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Class</th>
                          <th>Student Name</th>
                          <th>Student No.</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aggregatedSummary.absences.map((a, idx) => (
                          <tr key={`${a.date}-${a.student_no}-${idx}`}>
                            <td className="mono">{fmtDate(a.date)}</td>
                            <td><strong>{a.class_name}</strong></td>
                            <td>{a.student_name}</td>
                            <td className="mono">{a.student_no}</td>
                            <td><span className="chip" style={{ background: '#fee2e2', color: '#991b1b' }}>{a.reason || 'No reason'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {error && <div className="notice notice-error">{error}</div>}
      {info && <div className="notice notice-ok">{info}</div>}
    </div>
  )
}

