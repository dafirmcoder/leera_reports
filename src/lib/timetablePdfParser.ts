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
}

interface PdfPositionedItem {
  str: string
  x: number
  y: number
  w: number
  h: number
  page: number
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
 * Normalizes and resolves class name against known classes.
 */
function resolveClass(
  rawText: string,
  knownClasses: Array<{ id: string; name: string }>
): { name: string; id: string | null } {
  let clean = rawText
    .replace(/\b9\s*-\s*Atlanti\s*c\b/gi, 'Year 9 Atlantic')
    .replace(/\s+c$/i, 'c')
    .replace(/\s*-\s*/g, '-')
    .trim()

  const asYrMatch = clean.match(/as[-\s]*yr\s*(\d+)/i)
  if (asYrMatch) clean = `Year ${asYrMatch[1]}`

  clean = clean.replace(/year\s*(\d+)[-\s]*([A-Za-z]+)/i, 'Year $1 $2')
  clean = clean.replace(/year\s*(\d+)/i, 'Year $1')

  const cleanNorm = clean.toLowerCase().replace(/[\s\-_]+/g, '')

  // 1. Exact match
  for (const c of knownClasses) {
    const cNorm = c.name.toLowerCase().replace(/[\s\-_]+/g, '')
    if (cNorm === cleanNorm) {
      return { name: c.name, id: c.id }
    }
  }

  // 2. Substring match (ensure at least 4 characters and avoid matching bare 'year')
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
 * Extracts positioned text items and per-page content from PDF.
 */
async function extractPositionedItems(
  file: File,
  targetTeacherName?: string
): Promise<{
  targetItems: PdfPositionedItem[]
  allLines: string[]
  pageCount: number
  selectedPage: number
}> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise

  const pagesMap: Map<number, PdfPositionedItem[]> = new Map()
  const allLines: string[] = []

  let matchedPage = 1

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const pageItems: PdfPositionedItem[] = []

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
      allLines.push(str)
    }
    pagesMap.set(pageNum, pageItems)

    // Check if this page matches target teacher's name
    if (targetTeacherName && pdf.numPages > 1) {
      const pageFullText = pageItems.map((i) => i.str.toLowerCase()).join(' ')
      const teacherTokens = targetTeacherName
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 2 && !['mr.', 'ms.', 'mrs.', 'dr.', 'teacher'].includes(t))

      const matches = teacherTokens.some((token) => pageFullText.includes(token))
      if (matches) {
        matchedPage = pageNum
      }
    }
  }

  const targetItems = pagesMap.get(matchedPage) || pagesMap.get(1) || []

  return {
    targetItems,
    allLines,
    pageCount: pdf.numPages,
    selectedPage: matchedPage
  }
}

