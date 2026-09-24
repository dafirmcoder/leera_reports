import * as pdfjsLib from 'pdfjs-dist'
import { ParsedWorkPlan, ParsedWorkPlanWeek, ParsedWorkPlanObjective } from './types'

// Configure worker using CDN fallback
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
} catch {
  // worker fallback handled by pdfjs
}

const MONTH_MAP: Record<string, number> = {
  JAN: 0, JANUARY: 0,
  FEB: 1, FEBRUARY: 1,
  MAR: 2, MARCH: 2,
  APR: 3, APRIL: 3,
  MAY: 4,
  JUN: 5, JUNE: 5,
  JUL: 6, JULY: 6,
  AUG: 7, AUGUST: 7,
  SEP: 8, SEPT: 8, SEPTEMBER: 8,
  OCT: 9, OCTOBER: 9,
  NOV: 10, NOVEMBER: 10,
  DEC: 11, DECEMBER: 11
}

interface PositionedPdfItem {
  str: string
  x: number
  y: number
  w: number
  h: number
  page: number
}

/**
 * Extracts raw text items and joined text per page from a PDF File
 */
export async function extractWorkPlanTextFromPdf(file: File): Promise<{
  pagesText: string[]
  fullText: string
  lines: string[]
  positionedItems: PositionedPdfItem[]
  pagesItems: PositionedPdfItem[][]
}> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise
  const pagesText: string[] = []
  const allLines: string[] = []
  const positionedItems: PositionedPdfItem[] = []
  const pagesItems: PositionedPdfItem[][] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const pageLines: string[] = []
    const pageItemsList: PositionedPdfItem[] = []

    for (const rawItem of content.items as any[]) {
      const str = (rawItem.str || '').trim()
      if (!str) continue

      const item: PositionedPdfItem = {
        str,
        x: Math.round(rawItem.transform[4] * 10) / 10,
        y: Math.round(rawItem.transform[5] * 10) / 10,
        w: Math.round((rawItem.width || 0) * 10) / 10,
        h: Math.round((rawItem.height || 0) * 10) / 10,
        page: pageNum
      }
      positionedItems.push(item)
      pageItemsList.push(item)
      pageLines.push(str)
    }

    // Sort page items top to bottom (y desc), then left to right (x asc)
    pageItemsList.sort((a, b) => b.y - a.y || a.x - b.x)
    pagesItems.push(pageItemsList)

    pagesText.push(pageLines.join('\n'))
    allLines.push(...pageLines)
  }

  return {
    pagesText,
    fullText: pagesText.join('\n\n'),
    lines: allLines,
    positionedItems,
    pagesItems
  }
}

/**
 * Attempts to parse date range strings into ISO dates
 */
function parseTermDates(dateStr: string, defaultYear = 2026): { startDate: string | null; endDate: string | null } {
  if (!dateStr) return { startDate: null, endDate: null }

  const cleaned = dateStr.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1').replace(/\s+/g, ' ').trim()

  // Format 1: "24 – 28 AUGUST" or "24TH – 28TH AUG" or "30 NOV – 4 DEC"
  const wordMonthMatch = cleaned.match(/(\d{1,2})\s*(?:[A-Za-z]+)?\s*[–\-—]\s*(\d{1,2})\s*([A-Za-z]{3,9})/i)
  if (wordMonthMatch) {
    const startDay = parseInt(wordMonthMatch[1], 10)
    const endDay = parseInt(wordMonthMatch[2], 10)
    const monthKey = wordMonthMatch[3].toUpperCase().slice(0, 3)
    const monthIdx = MONTH_MAP[monthKey]
    if (monthIdx !== undefined && !isNaN(startDay) && !isNaN(endDay)) {
      const s = new Date(Date.UTC(defaultYear, monthIdx, startDay))
      const e = new Date(Date.UTC(defaultYear, monthIdx, endDay))
      return {
        startDate: s.toISOString().split('T')[0],
        endDate: e.toISOString().split('T')[0]
      }
    }
  }

  // Format 2: "15/01 - 19/01"
  const slashMatch = cleaned.match(/(\d{1,2})\/(\d{1,2})\s*[–\-—]\s*(\d{1,2})\/(\d{1,2})/)
  if (slashMatch) {
    const startDay = parseInt(slashMatch[1], 10)
    const startMonth = parseInt(slashMatch[2], 10) - 1
    const endDay = parseInt(slashMatch[3], 10)
    const endMonth = parseInt(slashMatch[4], 10) - 1
    const s = new Date(Date.UTC(defaultYear, startMonth, startDay))
    const e = new Date(Date.UTC(defaultYear, endMonth, endDay))
    return {
      startDate: s.toISOString().split('T')[0],
      endDate: e.toISOString().split('T')[0]
    }
  }

  return { startDate: null, endDate: null }
}

