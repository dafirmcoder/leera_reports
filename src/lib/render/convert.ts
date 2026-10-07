import type { WorkPlan, School } from '../types'
import type { ParsedWorkplan, WorkplanWeek } from '../workplan/types'

function formatOrdinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}TH`
  const last = day % 10
  if (last === 1) return `${day}ST`
  if (last === 2) return `${day}ND`
  if (last === 3) return `${day}RD`
  return `${day}TH`
}

function formatDateRange(startStr?: string | null, endStr?: string | null): string | null {
  if (!startStr && !endStr) return null
  if (!startStr && endStr) return String(endStr)
  if (startStr && !endStr) {
    const s = new Date(startStr)
    return isNaN(s.getTime()) ? String(startStr) : formatOrdinal(s.getDate())
  }
  const s = new Date(startStr!)
  const e = new Date(endStr!)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) {
    return `${startStr} – ${endStr}`
  }
  const sDay = formatOrdinal(s.getDate())
  const eDay = formatOrdinal(e.getDate())
  if (s.getMonth() === e.getMonth()) {
    return `${sDay} – ${eDay}`
  }
  const sMonth = s.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()
  const eMonth = e.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()
  return `${sDay} ${sMonth} – ${eDay} ${eMonth}`
}

/**
 * Converts a Leera-Reports WorkPlan database record into a ParsedWorkplan
 * so it can be rendered using the standard PDF renderer.
 */
export function workPlanToParsedWorkplan(
  plan: WorkPlan,
  school?: School | { name: string } | null
): ParsedWorkplan {
  const weeks: WorkplanWeek[] = (plan.weeks || []).map((w, i) => {
    let dates: string | null = (w as any).term_dates || (w as any).dates || null
    if (!dates && (w.start_date || w.end_date)) {
      dates = formatDateRange(w.start_date, w.end_date)
    }

    // If still missing, check if week_label has embedded dates (e.g. "Week 1 (24th - 28th)" or "Week 1: 24th – 28th")
    if (!dates && w.week_label) {
      const dateMatch = w.week_label.match(/(\d{1,2}(?:st|nd|rd|th)?\s*(?:[–\-—]|to)\s*\d{1,2}(?:st|nd|rd|th)?(?:\s+[A-Za-z]+)?)/i)
      if (dateMatch) {
        dates = dateMatch[1]
      }
    }

    // If still missing, check remarks or event_label for date patterns
    if (!dates && (w.event_label || w.remarks)) {
      const dateMatch = (w.event_label || w.remarks || '').match(/\b(\d{1,2}(?:st|nd|rd|th)?\s*(?:[–\-—]|to)\s*\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC))?)\b/i)
      if (dateMatch) {
        dates = dateMatch[1]
      }
    }

    let month = (w.month_label || (w as any).month || '').trim() || null
    if (!month && w.start_date) {
      const s = new Date(w.start_date)
      if (!isNaN(s.getTime())) {
        month = s.toLocaleDateString('en-GB', { month: 'long' }).toUpperCase()
      }
    }

    const objectives = (w.objectives || []).map((o) => ({
      kind: 'objective' as const,
      code: o.code_snapshot || null,
      strandCode: o.code_snapshot ? o.code_snapshot.split('.')[0] : null,
      text: o.text_snapshot,
      raw: `${o.code_snapshot ? o.code_snapshot + ' ' : ''}${o.text_snapshot}`,
      unit: w.topic_title || null,
      page: 1,
      is_met: Boolean(o.is_met)
    }))

    const allMet = objectives.length > 0 && objectives.every((o) => o.is_met)
    const someMet = objectives.some((o) => o.is_met)
    const metCount = objectives.filter((o) => o.is_met).length

    let remarksVal = (w.remarks || '').trim()
    if (allMet) {
      if (!remarksVal || /not covered/i.test(remarksVal)) {
        remarksVal = 'Covered'
      } else if (!/covered/i.test(remarksVal)) {
        remarksVal = `Covered\n${remarksVal}`
      }
    } else if (someMet) {
      if (!remarksVal || /not covered/i.test(remarksVal)) {
        remarksVal = `Partially covered (${metCount}/${objectives.length})`
      }
    }

    return {
      week: w.sequence ?? (i + 1),
      label: w.week_label || String(w.sequence ?? (i + 1)),
      dates,
      month,
      unit: w.topic_title || null,
      units: w.topic_title ? [w.topic_title] : [],
      topics: [w.topic_title, w.subtopic_title].filter(Boolean) as string[],
      objectives,
      lessons: [],
      assessments: !w.is_instructional && w.event_label ? [w.event_label] : [],
      remarks: remarksVal || null,
      remarksNote: remarksVal || null,
      remarkCodes: [],
      items: [],
      pages: [1],
      warnings: [],
      extraLines: []
    }
  })

  return {
    fileName: `${plan.subject_name || 'Subject'}-${plan.class_name || 'Class'}-Semester${plan.semester || '1'}.pdf`,
    title: 'SEMESTER WORK PLAN',
    school: school?.name || 'LEERA INTERNATIONAL SCHOOL',
    level: plan.class_name ? plan.class_name.replace(/\D/g, '') : null,
    levelLabel: plan.class_name || null,
    subject: plan.subject_name?.toUpperCase() || null,
    subjectCode: null,
    teacher: plan.teacher_name?.toUpperCase() || null,
    semester: plan.semester || '1',
    semesterLabel: `Semester ${plan.semester || '1'}`,
    session: plan.academic_year || '2026/2027',
    period: null,
    strandCodes: [],
    weeks,
    resources: plan.resources ? [plan.resources] : [],
    pageCount: 1,
    warnings: []
  }
}
