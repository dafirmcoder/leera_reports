import * as pdfjsLib from 'pdfjs-dist'
import type { TeacherScheduleSlot } from './types'

if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
  } catch {
    // worker fallback
  }
}

const DAYS_MAP: Record<string, number> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tue: 1,
  tues: 1,
  wednesday: 2,
  wed: 2,
  thursday: 3,
  thu: 3,
  thur: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6
}

const TIME_RANGE_REGEX = /(?:^|\s)(0?[7-9]|1[0-9])[:.]([0-5][0-9])\s*(?:am|pm)?\s*(?:-|–|—|to)\s*(0?[7-9]|1[0-9])[:.]([0-5][0-9])\s*(?:am|pm)?/i

function parseTimeRange(str: string): { startTime: string; endTime: string } | null {
  const m = str.match(TIME_RANGE_REGEX)
  if (!m) return null
  const startH = m[1].padStart(2, '0')
  const startM = m[2]
  const endH = m[3].padStart(2, '0')
  const endM = m[4]
  return {
    startTime: `${startH}:${startM}`,
    endTime: `${endH}:${endM}`
  }
}

// Assemble split time tokens on the same horizontal line (e.g. "8:00" + "-" + "8:40")
function assembleSplitTokens(items: PdfPositionedItem[]): PdfPositionedItem[] {
  const result = [...items]
  const sorted = [...items].sort((a, b) => Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x)
  for (let i = 0; i < sorted.length - 2; i++) {
    const a = sorted[i], b = sorted[i + 1], c = sorted[i + 2]
    if (Math.abs(a.y - b.y) <= 3 && Math.abs(b.y - c.y) <= 3) {
      if (/^\d{1,2}:\d{2}$/.test(a.str) && /^[-–—]$/.test(b.str) && /^\d{1,2}:\d{2}$/.test(c.str)) {
        const assembledStr = `${a.str} - ${c.str}`
        result.push({
          str: assembledStr,
          x: a.x,
          y: a.y,
          w: (c.x + c.w) - a.x,
          h: a.h,
          page: a.page
        })
      }
    }
  }
  return result
}

const NON_LESSON_KEYWORDS = [
  'break',
  'lunch',
  'tea break',
  'breakfast',
  'assembly',
  'morning assembly',
  'duty',
  'homeroom',
  'free',
  'planning',
  'meeting',
  'registration',
  'clubs',
  'lessons/week',
  'lessons / week',
  'asc timetables',
  'timetable generated',
  'count',
  'total',
  'short',
  'primary:',
  'secondary:',
  'total:',
  'subjects'
]

function isNonLesson(str: string): boolean {
  const s = str.toLowerCase().trim()
  if (NON_LESSON_KEYWORDS.some((kw) => s.includes(kw))) return true
  if (/^—+\s*(break)?\s*—*$/i.test(s)) return true
  if (/^\d+\s*lessons?(\s*\/\s*week)?$/i.test(s)) return true
  if (/\(\d+\s*lessons?\)/i.test(s)) return true
  if (/^[-–—]$/.test(s)) return true
  return false
}

// Common subject abbreviations and aliases in school timetables
const SUBJECT_ALIASES: Array<{ match: RegExp; canonical: string; alternate?: string }> = [
  { match: /^(?:comp[\.\s\-_]*sc[\.\s\-_]*prc|cs\s*prc|comp\s*prc)/i, canonical: 'Computer Science', alternate: 'COMP-SC-PRC' },
  { match: /^(?:comp[\.\s\-_]*sc|cs|computer\s*science)/i, canonical: 'Computer Science' },
  { match: /^(?:ict|it|computing|information\s*technology)/i, canonical: 'ICT', alternate: 'Computing' },
  { match: /^(?:math|maths|mathematics|pure\s*math)/i, canonical: 'Mathematics' },
  { match: /^(?:eng|engl|english(?:\s*language|\s*literature)?)/i, canonical: 'English' },
  { match: /^(?:sci|science|gen\s*sci)/i, canonical: 'Science' },
  { match: /^(?:bio|biol|biology)/i, canonical: 'Biology' },
  { match: /^(?:chem|chemistry)/i, canonical: 'Chemistry' },
  { match: /^(?:phy|phys|physics)/i, canonical: 'Physics' },
  { match: /^(?:gp|global\s*perspectives)/i, canonical: 'Global Perspectives' },
  { match: /^(?:geo|geog|geography)/i, canonical: 'Geography' },
  { match: /^(?:hist|history)/i, canonical: 'History' },
  { match: /^(?:hum|humanities)/i, canonical: 'Humanities' },
  { match: /^(?:bs|bus|business(?:\s*studies)?)/i, canonical: 'Business Studies' },
  { match: /^(?:econ|economics)/i, canonical: 'Economics' },
  { match: /^(?:art|visual\s*art)/i, canonical: 'Art' },
  { match: /^(?:pe|p\.e\.|physical\s*education|sports)/i, canonical: 'Physical Education' },
  { match: /^(?:chi|chin|chinese)/i, canonical: 'Chinese' },
  { match: /^(?:fre|fren|french)/i, canonical: 'French' },
  { match: /^(?:kisw|kiswahili|swahili)/i, canonical: 'Kiswahili' },
  { match: /^(?:music)/i, canonical: 'Music' },
  { match: /^(?:drama)/i, canonical: 'Drama' },
  { match: /^(?:sociology|soc)/i, canonical: 'Sociology' },
  { match: /^(?:psychology|psych)/i, canonical: 'Psychology' }
]

export interface ParsedTimetableResult {
  slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>>
  rawPreview: string
  warnings: string[]
  pagesExtracted?: number
  totalPages?: number
  isCombinedBlock?: boolean
  primarySlotsCount?: number
  secondarySlotsCount?: number
}

export interface TimetableParseOptions {
  /**
   * When true (e.g. for teachers with Year 5 and/or Year 6 subject assignments),
   * allows extracting from a 2-page PDF (Primary + Secondary) and merging into a single block timetable.
   */
  allowTwoPageCombine?: boolean
  /**
   * Teacher's assigned class-subject pairs to assist resolving class/subject when a cell
   * only displays a class name (common on Primary timetables) or shorthand.
   */
  teacherAssignments?: Array<{
    class_id: string
    subject_id: string
    class_name?: string
    subject_name?: string
  }>
}

