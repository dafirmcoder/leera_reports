import * as pdfjsLib from 'pdfjs-dist'
import type { TeacherScheduleSlot } from './types'

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
} catch {
  // worker fallback
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

const TIME_RANGE_REGEX = /(?:^|\s)(0?[7-9]|1[0-9])[:.]([0-5][0-9])\s*(?:am|pm)?\s*(?:-|–|to)\s*(0?[7-9]|1[0-9])[:.]([0-5][0-9])\s*(?:am|pm)?/i

// Common non-lesson keywords to filter out
const NON_LESSON_KEYWORDS = [
  'break',
  'lunch',
  'tea break',
  'breakfast',
  'assembly',
  'morning assembly',
  'morning',
  'duty',
  'homeroom',
  'free',
  'planning',
  'meeting',
  'registration',
  'clubs',
  'lessons/week',
  'asc timetables',
  'timetable generated'
]

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

interface PdfVectorLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

function applyTransform(p: [number, number], m: number[]): [number, number] {
  return [
    p[0] * m[0] + p[1] * m[2] + m[4],
    p[0] * m[1] + p[1] * m[3] + m[5]
  ]
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
    .replace(/\s+c$/i, 'c')
    .replace(/\s*-\s*/g, '-')
    .trim()

  const asYrMatch = clean.match(/as[-\s]*yr\s*(\d+)/i)
  if (asYrMatch) clean = `Year ${asYrMatch[1]}`

  clean = clean.replace(/year\s*(\d+)[-\s]*([A-Za-z]+)/i, 'Year $1 $2')
  clean = clean.replace(/year\s*(\d+)/i, 'Year $1')

  const cleanNorm = clean.toLowerCase().replace(/[\s\-_]+/g, '')

  for (const c of knownClasses) {
    const cNorm = c.name.toLowerCase().replace(/[\s\-_]+/g, '')
    if (cNorm === cleanNorm || cleanNorm.includes(cNorm) || cNorm.includes(cleanNorm)) {
      return { name: c.name, id: c.id }
    }
  }

  return { name: clean, id: null }
}

/**
 * Extracts rich positioned text items and vector lines from PDF.
 */
async function extractPositionedItems(file: File): Promise<{
  items: PdfPositionedItem[]
  vectorLines: PdfVectorLine[]
  fullText: string
  lines: string[]
}> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise

  const items: PdfPositionedItem[] = []
  const vectorLines: PdfVectorLine[] = []
  const pageStrings: string[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()

    const pageLines: string[] = []
    for (const rawItem of content.items as any[]) {
      const str = (rawItem.str || '').trim()
      if (!str) continue

      items.push({
        str,
        x: Math.round(rawItem.transform[4] * 10) / 10,
        y: Math.round(rawItem.transform[5] * 10) / 10,
        w: Math.round((rawItem.width || 0) * 10) / 10,
        h: Math.round((rawItem.height || 0) * 10) / 10,
        page: pageNum
      })
      pageLines.push(str)
    }
    pageStrings.push(pageLines.join('\n'))

    // Extract vector line paths on page 1
    if (pageNum === 1) {
      try {
        const opList = await page.getOperatorList()
        const matrixStack: number[][] = [[1, 0, 0, 1, 0, 0]]
        let currentMatrix = [1, 0, 0, 1, 0, 0]

        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i]
          const args = opList.argsArray[i]

          if (fn === pdfjsLib.OPS.save) {
            matrixStack.push([...currentMatrix])
          } else if (fn === pdfjsLib.OPS.restore) {
            currentMatrix = matrixStack.pop() || [1, 0, 0, 1, 0, 0]
          } else if (fn === pdfjsLib.OPS.transform) {
            const [a1, b1, c1, d1, e1, f1] = currentMatrix
            const [a2, b2, c2, d2, e2, f2] = args
            currentMatrix = [
              a1 * a2 + c1 * b2,
              b1 * a2 + d1 * b2,
              a1 * c2 + c1 * d2,
              b1 * c2 + d1 * d2,
              a1 * e2 + c1 * f2 + e1,
              b1 * e2 + d1 * f2 + f1
            ]
          } else if (fn === pdfjsLib.OPS.constructPath) {
            const ops = args[0]
            const coords = args[1]
            let cIdx = 0
            let curPt: [number, number] = [0, 0]
            for (const op of ops) {
              if (op === 13) { // moveTo
                curPt = applyTransform([coords[cIdx++], coords[cIdx++]], currentMatrix)
              } else if (op === 14) { // lineTo
                const nextPt = applyTransform([coords[cIdx++], coords[cIdx++]], currentMatrix)
                vectorLines.push({
                  x1: Math.round(curPt[0] * 10) / 10,
                  y1: Math.round(curPt[1] * 10) / 10,
                  x2: Math.round(nextPt[0] * 10) / 10,
                  y2: Math.round(nextPt[1] * 10) / 10
                })
                curPt = nextPt
              }
            }
          }
        }
      } catch (err) {
        console.warn('Vector line extraction skipped:', err)
      }
    }
  }

  const fullText = pageStrings.join('\n\n')
  const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean)

  return { items, vectorLines, fullText, lines }
}

