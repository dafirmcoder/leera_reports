import type { ParsedWorkplan } from './types'
import type { ParsedWorkPlan, ParsedWorkPlanWeek, ParsedWorkPlanObjective } from '../types'
import { parseWorkplanPdf } from './index'
import { pdfjsLib } from '../../pdf'

export interface WorkPlanParseProgress {
  percent: number
  stage: string
  detail?: string
  page?: number
  totalPages?: number
}

export type WorkPlanParseProgressCallback = (progress: WorkPlanParseProgress) => void

function detectFramework(level: string | null, levelLabel: string | null): string {
  const lvlNum = parseInt(level || '', 10)
  if (lvlNum >= 1 && lvlNum <= 6) return 'CAMBRIDGE_PRIMARY'
  if (lvlNum >= 7 && lvlNum <= 9) return 'CAMBRIDGE_LOWER_SECONDARY'
  if (lvlNum >= 10 && lvlNum <= 11) return 'CAMBRIDGE_IGCSE'
  if (lvlNum >= 12 && lvlNum <= 13) return 'CAMBRIDGE_AS_A_LEVEL'

  const lbl = (levelLabel || '').toLowerCase()
  if (lbl.includes('primary')) return 'CAMBRIDGE_PRIMARY'
  if (lbl.includes('lower secondary')) return 'CAMBRIDGE_LOWER_SECONDARY'
  if (lbl.includes('igcse')) return 'CAMBRIDGE_IGCSE'
  if (lbl.includes('as') || lbl.includes('a level')) return 'CAMBRIDGE_AS_A_LEVEL'

  return 'CAMBRIDGE_LOWER_SECONDARY'
}

function resolveCambridgeCode(framework: string, subject: string | null, subjectCode: string | null): string {
  const s = (subject || '').trim().toLowerCase()
  if (framework === 'CAMBRIDGE_LOWER_SECONDARY') {
    if (s.includes('computing')) return '0860'
    if (s.includes('math')) return '0862'
    if (s.includes('science')) return '0893'
    if (s.includes('english')) return '0861'
    if (s.includes('global')) return '1129'
  } else if (framework === 'CAMBRIDGE_PRIMARY') {
    if (s.includes('computing')) return '0059'
    if (s.includes('math')) return '0096'
    if (s.includes('science')) return '0097'
    if (s.includes('english')) return '0058'
    if (s.includes('global')) return '0838'
  } else if (framework === 'CAMBRIDGE_IGCSE') {
    if (s.includes('computing') || s.includes('computer')) return '0478'
    if (s.includes('econ')) return '0455'
    if (s.includes('business')) return '0450'
    if (s.includes('math')) return '0580'
    if (s.includes('bio')) return '0610'
    if (s.includes('chem')) return '0620'
    if (s.includes('phy')) return '0625'
    if (s.includes('english')) return '0500'
    if (s.includes('global')) return '0457'
  } else if (framework === 'CAMBRIDGE_AS_A_LEVEL') {
    if (s.includes('computing') || s.includes('computer')) return '9618'
    if (s.includes('econ')) return '9708'
    if (s.includes('business')) return '9609'
    if (s.includes('math')) return '9709'
    if (s.includes('bio')) return '9700'
    if (s.includes('chem')) return '9701'
    if (s.includes('phy')) return '9702'
    if (s.includes('english')) return '9093'
    if (s.includes('global')) return '9239'
  }
  return subjectCode || ''
}