interface PdfPositionedItem {
  str: string
  x: number
  y: number
  w: number
  h: number
  page: number
}

interface ExtractedPdfPage {
  pageNumber: number
  items: PdfPositionedItem[]
  lines: string[]
  matchesTeacher: boolean
}

/**
 * Checks whether a class name represents a Primary class (Years 1–6, specifically Year 5 or Year 6).
 */
export function isPrimaryClassName(className?: string | null): boolean {
  if (!className) return false
  return /\b(?:year|yr|grade|stage|y)\s*[1-6]\b/i.test(className.trim()) || /^[1-6](?:[A-Za-z]|\s*-\s*[A-Za-z]+)?$/i.test(className.trim())
}

/**
 * Checks whether a class name represents Year 5 or Year 6 specifically.
 */
export function isYear5Or6ClassName(className?: string | null): boolean {
  if (!className) return false
  return /\b(?:year|yr|grade|stage|y)\s*[56]\b/i.test(className.trim()) || /^[56](?:[A-Za-z]|\s*-\s*[A-Za-z]+)?$/i.test(className.trim())
}

/**
 * Normalizes and resolves a raw subject code or name against known subjects in the database.
 */
function resolveSubject(
  rawText: string,
  knownSubjects: Array<{ id: string; name: string }>,
  legendSubjects: string[] = []
): { name: string; id: string | null } {
  const clean = rawText.trim()
  if (!clean) return { name: 'General', id: null }

  const cleanLower = clean.toLowerCase()

  // 1. Direct match with known subjects
  const exact = knownSubjects.find((s) => s.name.toLowerCase() === cleanLower)
  if (exact) return { name: exact.name, id: exact.id }

  // 2. Direct match with aliases
  for (const alias of SUBJECT_ALIASES) {
    if (alias.match.test(clean)) {
      const knownMatch = knownSubjects.find(
        (s) =>
          s.name.toLowerCase() === alias.canonical.toLowerCase() ||
          (alias.alternate && s.name.toLowerCase() === alias.alternate.toLowerCase()) ||
          alias.match.test(s.name)
      )
      if (knownMatch) return { name: knownMatch.name, id: knownMatch.id }
      return { name: alias.canonical, id: null }
    }
  }

  // 3. Match against legend subjects
  for (const ls of legendSubjects) {
    const lsLower = ls.toLowerCase()
    if (lsLower.includes(cleanLower) || cleanLower.includes(lsLower)) {
      const knownMatch = knownSubjects.find(
        (s) =>
          s.name.toLowerCase() === lsLower ||
          s.name.toLowerCase().includes(lsLower) ||
          lsLower.includes(s.name.toLowerCase())
      )
      if (knownMatch) return { name: knownMatch.name, id: knownMatch.id }
      return { name: ls, id: null }
    }
  }

  // 4. Substring in known subjects
  const subMatch = knownSubjects.find(
    (s) =>
      s.name.toLowerCase().includes(cleanLower) ||
      cleanLower.includes(s.name.toLowerCase())
  )
  if (subMatch) return { name: subMatch.name, id: subMatch.id }

  return { name: clean, id: null }
}

/**
 * Normalizes and resolves class name against known classes (supporting Year 5, Year 6, Primary & Secondary formats).
 */
function resolveClass(
  rawText: string,
  knownClasses: Array<{ id: string; name: string }>
): { name: string; id: string | null } {
  let clean = rawText
    .replace(/\b9\s*-\s*Atlanti\s*c\b/gi, 'Year 9 Atlantic')
    .replace(/\b([1-9]|1[0-3])\s*-\s*([A-Za-z]+)\b/gi, 'Year $1 $2')
    .replace(/\s+c$/i, 'c')
    .replace(/\s*-\s*/g, '-')
    .trim()

  const asYrMatch = clean.match(/as[-\s]*yr\s*(\d+)/i)
  if (asYrMatch) clean = `Year ${asYrMatch[1]}`

  clean = clean.replace(/\b(?:year|yr|grade|stage|y)\s*(\d+)[-\s]+([A-Za-z]+)/i, 'Year $1 $2')
  clean = clean.replace(/\b(?:year|yr|grade|stage|y)\s*(\d+)\b/i, 'Year $1')

  const cleanNorm = clean.toLowerCase().replace(/[\s\-_]+/g, '')

  // 1. Exact match
  for (const c of knownClasses) {
    const cNorm = c.name.toLowerCase().replace(/[\s\-_]+/g, '')
    if (cNorm === cleanNorm) {
      return { name: c.name, id: c.id }
    }
  }

  // 2. Exact year number + stream match (prevents Year 1 matching Year 10)
  const cleanYearMatch = clean.match(/\byear\s*(\d+)\b/i)
  if (cleanYearMatch) {
    const targetYrNum = cleanYearMatch[1]
    const sameYearClasses = knownClasses.filter((c) => {
      const m = c.name.match(/\b(?:year|yr|grade|stage|y)?\s*(\d+)\b/i)
      return m && m[1] === targetYrNum
    })
    if (sameYearClasses.length === 1) {
      return { name: sameYearClasses[0].name, id: sameYearClasses[0].id }
    }
    if (sameYearClasses.length > 1) {
      for (const c of sameYearClasses) {
        const cNorm = c.name.toLowerCase().replace(/[\s\-_]+/g, '')
        if (cleanNorm.includes(cNorm) || cNorm.includes(cleanNorm)) {
          return { name: c.name, id: c.id }
        }
      }
    }
  }

  // 3. Substring match (ensure at least 4 characters and avoid matching bare 'year')
  if (cleanNorm.length >= 4 && cleanNorm !== 'year') {
    for (const c of knownClasses) {
      const cNorm = c.name.toLowerCase().replace(/[\s\-_]+/g, '')
      if (cleanNorm.includes(cNorm) || (cNorm.includes(cleanNorm) && /\d/.test(cleanNorm))) {
        return { name: c.name, id: c.id }
      }
    }
  }

  return { name: clean, id: null }
}

