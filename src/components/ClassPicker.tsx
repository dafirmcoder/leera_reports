import { useSchool } from '../context/SchoolContext'

export default function ClassPicker() {
  const { classes, selectedClassId, setSelectedClassId } = useSchool()
  if (classes.length <= 1) return null
  return (
    <label className="field inline classpicker">
      <span>Class</span>
      <select
        value={selectedClassId ?? ''}
        onChange={(e) => setSelectedClassId(e.target.value)}
      >
        {classes.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>
  )
}
