import type {
  Assignment,
  ExamGradeScaleItem,
  ExamOption,
  ExamReportData,
  ExamSubjectRow,
  ReportData,
  ReportFilter,
  ReportSubject,
  StudentReportRow,
  Subject,
  UnitTest
} from './types'

export const DEFAULT_REPORT_START_DATE = '2026-09-20'

/**
 * School Exam Grading Scale with Color Psychology applied to Grades and Comments/Remarks:
 * 90-100 = A* (OUTSTANDING)
 * 80-89  = A  (EXCELLENT)
 * 70-79  = B  (VERY GOOD)
 * 60-69  = C  (GOOD)
 * 50-59  = D  (BASIC UNDERSTANDING)
 * 40-49  = E  (DEVELOPING UNDERSTANDING)
 * 0-39   = U  (NEEDS IMPROVEMENT)
 */
export const EXAM_GRADING_SCALE: ExamGradeScaleItem[] = [
  {
    grade: 'A*',
    minScore: 90,
    maxScore: 100,
    rangeLabel: '90-100',
    scaleNotation: '90-100',
    remark: 'OUTSTANDING',
    psychologyMeaning: 'Mastery, prestige & peak confidence',
    textColor: '#065f46',
    bgColor: '#d1fae5',
    borderColor: '#6ee7b7',
    textRgb: [6, 95, 70],
    bgRgb: [209, 250, 229],
    borderRgb: [110, 231, 183]
  },
  {
    grade: 'A',
    minScore: 80,
    maxScore: 89.99,
    rangeLabel: '80-89',
    scaleNotation: '80-89',
    remark: 'EXCELLENT',
    psychologyMeaning: 'High achievement, growth & harmony',
    textColor: '#15803d',
    bgColor: '#dcfce7',
    borderColor: '#86efac',
    textRgb: [21, 128, 61],
    bgRgb: [220, 252, 231],
    borderRgb: [134, 239, 172]
  },
  {
    grade: 'B',
    minScore: 70,
    maxScore: 79.99,
    rangeLabel: '70-79',
    scaleNotation: '70-79',
    remark: 'VERY GOOD',
    psychologyMeaning: 'Strong competence, clarity & momentum',
    textColor: '#0f766e',
    bgColor: '#ccfbf1',
    borderColor: '#5eead4',
    textRgb: [15, 118, 110],
    bgRgb: [204, 251, 241],
    borderRgb: [94, 234, 212]
  },
  {
    grade: 'C',
    minScore: 60,
    maxScore: 69.99,
    rangeLabel: '60-69',
    scaleNotation: '60-69',
    remark: 'GOOD',
    psychologyMeaning: 'Steady progress, trust & reliability',
    textColor: '#1d4ed8',
    bgColor: '#dbeafe',
    borderColor: '#93c5fd',
    textRgb: [29, 78, 216],
    bgRgb: [219, 234, 254],
    borderRgb: [147, 197, 253]
  },
  {
    grade: 'D',
    minScore: 50,
    maxScore: 59.99,
    rangeLabel: '50-59',
    scaleNotation: '50-59',
    remark: 'BASIC UNDERSTANDING',
    psychologyMeaning: 'Foundational awareness & encouragement',
    textColor: '#b45309',
    bgColor: '#fef3c7',
    borderColor: '#fcd34d',
    textRgb: [180, 83, 9],
    bgRgb: [254, 243, 199],
    borderRgb: [252, 211, 77]
  },
  {
    grade: 'E',
    minScore: 40,
    maxScore: 49.99,
    rangeLabel: '40-49',
    scaleNotation: '40-49',
    remark: 'DEVELOPING UNDERSTANDING',
    psychologyMeaning: 'Constructive focus & active development',
    textColor: '#c2410c',
    bgColor: '#ffedd5',
    borderColor: '#fdba74',
    textRgb: [194, 65, 12],
    bgRgb: [255, 237, 213],
    borderRgb: [253, 186, 116]
  },
  {
    grade: 'U',
    minScore: 0,
    maxScore: 39.99,
    rangeLabel: '0-39',
    scaleNotation: '0-39',
    remark: 'NEEDS IMPROVEMENT',
    psychologyMeaning: 'Urgent attention & supportive intervention',
    textColor: '#b91c1c',
    bgColor: '#fee2e2',
    borderColor: '#fca5a5',
    textRgb: [185, 28, 28],
    bgRgb: [254, 226, 226],
    borderRgb: [252, 165, 165]
  }
]