/**
 * High-precision 2D Grid Timetable parser with double-period detection.
 */
function tryParse2DGrid(
  items: PdfPositionedItem[],
  vectorLines: PdfVectorLine[],
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>
): Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> | null {
  const p1Items = items.filter((it) => it.page === 1)
  if (p1Items.length === 0) return null

  // 1. Detect Day Labels on the left (x < 150)
  const dayItems = p1Items
    .filter((it) => {
      if (it.x > 150) return false
      const lower = it.str.toLowerCase()
      return DAYS_MAP[lower] !== undefined
    })
    .sort((a, b) => b.y - a.y)

  if (dayItems.length < 3) return null

  const numDays = dayItems.length

  // 2. Extract Declared Legend Subjects (typically on the right x >= 550)
  const legendSubjects: string[] = []
  const rightItems = p1Items.filter((it) => it.x >= 550 && it.y > 350).sort((a, b) => b.y - a.y)
  for (const it of rightItems) {
    const low = it.str.toLowerCase()
    if (!['subjects', 'count', 'lessons/week', 'total'].includes(low) && !/^\d+$/.test(it.str)) {
      legendSubjects.push(it.str)
    }
  }

  // 3. Detect Period Columns from header row
  const headerItems = p1Items.filter((it) => it.y > dayItems[0].y + 10 && it.x < 570)
  const timeHeaderItems = headerItems.filter((it) => TIME_RANGE_REGEX.test(it.str)).sort((a, b) => a.x - b.x)
  if (timeHeaderItems.length === 0) return null

  const headerBottom = Math.min(...timeHeaderItems.map((t) => t.y))

  const footerItems = p1Items.filter(
    (it) =>
      it.str.toLowerCase().includes('asc timetables') ||
      it.str.toLowerCase().includes('timetable generated') ||
      it.str.toLowerCase().includes('page ')
  )
  const footerTop = footerItems.length > 0 ? Math.max(...footerItems.map((f) => f.y)) + 5 : 25

  const totalGridHeight = headerBottom - footerTop
  const rowHeight = totalGridHeight / numDays

  const dayRows = dayItems.map((cur, i) => {
    const yMax = headerBottom - i * rowHeight
    const yMin = headerBottom - (i + 1) * rowHeight
    return {
      dayName: cur.str,
      dayIndex: DAYS_MAP[cur.str.toLowerCase()],
      yMin,
      yMax
    }
  })

  // Detect Period Columns
  const periodNumberItems = headerItems.filter((it) => /^[1-9]$/.test(it.str)).sort((a, b) => a.x - b.x)

  interface ColDef {
    period: number
    x: number
    xMin: number
    xMax: number
    startTime: string
    endTime: string
    dividerX: number
    nextPeriod: number | null
  }
  const periodCols: ColDef[] = []

  if (periodNumberItems.length >= 3) {
    for (let pIdx = 0; pIdx < periodNumberItems.length; pIdx++) {
      const pItem = periodNumberItems[pIdx]
      const periodNum = parseInt(pItem.str, 10)
      const closestTime = [...timeHeaderItems].sort(
        (a, b) => Math.abs(a.x - pItem.x) - Math.abs(b.x - pItem.x)
      )[0]
      const match = closestTime?.str.match(TIME_RANGE_REGEX)
      const startH = match ? match[1].padStart(2, '0') : '08'
      const startM = match ? match[2] : '00'
      const endH = match ? match[3].padStart(2, '0') : '08'
      const endM = match ? match[4] : '45'

      const nextPItem = periodNumberItems[pIdx + 1]
      const nextPeriodNum = nextPItem ? parseInt(nextPItem.str, 10) : null

      periodCols.push({
        period: periodNum,
        x: pItem.x,
        xMin: pItem.x - 22,
        xMax: pItem.x + 22,
        startTime: `${startH}:${startM}`,
        endTime: `${endH}:${endM}`,
        dividerX: nextPItem ? (pItem.x + nextPItem.x) / 2 : pItem.x + 25,
        nextPeriod: nextPeriodNum
      })
    }
  } else {
    let pCount = 1
    for (let tIdx = 0; tIdx < timeHeaderItems.length; tIdx++) {
      const tItem = timeHeaderItems[tIdx]
      const match = tItem.str.match(TIME_RANGE_REGEX)
      if (!match) continue
      const startH = match[1].padStart(2, '0')
      const startM = match[2]
      const endH = match[3].padStart(2, '0')
      const endM = match[4]

      const nextTItem = timeHeaderItems[tIdx + 1]

      periodCols.push({
        period: pCount,
        x: tItem.x,
        xMin: tItem.x - 22,
        xMax: tItem.x + 22,
        startTime: `${startH}:${startM}`,
        endTime: `${endH}:${endM}`,
        dividerX: nextTItem ? (tItem.x + nextTItem.x) / 2 : tItem.x + 25,
        nextPeriod: nextTItem ? pCount + 1 : null
      })
      pCount++
    }
  }

  if (periodCols.length === 0) return null

  // Refine column boundaries
  for (let i = 0; i < periodCols.length; i++) {
    const cur = periodCols[i]
    const prev = periodCols[i - 1]
    const next = periodCols[i + 1]
    cur.xMin = prev ? (prev.x + cur.x) / 2 : cur.x - 25
    cur.xMax = next ? (cur.x + next.x) / 2 : cur.x + 25
    cur.dividerX = cur.xMax
  }

  // 4. Extract Lesson Cells with Double Period Detection
  const slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []

  for (const dRow of dayRows) {
    // Find vertical divider lines in this day's row
    const dayLines = vectorLines.filter(
      (l) =>
        Math.abs(l.x1 - l.x2) < 2 &&
        Math.min(l.y1, l.y2) <= dRow.yMin + 10 &&
        Math.max(l.y1, l.y2) >= dRow.yMax - 10
    )
    const dayDividerXs = dayLines.map((l) => l.x1)

    const rowItems = p1Items.filter(
      (it) =>
        it.y >= dRow.yMin &&
        it.y < dRow.yMax &&
        it.x >= 75 &&
        it.x < 570 &&
        !NON_LESSON_KEYWORDS.some((kw) => it.str.toLowerCase().includes(kw))
    )

    const visitedPeriods = new Set<number>()

    for (let cIdx = 0; cIdx < periodCols.length; cIdx++) {
      const col = periodCols[cIdx]
      if (visitedPeriods.has(col.period)) continue

      // Check if divider between this period and the next period is missing
      const nextCol = col.nextPeriod ? periodCols.find((p) => p.period === col.nextPeriod) : null
      let isDouble = false

      if (nextCol) {
        // Condition A: If vector divider lines exist and the divider between col and nextCol is missing
        if (dayDividerXs.length > 0) {
          const hasDivider = dayDividerXs.some((x) => Math.abs(x - col.dividerX) < 6)
          if (!hasDivider) {
            isDouble = true
          }
        } else {
          // Condition B: Fallback heuristic if no vector lines present
          // Check if next column has no items of its own and cell in this column is wide
          const nextItems = rowItems.filter((it) => it.x >= nextCol.xMin && it.x < nextCol.xMax)
          if (nextItems.length === 0) {
            const thisItems = rowItems.filter((it) => it.x >= col.xMin && it.x < col.xMax)
            const hasWideText = thisItems.some((it) => it.x + it.w > col.xMax - 5)
            if (hasWideText) isDouble = true
          }
        }
      }

      const effectiveXMax = isDouble && nextCol ? nextCol.xMax : col.xMax
      const cellItems = rowItems.filter((it) => it.x >= col.xMin && it.x < effectiveXMax)
      if (cellItems.length === 0) continue

      visitedPeriods.add(col.period)
      if (isDouble && nextCol) {
        visitedPeriods.add(nextCol.period)
      }

      cellItems.sort((a, b) => b.y - a.y)

      let customStart = col.startTime
      let customEnd = isDouble && nextCol ? nextCol.endTime : col.endTime
      const textParts: string[] = []

      for (const item of cellItems) {
        const tm = item.str.match(TIME_RANGE_REGEX)
        if (tm) {
          customStart = `${tm[1].padStart(2, '0')}:${tm[2]}`
          customEnd = `${tm[3].padStart(2, '0')}:${tm[4]}`
        } else {
          textParts.push(item.str)
        }
      }

      if (textParts.length === 0) continue

      const candidateSubjectRaw = textParts[0]

      let candidateRoom = ''
      let remaining = textParts.slice(1)
      if (remaining.length > 0) {
        const last = remaining[remaining.length - 1]
        if (
          ['COMP', 'LAB', 'ROOM', 'HALL'].some((r) => last.toUpperCase().includes(r)) ||
          /^[A-Z]\d+$/.test(last)
        ) {
          candidateRoom = last
          remaining = remaining.slice(0, -1)
        }
      }

      const rawClass = remaining.join(' ')
      const matchedClass = resolveClass(rawClass, knownClasses)
      const matchedSubject = resolveSubject(candidateSubjectRaw, knownSubjects, legendSubjects)

      slots.push({
        day_of_week: dRow.dayIndex,
        period_number: col.period,
        start_time: customStart,
        end_time: customEnd,
        class_id: matchedClass.id,
        class_name: matchedClass.name,
        subject_id: matchedSubject.id,
        subject_name: matchedSubject.name,
        room: candidateRoom
      })
    }
  }

  return slots.length > 0 ? slots : null
}