function formatSubjectName(sub: string | null): string {
  if (!sub) return 'Subject'
  return sub
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function checkObjectiveMet(code: string, remarks: string | null, remarkCodes: string[]): boolean {
  if (code && remarkCodes.includes(code)) return true
  if (!remarks) return false
  const r = remarks.toLowerCase()
  if (/\b(?:not\s*(?:yet)?\s*covered|uncovered|pending|rescheduled)\b/i.test(r) && !/\ball covered\b/i.test(r)) {
    return false
  }
  if (/\b(?:covered|all covered|done|completed|ticked)\b/i.test(r)) {
    return true
  }
  return false
}

function parseIsoDateRange(
  datesStr: string | null | undefined,
  monthStr: string | null | undefined,
  sessionStr: string | null | undefined
): { startDate?: string; endDate?: string } {
  if (!datesStr) return {}

  const isoMatch = datesStr.match(/(\d{4}-\d{2}-\d{2})\s*(?:[–\-—]|to)\s*(\d{4}-\d{2}-\d{2})/)
  if (isoMatch) {
    return { startDate: isoMatch[1], endDate: isoMatch[2] }
  }

  let year = new Date().getFullYear()
  if (sessionStr) {
    const yMatch = sessionStr.match(/\b(20\d{2})\b/)
    if (yMatch) year = parseInt(yMatch[1], 10)
  }

  const nums = [...datesStr.matchAll(/(?:^|\D)(\d{1,2})(?:st|nd|rd|th)?(?!\d)/gi)].map((m) => parseInt(m[1], 10))
  if (!nums.length) return {}

  const startDay = nums[0]
  const endDay = nums.length > 1 ? nums[nums.length - 1] : startDay

  const monthMap: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  }

  const monthsInDates = [...datesStr.matchAll(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi)]
    .map((m) => monthMap[m[1].toLowerCase()])

  let startMonthNum = 0
  let endMonthNum = 0

  if (monthsInDates.length === 1) {
    startMonthNum = monthsInDates[0]
    endMonthNum = monthsInDates[0]
  } else if (monthsInDates.length >= 2) {
    startMonthNum = monthsInDates[0]
    endMonthNum = monthsInDates[1]
  } else if (monthStr) {
    const cleanM = monthStr.toLowerCase()
    for (const [k, v] of Object.entries(monthMap)) {
      if (cleanM.includes(k)) {
        startMonthNum = v
        endMonthNum = v
        break
      }
    }
  }

  function isValidDate(y: number, m: number, d: number): boolean {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false
    const dt = new Date(y, m - 1, d)
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  }

  let startYear = year
  let endYear = year

  if (startMonthNum && startDay > endDay) {
    // Week crosses month boundary.
    // Check if startDay is invalid in startMonthNum (e.g. 31 in September)
    if (!isValidDate(startYear, startMonthNum, startDay)) {
      const prevMonth = startMonthNum - 1 <= 0 ? 12 : startMonthNum - 1
      const prevYear = startMonthNum - 1 <= 0 ? startYear - 1 : startYear
      if (isValidDate(prevYear, prevMonth, startDay)) {
        endMonthNum = startMonthNum
        startMonthNum = prevMonth
        startYear = prevYear
      }
    } else if (startDay >= 20 && endDay <= 10) {
      // In school work plans, the month column often names the month in which the week ends
      const prevMonth = startMonthNum - 1 <= 0 ? 12 : startMonthNum - 1
      const prevYear = startMonthNum - 1 <= 0 ? startYear - 1 : startYear
      if (isValidDate(prevYear, prevMonth, startDay)) {
        endMonthNum = startMonthNum
        startMonthNum = prevMonth
        startYear = prevYear
      } else {
        endMonthNum = (startMonthNum % 12) + 1
        if (endMonthNum === 1) endYear += 1
      }
    } else {
      endMonthNum = (startMonthNum % 12) + 1
      if (endMonthNum === 1) endYear += 1
    }
  }

  if (isValidDate(startYear, startMonthNum, startDay) && isValidDate(endYear, endMonthNum, endDay)) {
    const sMonthPad = String(startMonthNum).padStart(2, '0')
    const sDayPad = String(startDay).padStart(2, '0')
    const eMonthPad = String(endMonthNum || startMonthNum).padStart(2, '0')
    const eDayPad = String(endDay).padStart(2, '0')
    return {
      startDate: `${startYear}-${sMonthPad}-${sDayPad}`,
      endDate: `${endYear}-${eMonthPad}-${eDayPad}`
    }
  }

  return {}
}