/**
 * Resolves a percentage score (including decimals such as 89.4%, 89.8%, 79.5%)
 * to its corresponding ExamGradeScaleItem without gaps between integer bands.
 * Normalizes to 1 decimal place (matching fmtPct display precision) so that
 * floating-point inaccuracies (e.g. 79.99999999999999 -> 80.0) or values that
 * display as 90.0% are never misgraded.
 */
export function getExamGradeInfo(scorePct: number | null | undefined): ExamGradeScaleItem | null {
  if (scorePct === null || scorePct === undefined) return null
  const num = Number(scorePct)
  if (!Number.isFinite(num)) return null

  // Clamp to valid percentage range [0, 100] and round to 1 decimal place to match fmtPct()
  const clamped = Math.min(100, Math.max(0, num))
  const val = Number(clamped.toFixed(1))

  // Contiguous lower-bound checks ensure decimal percentages (e.g. 89.1 - 89.9, 79.5, 39.8)
  // never fall into a gap between integer labels (80-89 and 90-100, etc.)
  if (val >= 90) return EXAM_GRADING_SCALE[0] // 90.0 - 100.0 -> A* (OUTSTANDING)
  if (val >= 80) return EXAM_GRADING_SCALE[1] // 80.0 - 89.9  -> A  (EXCELLENT)
  if (val >= 70) return EXAM_GRADING_SCALE[2] // 70.0 - 79.9  -> B  (VERY GOOD)
  if (val >= 60) return EXAM_GRADING_SCALE[3] // 60.0 - 69.9  -> C  (GOOD)
  if (val >= 50) return EXAM_GRADING_SCALE[4] // 50.0 - 59.9  -> D  (BASIC UNDERSTANDING)
  if (val >= 40) return EXAM_GRADING_SCALE[5] // 40.0 - 49.9  -> E  (DEVELOPING UNDERSTANDING)
  return EXAM_GRADING_SCALE[6]                // 0.0  - 39.9  -> U  (NEEDS IMPROVEMENT)
}

/**
 * Extracts distinct school exams from unit tests in a class for the exam selector dropdown.
 */
export function extractExamOptions(unitTests: UnitTest[]): ExamOption[] {
  const examTests = unitTests.filter(
    (t) => t.assessment_type === 'exam' || t.assessment_type === 'midterm'
  )
  const sourceList = examTests.length > 0 ? examTests : []
  const map = new Map<string, { title: string; testDate: string; testIds: string[]; subjectSet: Set<string> }>()

  for (const t of sourceList) {
    const cleanTitle = (t.title || 'School Examination').trim()
    const key = cleanTitle.toLowerCase()
    let entry = map.get(key)
    if (!entry) {
      entry = {
        title: cleanTitle,
        testDate: t.test_date || '',
        testIds: [],
        subjectSet: new Set<string>()
      }
      map.set(key, entry)
    }
    entry.testIds.push(t.id)
    if (t.subject_name) entry.subjectSet.add(t.subject_name.toLowerCase())
    if (t.test_date && (!entry.testDate || t.test_date > entry.testDate)) {
      entry.testDate = t.test_date
    }
  }

  return Array.from(map.entries())
    .map(([key, v]) => ({
      key,
      title: v.title,
      testDate: v.testDate,
      testIds: v.testIds,
      subjectsCount: v.subjectSet.size
    }))
    .sort((a, b) => {
      if (a.testDate && b.testDate && a.testDate !== b.testDate) {
        return b.testDate.localeCompare(a.testDate)
      }
      return a.title.localeCompare(b.title)
    })
}

/**
 * Resolves all subjects that a specific learner is taking in their class.
 */
