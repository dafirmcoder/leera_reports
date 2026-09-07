import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import ClassPicker from '../components/ClassPicker'
import type { Student, StudentReportRow } from '../lib/types'

const canSaveToFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window

export default function Reports() {
  const { selectedClassId, classes, school } = useSchool()
  const [students, setStudents] = useState<Student[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selectedClassId) return
    api.listStudents(selectedClassId).then(setStudents).catch(() => {})
  }, [selectedClassId])

  const cls = classes.find((c) => c.id === selectedClassId)
  const filtered = students.filter((s) => s.full_name.toLowerCase().includes(q.toLowerCase()))

  const runBulk = async (mode: 'zip' | 'folder') => {
    if (!selectedClassId || !school) return
    setBusy(true)
    setError('')
    setProgress('Preparing reports…')
    try {
      const rowsByStudent: Record<string, StudentReportRow[]> = await api.getClassReportRows(selectedClassId)
      const opts = {
        students,
        rowsByStudent,
        school,
        className: cls?.name ?? 'Class',
        teacherName: cls?.homeroom_teacher_name ?? '',
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Reports{cls ? ` — ${cls.name}` : ''}</h2>
          <p className="muted">Preview a single report, or download every student's report as individual PDFs.</p>
        </div>
        <ClassPicker />
      </div>

      <div className="row">
        <input className="search" placeholder="Search student…" value={q} onChange={(e) => setQ(e.target.value)} />
        {selectedClassId && students.length > 0 && (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => runBulk('zip')}>
              ⬇ Download all (ZIP)
            </button>
            {canSaveToFolder && (
              <button className="btn" disabled={busy} onClick={() => runBulk('folder')}>
                📁 Save to folder
              </button>
            )}
          </>
        )}
      </div>

      {progress && <div className="notice">{progress}</div>}
      {error && <div className="notice notice-error">{error}</div>}

      <div className="card">
        {filtered.length === 0 && <p className="muted center">No students found.</p>}
        {filtered.map((s) => (
          <Link key={s.id} to={`/reports/${s.id}`} className="list-row link">
            <div className="list-main">
              <strong>{s.full_name}</strong>
              <span className="muted"> {s.student_no}{s.admission_no ? ` · Adm ${s.admission_no}` : ''}</span>
            </div>
            <span className="btn btn-small">Open report →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