/**
 * Adapter that runs the new layout-driven parser and converts its output
 * to the Leera-Reports ParsedWorkPlan structure used by Planning.tsx and api.importWorkPlan.
 */
export async function parseWorkPlanPdf(
  file: File,
  onProgress?: WorkPlanParseProgressCallback
): Promise<ParsedWorkPlan> {
  onProgress?.({
    percent: 10,
    stage: 'Reading PDF text and vector rules...',
    detail: file.name
  })

  const doc: ParsedWorkplan = await parseWorkplanPdf(file, {
    pdfjs: pdfjsLib,
    fileName: file.name,
    onProgress: (p, total) => {
      const pct = Math.round(10 + (p / total) * 75)
      onProgress?.({
        percent: pct,
        stage: `Reading page ${p} of ${total}...`,
        detail: `Analyzing grid rules and column boundaries`,
        page: p,
        totalPages: total
      })
    }
  })

  onProgress?.({
    percent: 90,
    stage: 'Structuring weeks & learning objectives...',
    detail: `Found ${doc.weeks.length} weeks`
  })

  const framework = detectFramework(doc.level, doc.levelLabel)
  const subjectName = formatSubjectName(doc.subject)
  const subjectCode = resolveCambridgeCode(framework, doc.subject, doc.subjectCode)
  const className = doc.levelLabel || (doc.level ? `Year ${doc.level}` : undefined)

  const weeks: ParsedWorkPlanWeek[] = doc.weeks.map((w, idx) => {
    const seq = w.week ?? (idx + 1)
    const isInstructional = !(
      w.objectives.length === 0 &&
      (w.lessons?.length || 0) === 0 &&
      /break|holiday|vacation|mid-term/i.test(`${w.unit || ''} ${w.topics.join(' ')} ${w.assessments.join(' ')}`)
    )
    const eventLabel = !isInstructional
      ? (w.topics[0] || w.assessments[0] || 'NON-INSTRUCTIONAL')
      : undefined

    const objectives: ParsedWorkPlanObjective[] = w.objectives.map((o) => ({
      code: o.code || '',
      text: o.text || o.raw,
      is_met: checkObjectiveMet(o.code || '', w.remarks, w.remarkCodes),
      topic_title: o.unit || w.unit || (w.topics[0] ?? 'General Curriculum')
    }))

    const topicTitle = w.unit || (w.topics.length > 0 ? w.topics[0] : (w.assessments[0] || 'General Curriculum'))
    const subtopicTitle = w.topics.length > 1 ? w.topics.slice(1).join('; ') : undefined
    const { startDate, endDate } = parseIsoDateRange(w.dates, w.month, doc.session)

    return {
      sequence: seq,
      week_label: w.label ? (w.label.toUpperCase().startsWith('WEEK') ? w.label : `Week ${w.label}`) : `Week ${seq}`,
      month_label: w.month || undefined,
      term_dates: w.dates || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      is_instructional: isInstructional,
      event_label: eventLabel,
      topic_title: topicTitle,
      subtopic_title: subtopicTitle,
      remarks: w.remarks || undefined,
      objectives,
      is_commed: objectives.length > 0 && objectives.every((o) => o.is_met)
    }
  })

  const parsed: ParsedWorkPlan = {
    raw_text: '',
    title: doc.title || `${subjectName} Semester ${doc.semester || '1'} Work Plan`,
    framework,
    subject_code: subjectCode || undefined,
    subject_name: subjectName,
    class_name: className,
    teacher_name: doc.teacher || undefined,
    academic_year: doc.session || '2026/2027',
    semester: doc.semester || '1',
    needs_subject_code: !subjectCode,
    weeks,
    resources: doc.resources.join('\n'),
    notes: doc.warnings.length > 0 ? doc.warnings.join('\n') : undefined
  }

  onProgress?.({
    percent: 100,
    stage: 'Work plan parsed successfully!',
    detail: `Extracted ${parsed.weeks.length} weeks and ${parsed.weeks.reduce((acc, w) => acc + w.objectives.length, 0)} learning objectives`
  })

  return parsed
}