/**
 * Parses cell text lines to accurately distinguish Subject, Class (e.g. Year 5, Year 6, Year 9), and Room,
 * regardless of whether the PDF prints Subject above Class or Class above Subject.
 */
function parseCellSubjectClassRoom(
  textParts: string[],
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>
): {
  resolvedSub: { name: string; id: string | null }
  resolvedCls: { name: string; id: string | null }
  room: string
} | null {
  if (textParts.length === 0) return null

  const looksLikeClass = (str: string) =>
    /\b(?:year|yr|grade|stage|as[-\s]*yr)\s*\d+|\b(?:[1-9]|1[0-3])\s*-\s*[a-z]+|^y\d+\b/i.test(str.trim())

  const looksLikeRoom = (str: string) =>
    /(?:lab|room|hall|comp)/i.test(str.trim()) || /^[A-Z]\d+$/.test(str.trim())

  let room = ''
  let workingParts = [...textParts]
  if (workingParts.length > 1 && looksLikeRoom(workingParts[workingParts.length - 1])) {
    room = workingParts[workingParts.length - 1]
    workingParts = workingParts.slice(0, -1)
  }

  let subjectRaw = workingParts[0]
  let classRaw = workingParts.slice(1).join(' ') || subjectRaw

  // If the first line is a class name (e.g., "Year 5" or "Year 6") and the remaining lines hold the subject
  if (workingParts.length > 1 && looksLikeClass(workingParts[0]) && !looksLikeClass(workingParts.slice(1).join(' '))) {
    classRaw = workingParts[0]
    subjectRaw = workingParts.slice(1).join(' ')
  } else if (workingParts.length === 1) {
    // Single combined token, e.g. "ICT Year 5" or "Year 6 - ICT"
    const combined = workingParts[0]
    const clsMatch = combined.match(/\b((?:year|yr|grade|stage|as[-\s]*yr)\s*\d+(?:\s+[A-Za-z]+)?)\b/i)
    if (clsMatch) {
      classRaw = clsMatch[1].trim()
      const strippedSub = combined.replace(clsMatch[0], '').replace(/^[\s\-–—:/()]+|[\s\-–—:/()]+$/g, '').trim()
      if (strippedSub) {
        subjectRaw = strippedSub
      }
    }
  }

  if (/^[-–—]$/.test(subjectRaw) || isNonLesson(subjectRaw) || isNonLesson(classRaw)) {
    return null
  }

  const resolvedSub = resolveSubject(subjectRaw, knownSubjects)
  const resolvedCls = resolveClass(classRaw, knownClasses)

  return { resolvedSub, resolvedCls, room }
}

/**
 * Extracts positioned text items and per-page content from a PDF file.
 */
async function extractPagesFromPdf(
  file: File,
  targetTeacherName?: string
): Promise<{
  pages: ExtractedPdfPage[]
  allLines: string[]
  pageCount: number
}> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise

  const pages: ExtractedPdfPage[] = []
  const allLines: string[] = []

  const teacherTokens = (targetTeacherName || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2 && !['mr.', 'ms.', 'mrs.', 'dr.', 'teacher'].includes(t))

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const pageItems: PdfPositionedItem[] = []
    const pageLines: string[] = []

    for (const rawItem of content.items as any[]) {
      const str = (rawItem.str || '').trim()
      if (!str) continue

      pageItems.push({
        str,
        x: Math.round(rawItem.transform[4] * 10) / 10,
        y: Math.round(rawItem.transform[5] * 10) / 10,
        w: Math.round((rawItem.width || 0) * 10) / 10,
        h: Math.round((rawItem.height || 0) * 10) / 10,
        page: pageNum
      })
      pageLines.push(str)
      allLines.push(str)
    }

    const pageFullText = pageItems.map((i) => i.str.toLowerCase()).join(' ')
    const matchesTeacher =
      teacherTokens.length > 0 && teacherTokens.some((token) => pageFullText.includes(token))

    pages.push({
      pageNumber: pageNum,
      items: pageItems,
      lines: pageLines,
      matchesTeacher
    })
  }

  return {
    pages,
    allLines,
    pageCount: pdf.numPages
  }
}

/**
 * STRATEGY 1: Days in Columns Layout
 * Examples: Combined Teacher Timetable (Mr. Samson, Mr. Daniel)
 * - Header has Day names across top (MONDAY, TUESDAY, WEDNESDAY...)
 * - Left column has Period numbers and Time ranges
 * Supports single or multiple stacked vertical timetable sections on the same page.
 */
