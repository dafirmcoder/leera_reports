import * as pdfjsLib from 'pdfjs-dist'
import { ParsedWorkPlan, ParsedWorkPlanWeek, ParsedWorkPlanObjective } from './types'

// Configure worker using CDN fallback
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
} catch {
  // worker fallback handled by pdfjs
}

// Month name lookup for date parsing
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

/**
 * Extracts raw text items and joined text per page from a PDF File
 */
export async function extractWorkPlanTextFromPdf(file: File): Promise<{ pagesText: string[]; fullText: string; lines: string[] }> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise
  const pagesText: string[] = []
  const allLines: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageStrings = content.items
      .map((item: any) => item.str || '')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0)

    pagesText.push(pageStrings.join('\n'))
    allLines.push(...pageStrings)
  }

  return {
    pagesText,
    fullText: pagesText.join('\n\n'),
    lines: allLines
  }
}

/**
 * Attempts to parse date range strings like "15TH – 19TH JAN" or "15/01 - 19/01" into ISO dates
 */
function parseTermDates(dateStr: string, defaultYear = 2026): { startDate: string | null; endDate: string | null } {
  if (!dateStr) return { startDate: null, endDate: null }

  // Clean ordinal suffixes: 15TH -> 15, 1ST -> 1, 2ND -> 2, 3RD -> 3
  const cleaned = dateStr.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1').replace(/\s+/g, ' ').trim()

  // Format 1: "15 – 19 JAN" or "15 - 19 JANUARY" or "15 JAN - 19 JAN"
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
 * Main parser for Semester Work Plans (matching Cambridge & Leera/CambriFy layouts)
 */
export async function parseWorkPlanPdf(file: File): Promise<ParsedWorkPlan> {
  const { lines, fullText } = await extractWorkPlanTextFromPdf(file)
  const textLower = fullText.toLowerCase()

  // 1. Detect Framework
  let framework = 'CAMBRIDGE_LOWER_SECONDARY'
  if (textLower.includes('as & a level') || textLower.includes('a level') || textLower.includes('as level')) {
    framework = 'CAMBRIDGE_AS_A_LEVEL'
  } else if (textLower.includes('igcse') || textLower.includes('year 10') || textLower.includes('year 11') || textLower.includes('grade 10') || textLower.includes('grade 11')) {
    framework = 'CAMBRIDGE_IGCSE'
  } else if (textLower.includes('primary') || textLower.includes('stage 1') || textLower.includes('stage 6') || textLower.includes('grade 1') || textLower.includes('grade 6')) {
    framework = 'CAMBRIDGE_PRIMARY'
  }

  // 2. Detect Subject Code (4-digit Cambridge Code, e.g. 0580, 0610, 0457, 0893, 1129, etc.)
  let subjectCode = ''
  // Try finding 4-digit code in filename first
  const fileCodeMatch = file.name.match(/\b(0\d{3}|1\d{3}|9\d{3})\b/)
  if (fileCodeMatch) {
    subjectCode = fileCodeMatch[1]
  }

  // Try finding in text header (first 35 lines)
  if (!subjectCode) {
    for (let i = 0; i < Math.min(35, lines.length); i++) {
      const line = lines[i]
      const m = line.match(/\b(0\d{3}|1\d{3}|9\d{3})\b/)
      if (m) {
        subjectCode = m[1]
        break
      }
    }
  }

  // 3. Detect Subject Name
  let subjectName = ''
  if (textLower.includes('global perspective') || subjectCode === '0457' || subjectCode === '1129' || subjectCode === '0838' || subjectCode === '9239') {
    subjectName = 'Global Perspectives'
    if (!subjectCode) {
      if (framework === 'CAMBRIDGE_PRIMARY') subjectCode = '0838'
      else if (framework === 'CAMBRIDGE_LOWER_SECONDARY') subjectCode = '1129'
      else if (framework === 'CAMBRIDGE_IGCSE') subjectCode = '0457'
      else subjectCode = '9239'
    }
  } else if (textLower.includes('mathematics') || textLower.includes('maths') || subjectCode === '0580' || subjectCode === '0862' || subjectCode === '9709') {
    subjectName = 'Mathematics'
  } else if (textLower.includes('biology') || subjectCode === '0610' || subjectCode === '9700') {
    subjectName = 'Biology'
  } else if (textLower.includes('chemistry') || subjectCode === '0620' || subjectCode === '9701') {
    subjectName = 'Chemistry'
  } else if (textLower.includes('physics') || subjectCode === '0625' || subjectCode === '9702') {
    subjectName = 'Physics'
  } else if (textLower.includes('computer science') || subjectCode === '0478' || subjectCode === '9618') {
    subjectName = 'Computer Science'
  } else if (textLower.includes('computing') || subjectCode === '0860') {
    subjectName = 'Computing'
  } else if (textLower.includes('english') || subjectCode === '0500' || subjectCode === '0861') {
    subjectName = 'English Language'
  } else if (textLower.includes('science') || subjectCode === '0893') {
    subjectName = 'Science'
  } else if (textLower.includes('business studies') || subjectCode === '0450') {
    subjectName = 'Business Studies'
  } else if (textLower.includes('economics') || subjectCode === '0455') {
    subjectName = 'Economics'
  }

  // 4. Detect Class / Year Group
  let className = ''
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const l = lines[i]
    const classMatch = l.match(/\b(Year\s*\d+|Grade\s*\d+|Stage\s*\d+|AS\s*Level|A\s*Level)\b/i)
    if (classMatch) {
      className = classMatch[1].toUpperCase()
      break
    }
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
  if (textLower.includes('semester 2') || textLower.includes('term 2')) {
    semester = '2'
  } else if (textLower.includes('term 3') || textLower.includes('semester 3')) {
    semester = '3'
  }

  // 6. Detect Teacher Name if available
  let teacherName = ''
  for (let i = 0; i < Math.min(35, lines.length); i++) {
    const m = lines[i].match(/(?:Teacher|Facilitator|Instructor|Prepared By)\s*[:\-]\s*([A-Za-z\.\s]+)/i)
    if (m) {
      teacherName = m[1].trim()
      break
    }
  }

  // 7. Parse Table of Weeks, Term Dates, Topics, Objectives, Coverage ("Commed" status)
  const weeks: ParsedWorkPlanWeek[] = []
  let currentMonth = 'MONTH 1'
  let currentWeek: Partial<ParsedWorkPlanWeek> | null = null

  // Evaluates coverage from comment/remarks section (covered vs not covered)
  const evaluateCoverageFromRemarks = (remarks: string, objectives: ParsedWorkPlanObjective[]) => {
    const text = (remarks || '').trim()
    if (!text) {
      const allMet = objectives.length > 0 && objectives.every((o) => o.is_met)
      return { isCommed: allMet, updatedObjectives: objectives }
    }

    const textLower = text.toLowerCase()
    const hasExcept = /\b(?:except|excluding|but not)\b/i.test(text)
    if (hasExcept) {
      const parts = text.split(/\b(?:except|excluding|but not)\b/i)
      const afterExcept = parts[1] || ''
      const updated = objectives.map((obj) => {
        const isExcluded = new RegExp(`\\b${obj.code.replace('.', '\\.')}\\b`, 'i').test(afterExcept)
        return {
          ...obj,
          is_met: !isExcluded
        }
      })
      const isCommed = updated.length > 0 && updated.every((o) => o.is_met)
      return { isCommed, updatedObjectives: updated }
    }

    const hasNegativeKeyword = /\b(?:not covered|uncovered|pending|carried forward|carry forward|roll\s*over|rollover|incomplete|postponed|to be covered|unmet|deferred|not met|partially covered)\b/i.test(text)
    const hasPositiveKeyword = /\b(?:fully covered|all covered|covered|completed|done|taught|met|achieved|commed|finished)\b/i.test(text)

    if (hasNegativeKeyword && !textLower.includes('all covered') && !textLower.includes('fully covered')) {
      // Comment indicates objectives in this week are not covered / pending rollover
      const updated = objectives.map((obj) => {
        const specificCovered = new RegExp(`\\b${obj.code.replace('.', '\\.')}\\b[^.]*?\\b(covered|completed|done|met|taught)\\b`, 'i').test(text)
        return {
          ...obj,
          is_met: specificCovered ? true : false
        }
      })
      const isCommed = updated.length > 0 && updated.every((o) => o.is_met)
      return { isCommed, updatedObjectives: updated }
    }

    if (hasPositiveKeyword) {
      // Comment indicates objectives in this week are covered
      const updated = objectives.map((obj) => {
        const specificUncovered = new RegExp(`\\b${obj.code.replace('.', '\\.')}\\b[^.]*?\\b(not covered|pending|uncovered|carried forward|incomplete)\\b`, 'i').test(text)
        return {
          ...obj,
          is_met: specificUncovered ? false : true
        }
      })
      const isCommed = updated.length > 0 && updated.every((o) => o.is_met)
      return { isCommed, updatedObjectives: updated }
    }

    const allMet = objectives.length > 0 && objectives.every((o) => o.is_met)
    return { isCommed: allMet, updatedObjectives: objectives }
  }

  // Helper to commit current week
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

  // Regex patterns
  const DATE_RANGE_PATTERN = /(\d{1,2}(?:st|nd|rd|th)?\s*[–\-—]\s*\d{1,2}(?:st|nd|rd|th)?\s*(?:[A-Za-z]{3,9})|\d{1,2}\/\d{1,2}\s*[–\-—]\s*\d{1,2}\/\d{1,2})/i
  const TOPIC_PREFIX_PATTERN = /^(?:TOPIC|UNIT|CHAPTER|STRAND|SECTION)\s*(\d+|[A-Z])?[:\.\-]?\s*(.*)/i
  const CHALLENGE_PREFIX_PATTERN = /^(?:CHALLENGE|THEME)\s*(\d+|[A-Z])?[:\.\-]?\s*(.*)/i
  const TICK_COMMED_PATTERN = /(?:\[[✓xX✔]\]|[✓✔]|commed|checked|completed)/i
  const OBJECTIVE_BULLET_PATTERN = /^(?:\[[✓xX✔\s]\]|[✓✔•\*\-]|LO\s*\d+)\s*(.*)/i

  let defaultYearNum = 2026
  try {
    defaultYearNum = parseInt(academicYear.split('/')[0], 10) || 2026
  } catch {}

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim()
    if (!rawLine) continue

    // Detect month name row
    const upperLine = rawLine.toUpperCase()
    if (
      (MONTH_MAP[upperLine.slice(0, 3)] !== undefined && upperLine.length <= 15) ||
      /^MONTH\s*\d+/i.test(upperLine)
    ) {
      currentMonth = upperLine
      continue
    }

    // Detect week row initiation
    const regexMatch = rawLine.match(/^(?:Week\s*(\d+)|Wk\s*(\d+)|(\d{1,2})\s*[\.:\-]\s*(\d{1,2}[a-z]{0,2}\s*[–\-—]\s*\d{1,2}[a-z]{0,2}))/i)
    const isStandaloneDigitWithDate = /^\d{1,2}$/.test(rawLine) && i + 1 < lines.length && DATE_RANGE_PATTERN.test(lines[i + 1])

    if (regexMatch || isStandaloneDigitWithDate) {
      finalizeCurrentWeek()

      const seq = parseInt(regexMatch ? (regexMatch[1] || regexMatch[2] || regexMatch[3] || rawLine) : rawLine, 10)
      let termDateStr = ''
      const dateInLine = rawLine.match(DATE_RANGE_PATTERN)
      if (dateInLine) {
        termDateStr = dateInLine[1]
      } else if (i + 1 < lines.length && DATE_RANGE_PATTERN.test(lines[i + 1])) {
        termDateStr = lines[i + 1].trim()
        i++ // consume next line
      }

      const { startDate, endDate } = parseTermDates(termDateStr, defaultYearNum)

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

    if (!currentWeek) {
      // If we haven't encountered a week header yet, skip header/metadata lines
      continue
    }

    // If within a week block:
    // Check non-instructional events
    if (/(?:MID-TERM|BREAK|HOLIDAY|EXAM|INDUCTION|REVISION\s*WEEK)/i.test(rawLine)) {
      currentWeek.is_instructional = false
      currentWeek.event_label = rawLine.toUpperCase()
      continue
    }

    // Check Topic / Challenge
    const topicMatch = rawLine.match(TOPIC_PREFIX_PATTERN)
    if (topicMatch) {
      currentWeek.topic_title = topicMatch[2].trim() || topicMatch[0].trim()
      continue
    }

    const challengeMatch = rawLine.match(CHALLENGE_PREFIX_PATTERN)
    if (challengeMatch) {
      currentWeek.challenge_title = challengeMatch[2].trim() || challengeMatch[0].trim()
      continue
    }

    // Check Learning Objectives
    const isCommedTick = TICK_COMMED_PATTERN.test(rawLine.slice(0, 10))
    const objBulletMatch = rawLine.match(OBJECTIVE_BULLET_PATTERN)
    const codeMatch = rawLine.match(/^(\*?[A-Za-z0-9\.\-]{2,12}[0-9]+[A-Za-z0-9\.\-]*)\s*[:\-]?\s+(.*)/)

    if (objBulletMatch || codeMatch) {
      let code = ''
      let text = ''
      const isMet = isCommedTick || /\[[✓xX✔]\]|[✓✔]/.test(rawLine)

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

      if (text) {
        currentWeek.objectives = currentWeek.objectives || []
        currentWeek.objectives.push({
          code,
          text,
          is_met: isMet,
          topic_title: currentWeek.topic_title || '',
          challenge_title: currentWeek.challenge_title || ''
        })
      }
      continue
    }

    // Check Remarks / Comments column content
    if (/^(?:REMARKS?|COMMENTS?|NOTES?|OBSERVATIONS?|COVERAGE|STATUS)\s*[:\-]?\s*(.*)/i.test(rawLine)) {
      const rmMatch = rawLine.match(/^(?:REMARKS?|COMMENTS?|NOTES?|OBSERVATIONS?|COVERAGE|STATUS)\s*[:\-]?\s*(.*)/i)
      currentWeek.remarks = (currentWeek.remarks ? `${currentWeek.remarks}\n` : '') + (rmMatch ? rmMatch[1] : rawLine)
      continue
    }

    // Append to existing remarks if it looks like a note or coverage indicator
    if (/\b(?:covered|not covered|uncovered|pending|carried forward|carry forward|roll\s*over|rollover|completed|commed|tested|quiz|revision|homework|incomplete|taught|done|finished|achieved|not met|postponed|deferred|except)\b/i.test(rawLine)) {
      currentWeek.remarks = (currentWeek.remarks ? `${currentWeek.remarks} | ` : '') + rawLine
    } else if (!currentWeek.topic_title && rawLine.length < 80 && !rawLine.includes('http')) {
      currentWeek.topic_title = rawLine
    }
  }

  finalizeCurrentWeek()

  // Fallback: If no weeks were detected via the table loop, create 12 default weeks
  if (weeks.length === 0) {
    const rawObjs: ParsedWorkPlanObjective[] = []
    for (const l of lines) {
      const cm = l.match(/^(\*?[A-Za-z0-9\.\-]{2,12}[0-9]+[A-Za-z0-9\.\-]*)\s*[:\-]?\s+(.*)/)
      if (cm) {
        rawObjs.push({
          code: cm[1].replace(/^\*/, '').trim(),
          text: cm[2].trim(),
          is_met: TICK_COMMED_PATTERN.test(l)
        })
      }
    }

    for (let i = 1; i <= 12; i++) {
      const chunk = rawObjs.slice((i - 1) * 2, i * 2)
      weeks.push({
        sequence: i,
        week_label: `Week ${i}`,
        month_label: i <= 4 ? 'MONTH 1' : i <= 8 ? 'MONTH 2' : 'MONTH 3',
        term_dates: '',
        start_date: null,
        end_date: null,
        is_instructional: true,
        topic_title: '',
        challenge_title: '',
        subtopic_title: '',
        lessons_per_week: 1,
        remarks: '',
        objectives: chunk,
        is_commed: chunk.length > 0 && chunk.every((o) => o.is_met)
      })
    }
  }

  return {
    raw_text: fullText,
    title: `${subjectName || 'Subject'} Semester ${semester} Work Plan`,
    framework,
    subject_code: subjectCode || undefined,
    subject_name: subjectName || undefined,
    class_name: className || undefined,
    teacher_name: teacherName || undefined,
    academic_year: academicYear,
    semester: semester,
    needs_subject_code: !subjectCode,
    weeks,
    resources: '',
    notes: 'Imported from teacher Semester 1 work plan'
  }
}
