import type { ReportData, ReportSubject, StudentReportRow } from './types'

function pct(score: number, max: number): number {
  if (max <= 0) return 0
  return (score / max) * 100
}

/**
 * Build the report exactly like the Excel VBA did:
 *  - subjects sorted alphabetically
 *  - subject average = total score / total max x 100 (subject row shown
 *    separately when a subject has more than one test)
 *  - overall average = mean of the subject averages
 */
export function buildReport(rows: StudentReportRow[]): ReportData {
  const map = new Map<string, { rows: StudentReportRow[]; totalScore: number; totalMax: number }>()

  for (const r of rows) {
    const key = r.subject.toLowerCase()
    let entry = map.get(key)
    if (!entry) {
      entry = { rows: [], totalScore: 0, totalMax: 0 }
      map.set(key, entry)
    }
    entry.rows.push(r)
    entry.totalScore += r.score
    entry.totalMax += r.max_mark
  }

  const subjects: ReportSubject[] = [...map.values()]
    .map((e) => ({
      name: e.rows[0].subject,
      rows: e.rows,
      count: e.rows.length,
      totalScore: e.totalScore,
      totalMax: e.totalMax,
      average: pct(e.totalScore, e.totalMax)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  const overall =
    subjects.length > 0
      ? subjects.reduce((acc, s) => acc + s.average, 0) / subjects.length
      : 0

  return { subjects, overall }
}

export function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`
}

export function fmtDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function nextStudentNo(existing: string[]): string {
  let max = 0
  for (const s of existing) {
    const m = /^ST-(\d+)$/i.exec(s.trim())
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `ST-${String(max + 1).padStart(3, '0')}`
}
