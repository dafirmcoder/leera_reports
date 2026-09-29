import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { LessonPlan, School, WorkPlan } from './types'
import { LEERA_LESSON_PLAN_LOGO_DATA_URL } from './lessonPlanLogo'

// Helper for ordinal day formatting (e.g. 24 -> 24TH)
function formatOrdinalDay(day: number): string {
  if (day >= 11 && day <= 13) return `${day}TH`
  const last = day % 10
  if (last === 1) return `${day}ST`
  if (last === 2) return `${day}ND`
  if (last === 3) return `${day}RD`
  return `${day}TH`
}

function formatDateRangeOrdinal(startStr?: string | null, endStr?: string | null): string {
  if (!startStr) return ''
  const s = new Date(startStr)
  if (isNaN(s.getTime())) return ''
  const sDay = formatOrdinalDay(s.getDate())
  if (!endStr) return sDay
  const e = new Date(endStr)
  if (isNaN(e.getTime())) return sDay
  const eDay = formatOrdinalDay(e.getDate())
  return `${sDay} – ${eDay}`
}

/**
 * Generates Semester Work Plan PDF matching CAMBRIFY's exact landscape layout.
 */
export async function generateWorkPlanPdf(plan: WorkPlan, school: School): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const pageW = 297
  const margin = 10
  const usableW = pageW - margin * 2 // 277mm

  // 1. TOP HEADER (3 Columns: School Name / Logo | Title | Cambridge Assessment)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42) // #0f172a
  doc.text(school.name.toUpperCase(), margin, 12)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(11, 79, 138) // #0B4F8A Cambridge blue
  doc.text('Cambridge International School', margin, 16)

  // Title Center
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(0, 0, 0)
  doc.text('SEMESTER WORK PLAN', pageW / 2, 14, { align: 'center' })

  // Cambridge Assessment Right
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(30, 41, 59)
  doc.text('Cambridge Assessment', pageW - margin, 12, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(71, 85, 105)
  doc.text('International Education', pageW - margin, 16, { align: 'right' })

  // 2. METADATA SUBHEADER BOX (Stacked 4 Rows matching CAMBRIFY)
  const metaY = 19
  const metaH = 22
  doc.setDrawColor(100, 116, 139) // #64748b
  doc.setLineWidth(0.3)
  doc.setFillColor(255, 255, 255)
  doc.rect(margin, metaY, usableW, metaH, 'FD')

  // Inner lines
  const rowH = metaH / 4
  for (let r = 1; r < 4; r++) {
    doc.line(margin, metaY + r * rowH, margin + usableW, metaY + r * rowH)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(0, 0, 0)
  doc.text(school.name.toUpperCase(), pageW / 2, metaY + 4, { align: 'center' })
  doc.text(`${(plan.class_name || 'CLASS').toUpperCase()} LONG TERM PLAN ${plan.academic_year}`, pageW / 2, metaY + rowH + 4, { align: 'center' })
  doc.text((plan.subject_name || 'SUBJECT').toUpperCase(), pageW / 2, metaY + rowH * 2 + 4, { align: 'center' })
  doc.text(`SEMESTER ${plan.semester || '1'} WORK PLAN`, pageW / 2, metaY + rowH * 3 + 4, { align: 'center' })

  // 3. MAIN WORK PLAN TABLE
  // Columns: MONTHS (28mm), WEEK (24mm), TOPIC/ LEARNING OBJECTIVE (185mm), REMARKS (40mm)
  const weeks = plan.weeks || []
  const tableBody: any[] = []

  for (const week of weeks) {
    const month = (week.month_label || 'TERM').toUpperCase()

    // Week cell: sequence and ordinal dates
    const dateRange = formatDateRangeOrdinal(week.start_date, week.end_date)
    const weekCellText = dateRange ? `Week ${week.sequence}\n${dateRange}` : `Week ${week.sequence}`

    // Topic & Learning Objectives cell
    let topicText = ''
    if (!week.is_instructional) {
      topicText = `[SPECIAL EVENT]\n${(week.event_label || 'Non-instructional Week').toUpperCase()}`
    } else {
      const parts: string[] = []
      if (week.challenge_title) {
        parts.push(`CHALLENGE: ${week.challenge_title.toUpperCase()}`)
      }
      if (week.topic_title) {
        parts.push(`TOPIC: ${week.topic_title.toUpperCase()}`)
      }
      if (week.subtopic_title) {
        parts.push(`UNIT: ${week.subtopic_title}`)
      }

      if (week.objectives && week.objectives.length > 0) {
        parts.push('\nLEARNING OBJECTIVES:')
        week.objectives.forEach((obj) => {
          const statusTag = obj.is_met ? '[✓ COVERED]' : '[⏳ UNCOVERED]'
          parts.push(`• ${statusTag} [${obj.code_snapshot}] ${obj.text_snapshot}`)
        })
      }
      topicText = parts.join('\n')
    }

    // Remarks cell (Comments & Coverage status)
    const remarkParts: string[] = []
    if (week.objectives && week.objectives.length > 0) {
      const allMet = week.objectives.every((o) => o.is_met)
      const someMet = week.objectives.some((o) => o.is_met)
      if (allMet) {
        remarkParts.push('[✓ ALL COVERED]')
      } else if (someMet) {
        const coveredCnt = week.objectives.filter((o) => o.is_met).length
        remarkParts.push(`[PARTIALLY COVERED: ${coveredCnt}/${week.objectives.length}]`)
      } else {
        remarkParts.push('[⏳ NOT COVERED]')
      }
    }
    if (week.lessons_per_week) {
      remarkParts.push(`${week.lessons_per_week} Lessons/wk`)
    }
    if (week.remarks) {
      remarkParts.push(week.remarks)
    }
    const remarksText = remarkParts.join('\n')

    tableBody.push([month, weekCellText, topicText, remarksText])
  }

  if (tableBody.length === 0) {
    tableBody.push(['TERM 1', 'Week 1', 'No instructional weeks configured yet.', ''])
  }

  autoTable(doc, {
    startY: metaY + metaH + 3,
    head: [['MONTHS', 'WEEK', 'TOPIC/ LEARNING OBJECTIVE', 'REMARKS']],
    body: tableBody,
    theme: 'grid',
    margin: { left: margin, right: margin, bottom: 25 },
    headStyles: {
      fillColor: [0, 168, 89], // #00A859 Solid Brand Green Header matching CAMBRIFY
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      fontSize: 8,
      cellPadding: 2
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2.5,
      textColor: [30, 41, 59],
      lineColor: [148, 163, 184],
      lineWidth: 0.2
    },
    columnStyles: {
      0: { cellWidth: 28, halign: 'center', valign: 'middle', fontStyle: 'bold' },
      1: { cellWidth: 24, halign: 'center', valign: 'top', fontStyle: 'bold' },
      2: { cellWidth: 185, halign: 'left', valign: 'top' },
      3: { cellWidth: 40, halign: 'center', valign: 'top' }
    },
    didDrawPage: (data) => {
      // Signature blocks and footer at the bottom of the page
      const pageH = doc.internal.pageSize.getHeight()
      const sigY = pageH - 18

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(71, 85, 105)

      // Teacher sign
      doc.line(margin, sigY, margin + 60, sigY)
      doc.text(`Subject Teacher: ${plan.teacher_name || 'Teacher'}`, margin, sigY + 4)
      doc.text(`Status: ${plan.status.toUpperCase()}`, margin, sigY + 8)

      // Head of School / Coordinator sign
      doc.line(pageW - margin - 70, sigY, pageW - margin, sigY)
      doc.text('Head of School / Coordinator Signature', pageW - margin - 70, sigY + 4)
      doc.text(plan.approved_at ? `Approved on: ${new Date(plan.approved_at).toLocaleDateString()}` : 'Date: _______________', pageW - margin - 70, sigY + 8)

      // Footer bar
      doc.setFontSize(7)
      doc.setTextColor(148, 163, 184)
      doc.text(`Page ${data.pageNumber} · ${school.name} · ${school.footer_text}`, pageW / 2, pageH - 4, { align: 'center' })
    }
  })

  return doc
}

// ---------------------------------------------------------------------------
// LESSON PLAN PDF (MATCHES VERBATIM STRUCTURE, COLORS & LOGO PLACEMENT)
// ---------------------------------------------------------------------------

const BRAND_RED = [227, 10, 20] as const // #E30A14 Crimson Red
const BRAND_PURPLE = [76, 37, 112] as const // #4C2570 Deep Purple
const BRAND_PURPLE_LINE = [76, 37, 110] as const
const CELL_BG = [255, 242, 204] as const // #FFF2CC Pale Cream Yellow
const FOOTER_LIME = [149, 191, 32] as const // #95BF20 Brand Green
const BORDER_COLOR = [0, 0, 0] as const
const BORDER_DASH = [0.72, 0.72] as const
const BORDER_LW = 0.72

function formatLessonPlanDate(dateStr?: string | null): string {
  if (!dateStr) return 'TUESDAY 15TH SEPTEMBER 2026'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr.toUpperCase()

  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
  const months = [
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
  ]

  const dayOfWeek = days[d.getDay()]
  const dayNum = d.getDate()
  const monthName = months[d.getMonth()]
  const year = d.getFullYear()

  let suffix = 'TH'
  if (dayNum % 10 === 1 && dayNum !== 11) suffix = 'ST'
  else if (dayNum % 10 === 2 && dayNum !== 12) suffix = 'ND'
  else if (dayNum % 10 === 3 && dayNum !== 13) suffix = 'RD'

  return `${dayOfWeek} ${dayNum}${suffix} ${monthName} ${year}`
}

function drawDottedLine(doc: jsPDF, x1: number, y1: number, x2: number, y2: number) {
  doc.saveGraphicsState()
  doc.setDrawColor(...BORDER_COLOR)
  doc.setLineWidth(BORDER_LW)
  doc.setLineDashPattern([...BORDER_DASH], 0)
  doc.line(x1, y1, x2, y2)
  doc.restoreGraphicsState()
}

function drawDottedBox(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(...CELL_BG)
  doc.rect(x, y, w, h, 'F')
  drawDottedLine(doc, x, y, x + w, y)
  drawDottedLine(doc, x, y + h, x + w, y + h)
  drawDottedLine(doc, x, y, x, y + h)
  drawDottedLine(doc, x + w, y, x + w, y + h)
}

function drawDottedCell(doc: jsPDF, x: number, y: number, w: number, h: number) {
  drawDottedBox(doc, x, y, w, h)
}

interface TeachingActivityStage {
  title: string
  text: string
}

function cleanStageText(text: string, fallback: string): string {
  const trimmed = (text || '').trim().replace(/^[-—•:\s.]+/, '').trim()
  if (!trimmed || /^[\.\,\-\;\:]+$/.test(trimmed)) {
    return fallback
  }
  return trimmed
}

function parseMainTeachingActivities(rawText?: string | null): TeachingActivityStage[] {
  const defaultStages: TeachingActivityStage[] = [
    {
      title: 'Starter (10 min):',
      text: 'Torch ON/OFF demo — “Computers only see two states; how do they show numbers, pictures and words?”; introduce the lesson question.'
    },
    {
      title: 'Exposition (15 min):',
      text: 'How computers represent data in binary (0,1) — patterns of switches; data measurement — bits, bytes, kilobytes and megabytes, making links to memory size and storage; version control — how digital tools keep versions of an artefact so we can navigate between them.'
    },
    {
      title: 'Learner activity (35 min):',
      text: 'Three stations — (a) binary counting cards: hold up 0/1 cards to build given numbers and write binary patterns; (b) data-size ladder: order bit, byte, kilobyte, megabyte and match files (photo, song, essay) to the size that fits; (c) version control: edit a shared document, open its version history, navigate between versions and restore an earlier one.'
    },
    {
      title: 'Plenary (10 min):',
      text: 'Exit ticket — read one binary pattern, answer one data-size question, and state one benefit of version control; preview Friday’s new unit on networks.'
    }
  ]

  if (!rawText || !rawText.trim()) {
    return defaultStages
  }

  const stageMap: Record<'starter' | 'exposition' | 'learner' | 'plenary', string> = {
    starter: '',
    exposition: '',
    learner: '',
    plenary: ''
  }

  const stageRegex = /(?:^|\n)\s*(?:•\s*)?(Starter(?:\s*Activity)?(?:\s*\([^)]*\))?:?|Exposition(?:\s*(?:Methods|methods)?(?:\s*\([^)]*\))?)?:?|Learner(?:s)?\s*(?:Activity|activity)?(?:\s*\([^)]*\))?:?|Plenary(?:\s*\([^)]*\))?:?|Main\s*Activity:?)/gi
  const matches = [...rawText.matchAll(stageRegex)]

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const lower = match[1].toLowerCase()
      const startIndex = match.index! + match[0].length
      const endIndex = i + 1 < matches.length ? matches[i + 1].index! : rawText.length
      const body = rawText.slice(startIndex, endIndex).trim().replace(/^[-—:\s]+/, '')

      if (lower.startsWith('starter')) {
        stageMap.starter = body
      } else if (lower.startsWith('exposition') || lower.startsWith('main activity')) {
        stageMap.exposition = body
      } else if (lower.startsWith('learner')) {
        stageMap.learner = body
      } else if (lower.startsWith('plenary')) {
        stageMap.plenary = body
      }
    }
  } else {
    // If no explicit stage labels found, check for bullet points or assign to learner activity
    const lines = rawText.split(/\n|•/).map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length >= 4) {
      stageMap.starter = lines[0]
      stageMap.exposition = lines[1]
      stageMap.learner = lines.slice(2, lines.length - 1).join('\n')
      stageMap.plenary = lines[lines.length - 1]
    } else {
      stageMap.learner = rawText.trim()
    }
  }

  // Canonical Cambridge 4-stage instructional model: ALWAYS guaranteed in order
  return [
    {
      title: 'Starter (10 min):',
      text: cleanStageText(stageMap.starter, 'Inquiry discussion, recap of prior knowledge, and introduction of the lesson inquiry question.')
    },
    {
      title: 'Exposition (15 min):',
      text: cleanStageText(stageMap.exposition, 'Direct instruction, concept explanation, key vocabulary, and guided teacher demonstration.')
    },
    {
      title: 'Learners Activity (35 min):',
      text: cleanStageText(stageMap.learner, 'Differentiated student tasks, collaborative problem-solving, and practical application exercises.')
    },
    {
      title: 'Plenary (10 min):',
      text: cleanStageText(stageMap.plenary, 'Exit ticket — review key learning objectives, student self-reflection, and preview next session.')
    }
  ]
}