function tryParseDaysInColumns(
  rawItems: PdfPositionedItem[],
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>
): Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> | null {
  const items = assembleSplitTokens(rawItems)

  const dayCandidates = items.filter((it) => {
    if (it.x < 120) return false
    const low = it.str.toLowerCase()
    return DAYS_MAP[low] !== undefined
  })

  if (dayCandidates.length < 3) return null

  // Group by Y to find day header rows (supports 1 or 2 stacked tables on a page)
  const yGroups = new Map<number, PdfPositionedItem[]>()
  for (const d of dayCandidates) {
    const groupY = Array.from(yGroups.keys()).find((gy) => Math.abs(gy - d.y) < 8)
    if (groupY !== undefined) {
      yGroups.get(groupY)!.push(d)
    } else {
      yGroups.set(d.y, [d])
    }
  }

  const validHeaderRows = Array.from(yGroups.entries())
    .filter(([, list]) => list.length >= 3)
    .sort((a, b) => b[0] - a[0]) // Top-most table first

  if (validHeaderRows.length === 0) return null

  const allSlots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []

  for (let hIdx = 0; hIdx < validHeaderRows.length; hIdx++) {
    const [headerY, rawHeaderDays] = validHeaderRows[hIdx]
    const nextHeaderY = hIdx + 1 < validHeaderRows.length ? validHeaderRows[hIdx + 1][0] + 15 : -99999
    const headerDays = [...rawHeaderDays].sort((a, b) => a.x - b.x)

    // Compute column horizontal boundaries for each day
    const dayCols = headerDays.map((d, i) => {
      const prev = headerDays[i - 1]
      const next = headerDays[i + 1]
      const xMin = prev ? (prev.x + d.x) / 2 : d.x - 50
      const xMax = next ? (d.x + next.x) / 2 : d.x + 65
      return {
        dayIndex: DAYS_MAP[d.str.toLowerCase()],
        dayName: d.str,
        x: d.x,
        xMin,
        xMax
      }
    })

    // Detect Period rows from the left side (x < 130, between headerY and nextHeaderY)
    const leftItems = items.filter((it) => it.x < 130 && it.y < headerY - 5 && it.y > nextHeaderY)
    const periodNumItems = leftItems.filter((it) => /^[1-9]$|^1[0-2]$/.test(it.str)).sort((a, b) => b.y - a.y)
    const timeItems = leftItems.filter((it) => TIME_RANGE_REGEX.test(it.str)).sort((a, b) => b.y - a.y)

    if (periodNumItems.length === 0 && timeItems.length === 0) continue

    const periodRows: Array<{
      periodNum: number
      startTime: string
      endTime: string
      y: number
      yMin: number
      yMax: number
    }> = []

    const anchorItems = periodNumItems.length > 0 ? periodNumItems : timeItems

    for (let i = 0; i < anchorItems.length; i++) {
      const pItem = anchorItems[i]
      const pNum = periodNumItems.length > 0 ? parseInt(pItem.str, 10) : i + 1
      const closestTime = [...timeItems].sort((a, b) => Math.abs(a.y - pItem.y) - Math.abs(b.y - pItem.y))[0]
      const tr = closestTime ? parseTimeRange(closestTime.str) : parseTimeRange(pItem.str)
      const startTime = tr ? tr.startTime : '08:00'
      const endTime = tr ? tr.endTime : '08:40'

      const prevP = anchorItems[i - 1]
      const nextP = anchorItems[i + 1]
      const yMax = prevP ? (prevP.y + pItem.y) / 2 : pItem.y + 12
      const yMin = nextP ? (pItem.y + nextP.y) / 2 : pItem.y - 12

      periodRows.push({
        periodNum: pNum,
        startTime,
        endTime,
        y: pItem.y,
        yMin,
        yMax
      })
    }

    const lessonItems = items.filter(
      (it) => it.x >= 120 && it.y < headerY - 5 && it.y > nextHeaderY && !isNonLesson(it.str)
    )

    for (const dCol of dayCols) {
      const colItems = lessonItems.filter((it) => it.x >= dCol.xMin && it.x < dCol.xMax)
      const visitedRowIndices = new Set<number>()

      for (let rIdx = 0; rIdx < periodRows.length; rIdx++) {
        if (visitedRowIndices.has(rIdx)) continue
        const pRow = periodRows[rIdx]

        const cellItems = colItems.filter((it) => it.y >= pRow.yMin - 4 && it.y < pRow.yMax + 4)
        if (cellItems.length === 0) continue

        let customTime: { startTime: string; endTime: string } | null = null
        let isDouble = false
        for (const cit of cellItems) {
          const tr = parseTimeRange(cit.str)
          if (tr) {
            customTime = tr
            isDouble = true
            break
          }
        }

        visitedRowIndices.add(rIdx)
        if (isDouble && rIdx + 1 < periodRows.length) {
          visitedRowIndices.add(rIdx + 1)
        }

        const textParts = cellItems
          .filter((it) => !TIME_RANGE_REGEX.test(it.str) && !isNonLesson(it.str))
          .sort((a, b) => b.y - a.y)
          .map((it) => it.str)

        const parsedCell = parseCellSubjectClassRoom(textParts, knownClasses, knownSubjects)
        if (!parsedCell) continue

        allSlots.push({
          day_of_week: dCol.dayIndex,
          period_number: pRow.periodNum,
          start_time: customTime ? customTime.startTime : pRow.startTime,
          end_time: customTime ? customTime.endTime : pRow.endTime,
          class_id: parsedCell.resolvedCls.id,
          class_name: parsedCell.resolvedCls.name,
          subject_id: parsedCell.resolvedSub.id,
          subject_name: parsedCell.resolvedSub.name,
          room: parsedCell.room
        })
      }
    }
  }

  return allSlots.length > 0 ? allSlots : null
}

/**
 * Helper to parse a single Days-in-Rows table block.
 */