/**
 * Expands range expressions like "9CS.05 – 9CS.08" in remarks text into specific covered or uncovered code sets.
 */
function expandCodeRangeFromRemarks(remarks: string): { coveredCodes: Set<string>; uncoveredCodes: Set<string> } {
  const coveredCodes = new Set<string>()
  const uncoveredCodes = new Set<string>()
  if (!remarks) return { coveredCodes, uncoveredCodes }

  const clauses = remarks.split(/;|\n|\|/)
  for (const clause of clauses) {
    const isUncovered = /\b(?:not\s*(?:yet)?\s*covered|uncovered|rescheduled|pending|deferred)\b/i.test(clause)
    const isCovered = /\b(?:all covered|fully covered|covered|completed|commed|taught)\b/i.test(clause)

    // Range: e.g. "9CS.05 – 9CS.08" or "9DC.01 – 9DC.03"
    const rangeMatches = clause.matchAll(/(\d+[A-Za-z]+\.)(\d+)\s*[–\-—]\s*(\d+[A-Za-z]+\.)(\d+)/g)
    for (const rm of rangeMatches) {
      const p1 = rm[1]
      const sNum = parseInt(rm[2], 10)
      const p2 = rm[3]
      const eNum = parseInt(rm[4], 10)
      if (p1 === p2 && sNum <= eNum) {
        for (let n = sNum; n <= eNum; n++) {
          const code = `${p1}${n.toString().padStart(2, '0')}`
          if (isUncovered) uncoveredCodes.add(code)
          else if (isCovered) coveredCodes.add(code)
        }
      }
    }

    // Individual code: e.g. "9CS.01", "9CS.02"
    const codeMatches = clause.matchAll(/(\d+[A-Za-z]+\.\d{2})/g)
    for (const cm of codeMatches) {
      const code = cm[1]
      if (isUncovered) uncoveredCodes.add(code)
      else if (isCovered) coveredCodes.add(code)
    }
  }

  return { coveredCodes, uncoveredCodes }
}

/**
 * Evaluates coverage from remarks column text (covered vs uncovered for lesson planning).
 */
function evaluateCoverageFromRemarks(
  remarks: string,
  objectives: ParsedWorkPlanObjective[]
): { isCommed: boolean; updatedObjectives: ParsedWorkPlanObjective[] } {
  const text = (remarks || '').trim()
  if (!text) {
    // Uncovered by default for lesson planning
    const updated = objectives.map((o) => ({ ...o, is_met: false }))
    return { isCommed: false, updatedObjectives: updated }
  }

  const { coveredCodes, uncoveredCodes } = expandCodeRangeFromRemarks(text)

  const updated = objectives.map((obj) => {
    if (uncoveredCodes.has(obj.code)) {
      return { ...obj, is_met: false }
    }
    if (coveredCodes.has(obj.code)) {
      return { ...obj, is_met: true }
    }
    if (/\b(?:not\s*(?:yet)?\s*covered|uncovered|rescheduled)\b/i.test(text) && !/\ball covered\b/i.test(text)) {
      return { ...obj, is_met: false }
    }
    if (/\b(?:all covered|fully covered|covered)\b/i.test(text)) {
      return { ...obj, is_met: true }
    }
    return { ...obj, is_met: false }
  })

  const isCommed = updated.length > 0 && updated.every((o) => o.is_met)
  return { isCommed, updatedObjectives: updated }
}