function renderSingleLessonPlanPage(doc: jsPDF, plan: LessonPlan, school: School) {
  const pageW = 612
  const pageH = 792
  const leftM = 57.6
  const contentW = 496.8

  // 1. SCHOOL LOGO (TOP LEFT)
  const logoUrl = (school as any).logo_url || LEERA_LESSON_PLAN_LOGO_DATA_URL
  try {
    doc.addImage(logoUrl, 'PNG', 62.3, 47.6, 128.9, 48.0)
  } catch {
    try {
      doc.addImage(LEERA_LESSON_PLAN_LOGO_DATA_URL, 'PNG', 62.3, 47.6, 128.9, 48.0)
    } catch {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.setTextColor(...BRAND_RED)
      doc.text(school.name.toUpperCase(), 62.3, 75)
    }
  }

  // 2. HEADER RIGHT (Crimson red school name + Deep Purple LESSON PLAN title)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...BRAND_RED)
  doc.text(school.name.toUpperCase(), 554.4, 61.2, { align: 'right' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...BRAND_PURPLE)
  doc.text('LESSON PLAN', 554.4, 77.2, { align: 'right' })

  // 3. TWO-TONE ACCENT DIVIDER BAR (Red left 236.6pt, Purple right line)
  doc.setFillColor(...BRAND_RED)
  doc.rect(58.0, 95.6, 236.6, 5.2, 'F')

  doc.saveGraphicsState()
  doc.setDrawColor(...BRAND_PURPLE_LINE)
  doc.setLineWidth(2.25)
  doc.line(292.3, 99.4, 556.0, 99.4)
  doc.restoreGraphicsState()

  // 4. CONTEXT & METADATA SECTION TABLE
  let curY = 101.5
  const row1H = 13.5
  const row2H = 18.0
  const row3H = 26.5
  const totalContextH = row1H + row2H + row3H // 58.0 pt

  // Outer container box with dotted border - no internal grid lines
  drawDottedBox(doc, leftM, curY, contentW, totalContextH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(0, 0, 0)
  doc.text(`TEACHER: ${(plan.teacher_name || 'Teacher').toUpperCase()}`, leftM + 5.1, curY + 9.5)
  doc.text(`CLASS: ${(plan.class_name || 'Class').toUpperCase()}`, leftM + 248.4 + 5.5, curY + 9.5)

  doc.text(`SUBJECT: ${(plan.subject_name || 'Subject').toUpperCase()}`, leftM + 5.1, curY + row1H + 11.5)

  const dateFormatted = formatLessonPlanDate(plan.lesson_date)
  const timeFormatted = plan.start_time && plan.end_time
    ? `${plan.start_time} – ${plan.end_time}`
    : ''
  const periodOrTime = timeFormatted ? `(${timeFormatted})` : ''
  const dateFullStr = `DATE: ${dateFormatted} ${periodOrTime}`.trim()
  const dateLines = doc.splitTextToSize(dateFullStr, 248.4 - 11)
  if (dateLines.length > 1) {
    doc.text(dateLines[0], leftM + 248.4 + 5.5, curY + row1H + 7.5)
    doc.text(dateLines[1], leftM + 248.4 + 5.5, curY + row1H + 16.0)
  } else {
    doc.text(dateFullStr, leftM + 248.4 + 5.5, curY + row1H + 11.5)
  }

  const row3Top = curY + row1H + row2H
  const challengeStr = plan.challenge_title ? `${plan.challenge_title.toUpperCase()} — ` : ''
  const topicStr = plan.topic_title ? plan.topic_title.toUpperCase() : ''
  const subtopicStr = plan.subtopic_title ? ` (${plan.subtopic_title})` : ''
  let unitBody = (challengeStr + topicStr + subtopicStr).trim()
  if (!unitBody) unitBody = 'CURRICULUM UNIT'

  const unitFullStr = `UNIT/SUB-UNIT: ${unitBody}`
  const unitLines = doc.splitTextToSize(unitFullStr, 248.4 - 10.2)
  for (let u = 0; u < Math.min(unitLines.length, 2); u++) {
    doc.text(unitLines[u], leftM + 5.1, row3Top + 9.5 + u * 10.5)
  }

  doc.text('ATTENDANCE:', leftM + 248.4 + 5.5, row3Top + 16)
  const boysStr = plan.boys_attendance != null ? ` ${plan.boys_attendance}` : ''
  const girlsStr = plan.girls_attendance != null ? ` ${plan.girls_attendance}` : ''
  doc.text(`BOYS:${boysStr}`, leftM + 248.4 + 82.8 + 5.5, row3Top + 9.5)
  doc.text(`GIRLS:${girlsStr}`, leftM + 248.4 + 82.8 + 5.5, row3Top + 20.0)

  curY += totalContextH + 5.0

  // 5. RESOURCES SECTION
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BRAND_PURPLE)
  doc.text('RESOURCES', leftM, curY + 6.5)
  curY += 9.0

  let userResources: string[] = []
  if (plan.resources && plan.resources.trim()) {
    userResources = plan.resources
      .split(/\n|•|;/)
      .map(r => r.trim())
      .filter(r => r.length > 0)
  }
  const defaultLeft = ['Lesson Notes', 'Projector', 'Laptop']
  const defaultRight = ['Learner’s Book', 'Teacher’s Resource', 'Whiteboard/marker']

  const resColLeft: string[] = []
  const resColRight: string[] = []
  for (let i = 0; i < 3; i++) {
    resColLeft.push(userResources[i * 2] || defaultLeft[i])
    resColRight.push(userResources[i * 2 + 1] || defaultRight[i])
  }

  const resRowH = 11.0
  const totalResH = 3 * resRowH // 33.0 pt
  drawDottedBox(doc, leftM, curY, contentW, totalResH)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.0)
  doc.setTextColor(0, 0, 0)

  for (let r = 0; r < 3; r++) {
    const textY = curY + 8.5 + r * resRowH
    doc.text(`• ${resColLeft[r].replace(/^•\s*/, '')}`, leftM + 5.1, textY)
    doc.text(`• ${resColRight[r].replace(/^•\s*/, '')}`, leftM + 248.4 + 5.5, textY)
  }

  curY += totalResH + 5.0

  // 6. LEARNING OBJECTIVES SECTION
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BRAND_PURPLE)
  doc.text('LEARNING OBJECTIVES', leftM, curY + 6.5)
  curY += 9.0

  const loIntroH = 11.0
  const objectives = plan.objectives || []
  const loList: string[] = []
  if (objectives.length > 0) {
    objectives.forEach(o => {
      const codePart = o.code_snapshot ? `${o.code_snapshot}: ` : ''
      loList.push(`• ${codePart}${o.text_snapshot}`)
    })
  } else {
    loList.push('• General curriculum learning objectives and skills for this lesson.')
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.0)
  const loItemWraps = loList.map(loText => {
    const wrapped = doc.splitTextToSize(loText, contentW - 10.2)
    const h = wrapped.length * 9.6 + 1.5
    return { wrapped, h }
  })

  const totalLoH = loIntroH + loItemWraps.reduce((sum, item) => sum + item.h, 0) + 2.0
  drawDottedBox(doc, leftM, curY, contentW, totalLoH)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.0)
  doc.setTextColor(0, 0, 0)
  doc.text('By the end of this lesson, learners should be able to:', leftM + 5.1, curY + 8.5)

  let loY = curY + loIntroH
  for (const item of loItemWraps) {
    for (let l = 0; l < item.wrapped.length; l++) {
      doc.text(item.wrapped[l], leftM + 5.1, loY + 8.0 + l * 9.6)
    }
    loY += item.h
  }

  curY += totalLoH + 5.0

  // 7. MAIN TEACHING ACTIVITIES & INQUIRY SECTION (Always 4 stages: Starter, Exposition, Learners Activity, Plenary)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BRAND_PURPLE)
  doc.text('MAIN TEACHING ACTIVITIES & INQUIRY', leftM, curY + 6.5)
  curY += 9.0

  const activities = parseMainTeachingActivities(plan.main_teaching_activity)
  const preparedStages = activities.map(act => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.0)
    const titleW = doc.getTextWidth(act.title) + 4.0

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.0)
    const firstLineAvailW = contentW - 13.3 - titleW - 5.1

    // Split words to place the first chunk inline with the bold title
    const allWords = act.text.replace(/\r\n/g, '\n').split(/\s+/).filter(Boolean)
    let firstLine = ''
    let wordIdx = 0
    while (wordIdx < allWords.length) {
      const candidate = firstLine ? `${firstLine} ${allWords[wordIdx]}` : allWords[wordIdx]
      if (doc.getTextWidth(candidate) <= firstLineAvailW) {
        firstLine = candidate
        wordIdx++
      } else {
        break
      }
    }
    const remainingText = allWords.slice(wordIdx).join(' ')
    const restLines = remainingText ? doc.splitTextToSize(remainingText, contentW - 18.4) : []
    const totalLines = (firstLine ? 1 : 0) + restLines.length
    const actH = Math.max(14.0, totalLines * 9.6 + 3.0)
    return { act, titleW, firstLine, restLines, actH }
  })

  const totalActH = preparedStages.reduce((sum, s) => sum + s.actH, 0) + 2.0
  drawDottedBox(doc, leftM, curY, contentW, totalActH)

  let stageY = curY + 2.0
  for (const s of preparedStages) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.0)
    doc.setTextColor(0, 0, 0)
    doc.text('•', leftM + 5.1, stageY + 8.5)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...BRAND_PURPLE)
    doc.text(s.act.title, leftM + 13.3, stageY + 8.5)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0, 0, 0)
    if (s.firstLine) {
      doc.text(s.firstLine, leftM + 13.3 + s.titleW, stageY + 8.5)
    }

    for (let l = 0; l < s.restLines.length; l++) {
      doc.text(s.restLines[l], leftM + 13.3, stageY + 8.5 + (l + 1) * 9.6)
    }

    stageY += s.actH
  }

  curY += totalActH + 5.0

  // 8. ASSESSMENT IDEAS SECTION
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BRAND_PURPLE)
  doc.text('ASSESMENT IDEAS', leftM, curY + 6.5)
  curY += 9.0

  let assessItems: string[] = []
  if (plan.assessment_ideas && plan.assessment_ideas.trim()) {
    assessItems = plan.assessment_ideas
      .split(/\n|•|;/)
      .map(a => a.trim().replace(/^[-—•:\s.]+/, '').trim())
      .filter(a => a.length > 0)
  }
  if (assessItems.length === 0) {
    assessItems = [
      'Marked activity sheets and binary counting cards.',
      'Completed data-size ladder and file-matching exercise.',
      'Exit ticket checked and recorded.'
    ]
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.0)
  const wrappedAssessItems = assessItems.map(item => {
    const lines = doc.splitTextToSize(`• ${item}`, contentW - 10.2)
    const h = lines.length * 9.6 + 1.5
    return { lines, h }
  })
  const totalAssessH = Math.max(22.0, wrappedAssessItems.reduce((sum, it) => sum + it.h, 0) + 2.0)
  drawDottedBox(doc, leftM, curY, contentW, totalAssessH)

  let aY = curY + 8.5
  for (const it of wrappedAssessItems) {
    for (let l = 0; l < it.lines.length; l++) {
      doc.text(it.lines[l], leftM + 5.1, aY)
      aY += 9.6
    }
  }

  curY += totalAssessH + 5.0

  // 9. NOTES/REMARKS SECTION
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...BRAND_PURPLE)
  doc.text('NOTES/REMARKS', leftM, curY + 6.5)
  curY += 9.0

  const footerTop = 735.4
  // Notes/Remarks box has a clean, standard height (28pt) capped at max 38pt if remarks exist
  let notesH = 28.0
  if (plan.reflection_remarks && plan.reflection_remarks.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.0)
    const remarksWrapped = doc.splitTextToSize(plan.reflection_remarks, contentW - 10.2)
    notesH = Math.min(38.0, Math.max(28.0, remarksWrapped.length * 9.6 + 6.0))
  }
  // Ensure it never collides with footer
  notesH = Math.min(notesH, Math.max(16.0, footerTop - curY - 6.0))

  drawDottedBox(doc, leftM, curY, contentW, notesH)
  if (plan.reflection_remarks && plan.reflection_remarks.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.8)
    doc.setTextColor(0, 0, 0)
    const remarksWrapped = doc.splitTextToSize(plan.reflection_remarks, contentW - 10.2)
    const maxRemarksLines = Math.floor((notesH - 6.0) / 9.2)
    for (let r = 0; r < Math.min(remarksWrapped.length, maxRemarksLines); r++) {
      doc.text(remarksWrapped[r], leftM + 5.1, curY + 8.0 + r * 9.2)
    }
  }

  // 10. BOTTOM BRAND GREEN FOOTER BAR
  const footerH = 20.7
  doc.setFillColor(...FOOTER_LIME)
  doc.rect(0, footerTop, pageW, footerH, 'F')

  const year = plan.lesson_date ? new Date(plan.lesson_date).getFullYear() : new Date().getFullYear()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  doc.text(`© ${school.name.toUpperCase()} - ${year}`, pageW / 2, footerTop + 13.1, { align: 'center' })
}

/**
 * Generates Lesson Plan PDF matching the exact verbatim structure, colors,
 * arrangement, and school logo placement of LIS_YEAR_5_COMPUTING_WEEK_4_2026-2027.pdf.
 * Supports both single LessonPlan and array of LessonPlans (1 page per lesson).
 */
export async function generateLessonPlanPdf(
  planOrPlans: LessonPlan | LessonPlan[],
  school: School
): Promise<jsPDF> {
  const plans = Array.isArray(planOrPlans) ? planOrPlans : [planOrPlans]
  const doc = new jsPDF({ unit: 'pt', format: [612, 792], orientation: 'portrait' })

  plans.forEach((plan, idx) => {
    if (idx > 0) {
      doc.addPage([612, 792], 'portrait')
    }
    renderSingleLessonPlanPage(doc, plan, school)
  })

  return doc
}

