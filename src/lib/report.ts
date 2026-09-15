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

export function formatStudentNo(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value).trim()
  const digits = str.replace(/\D/g, '')
  if (!digits) return str
  const n = parseInt(digits, 10)
  if (isNaN(n) || n <= 0) return str
  return `ST-${String(n).padStart(3, '0')}`
}

export function nextStudentNo(existing: string[]): string {
  let max = 0
  for (const s of existing) {
    if (!s) continue
    const digits = s.trim().replace(/\D/g, '')
    if (digits) {
      const n = parseInt(digits, 10)
      if (!isNaN(n)) max = Math.max(max, n)
    }
  }
  return `ST-${String(max + 1).padStart(3, '0')}`
}

/**
 * Formats an admission number so scientific notation (e.g. "2.48923E+13" or "2.48923E+13-1")
 * is expanded and displayed as a real, full numeric string (e.g. "24892300000000" or "24892300000000-1").
 */
export function formatAdmissionNo(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return ''
  const str = String(val).trim()
  if (!str) return ''

  // Match scientific notation (e.g. 2.48923E+13, 2.48923e+13, with optional suffix like -1)
  const sciMatch = /^([+-]?[0-9]+(?:\.[0-9]+)?)[eE]([+-]?[0-9]+)(.*)$/.exec(str)
  if (!sciMatch) return str

  const [, coeffStr, expStr, suffix] = sciMatch
  const exp = parseInt(expStr, 10)
  if (isNaN(exp)) return str

  const isNegative = coeffStr.startsWith('-')
  const cleanCoeff = coeffStr.replace(/^[+-]/, '')
  const [intPart, fracPart = ''] = cleanCoeff.split('.')

  let expanded = ''
  if (exp >= 0) {
    if (exp >= fracPart.length) {
      expanded = intPart + fracPart + '0'.repeat(exp - fracPart.length)
    } else {
      expanded = intPart + fracPart.slice(0, exp) + '.' + fracPart.slice(exp)
    }
  } else {
    const absExp = Math.abs(exp)
    if (absExp >= intPart.length) {
      expanded = '0.' + '0'.repeat(absExp - intPart.length) + intPart + fracPart
    } else {
      expanded = intPart.slice(0, intPart.length - absExp) + '.' + intPart.slice(intPart.length - absExp) + fracPart
    }
  }

  expanded = expanded.replace(/^0+(?=\d)/, '')
  return (isNegative ? '-' : '') + expanded + suffix
}