/**
 * STRATEGY 1: Days in Columns Layout
 * Examples: Combined Teacher Timetable (Mr. Samson, Mr. Daniel)
 * - Header has Day names across top (MONDAY, TUESDAY, WEDNESDAY...)
 * - Left column has Period numbers and Time ranges
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

  // Group by Y to find the main day header row
  const yGroups = new Map<number, PdfPositionedItem[]>()
  for (const d of dayCandidates) {
    const groupY = Array.from(yGroups.keys()).find((gy) => Math.abs(gy - d.y) < 8)
    if (groupY !== undefined) {
      yGroups.get(groupY)!.push(d)
    } else {
      yGroups.set(d.y, [d])
    }
  }

  let headerDays: PdfPositionedItem[] = []
  let headerY = 0
  for (const [y, list] of yGroups.entries()) {
    if (list.length > headerDays.length) {
      headerDays = list
      headerY = y
    }
  }

  if (headerDays.length < 3) return null
  headerDays.sort((a, b) => a.x - b.x)

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

  // Detect Period rows from the left side (x < 130, y < headerY - 5)
  const leftItems = items.filter((it) => it.x < 130 && it.y < headerY - 5)
  const periodNumItems = leftItems.filter((it) => /^[1-9]$|^10$/.test(it.str)).sort((a, b) => b.y - a.y)
  const timeItems = leftItems.filter((it) => TIME_RANGE_REGEX.test(it.str)).sort((a, b) => b.y - a.y)

  if (periodNumItems.length === 0 && timeItems.length === 0) return null

  const periodRows: Array<{
    periodNum: number
    startTime: string
    endTime: string
    y: number
    yMin: number
    yMax: number
  }> = []

  for (let i = 0; i < periodNumItems.length; i++) {
    const pItem = periodNumItems[i]
    const pNum = parseInt(pItem.str, 10)
    const closestTime = [...timeItems].sort((a, b) => Math.abs(a.y - pItem.y) - Math.abs(b.y - pItem.y))[0]
    const tr = closestTime ? parseTimeRange(closestTime.str) : null
    const startTime = tr ? tr.startTime : '08:00'
    const endTime = tr ? tr.endTime : '08:40'

    const prevP = periodNumItems[i - 1]
    const nextP = periodNumItems[i + 1]
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

  const slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []
  const lessonItems = items.filter((it) => it.x >= 120 && it.y < headerY - 5 && !isNonLesson(it.str))

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

      if (textParts.length === 0) continue

      const subjectRaw = textParts[0]
      const remaining = textParts.slice(1)
      let room = ''
      let classTokens = remaining
      if (remaining.length > 0) {
        const last = remaining[remaining.length - 1]
        if (/(?:lab|room|hall|comp)/i.test(last) || /^[A-Z]\d+$/.test(last)) {
          room = last
          classTokens = remaining.slice(0, -1)
        }
      }
      const classRaw = classTokens.join(' ') || subjectRaw

      const resolvedSub = resolveSubject(subjectRaw, knownSubjects)
      const resolvedCls = resolveClass(classRaw, knownClasses)

      slots.push({
        day_of_week: dCol.dayIndex,
        period_number: pRow.periodNum,
        start_time: customTime ? customTime.startTime : pRow.startTime,
        end_time: customTime ? customTime.endTime : pRow.endTime,
        class_id: resolvedCls.id,
        class_name: resolvedCls.name,
        subject_id: resolvedSub.id,
        subject_name: resolvedSub.name,
        room
      })
    }
  }

  return slots.length > 0 ? slots : null
}

/**
 * STRATEGY 2: Days in Rows Layout
 * Examples: Standard aSc Timetable (Teachers-Timetable-secondary.pdf, Mr. Erick)
 * - Days are arranged vertically down the left (Monday, Tuesday...)
 * - Periods and Times are columns across the top (supports single grid or side-by-side split grids)
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

  // Detect if there is a legend table on the right (e.g. 'Subjects', 'Count' in aSc timetables)
  const legendHeader = items.find(
    (it) => it.y > dayItems[0].y && (/^subjects$/i.test(it.str) || /^count$/i.test(it.str))
  )
  const gridRightBoundary = legendHeader ? legendHeader.x - 10 : 99999

  // Header cutoff is above the first day label
  const headerCutoff = dayItems[0].y + 15
  const topItems = items.filter(
    (it) =>
      it.y >= headerCutoff &&
      it.x < gridRightBoundary &&
      !isNonLesson(it.str) &&
      !/primary|secondary|years|timetable|schools|combined/i.test(it.str)
  )

  const rawPNumItems = topItems.filter((it) => /^[1-9]$|^10$/.test(it.str)).sort((a, b) => a.x - b.x)
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

  const periodCols: Array<{
    periodNum: number
    startTime: string
    endTime: string
    x: number
    xMin: number
    xMax: number
  }> = []

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

  const headerBottom = Math.min(...[...rawPNumItems, ...rawTimeItems].map((it) => it.y)) - 3
  const footerItems = items.filter(
    (it) =>
      it.x < gridRightBoundary &&
      it.y < dayItems[dayItems.length - 1].y &&
      (it.str.includes('Timetable') || it.str.includes('generated') || it.str.includes('Lessons') || it.str.includes('aSc'))
  )
  const gridBottom = footerItems.length > 0 ? Math.max(...footerItems.map((f) => f.y)) + 5 : 25
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
  const lessonItems = items.filter((it) => it.x >= 75 && it.x < gridRightBoundary && it.y < headerBottom && !isNonLesson(it.str))

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

      if (textParts.length === 0) continue

      const subjectRaw = textParts[0]
      if (/^[-–—]$/.test(subjectRaw) || isNonLesson(subjectRaw)) continue

      const remaining = textParts.slice(1)
      let room = ''
      let classTokens = remaining
      if (remaining.length > 0) {
        const last = remaining[remaining.length - 1]
        if (/(?:lab|room|hall|comp)/i.test(last) || /^[A-Z]\d+$/.test(last)) {
          room = last
          classTokens = remaining.slice(0, -1)
        }
      }
      const classRaw = classTokens.join(' ') || subjectRaw
      if (isNonLesson(classRaw)) continue

      const resolvedSub = resolveSubject(subjectRaw, knownSubjects)
      const resolvedCls = resolveClass(classRaw, knownClasses)

      slots.push({
        day_of_week: dRow.dayIndex,
        period_number: pCol.periodNum,
        start_time: customTime ? customTime.startTime : pCol.startTime,
        end_time: customTime ? customTime.endTime : pCol.endTime,
        class_id: resolvedCls.id,
        class_name: resolvedCls.name,
        subject_id: resolvedSub.id,
        subject_name: resolvedSub.name,
        room
      })
    }
  }

  return slots.length > 0 ? slots : null
}

/**
 * STRATEGY 3: Linear Sequential Fallback
 */