function parseSingleDaysInRowsBlock(
  items: PdfPositionedItem[],
  dayItems: PdfPositionedItem[],
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>,
  upperYBound = 99999,
  lowerYBound = 0
): Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> | null {
  if (dayItems.length < 3) return null

  const scopedItems = items.filter((it) => it.y <= upperYBound && it.y >= lowerYBound)

  // Detect if there is a legend table on the right (e.g. 'Subjects', 'Count' in aSc timetables)
  const legendHeader = scopedItems.find(
    (it) => it.y > dayItems[0].y && (/^subjects$/i.test(it.str) || /^count$/i.test(it.str))
  )
  const gridRightBoundary = legendHeader ? legendHeader.x - 10 : 99999

  // Header cutoff is above the first day label
  const headerCutoff = dayItems[0].y + 15
  const topItems = scopedItems.filter(
    (it) =>
      it.y >= headerCutoff &&
      it.x < gridRightBoundary &&
      !isNonLesson(it.str) &&
      !/primary|secondary|years|timetable|schools|combined/i.test(it.str)
  )

  const rawPNumItems = topItems.filter((it) => /^[1-9]$|^1[0-2]$/.test(it.str)).sort((a, b) => a.x - b.x)
  const rawTimeItems = topItems
    .filter((it) => {
      const tr = parseTimeRange(it.str)
      if (!tr) return false
      const [sh, sm] = tr.startTime.split(':').map(Number)
      const [eh, em] = tr.endTime.split(':').map(Number)
      const dur = eh * 60 + em - (sh * 60 + sm)
      return dur >= 20 && dur <= 150
    })
    .sort((a, b) => a.x - b.x)

  if (rawPNumItems.length < 3 && rawTimeItems.length < 3) return null

  const periodCols: Array<{
    periodNum: number
    startTime: string
    endTime: string
    x: number
    xMin: number
    xMax: number
  }> = []

  if (rawPNumItems.length >= 3) {
    // Support side-by-side section grids (e.g. Primary on left, Secondary on right where period 1 resets)
    const sections: PdfPositionedItem[][] = []
    let curSection: PdfPositionedItem[] = []
    for (let i = 0; i < rawPNumItems.length; i++) {
      const it = rawPNumItems[i]
      const num = parseInt(it.str, 10)
      const prev = rawPNumItems[i - 1]
      const prevNum = prev ? parseInt(prev.str, 10) : 0
      if (num <= prevNum && curSection.length >= 3) {
        sections.push(curSection)
        curSection = []
      }
      curSection.push(it)
    }
    if (curSection.length > 0) sections.push(curSection)

    for (const pList of sections) {
      for (let i = 0; i < pList.length; i++) {
        const pIt = pList[i]
        const pNum = parseInt(pIt.str, 10)
        const closestTime = [...rawTimeItems].sort((a, b) => Math.abs(a.x - pIt.x) - Math.abs(b.x - pIt.x))[0]
        const tr = closestTime ? parseTimeRange(closestTime.str) : null
        const startTime = tr ? tr.startTime : '08:00'
        const endTime = tr ? tr.endTime : '08:40'

        const prev = pList[i - 1]
        const next = pList[i + 1]
        const xMin = prev ? (prev.x + pIt.x) / 2 : pIt.x - 20
        const xMax = next ? (pIt.x + next.x) / 2 : pIt.x + 20

        periodCols.push({
          periodNum: pNum,
          startTime,
          endTime,
          x: pIt.x,
          xMin,
          xMax
        })
      }
    }
  } else {
    // Fallback when only time headers exist across top without period numbers
    for (let i = 0; i < rawTimeItems.length; i++) {
      const tIt = rawTimeItems[i]
      const tr = parseTimeRange(tIt.str)
      const startTime = tr ? tr.startTime : '08:00'
      const endTime = tr ? tr.endTime : '08:40'
      const prev = rawTimeItems[i - 1]
      const next = rawTimeItems[i + 1]
      const xMin = prev ? (prev.x + tIt.x) / 2 : tIt.x - 25
      const xMax = next ? (tIt.x + next.x) / 2 : tIt.x + 25

      periodCols.push({
        periodNum: i + 1,
        startTime,
        endTime,
        x: tIt.x,
        xMin,
        xMax
      })
    }
  }

  const headerBottom = Math.min(...[...rawPNumItems, ...rawTimeItems].map((it) => it.y)) - 3
  const footerItems = scopedItems.filter(
    (it) =>
      it.x < gridRightBoundary &&
      it.y < dayItems[dayItems.length - 1].y &&
      (it.str.includes('Timetable') || it.str.includes('generated') || it.str.includes('Lessons') || it.str.includes('aSc'))
  )
  const gridBottom = footerItems.length > 0 ? Math.max(...footerItems.map((f) => f.y)) + 5 : Math.max(25, lowerYBound)
  const totalHeight = headerBottom - gridBottom
  const rowHeight = totalHeight / dayItems.length

  const dayRows = dayItems.map((d, i) => {
    const yMax = headerBottom - i * rowHeight
    const yMin = headerBottom - (i + 1) * rowHeight
    return {
      dayIndex: DAYS_MAP[d.str.toLowerCase()],
      dayName: d.str,
      y: d.y,
      yMin,
      yMax
    }
  })

  const slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []
  const lessonItems = scopedItems.filter(
    (it) => it.x >= 75 && it.x < gridRightBoundary && it.y < headerBottom && !isNonLesson(it.str)
  )

  for (const dRow of dayRows) {
    const rowItems = lessonItems.filter((it) => it.y >= dRow.yMin && it.y < dRow.yMax)
    const visitedCols = new Set<number>()

    for (let cIdx = 0; cIdx < periodCols.length; cIdx++) {
      if (visitedCols.has(cIdx)) continue
      const pCol = periodCols[cIdx]

      const cellItems = rowItems.filter((it) => it.x >= pCol.xMin && it.x < pCol.xMax)
      if (cellItems.length === 0) continue

      let customTime: { startTime: string; endTime: string } | null = null
      let isDouble = false
      for (const cit of cellItems) {
        const tr = parseTimeRange(cit.str)
        if (tr) {
          customTime = tr
          isDouble = true
          break
        }
      }

      visitedCols.add(cIdx)
      if (isDouble && cIdx + 1 < periodCols.length) {
        visitedCols.add(cIdx + 1)
      }

      const textParts = cellItems
        .filter((it) => !TIME_RANGE_REGEX.test(it.str) && !isNonLesson(it.str))
        .sort((a, b) => b.y - a.y)
        .map((it) => it.str)

      const parsedCell = parseCellSubjectClassRoom(textParts, knownClasses, knownSubjects)
      if (!parsedCell) continue

      slots.push({
        day_of_week: dRow.dayIndex,
        period_number: pCol.periodNum,
        start_time: customTime ? customTime.startTime : pCol.startTime,
        end_time: customTime ? customTime.endTime : pCol.endTime,
        class_id: parsedCell.resolvedCls.id,
        class_name: parsedCell.resolvedCls.name,
        subject_id: parsedCell.resolvedSub.id,
        subject_name: parsedCell.resolvedSub.name,
        room: parsedCell.room
      })
    }
  }

  return slots.length > 0 ? slots : null
}

/**
 * STRATEGY 2: Days in Rows Layout
 * Examples: Standard aSc Timetable (Teachers-Timetable-secondary.pdf, Primary Timetable)
 * - Days are arranged vertically down the left (Monday, Tuesday...)
 * - Periods and Times are columns across the top (supports single grid, side-by-side split grids, or vertically stacked grids)
 */
