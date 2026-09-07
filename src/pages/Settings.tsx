import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { useSchool } from '../context/SchoolContext'
import { useAuth } from '../context/AuthContext'
import { can } from '../lib/permissions'
import type { School } from '../lib/types'

export default function SettingsPage() {
  const { school, subjects, refresh } = useSchool()
  const { profile } = useAuth()
  const [draft, setDraft] = useState<School | null>(null)
  const [newSubject, setNewSubject] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const canEdit = can(profile?.role, 'editSchool')
  const canSubjects = can(profile?.role, 'manageSubjects')

  useEffect(() => {
    if (school) setDraft(school)
  }, [school])

  if (!draft) {
    return <div className="page"><div className="card"><p className="muted center">Loading…</p></div></div>
  }

  const set = (patch: Partial<School>) => setDraft({ ...draft, ...patch })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await api.saveSchool(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      refresh()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const addSubject = async () => {
    const name = newSubject.trim()
    if (!name) return
    await api.addSubject(name)
    setNewSubject('')
    refresh()
  }

  const removeSubject = async (id: string, name: string) => {
    if (!confirm(`Delete subject "${name}"? Its unit tests and scores will be removed.`)) return
    await api.deleteSubject(id)
    refresh()
  }

  return (
    <div className="page">
      <h2>School Settings</h2>
      <p className="muted">{canEdit ? 'Details shown on every report, plus your subject list.' : 'View of the school details used on reports.'}</p>

      <form onSubmit={save} className="card stack">
        <h3>School &amp; report header</h3>
        <div className="grid3">
          <label className="field"><span>School name</span>
            <input value={draft.name} disabled={!canEdit} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="field"><span>Motto (optional)</span>
            <input value={draft.motto} disabled={!canEdit} onChange={(e) => set({ motto: e.target.value })} />
          </label>
          <label className="field"><span>Academic year</span>
            <input value={draft.academic_year} disabled={!canEdit} onChange={(e) => set({ academic_year: e.target.value })} />
          </label>
          <label className="field"><span>Term</span>
            <input value={draft.term} disabled={!canEdit} onChange={(e) => set({ term: e.target.value })} />
          </label>
          <label className="field"><span>Footer text (contact details)</span>
            <input value={draft.footer_text} disabled={!canEdit} onChange={(e) => set({ footer_text: e.target.value })} />
          </label>
          <label className="field inline"><span>Footer colour</span>
            <input type="color" value={draft.footer_color} disabled={!canEdit} onChange={(e) => set({ footer_color: e.target.value })} />
          </label>
        </div>
        {canEdit && (
          <div className="row">
            <label className="check"><input type="checkbox" checked={draft.show_school_logo} onChange={(e) => set({ show_school_logo: e.target.checked })} /> Show school logo</label>
            <label className="check"><input type="checkbox" checked={draft.show_cambridge_logo} onChange={(e) => set({ show_cambridge_logo: e.target.checked })} /> Show Cambridge logo</label>
          </div>
        )}
        {canEdit && (
          <div className="row">
            <button className="btn btn-primary">Save settings</button>
            {saved && <span className="notice-ok">Saved ✓</span>}
          </div>
        )}
        {error && <div className="notice notice-error">{error}</div>}
      </form>

      {canSubjects && (
        <div className="card">
          <h3>Subjects</h3>
          <div className="row">
            <input
              className="grow"
              placeholder="New subject name…"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubject() } }}
            />
            <button className="btn" onClick={addSubject}>Add subject</button>
          </div>
          <div className="chips">
            {subjects.map((s) => (
              <span key={s.id} className="chip">
                {s.name}
                <button type="button" className="chip-x" onClick={() => removeSubject(s.id, s.name)} aria-label={`Delete ${s.name}`}>×</button>
              </span>
            ))}
            {subjects.length === 0 && <span className="muted">No subjects yet.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