export function resolveLearnerSubjects(params: {
  studentId: string
  className?: string | null
  allSubjects?: Subject[]
  assignments?: Assignment[]
  allocations?: Record<string, string[]>
  unitTests?: UnitTest[]
  studentRows?: StudentReportRow[]
}): string[] {
  const {
    studentId,
    className,
    allSubjects = [],
    assignments = [],
    allocations = {},
    unitTests = [],
    studentRows = []
  } = params

  // Build subject ID -> name map and sort_order map
  const idToName = new Map<string, string>()
  const sortOrderByName = new Map<string, number>()

  allSubjects.forEach((s, idx) => {
    idToName.set(s.id, s.name)
    sortOrderByName.set(s.name.trim().toLowerCase(), s.sort_order ?? idx)
  })
  assignments.forEach((a) => {
    if (a.subject_id && a.subject_name && !idToName.has(a.subject_id)) {
      idToName.set(a.subject_id, a.subject_name)
    }
  })
  unitTests.forEach((t) => {
    if (t.subject_id && t.subject_name && !idToName.has(t.subject_id)) {
      idToName.set(t.subject_id, t.subject_name)
    }
  })

  const chosenMap = new Map<string, string>() // lowercase -> display name
  const addSubjectName = (name?: string | null) => {
    if (!name) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === '—' || trimmed.toLowerCase().includes('unknown')) return
    const key = trimmed.toLowerCase()
    if (!chosenMap.has(key)) {
      chosenMap.set(key, trimmed)
    }
  }

  const hasAllocationsConfigured = Object.values(allocations).some(
    (arr) => Array.isArray(arr) && arr.length > 0
  )
  const studentAllocIds = allocations[studentId]

  if (hasAllocationsConfigured && Array.isArray(studentAllocIds) && studentAllocIds.length > 0) {
    // Student has explicit subject allocations
    studentAllocIds.forEach((subId) => {
      addSubjectName(idToName.get(subId))
    })
  } else if (!isYear10OrAbove(className) || !hasAllocationsConfigured) {
    // Standard class subject set: prefer subjects assigned to teachers for this class
    if (assignments.length > 0) {
      assignments.forEach((a) => addSubjectName(a.subject_name))
    } else if (unitTests.length > 0) {
      unitTests.forEach((t) => addSubjectName(t.subject_name))
    } else if (allSubjects.length > 0) {
      allSubjects.forEach((s) => addSubjectName(s.name))
    }
  }

  // Always ensure any subject where the student already has a recorded score in studentRows is included
  studentRows.forEach((r) => {
    if (r.score !== null && r.score !== undefined) {
      addSubjectName(r.subject)
    }
  })

  // Fallback if still empty: use any subjects from studentRows, assignments, or allSubjects
  if (chosenMap.size === 0) {
    studentRows.forEach((r) => addSubjectName(r.subject))
    assignments.forEach((a) => addSubjectName(a.subject_name))
    allSubjects.forEach((s) => addSubjectName(s.name))
  }

  return Array.from(chosenMap.values()).sort((a, b) => {
    const orderA = sortOrderByName.get(a.toLowerCase()) ?? 999
    const orderB = sortOrderByName.get(b.toLowerCase()) ?? 999
    if (orderA !== orderB) return orderA - orderB
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  })
}

/**
 * Builds the Independent School Exam Report data for a single learner.
 * Includes all subjects the learner is taking, their exam score (%), letter grade,
 * psychological remark, and overall exam summary.
 */