function tryParseDaysInRows(
  rawItems: PdfPositionedItem[],
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>
): Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> | null {
  const items = assembleSplitTokens(rawItems)

  const dayItems = items
    .filter((it) => {
      if (it.x > 150) return false
      const low = it.str.toLowerCase()
      return DAYS_MAP[low] !== undefined
    })
    .sort((a, b) => b.y - a.y)

  if (dayItems.length < 3) return null

  // Split dayItems into vertical groups in case two tables (Primary & Secondary) are stacked on the same page
  const dayBlocks: PdfPositionedItem[][] = []
  let curBlock: PdfPositionedItem[] = []
  for (let i = 0; i < dayItems.length; i++) {
    const d = dayItems[i]
    const dayIdx = DAYS_MAP[d.str.toLowerCase()]
    const prev = curBlock[curBlock.length - 1]
    const prevDayIdx = prev ? DAYS_MAP[prev.str.toLowerCase()] : -1
    if (dayIdx <= prevDayIdx && curBlock.length >= 3) {
      dayBlocks.push(curBlock)
      curBlock = []
    }
    curBlock.push(d)
  }
  if (curBlock.length >= 3) dayBlocks.push(curBlock)

  if (dayBlocks.length === 0) return null

  if (dayBlocks.length === 1) {
    return parseSingleDaysInRowsBlock(items, dayBlocks[0], knownClasses, knownSubjects)
  }

  const combinedSlots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []
  for (let bIdx = 0; bIdx < dayBlocks.length; bIdx++) {
    const blockDays = dayBlocks[bIdx]
    const prevBlockDays = dayBlocks[bIdx - 1]
    const nextBlockDays = dayBlocks[bIdx + 1]
    const upperBound = prevBlockDays ? prevBlockDays[prevBlockDays.length - 1].y - 10 : 99999
    const lowerBound = nextBlockDays ? (blockDays[blockDays.length - 1].y + nextBlockDays[0].y) / 2 : 0
    const blockSlots = parseSingleDaysInRowsBlock(
      items,
      blockDays,
      knownClasses,
      knownSubjects,
      upperBound,
      lowerBound
    )
    if (blockSlots) {
      combinedSlots.push(...blockSlots)
    }
  }

  return combinedSlots.length > 0 ? combinedSlots : null
}

/**
 * STRATEGY 3: Linear Sequential Fallback
 */
function tryParseLinear(
  _items: PdfPositionedItem[],
  lines: string[],
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>
): Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> {
  const slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []
  let currentDay = 0
  let periodCounter = 1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lower = line.toLowerCase().trim()

    for (const [dayKey, dayIndex] of Object.entries(DAYS_MAP)) {
      if (lower === dayKey || lower.startsWith(dayKey + ' ') || lower.endsWith(' ' + dayKey)) {
        currentDay = dayIndex
        periodCounter = 1
        break
      }
    }

    if (isNonLesson(lower)) continue

    const timeMatch = line.match(TIME_RANGE_REGEX)
    if (timeMatch) {
      const tr = parseTimeRange(line)
      if (!tr) continue

      let candidateSubjectRaw = ''
      let candidateClassRaw = ''
      let candidateRoom = ''

      const contextLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 4))
      for (const cl of contextLines) {
        if (TIME_RANGE_REGEX.test(cl) || isNonLesson(cl)) continue

        const roomMatch = cl.match(/\b(Lab\s*\d*|Room\s*\d+|Hall|[A-Z]\d{2}|COMP)\b/i)
        if (roomMatch && !candidateRoom) candidateRoom = roomMatch[0]

        const resolved = resolveSubject(cl, knownSubjects)
        if (resolved.id || (resolved.name !== 'General' && !candidateSubjectRaw)) {
          candidateSubjectRaw = cl
        }

        const resolvedCls = resolveClass(cl, knownClasses)
        if (resolvedCls.id || (!candidateClassRaw && /year|yr|grade|class|as[-\s]*yr/i.test(cl))) {
          candidateClassRaw = cl
        }
      }

      const finalSubject = resolveSubject(candidateSubjectRaw || 'General', knownSubjects)
      const finalClass = resolveClass(candidateClassRaw || 'All', knownClasses)

      slots.push({
        day_of_week: currentDay,
        period_number: periodCounter++,
        start_time: tr.startTime,
        end_time: tr.endTime,
        class_id: finalClass.id,
        subject_id: finalSubject.id,
        class_name: finalClass.name,
        subject_name: finalSubject.name,
        room: candidateRoom
      })
    }
  }

  return slots
}

/**
 * Parses a single PDF page using all 3 strategies.
 */
function parseSinglePageSlots(
  pageItems: PdfPositionedItem[],
  pageLines: string[],
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>
): Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> {
  const colSlots = tryParseDaysInColumns(pageItems, knownClasses, knownSubjects)
  if (colSlots && colSlots.length > 0) return colSlots

  const rowSlots = tryParseDaysInRows(pageItems, knownClasses, knownSubjects)
  if (rowSlots && rowSlots.length > 0) return rowSlots

  const linearSlots = tryParseLinear(pageItems, pageLines, knownClasses, knownSubjects)
  if (linearSlots.length > 0) return linearSlots

  return []
}

/**
 * Enriches and merges timetable slots from multiple pages (e.g., Primary Page + Secondary Page)
 * into a single unified one-block weekly timetable sorted chronologically per day.
 */