/**
 * Main timetable PDF parser supporting both 2D tabular timetables (aSc Timetables) and linear schedules.
 */
export async function parseTeacherTimetablePdf(
  file: File,
  knownClasses: Array<{ id: string; name: string }>,
  knownSubjects: Array<{ id: string; name: string }>
): Promise<ParsedTimetableResult> {
  const { items, vectorLines, lines } = await extractPositionedItems(file)
  const warnings: string[] = []

  // Strategy 1: Try high-precision 2D Grid extraction with double periods support
  const gridSlots = tryParse2DGrid(items, vectorLines, knownClasses, knownSubjects)
  if (gridSlots && gridSlots.length > 0) {
    return {
      slots: gridSlots,
      rawPreview: lines.slice(0, 40).join('\n'),
      warnings
    }
  }

  // Strategy 2: Sequential line-by-line fallback
  const slots: Array<Omit<TeacherScheduleSlot, 'id' | 'timetable_id' | 'teacher_id'>> = []
  let currentDay = 0
  let periodCounter = 1

  const legendSubjects: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() === 'subjects') {
      for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
        if (!/^\d+$/.test(lines[j]) && !NON_LESSON_KEYWORDS.some((kw) => lines[j].toLowerCase().includes(kw))) {
          legendSubjects.push(lines[j])
        }
      }
      break
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lower = line.toLowerCase()

    for (const [dayKey, dayIndex] of Object.entries(DAYS_MAP)) {
      if (lower === dayKey || lower.startsWith(dayKey + ' ') || lower.endsWith(' ' + dayKey)) {
        currentDay = dayIndex
        periodCounter = 1
        break
      }
    }

    if (NON_LESSON_KEYWORDS.some((kw) => lower.includes(kw))) {
      continue
    }

    const timeMatch = line.match(TIME_RANGE_REGEX)
    if (timeMatch) {
      const startH = timeMatch[1].padStart(2, '0')
      const startM = timeMatch[2]
      const endH = timeMatch[3].padStart(2, '0')
      const endM = timeMatch[4]
      const startTime = `${startH}:${startM}`
      const endTime = `${endH}:${endM}`

      let candidateSubjectRaw = ''
      let candidateClassRaw = ''
      let candidateRoom = ''

      const contextLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 4))
      for (const cl of contextLines) {
        if (TIME_RANGE_REGEX.test(cl) || NON_LESSON_KEYWORDS.some((kw) => cl.toLowerCase().includes(kw))) {
          continue
        }

        const roomMatch = cl.match(/\b(Lab\s*\d*|Room\s*\d+|Hall|[A-Z]\d{2}|COMP)\b/i)
        if (roomMatch && !candidateRoom) {
          candidateRoom = roomMatch[0]
        }

        const resolved = resolveSubject(cl, knownSubjects, legendSubjects)
        if (resolved.id || (resolved.name !== 'General' && !candidateSubjectRaw)) {
          candidateSubjectRaw = cl
        }

        const resolvedCls = resolveClass(cl, knownClasses)
        if (resolvedCls.id || (!candidateClassRaw && /year|grade|class|as[-\s]*yr/i.test(cl))) {
          candidateClassRaw = cl
        }
      }

      const finalSubject = resolveSubject(candidateSubjectRaw || 'General', knownSubjects, legendSubjects)
      const finalClass = resolveClass(candidateClassRaw || 'All', knownClasses)

      slots.push({
        day_of_week: currentDay,
        period_number: periodCounter++,
        start_time: startTime,
        end_time: endTime,
        class_id: finalClass.id,
        subject_id: finalSubject.id,
        class_name: finalClass.name,
        subject_name: finalSubject.name,
        room: candidateRoom
      })
    }
  }

  if (slots.length === 0) {
    warnings.push('Could not detect exact schedule periods. Please review the generated default periods.')
    const defaultPeriods = [
      { p: 1, start: '08:00', end: '08:45' },
      { p: 2, start: '08:50', end: '09:35' },
      { p: 3, start: '10:00', end: '10:45' },
      { p: 4, start: '10:50', end: '11:35' },
      { p: 5, start: '12:20', end: '13:05' }
    ]

    for (let day = 0; day < 5; day++) {
      for (const dp of defaultPeriods) {
        const cls = knownClasses[day % (knownClasses.length || 1)]?.name || 'Class 1'
        const sbj = knownSubjects[dp.p % (knownSubjects.length || 1)]?.name || 'Subject'
        slots.push({
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
  }

  return {
    slots,
    rawPreview: lines.slice(0, 40).join('\n'),
    warnings
  }
}