function tryParseLinear(
  items: PdfPositionedItem[],
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
        if (resolvedCls.id || (!candidateClassRaw && /year|grade|class|as[-\s]*yr/i.test(cl))) {
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
 * Main timetable PDF parser supporting 2D tabular timetables (aSc Timetables, combined primary/secondary grids)
 * and linear schedules. Automatically extracts the exact period numbers and times.
 */
export async function parseTeacherTimetablePdf(
  file: File,
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>,
  targetTeacherName?: string
): Promise<ParsedTimetableResult> {
  const { targetItems, allLines, pageCount, selectedPage } = await extractPositionedItems(file, targetTeacherName)
  const warnings: string[] = []

  if (pageCount > 1 && targetTeacherName) {
    warnings.push(`Selected page ${selectedPage} of ${pageCount} matching teacher: ${targetTeacherName}`)
  }

  // Strategy 1: Days in Columns Layout (Combined primary/secondary timetables)
  const colSlots = tryParseDaysInColumns(targetItems, knownClasses, knownSubjects)
  if (colSlots && colSlots.length > 0) {
    return {
      slots: colSlots,
      rawPreview: allLines.slice(0, 40).join('\n'),
      warnings
    }
  }

  // Strategy 2: Days in Rows Layout (Standard aSc Timetable Grid)
  const rowSlots = tryParseDaysInRows(targetItems, knownClasses, knownSubjects)
  if (rowSlots && rowSlots.length > 0) {
    return {
      slots: rowSlots,
      rawPreview: allLines.slice(0, 40).join('\n'),
      warnings
    }
  }

  // Strategy 3: Sequential Line Fallback
  const linearSlots = tryParseLinear(targetItems, allLines, knownClasses, knownSubjects)
  if (linearSlots.length > 0) {
    return {
      slots: linearSlots,
      rawPreview: allLines.slice(0, 40).join('\n'),
      warnings
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
    rawPreview: allLines.slice(0, 40).join('\n'),
    warnings
  }
}