export function mergeTimetableSlotsIntoOneBlock(
  slotLists: Array<Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>>>,
  knownClasses: Array<{ id: string; name: string }> = [],
  knownSubjects: Array<{ id: string; name: string }> = [],
  teacherAssignments: NonNullable<TimetableParseOptions['teacherAssignments']> = [],
  resequenceCombinedPeriods = false
): Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> {
  const flatSlots = slotLists.flat()
  if (flatSlots.length === 0) return []

  // 1. Enrich slots with teacher's explicit subject-class assignments (especially helpful for Year 5 / Year 6 Primary cells)
  const enriched = flatSlots.map((slot) => {
    let classId = slot.class_id
    let className = slot.class_name
    let subjectId = slot.subject_id
    let subjectName = slot.subject_name

    // If class_id is missing, check if teacher has an assigned class matching the year level (e.g. Year 5 or Year 6)
    if (!classId && className) {
      const yrMatch = className.match(/\b(?:year|yr|grade|stage|y)\s*(\d+)\b/i)
      if (yrMatch) {
        const yrNum = yrMatch[1]
        const matchingAssignedClasses = teacherAssignments
          .map((a) => knownClasses.find((c) => c.id === a.class_id))
          .filter((c): c is { id: string; name: string } => {
            if (!c) return false
            const cm = c.name.match(/\b(?:year|yr|grade|stage|y)?\s*(\d+)\b/i)
            return Boolean(cm && cm[1] === yrNum)
          })
        const uniqueAssignedClasses = Array.from(new Map(matchingAssignedClasses.map((c) => [c.id, c])).values())
        if (uniqueAssignedClasses.length === 1) {
          classId = uniqueAssignedClasses[0].id
          className = uniqueAssignedClasses[0].name
        }
      }
    }

    // If subject_id is missing (or subjectName is just the class name, e.g. cell only printed "Year 5"),
    // infer from teacher's assigned subject for that class or year group
    const subLooksLikeClass =
      !subjectId &&
      (!subjectName ||
        subjectName === 'General' ||
        subjectName.toLowerCase() === (className || '').toLowerCase() ||
        /\b(?:year|yr|grade|stage)\s*\d+/i.test(subjectName))

    if (!subjectId || subLooksLikeClass) {
      let candidateAssignments = classId
        ? teacherAssignments.filter((a) => a.class_id === classId)
        : []

      if (candidateAssignments.length === 0 && className) {
        const yrMatch = className.match(/\b(?:year|yr|grade|stage|y)\s*(\d+)\b/i)
        if (yrMatch) {
          const yrNum = yrMatch[1]
          candidateAssignments = teacherAssignments.filter((a) => {
            const cls = knownClasses.find((c) => c.id === a.class_id)
            const cm = (cls?.name || a.class_name || '').match(/\b(?:year|yr|grade|stage|y)?\s*(\d+)\b/i)
            return Boolean(cm && cm[1] === yrNum)
          })
        }
      }

      // If teacher only teaches 1 unique subject in that class (or 1 unique subject across all assignments)
      const uniqueSubIds = Array.from(new Set(candidateAssignments.map((a) => a.subject_id).filter(Boolean)))
      if (uniqueSubIds.length === 1) {
        const foundSub = knownSubjects.find((s) => s.id === uniqueSubIds[0])
        if (foundSub) {
          subjectId = foundSub.id
          subjectName = foundSub.name
        }
      } else if (subLooksLikeClass) {
        const allTeacherSubIds = Array.from(new Set(teacherAssignments.map((a) => a.subject_id).filter(Boolean)))
        if (allTeacherSubIds.length === 1) {
          const foundSub = knownSubjects.find((s) => s.id === allTeacherSubIds[0])
          if (foundSub) {
            subjectId = foundSub.id
            subjectName = foundSub.name
          }
        }
      }
    }

    return {
      ...slot,
      class_id: classId,
      class_name: className,
      subject_id: subjectId,
      subject_name: subjectName
    }
  })

  // 2. Deduplicate identical slots across pages
  const dedupedMap = new Map<string, Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>>()
  for (const s of enriched) {
    const normStart = (s.start_time || '').trim()
    const normEnd = (s.end_time || '').trim()
    const normCls = (s.class_id || s.class_name || '').toLowerCase().trim()
    const normSub = (s.subject_id || s.subject_name || '').toLowerCase().trim()
    const key = `${s.day_of_week}_${normStart}_${normEnd}_${normCls}_${normSub}`

    const existing = dedupedMap.get(key)
    if (!existing) {
      dedupedMap.set(key, s)
    } else {
      dedupedMap.set(key, {
        ...existing,
        class_id: existing.class_id || s.class_id,
        subject_id: existing.subject_id || s.subject_id,
        room: existing.room || s.room
      })
    }
  }

  const allUnique = Array.from(dedupedMap.values())

  // 3. Group by day_of_week (0=Mon .. 6=Sun), sort chronologically by start_time, and unify period_number
  const unifiedSlots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []

  for (let day = 0; day <= 6; day++) {
    const daySlots = allUnique
      .filter((s) => s.day_of_week === day)
      .sort((a, b) => {
        const cmpStart = (a.start_time || '').localeCompare(b.start_time || '')
        if (cmpStart !== 0) return cmpStart
        const cmpEnd = (a.end_time || '').localeCompare(b.end_time || '')
        if (cmpEnd !== 0) return cmpEnd
        return (a.period_number || 0) - (b.period_number || 0)
      })

    if (daySlots.length === 0) continue

    // Check if period numbers collide or are out of order on this day (e.g. Primary P4 + Secondary P4)
    let hasPeriodCollisionOrInversion = resequenceCombinedPeriods
    for (let i = 1; i < daySlots.length; i++) {
      if ((daySlots[i].period_number || 0) <= (daySlots[i - 1].period_number || 0)) {
        hasPeriodCollisionOrInversion = true
        break
      }
    }

    if (hasPeriodCollisionOrInversion) {
      daySlots.forEach((s, idx) => {
        unifiedSlots.push({
          ...s,
          period_number: idx + 1
        })
      })
    } else {
      unifiedSlots.push(...daySlots)
    }
  }

  return unifiedSlots
}

/**
 * Main timetable PDF parser supporting:
 * - Single-page 2D tabular timetables (aSc Timetables, combined grids)
 * - 2-page PDFs (Primary + Secondary) or 2 separate PDF files for teachers with Year 5 and Year 6 subject assignments,
 *   automatically extracting both pages and generating a unified one-block timetable.
 */