export function buildExamReport(params: {
  rows: StudentReportRow[]
  learnerSubjects?: string[]
  selectedExamTitle?: string
}): ExamReportData {
  const { rows, learnerSubjects = [], selectedExamTitle } = params

  // Filter rows to school exams (or if selectedExamTitle is specified, match that exam title)
  const normalizedTarget = selectedExamTitle && selectedExamTitle !== '__ALL_EXAMS__'
    ? selectedExamTitle.trim().toLowerCase()
    : ''

  let matchingRows = rows.filter((r) => {
    const isExamType = r.assessment_type === 'exam' || r.assessment_type === 'midterm'
    if (normalizedTarget) {
      return (r.title || '').trim().toLowerCase() === normalizedTarget
    }
    return isExamType
  })

  // Fallback if rows weren't tagged with assessment_type but match the title or all rows are passed
  if (matchingRows.length === 0 && !normalizedTarget && rows.length > 0) {
    matchingRows = rows
  }

  // Group matching exam rows by subject
  const bySubject = new Map<
    string,
    {
      displayName: string
      pctSum: number
      scoredCount: number
      rawSum: number
      maxSum: number
      latestDate: string
    }
  >()

  let latestExamDate = ''
  let inferredTitle = selectedExamTitle && selectedExamTitle !== '__ALL_EXAMS__' ? selectedExamTitle : ''

  for (const r of matchingRows) {
    const subName = (r.subject || '').trim()
    if (!subName || subName === '—') continue
    const key = subName.toLowerCase()
    let entry = bySubject.get(key)
    if (!entry) {
      entry = {
        displayName: subName,
        pctSum: 0,
        scoredCount: 0,
        rawSum: 0,
        maxSum: 0,
        latestDate: r.test_date || ''
      }
      bySubject.set(key, entry)
    }
    if (!inferredTitle && r.title) {
      inferredTitle = r.title
    }
    if (r.test_date && (!latestExamDate || r.test_date > latestExamDate)) {
      latestExamDate = r.test_date
    }
    if (r.score !== null && r.score !== undefined) {
      const maxM = Number(r.max_mark) > 0 ? Number(r.max_mark) : 100
      const sc = Number(r.score)
      const pctVal = (sc / maxM) * 100
      entry.pctSum += pctVal
      entry.scoredCount += 1
      entry.rawSum += sc
      entry.maxSum += maxM
    }
  }

  // Merge learnerSubjects with any subjects present in bySubject
  const orderedSubjects: string[] = []
  const seenKeys = new Set<string>()

  for (const sName of learnerSubjects) {
    const trimmed = (sName || '').trim()
    if (!trimmed) continue
    const k = trimmed.toLowerCase()
    if (!seenKeys.has(k)) {
      seenKeys.add(k)
      orderedSubjects.push(bySubject.get(k)?.displayName || trimmed)
    }
  }

  for (const [k, v] of bySubject.entries()) {
    if (!seenKeys.has(k)) {
      seenKeys.add(k)
      orderedSubjects.push(v.displayName)
    }
  }

  const subjectRows: ExamSubjectRow[] = orderedSubjects.map((subName) => {
    const k = subName.toLowerCase()
    const entry = bySubject.get(k)
    if (entry && entry.scoredCount > 0) {
      const avgPct = Number((entry.pctSum / entry.scoredCount).toFixed(1))
      const gradeInfo = getExamGradeInfo(avgPct)
      return {
        subjectName: subName,
        score: avgPct,
        rawScore: entry.rawSum,
        maxMark: entry.maxSum,
        grade: gradeInfo?.grade ?? null,
        remark: gradeInfo?.remark ?? null,
        gradeInfo
      }
    }
    return {
      subjectName: subName,
      score: null,
      rawScore: null,
      maxMark: null,
      grade: null,
      remark: null,
      gradeInfo: null
    }
  })

  const scoredRows = subjectRows.filter((r) => r.score !== null && r.score !== undefined)
  const overallAverage =
    scoredRows.length > 0
      ? Number(
          (
            scoredRows.reduce((acc, r) => acc + (r.score ?? 0), 0) / scoredRows.length
          ).toFixed(1)
        )
      : null
  const overallGrade = getExamGradeInfo(overallAverage)

  return {
    examTitle: inferredTitle || 'School Examination',
    examDate: latestExamDate || undefined,
    subjects: subjectRows,
    scoredCount: scoredRows.length,
    totalSubjects: subjectRows.length,
    overallAverage,
    overallGrade
  }
}

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
  let result = rows

  if (filter.assessmentType && filter.assessmentType !== 'all') {
    result = result.filter((r) => (r.assessment_type || 'unit_test') === filter.assessmentType)
  }

  if (filter.mode === 'all') {
    return result
  }

  if (filter.mode === 'since_date') {
    const cutoff = filter.startDate || DEFAULT_REPORT_START_DATE
    return result.filter((r) => {
      const createdDate = r.created_at ? r.created_at.slice(0, 10) : r.test_date
      return createdDate >= cutoff
    })
  }

  if (filter.mode === 'custom' && filter.selectedTestIds) {
    const selectedSet = new Set(filter.selectedTestIds)
    return result.filter((r) => r.test_id && selectedSet.has(r.test_id))
  }

  return result
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
 * Determines whether a class is Year 10 or above (elective subject stage),
 * e.g. Year 10, Year 11, Year 12, Year 13, IGCSE, AS/A-Level, Grade 10-12, etc.
 */
