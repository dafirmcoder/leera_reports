import type { ReportData, ReportFilter, ReportSubject, StudentReportRow } from './types'

export const DEFAULT_REPORT_START_DATE = '2026-09-20'

function pct(score: number, max: number): number {
  if (max <= 0) return 0
  return (score / max) * 100
}

/**
 * Filter report rows based on teacher's filter settings:
 * - 'since_date': only tests created on or after startDate (default 2026-09-20)
 * - 'custom': only explicitly checked test IDs
 * - 'all': all recorded tests
 */
export function filterReportRows(
  rows: StudentReportRow[],
  filter: ReportFilter
): StudentReportRow[] {
  if (filter.mode === 'all') {
    return rows
  }

  if (filter.mode === 'since_date') {
    const cutoff = filter.startDate || DEFAULT_REPORT_START_DATE
    return rows.filter((r) => {
      const createdDate = r.created_at ? r.created_at.slice(0, 10) : r.test_date
      return createdDate >= cutoff
    })
  }

  if (filter.mode === 'custom' && filter.selectedTestIds) {
    const selectedSet = new Set(filter.selectedTestIds)
    return rows.filter((r) => r.test_id && selectedSet.has(r.test_id))
  }

  return rows
}

/**
 * Extract and normalize a comparable ISO date string (YYYY-MM-DD) from a report row.
 */
function getRowDate(r: StudentReportRow): string {
  const raw = (r.test_date || r.created_at || '').trim()
  if (!raw) return ''
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (match) {
    const [, y, m, d] = match
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(raw)
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }
  return raw.slice(0, 10)
}

/**
 * Build the report for End of Unit Tests:
 *  - subjects arranged by test date with the newest date first
 *  - individual tests within each subject arranged with the newest date first
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

  // Sort tests within each subject by test date descending (newest date first)
  for (const entry of map.values()) {
    entry.rows.sort((a, b) => {
      const dateA = getRowDate(a)
      const dateB = getRowDate(b)
      if (dateA && !dateB) return -1
      if (!dateA && dateB) return 1
      const dateCmp = dateB.localeCompare(dateA) // newest date first
      if (dateCmp !== 0) return dateCmp
      return (a.title || '').localeCompare(b.title || '')
    })
  }

  // Arrange subjects by date with newest date first (using the subject's latest test date)
  const subjects: ReportSubject[] = [...map.values()]
    .map((e) => ({
      name: e.rows[0].subject,
      rows: e.rows,
      count: e.rows.length,
      totalScore: e.totalScore,
      totalMax: e.totalMax,
      average: pct(e.totalScore, e.totalMax)
    }))
    .sort((a, b) => {
      const dateA = a.rows.length > 0 ? getRowDate(a.rows[0]) : ''
      const dateB = b.rows.length > 0 ? getRowDate(b.rows[0]) : ''
      if (dateA && !dateB) return -1
      if (!dateA && dateB) return 1
      const dateCmp = dateB.localeCompare(dateA) // newest date first
      if (dateCmp !== 0) return dateCmp
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

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
  return String(n)
}

export function nextStudentNo(existing: string[]): string {
  let max = 0
  for (const s of existing) {
    if (!s) continue
    const digits = String(s).trim().replace(/\D/g, '')
    if (digits) {
      const n = parseInt(digits, 10)
      if (!isNaN(n)) max = Math.max(max, n)
    }
  }
  return String(max + 1)
}

export function getClassCode(className: string): string {
  if (!className) return '0'
  const yearMatch = className.match(/Year\s*([0-9]+)/i) || className.match(/([0-9]+)/)
  const year = yearMatch ? yearMatch[1] : '0'
  const streamMatch = className.match(/(?:Year\s*[0-9]+|[0-9]+)\s*[-–—:]?\s*([A-Za-z]+)/i)
  if (streamMatch && streamMatch[1]) {
    return (year + streamMatch[1][0].toUpperCase()).toUpperCase()
  }
  if (year === '0') {
    const letters = className.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
    return letters || '0'
  }
  return year
}

/**
 * Normalizes class names into a canonical year/grade level group.
 * e.g. "Year 9 ATLANTIC", "Year 9 PACIFIC", "Year 9", "Y9" -> "Year 9"
 * e.g. "Year 7 A", "Year 7" -> "Year 7"
 */
export function getYearLevelFromClassName(className?: string | null): string {
  if (!className) return ''
  const clean = className.trim()
  const m = clean.match(/(?:Year|Grade|Form|Yr|Stage)\s*([0-9]+)/i) || clean.match(/^Y([0-9]+)/i)
  if (m && m[1]) {
    return `Year ${m[1]}`
  }
  const digitMatch = clean.match(/^([0-9]+)/)
  if (digitMatch && digitMatch[1]) {
    return `Year ${digitMatch[1]}`
  }
  return clean
}

export function getYearSuffix(academicYear?: string): string {
  if (!academicYear) return String(new Date().getFullYear()).slice(-2)
  const m = academicYear.match(/([0-9]{4})/)
  if (m) return String(parseInt(m[1], 10) % 100).padStart(2, '0')
  return String(new Date().getFullYear()).slice(-2)
}

export function buildRollNo(className: string, seq: number, academicYear?: string): string {
  const code = getClassCode(className)
  const yy = getYearSuffix(academicYear)
  return `LIS-${String(seq).padStart(3, '0')}/${code}/${yy}`
}

/**
 * Validates and formats Roll No (LIS-001/9P/26).
 * Also supports expanding legacy scientific notation if present.
 */
export function formatRollNo(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return ''
  const str = String(val).trim()
  if (!str) return ''

  // If matches new format LIS-001/9P/26, return uppercased
  if (/^LIS-[0-9]{3}\/[0-9]+[A-Z]?\/[0-9]{2}$/i.test(str)) {
    return str.toUpperCase()
  }

  // Legacy scientific notation expansion (keep for backward compatibility)
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

export const formatAdmissionNo = formatRollNo