export async function parseTeacherTimetablePdf(
  fileOrFiles: File | File[],
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>,
  targetTeacherName?: string,
  options?: TimetableParseOptions
): Promise<ParsedTimetableResult> {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles.slice(0, 2) : [fileOrFiles]
  const allowTwoPageCombine = Boolean(options?.allowTwoPageCombine)
  const teacherAssignments = options?.teacherAssignments || []

  const warnings: string[] = []
  const allRawLines: string[] = []
  const extractedPageSlotLists: Array<{
    pageLabel: string
    slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>>
    hasYear5Or6: boolean
    hasPrimary: boolean
    hasSecondary: boolean
    matchesTeacher: boolean
  }> = []

  let totalPagesAcrossFiles = 0

  for (let fIdx = 0; fIdx < files.length; fIdx++) {
    const file = files[fIdx]
    const { pages, allLines, pageCount } = await extractPagesFromPdf(file, targetTeacherName)
    totalPagesAcrossFiles += pageCount
    allRawLines.push(...allLines)

    // Parse all pages in this PDF to inspect their slots
    const parsedPages = pages.map((p) => {
      const slots = parseSinglePageSlots(p.items, p.lines, knownClasses, knownSubjects)
      const hasYear5Or6 = slots.some((s) => isYear5Or6ClassName(s.class_name))
      const hasPrimary = slots.some((s) => isPrimaryClassName(s.class_name))
      const hasSecondary = slots.some((s) => !isPrimaryClassName(s.class_name))
      return {
        pageNumber: p.pageNumber,
        slots,
        hasYear5Or6,
        hasPrimary,
        hasSecondary,
        matchesTeacher: p.matchesTeacher
      }
    })

    if (pageCount === 1) {
      if (parsedPages[0].slots.length > 0) {
        extractedPageSlotLists.push({
          pageLabel: files.length > 1 ? `File ${fIdx + 1} (Page 1)` : 'Page 1',
          ...parsedPages[0]
        })
      }
    } else if (pageCount === 2) {
      // 2-page PDF: Check if teacher has Year 5 / Year 6 assignments (allowTwoPageCombine)
      // or if the 2 pages contain Year 5 / Year 6 (Primary) + Secondary slots
      const bothPagesHaveSlots = parsedPages[0].slots.length > 0 && parsedPages[1].slots.length > 0
      const pdfHasYear5Or6 = parsedPages.some((p) => p.hasYear5Or6)

      if (allowTwoPageCombine || (bothPagesHaveSlots && pdfHasYear5Or6)) {
        for (const p of parsedPages) {
          if (p.slots.length > 0) {
            extractedPageSlotLists.push({
              pageLabel: `Page ${p.pageNumber}`,
              ...p
            })
          }
        }
      } else {
        // Teacher without Year 5/6 assignments: pick the single page matching teacher name (or page 1)
        const matched = parsedPages.filter((p) => p.matchesTeacher && p.slots.length > 0)
        const chosen = matched[matched.length - 1] || parsedPages.find((p) => p.slots.length > 0) || parsedPages[0]
        if (chosen && chosen.slots.length > 0) {
          extractedPageSlotLists.push({
            pageLabel: `Page ${chosen.pageNumber}`,
            ...chosen
          })
        }
        if (bothPagesHaveSlots && !allowTwoPageCombine) {
          warnings.push(
            'Note: 2-page Primary & Secondary combined block timetable extraction is enabled for teachers with Year 5 and Year 6 subject assignments.'
          )
        }
      }
    } else {
      // Multi-page PDF (> 2 pages, e.g., master school timetable pack)
      const matchedWithSlots = parsedPages.filter((p) => p.matchesTeacher && p.slots.length > 0)

      if (allowTwoPageCombine && matchedWithSlots.length >= 2) {
        // Teacher with Year 5/6 assignments matched on 2 pages (Primary + Secondary) in master pack
        const selectedTwo = matchedWithSlots.slice(0, 2)
        for (const p of selectedTwo) {
          extractedPageSlotLists.push({
            pageLabel: `Page ${p.pageNumber}`,
            ...p
          })
        }
      } else if (matchedWithSlots.length >= 1) {
        const chosen = matchedWithSlots[matchedWithSlots.length - 1]
        extractedPageSlotLists.push({
          pageLabel: `Page ${chosen.pageNumber}`,
          ...chosen
        })
      } else if (allowTwoPageCombine) {
        // Fallback: take up to 2 pages with valid slots
        const withSlots = parsedPages.filter((p) => p.slots.length > 0).slice(0, 2)
        for (const p of withSlots) {
          extractedPageSlotLists.push({
            pageLabel: `Page ${p.pageNumber}`,
            ...p
          })
        }
      } else {
        const firstWithSlots = parsedPages.find((p) => p.slots.length > 0)
        if (firstWithSlots) {
          extractedPageSlotLists.push({
            pageLabel: `Page ${firstWithSlots.pageNumber}`,
            ...firstWithSlots
          })
        }
      }
    }
  }

  if (extractedPageSlotLists.length > 0) {
    const isCombinedBlock =
      extractedPageSlotLists.length >= 2 ||
      (allowTwoPageCombine &&
        extractedPageSlotLists.some((p) => p.hasPrimary) &&
        extractedPageSlotLists.some((p) => p.hasSecondary))

    const mergedSlots = mergeTimetableSlotsIntoOneBlock(
      extractedPageSlotLists.map((p) => p.slots),
      knownClasses,
      knownSubjects,
      teacherAssignments,
      isCombinedBlock
    )

    const primarySlotsCount = mergedSlots.filter((s) => isPrimaryClassName(s.class_name)).length
    const secondarySlotsCount = mergedSlots.length - primarySlotsCount

    return {
      slots: mergedSlots,
      rawPreview: allRawLines.slice(0, 50).join('\n'),
      warnings,
      pagesExtracted: extractedPageSlotLists.length,
      totalPages: totalPagesAcrossFiles,
      isCombinedBlock,
      primarySlotsCount,
      secondarySlotsCount
    }
  }

  warnings.push('Could not detect exact schedule periods. Please review the generated default periods.')
  const defaultPeriods = [
    { p: 1, start: '08:00', end: '08:45' },
    { p: 2, start: '08:50', end: '09:35' },
    { p: 3, start: '10:00', end: '10:45' },
    { p: 4, start: '10:50', end: '11:35' },
    { p: 5, start: '12:20', end: '13:05' }
  ]

  const fallbackSlots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []
  for (let day = 0; day < 5; day++) {
    for (const dp of defaultPeriods) {
      const cls = knownClasses[day % (knownClasses.length || 1)]?.name || 'Class 1'
      const sbj = knownSubjects[dp.p % (knownSubjects.length || 1)]?.name || 'Subject'
      fallbackSlots.push({
        day_of_week: day,
        period_number: dp.p,
        start_time: dp.start,
        end_time: dp.end,
        class_id: knownClasses.find((c) => c.name === cls)?.id || null,
        subject_id: knownSubjects.find((s) => s.name === sbj)?.id || null,
        class_name: cls,
        subject_name: sbj,
        room: ''
      })
    }
  }

  return {
    slots: fallbackSlots,
    rawPreview: allRawLines.slice(0, 40).join('\n'),
    warnings,
    pagesExtracted: 0,
    totalPages: totalPagesAcrossFiles,
    isCombinedBlock: false,
    primarySlotsCount: 0,
    secondarySlotsCount: 0
  }
}