export function isYear10OrAbove(className: string | undefined | null): boolean {
  if (!className) return false
  const trimmed = className.trim()
  // Match Year / Yr / Grade / Form followed by number >= 10
  const match = trimmed.match(/(?:year|yr|grade|form)\s*(\d+)/i)
  if (match) {
    const num = parseInt(match[1], 10)
    if (!isNaN(num) && num >= 10) return true
  }
  // Match standalone number 10-13 at word boundaries (e.g. "10A", "11B", "12 Science")
  const standaloneMatch = trimmed.match(/\b(1[0-9])\s*[a-z]?\b/i)
  if (standaloneMatch) {
    const num = parseInt(standaloneMatch[1], 10)
    if (num >= 10 && num <= 13) return true
  }
  // Match senior secondary / post-16 Cambridge frameworks
  if (/\b(igcse|a\s*level|a-level|alevel|as\s*level|as|a2|advanced|sixth\s*form)\b/i.test(trimmed)) {
    return true
  }
  return false
}

/**
 * Build the report for End of Unit Tests:
 *  - subjects arranged by test date with the newest date first
 *  - individual tests within each subject arranged with the newest date first
 *  - subject average = mean of per-test percentages for administered tests
 *    (sum of each test's %, divided by the number of administered tests).
 *    Missed administered tests count as 0%.
 *    The average row is always shown, even when a subject has only one test.
 *  - overall average = mean of the subject averages
 */
export function buildReport(rows: StudentReportRow[]): ReportData {
  /**
   * Track, per subject:
   *  - pctSum: running sum of each administered test's % score
   *  - administeredCount: tests administered to the class (scored OR absent-but-administered)
   *  - scoredCount: tests where the student has a recorded score
   *
   * Average = pctSum / administeredCount  ("mean of per-test %")
   * A missed administered test contributes 0% to pctSum.
   */
  const map = new Map<string, { rows: StudentReportRow[]; pctSum: number; administeredCount: number; scoredCount: number }>()

  for (const r of rows) {
    const key = r.subject.toLowerCase()
    let entry = map.get(key)
    if (!entry) {
      entry = { rows: [], pctSum: 0, administeredCount: 0, scoredCount: 0 }
      map.set(key, entry)
    }
    entry.rows.push(r)
    if (r.score !== null && r.score !== undefined) {
      const testPct = r.max_mark > 0 ? (Number(r.score) / Number(r.max_mark)) * 100 : 0
      entry.pctSum += testPct
      entry.administeredCount += 1
      entry.scoredCount += 1
    }
  }

  // Case A: Unexcused (ABS)
  // For subjects where the student has actively sat at least one assessment (scoredCount > 0),
  // any missed administered test contributes 0% to pctSum and still counts toward administeredCount.
  for (const entry of map.values()) {
    if (entry.scoredCount > 0) {
      for (const r of entry.rows) {
        if (r.score === null || r.score === undefined) {
          // 0% for this test — pctSum stays unchanged, but count goes up
          entry.administeredCount += 1
        }
      }
    }
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
    .map((e) => {
      const hasScores = e.scoredCount > 0 && e.administeredCount > 0
      // average = mean of per-test percentages (pctSum / administeredCount)
      const average = hasScores ? e.pctSum / e.administeredCount : 0
      // totalScore / totalMax: kept for display in the score column cells
      const totalScore = e.rows
        .filter((r) => r.score !== null && r.score !== undefined)
        .reduce((a, r) => a + Number(r.score), 0)
      const totalMax = e.rows.reduce((a, r) => a + Number(r.max_mark), 0)
      return {
        name: e.rows[0].subject,
        rows: e.rows,
        count: e.rows.length,
        totalScore,
        totalMax,
        average
      }
    })
    .sort((a, b) => {
      const dateA = a.rows.length > 0 ? getRowDate(a.rows[0]) : ''
      const dateB = b.rows.length > 0 ? getRowDate(b.rows[0]) : ''
      if (dateA && !dateB) return -1
      if (!dateA && dateB) return 1
      const dateCmp = dateB.localeCompare(dateA) // newest date first
      if (dateCmp !== 0) return dateCmp
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })

  // In overall average: calculate mean of subject averages for subjects that actually have scored tests!
  // Subjects with 0 scored tests should not drag down the student's overall average to 0.
  const scoredSubjects = subjects.filter((s) => {
    const entry = map.get(s.name.toLowerCase())
    return entry && entry.scoredCount > 0 && entry.administeredCount > 0
  })

  const overall =
    scoredSubjects.length > 0
      ? scoredSubjects.reduce((acc, s) => acc + s.average, 0) / scoredSubjects.length
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