/**
 * High-precision tabular parser for Semester Work Plans using bounding box column detection.
 */
function tryParseTabularWorkPlan(
  pagesItems: PositionedPdfItem[][],
  academicYear: string,
  defaultSubjectCode: string
): ParsedWorkPlanWeek[] | null {
  if (!pagesItems || pagesItems.length === 0) return null

  // 1. Locate all week sequence numbers across pages (digits in column x ~ 120-180)
  const weekStarters: Array<{ pageIndex: number; y: number; weekNum: number }> = []

  for (let pNum = 0; pNum < pagesItems.length; pNum++) {
    const pItems = pagesItems[pNum]
    const headerItem = pItems.find((it) => it.str === 'TOPIC/ LEARNING OBJECTIVE' || it.str === 'WEEK')
    const tableTopY = headerItem ? headerItem.y - 8 : 580
    const bodyItems = pItems.filter((it) => it.y < tableTopY && it.y > 25)

    const starters = bodyItems
      .filter((it) => it.x >= 110 && it.x <= 185 && /^\d{1,2}$/.test(it.str))
      .sort((a, b) => b.y - a.y)

    for (const ws of starters) {
      weekStarters.push({
        pageIndex: pNum,
        y: ws.y,
        weekNum: parseInt(ws.str, 10)
      })
    }
  }

  // If fewer than 4 weeks detected, fallback to standard stream parser
  if (weekStarters.length < 4) return null

  // Sort weeks by sequence
  weekStarters.sort((a, b) => a.weekNum - b.weekNum)

  let defaultYearNum = 2026
  try {
    defaultYearNum = parseInt(academicYear.split('/')[0], 10) || 2026
  } catch {}

  const parsedWeeks: ParsedWorkPlanWeek[] = []
  let currentMonth = 'AUGUST'

  for (let i = 0; i < weekStarters.length; i++) {
    const curW = weekStarters[i]
    const nextW = weekStarters[i + 1]

    const weekItems: PositionedPdfItem[] = []
    const pItems = pagesItems[curW.pageIndex]
    const yStart = curW.y + 12
    const yEnd = nextW && nextW.pageIndex === curW.pageIndex ? nextW.y + 12 : 25

    for (const it of pItems) {
      if (it.y <= yStart && it.y > yEnd) {
        weekItems.push(it)
      }
    }

    // If next week is on a subsequent page, collect spanning items
    if (nextW && nextW.pageIndex > curW.pageIndex) {
      for (let p = curW.pageIndex + 1; p <= nextW.pageIndex; p++) {
        const subItems = pagesItems[p]
        const subTopItem = subItems.find((it) => it.str === 'TOPIC/ LEARNING OBJECTIVE' || it.str === 'WEEK')
        const subTableTop = subTopItem ? subTopItem.y - 8 : 580
        const subEnd = p === nextW.pageIndex ? nextW.y + 12 : 25
        for (const it of subItems) {
          if (it.y < subTableTop && it.y > subEnd) {
            weekItems.push(it)
          }
        }
      }
    } else if (!nextW) {
      for (let p = curW.pageIndex + 1; p < pagesItems.length; p++) {
        const subItems = pagesItems[p]
        const subTopItem = subItems.find((it) => it.str === 'TOPIC/ LEARNING OBJECTIVE' || it.str === 'WEEK')
        const subTableTop = subTopItem ? subTopItem.y - 8 : 580
        for (const it of subItems) {
          if (it.y < subTableTop && it.y > 25) {
            weekItems.push(it)
          }
        }
      }
    }

    weekItems.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)

    // 1. Month update in x < 100
    const mItem = weekItems.find((it) => it.x < 100 && MONTH_MAP[it.str.toUpperCase().slice(0, 3)] !== undefined)
    if (mItem) currentMonth = mItem.str.toUpperCase()

    // 2. Dates in x: [110, 185]
    const dateParts = weekItems
      .filter((it) => it.x >= 110 && it.x <= 185 && !/^\d{1,2}$/.test(it.str))
      .map((it) => it.str)
    const termDates = dateParts.join(' ').replace(/\s*–\s*/g, ' – ')

    // 3. Topic in x: [180, 640]
    const topicParts: string[] = []
    for (const it of weekItems) {
      if (it.x >= 180 && it.x <= 640) {
        if (
          /^(?:UNIT|TOPIC|CHAPTER|STRAND|SECTION)\s*\d+/i.test(it.str) ||
          /REVISION\s*WEEK|SEMESTER\s*ASSESSMENT|END\s*OF\s*FIRST\s*SEMESTER|PTC/i.test(it.str)
        ) {
          topicParts.push(it.str)
        } else if (
          topicParts.length > 0 &&
          !it.str.startsWith('Learning Objectives:') &&
          !it.str.startsWith('•') &&
          topicParts.length < 3
        ) {
          topicParts.push(it.str)
        }
      }
    }
    const topic = topicParts.join(' — ').replace(/\s*—\s*—\s*/g, ' — ')

    // 4. Learning Objectives in x: [180, 640]
    const objectives: ParsedWorkPlanObjective[] = []
    const objItems = weekItems.filter((it) => it.x >= 180 && it.x <= 640)
    for (let j = 0; j < objItems.length; j++) {
      const it = objItems[j]
      const codeMatch = it.str.match(/^(?:•\s*)?(\*?[A-Za-z0-9\.\-]{2,12}[0-9]+[A-Za-z0-9\.\-]*)\s*[:\-]?\s*(.*)/)
      if (codeMatch && !it.str.includes('Weekly Lesson Breakdown') && !it.str.startsWith('• Lesson')) {
        const code = codeMatch[1].replace(/^\*/, '').trim()
        let text = codeMatch[2].trim()

        let k = j + 1
        while (k < objItems.length) {
          const nextIt = objItems[k]
          if (
            nextIt.str.startsWith('•') ||
            nextIt.str.includes('Weekly Lesson Breakdown') ||
            /^(?:UNIT|TOPIC|Learning Objectives)/i.test(nextIt.str)
          ) {
            break
          }
          text += ' ' + nextIt.str
          k++
        }

        objectives.push({
          code,
          text: text.replace(/\s+/g, ' '),
          is_met: false,
          topic_title: topic
        })
      }
    }

    // 5. Remarks in x >= 640
    const remarksItems = weekItems.filter((it) => it.x >= 640).map((it) => it.str)
    const remarks = remarksItems
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/\s*–\s*/g, ' – ')
      .replace(/\s*—\s*/g, ' — ')

    const { isCommed, updatedObjectives } = evaluateCoverageFromRemarks(remarks, objectives)
    const { startDate, endDate } = parseTermDates(
      termDates ? `${termDates} ${currentMonth}` : '',
      defaultYearNum
    )

    const isInstructional = !/(?:REVISION|ASSESSMENT|PTC|EXAM|HOLIDAY|BREAK)/i.test(topic)

    parsedWeeks.push({
      sequence: curW.weekNum,
      week_label: `Week ${curW.weekNum}`,
      month_label: currentMonth,
      term_dates: termDates,
      start_date: startDate,
      end_date: endDate,
      is_instructional: isInstructional,
      topic_title: topic || 'General Curriculum',
      challenge_title: '',
      subtopic_title: '',
      lessons_per_week: 3,
      remarks,
      objectives: updatedObjectives,
      is_commed: isCommed
    })
  }

  return parsedWeeks.length > 0 ? parsedWeeks : null
}

/**
 * Main parser for Semester Work Plans (supporting Cambridge & Leera/CambriFy layouts)
 */
export async function parseWorkPlanPdf(file: File): Promise<ParsedWorkPlan> {
  const { lines, fullText, pagesItems } = await extractWorkPlanTextFromPdf(file)
  const textLower = fullText.toLowerCase()

  // First 35 lines for header inspection
  const headerLines = lines.slice(0, 35).join(' ')

  // 1. Detect Framework
  let framework = 'CAMBRIDGE_LOWER_SECONDARY'
  if (/as\s*&?\s*a\s*level|year\s*(?:12|13)|grade\s*(?:12|13)/i.test(headerLines)) {
    framework = 'CAMBRIDGE_AS_A_LEVEL'
  } else if (/igcse|year\s*(?:10|11)|grade\s*(?:10|11)/i.test(headerLines)) {
    framework = 'CAMBRIDGE_IGCSE'
  } else if (/year\s*(?:7|8|9)|stage\s*(?:7|8|9)|grade\s*(?:7|8|9)|lower\s*secondary/i.test(headerLines)) {
    framework = 'CAMBRIDGE_LOWER_SECONDARY'
  } else if (/primary|year\s*[1-6]|stage\s*[1-6]|grade\s*[1-6]/i.test(headerLines)) {
    framework = 'CAMBRIDGE_PRIMARY'
  } else if (textLower.includes('as & a level') || textLower.includes('a level')) {
    framework = 'CAMBRIDGE_AS_A_LEVEL'
  } else if (textLower.includes('igcse')) {
    framework = 'CAMBRIDGE_IGCSE'
  }

  // 2. Detect Subject Name
  let subjectName = ''
  if (/computing/i.test(headerLines) || textLower.includes('computing')) {
    subjectName = 'Computing'
  } else if (/computer\s*science/i.test(headerLines) || textLower.includes('computer science')) {
    subjectName = 'Computer Science'
  } else if (/mathematics|maths/i.test(headerLines) || textLower.includes('mathematics')) {
    subjectName = 'Mathematics'
  } else if (/biology/i.test(headerLines) || textLower.includes('biology')) {
    subjectName = 'Biology'
  } else if (/chemistry/i.test(headerLines) || textLower.includes('chemistry')) {
    subjectName = 'Chemistry'
  } else if (/physics/i.test(headerLines) || textLower.includes('physics')) {
    subjectName = 'Physics'
  } else if (/global\s*perspectives/i.test(headerLines) || textLower.includes('global perspective')) {
    subjectName = 'Global Perspectives'
  } else if (/english/i.test(headerLines) || textLower.includes('english')) {
    subjectName = 'English'
  } else if (/science/i.test(headerLines) || textLower.includes('science')) {
    subjectName = 'Science'
  } else if (/business\s*studies/i.test(headerLines)) {
    subjectName = 'Business Studies'
  } else if (/economics/i.test(headerLines)) {
    subjectName = 'Economics'
  }

  // 3. Detect Subject Code (4-digit Cambridge Code)
  let subjectCode = ''
  const fileCodeMatch = file.name.match(/\b(0\d{3}|1\d{3}|9\d{3})\b/)
  if (fileCodeMatch) subjectCode = fileCodeMatch[1]

  if (!subjectCode) {
    for (let i = 0; i < Math.min(35, lines.length); i++) {
      const m = lines[i].match(/\b(0\d{3}|1\d{3}|9\d{3})\b/)
      if (m) {
        subjectCode = m[1]
        break
      }
    }
  }

  // Canonical Cambridge Subject Code defaults
  if (!subjectCode) {
    if (framework === 'CAMBRIDGE_LOWER_SECONDARY') {
      if (subjectName === 'Computing') subjectCode = '0860'
      else if (subjectName === 'Mathematics') subjectCode = '0862'
      else if (subjectName === 'Science') subjectCode = '0893'
      else if (subjectName === 'English') subjectCode = '0861'
      else if (subjectName === 'Global Perspectives') subjectCode = '1129'
    } else if (framework === 'CAMBRIDGE_IGCSE') {
      if (subjectName === 'Computer Science') subjectCode = '0478'
      else if (subjectName === 'Mathematics') subjectCode = '0580'
      else if (subjectName === 'Biology') subjectCode = '0610'
      else if (subjectName === 'Chemistry') subjectCode = '0620'
      else if (subjectName === 'Physics') subjectCode = '0625'
      else if (subjectName === 'English') subjectCode = '0500'
      else if (subjectName === 'Global Perspectives') subjectCode = '0457'
    } else if (framework === 'CAMBRIDGE_AS_A_LEVEL') {
      if (subjectName === 'Computer Science') subjectCode = '9618'
      else if (subjectName === 'Mathematics') subjectCode = '9709'
      else if (subjectName === 'Biology') subjectCode = '9700'
      else if (subjectName === 'Chemistry') subjectCode = '9701'
      else if (subjectName === 'Physics') subjectCode = '9702'
      else if (subjectName === 'Global Perspectives') subjectCode = '9239'
    }
  }

  // 4. Detect Class / Year Group
  let className = ''
  const classMatch = headerLines.match(/\b(Year\s*\d+|Grade\s*\d+|Stage\s*\d+|AS\s*Level|A\s*Level)\b/i)
  if (classMatch) {
    className = classMatch[1].replace(/\s+/g, ' ')
  }

  // 5. Detect Academic Year & Semester
  let academicYear = '2026/2027'
  const yearMatch = fullText.match(/\b(202[4-9]\s*[\/-]\s*202[5-9]|202[4-9])\b/)
  if (yearMatch) {
    academicYear = yearMatch[1].replace(/\s+/g, '')
    if (!academicYear.includes('/')) {
      const yrNum = parseInt(academicYear, 10)
      academicYear = `${yrNum}/${yrNum + 1}`
    }
  }

  let semester = '1'
  if (/semester\s*2|term\s*2/i.test(headerLines)) semester = '2'
  else if (/semester\s*3|term\s*3/i.test(headerLines)) semester = '3'

  // 6. Detect Teacher Name
  let teacherName = ''
  for (let i = 0; i < Math.min(35, lines.length); i++) {
    const m = lines[i].match(/(?:Teacher|Facilitator|Instructor|Prepared By)\s*[:\-]\s*([A-Za-z\.\s]+)/i)
    if (m) {
      teacherName = m[1].trim()
      break
    }
  }

  // 7. Parse Table of Weeks, Term Dates, Topics, Objectives, Coverage
  // Strategy 1: High-precision Tabular Parser using 2D coordinates
  const tabularWeeks = tryParseTabularWorkPlan(pagesItems, academicYear, subjectCode)
  if (tabularWeeks && tabularWeeks.length > 0) {
    return {
      raw_text: fullText,
      title: `${subjectName || 'Subject'} Semester ${semester} Work Plan`,
      framework,
      subject_code: subjectCode || undefined,
      subject_name: subjectName || undefined,
      class_name: className || undefined,
      teacher_name: teacherName || undefined,
      academic_year: academicYear,
      semester,
      needs_subject_code: !subjectCode,
      weeks: tabularWeeks,
      resources: '',
      notes: 'Imported from teacher Semester 1 work plan'
    }
  }

  // Strategy 2: Sequential line-by-line fallback
  const weeks: ParsedWorkPlanWeek[] = []
  let currentMonth = 'MONTH 1'
  let currentWeek: Partial<ParsedWorkPlanWeek> | null = null

  const finalizeCurrentWeek = () => {
    if (currentWeek && currentWeek.sequence !== undefined) {
      const { isCommed, updatedObjectives } = evaluateCoverageFromRemarks(
        currentWeek.remarks || '',
        currentWeek.objectives || []
      )

      weeks.push({
        sequence: currentWeek.sequence,
        week_label: currentWeek.week_label || `Week ${currentWeek.sequence}`,
        month_label: currentWeek.month_label || currentMonth,
        term_dates: currentWeek.term_dates || '',
        start_date: currentWeek.start_date || null,
        end_date: currentWeek.end_date || null,
        is_instructional: currentWeek.is_instructional ?? true,
        event_label: currentWeek.event_label || '',
        topic_title: currentWeek.topic_title || '',
        challenge_title: currentWeek.challenge_title || '',
        subtopic_title: currentWeek.subtopic_title || '',
        lessons_per_week: currentWeek.lessons_per_week || 1,
        remarks: currentWeek.remarks || '',
        objectives: updatedObjectives,
        is_commed: isCommed
      })
      currentWeek = null
    }
  }

  const DATE_RANGE_PATTERN = /(\d{1,2}(?:st|nd|rd|th)?\s*[–\-—]\s*\d{1,2}(?:st|nd|rd|th)?\s*(?:[A-Za-z]{3,9})|\d{1,2}\/\d{1,2}\s*[–\-—]\s*\d{1,2}\/\d{1,2})/i
  const TOPIC_PREFIX_PATTERN = /^(?:TOPIC|UNIT|CHAPTER|STRAND|SECTION)\s*(\d+|[A-Z])?[:\.\-]?\s*(.*)/i
  const OBJECTIVE_BULLET_PATTERN = /^(?:\[[✓xX✔\s]\]|[✓✔•\*\-]|LO\s*\d+)\s*(.*)/i

  let defaultYearNum = 2026
  try {
    defaultYearNum = parseInt(academicYear.split('/')[0], 10) || 2026
  } catch {}

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim()
    if (!rawLine) continue

    const upperLine = rawLine.toUpperCase()
    if (
      (MONTH_MAP[upperLine.slice(0, 3)] !== undefined && upperLine.length <= 15) ||
      /^MONTH\s*\d+/i.test(upperLine)
    ) {
      currentMonth = upperLine
      continue
    }

    const regexMatch = rawLine.match(/^(?:Week\s*(\d+)|Wk\s*(\d+)|(\d{1,2})\s*[\.:\-]\s*(\d{1,2}[a-z]{0,2}\s*[–\-—]\s*\d{1,2}[a-z]{0,2}))/i)
    const isStandaloneDigit = /^\d{1,2}$/.test(rawLine) && i + 1 < lines.length && (DATE_RANGE_PATTERN.test(lines[i + 1]) || /\b\d{1,2}(?:st|nd|rd|th)\b/i.test(lines.slice(i + 1, i + 4).join(' ')))

    if (regexMatch || isStandaloneDigit) {
      finalizeCurrentWeek()

      const seq = parseInt(regexMatch ? regexMatch[1] || regexMatch[2] || regexMatch[3] || rawLine : rawLine, 10)
      const termDateWindow = lines.slice(i + 1, i + 5).join(' ')
      const dateInWindow = termDateWindow.match(DATE_RANGE_PATTERN)
      const termDateStr = dateInWindow ? dateInWindow[1] : ''

      const { startDate, endDate } = parseTermDates(
        termDateStr ? `${termDateStr} ${currentMonth}` : '',
        defaultYearNum
      )

      currentWeek = {
        sequence: seq,
        week_label: `Week ${seq}`,
        month_label: currentMonth,
        term_dates: termDateStr,
        start_date: startDate,
        end_date: endDate,
        is_instructional: true,
        topic_title: '',
        challenge_title: '',
        subtopic_title: '',
        lessons_per_week: 1,
        remarks: '',
        objectives: []
      }
      continue
    }

    if (!currentWeek) continue

    if (/(?:MID-TERM|BREAK|HOLIDAY|EXAM|INDUCTION|REVISION\s*WEEK)/i.test(rawLine)) {
      currentWeek.is_instructional = false
      currentWeek.event_label = rawLine.toUpperCase()
      continue
    }

    const topicMatch = rawLine.match(TOPIC_PREFIX_PATTERN)
    if (topicMatch) {
      currentWeek.topic_title = topicMatch[2].trim() || topicMatch[0].trim()
      continue
    }

    const objBulletMatch = rawLine.match(OBJECTIVE_BULLET_PATTERN)
    const codeMatch = rawLine.match(/^(\*?[A-Za-z0-9\.\-]{2,12}[0-9]+[A-Za-z0-9\.\-]*)\s*[:\-]?\s+(.*)/)

    if (objBulletMatch || codeMatch) {
      let code = ''
      let text = ''

      if (codeMatch) {
        code = codeMatch[1].replace(/^\*/, '').trim()
        text = codeMatch[2].trim()
      } else if (objBulletMatch) {
        const afterBullet = objBulletMatch[1].trim()
        const innerCodeMatch = afterBullet.match(/^(\*?[A-Za-z0-9\.\-]{2,12}[0-9]+[A-Za-z0-9\.\-]*)\s*[:\-]?\s+(.*)/)
        if (innerCodeMatch) {
          code = innerCodeMatch[1].replace(/^\*/, '').trim()
          text = innerCodeMatch[2].trim()
        } else {
          const objSeq = (currentWeek.objectives?.length || 0) + 1
          code = `${subjectCode || 'LO'}.W${currentWeek.sequence || 1}.${objSeq}`
          text = afterBullet
        }
      }

      if (text && !text.includes('Weekly Lesson Breakdown') && !code.startsWith('Lesson')) {
        currentWeek.objectives = currentWeek.objectives || []
        currentWeek.objectives.push({
          code,
          text,
          is_met: false,
          topic_title: currentWeek.topic_title || '',
          challenge_title: currentWeek.challenge_title || ''
        })
      }
      continue
    }

    if (/^(?:REMARKS?|COMMENTS?|NOTES?|OBSERVATIONS?|COVERAGE|STATUS)\s*[:\-]?\s*(.*)/i.test(rawLine)) {
      const rmMatch = rawLine.match(/^(?:REMARKS?|COMMENTS?|NOTES?|OBSERVATIONS?|COVERAGE|STATUS)\s*[:\-]?\s*(.*)/i)
      currentWeek.remarks = (currentWeek.remarks ? `${currentWeek.remarks}\n` : '') + (rmMatch ? rmMatch[1] : rawLine)
      continue
    }

    if (/\b(?:covered|not covered|uncovered|pending|carried forward|carry forward|roll\s*over|rollover|completed|commed|tested|quiz|revision|homework|incomplete|taught|done|finished|achieved|not met|postponed|deferred|except)\b/i.test(rawLine)) {
      currentWeek.remarks = (currentWeek.remarks ? `${currentWeek.remarks} | ` : '') + rawLine
    } else if (!currentWeek.topic_title && rawLine.length < 80 && !rawLine.includes('http')) {
      currentWeek.topic_title = rawLine
    }
  }

  finalizeCurrentWeek()

  return {
    raw_text: fullText,
    title: `${subjectName || 'Subject'} Semester ${semester} Work Plan`,
    framework,
    subject_code: subjectCode || undefined,
    subject_name: subjectName || undefined,
    class_name: className || undefined,
    teacher_name: teacherName || undefined,
    academic_year: academicYear,
    semester,
    needs_subject_code: !subjectCode,
    weeks,
    resources: '',
    notes: 'Imported from teacher Semester 1 work plan'
  }
}
