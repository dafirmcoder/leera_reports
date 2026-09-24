import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { LessonPlan, School, WorkPlan } from './types'

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

/**
 * Generates Lesson Plan PDF matching CAMBRIFY's exact portrait layout with two-tone header bar.
 */
export async function generateLessonPlanPdf(plan: LessonPlan, school: School): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const pageW = 210
  const pageH = 297
  const leftM = 14
  const rightM = 14
  const usableW = pageW - leftM - rightM // 182mm

  // 1. TOP HEADER (School Name / Logo on left, Crimson red school + Deep Indigo title on right)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42) // #0f172a
  doc.text(school.name.toUpperCase(), leftM, 13)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7.5)
  doc.setTextColor(11, 79, 138) // #0B4F8A Cambridge blue
  doc.text('Cambridge International School', leftM, 17)

  // Header Right
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(200, 16, 46) // #C8102E Crimson Red
  doc.text(school.name.toUpperCase(), pageW - rightM, 13, { align: 'right' })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(30, 27, 75) // #1E1B4B Deep Indigo
  doc.text('LESSON PLAN', pageW - rightM, 19, { align: 'right' })

  // 2. TWO-TONE ACCENT DIVIDER BAR (Red left 80mm, Indigo right 102mm)
  const dividerY = 22
  doc.setDrawColor(211, 18, 42) // #D3122A Red
  doc.setLineWidth(1.2)
  doc.line(leftM, dividerY, leftM + 80, dividerY)

  doc.setDrawColor(46, 16, 101) // #2E1065 Indigo
  doc.setLineWidth(0.8)
  doc.line(leftM + 80, dividerY, pageW - rightM, dividerY)

  // 3. CONTEXT & METADATA SECTION TABLE
  const timeSlot = plan.start_time && plan.end_time ? `${plan.start_time} – ${plan.end_time}` : 'Scheduled Lesson'
  const attendanceStr = plan.boys_attendance != null || plan.girls_attendance != null
    ? `Boys: ${plan.boys_attendance ?? 0} | Girls: ${plan.girls_attendance ?? 0} | Total: ${(plan.boys_attendance ?? 0) + (plan.girls_attendance ?? 0)}`
    : 'Pending Delivery'

  const metaRows = [
    [
      { content: 'Subject:', styles: { fontStyle: 'bold' as const, cellWidth: 26 } },
      { content: plan.subject_name || 'Subject', styles: { cellWidth: 65 } },
      { content: 'Class / Stage:', styles: { fontStyle: 'bold' as const, cellWidth: 28 } },
      { content: plan.class_name || 'Class', styles: { cellWidth: 63 } }
    ],
    [
      { content: 'Date & Time:', styles: { fontStyle: 'bold' as const } },
      { content: `${new Date(plan.lesson_date).toLocaleDateString()} (${timeSlot})` },
      { content: 'Teacher:', styles: { fontStyle: 'bold' as const } },
      { content: plan.teacher_name || 'Teacher' }
    ],
    [
      { content: plan.challenge_title ? 'Challenge:' : 'Topic / Unit:', styles: { fontStyle: 'bold' as const } },
      { content: plan.challenge_title ? `${plan.challenge_title} — ${plan.topic_title || ''}` : (plan.topic_title || 'Unit'), colSpan: 3 }
    ],
    [
      { content: 'Attendance:', styles: { fontStyle: 'bold' as const } },
      { content: attendanceStr, colSpan: 3 }
    ]
  ]

  autoTable(doc, {
    startY: dividerY + 3,
    body: metaRows,
    theme: 'grid',
    margin: { left: leftM, right: rightM },
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.2
    }
  })

  // 4. LEARNING OBJECTIVES SECTION
  const currentY = (doc as any).lastAutoTable.finalY + 4
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(11, 79, 138)
  doc.text('1. LEARNING OBJECTIVES', leftM, currentY)

  const objRows: any[] = []
  const objectives = plan.objectives || []
  if (objectives.length > 0) {
    objectives.forEach((o) => {
      objRows.push([o.code_snapshot, o.text_snapshot])
    })
  } else {
    objRows.push(['LO-01', 'General curriculum learning objectives and skills for this lesson.'])
  }

  autoTable(doc, {
    startY: currentY + 1.5,
    head: [['Code', 'Objective & Key Skills']],
    body: objRows,
    theme: 'grid',
    margin: { left: leftM, right: rightM },
    headStyles: {
      fillColor: [11, 79, 138],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      cellPadding: 1.8
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.2
    },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: 'bold' },
      1: { cellWidth: usableW - 28 }
    }
  })

  // 5. INSTRUCTIONAL PROCEDURES & PEDAGOGY
  const procY = (doc as any).lastAutoTable.finalY + 4
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(11, 79, 138)
  doc.text('2. INSTRUCTIONAL PROCEDURES & ACTIVITIES', leftM, procY)

  const procRows = [
    [
      { content: 'Main Teaching Activities:\n(Teacher input, student tasks, inquiry)', styles: { fontStyle: 'bold' as const, cellWidth: 48 } },
      { content: plan.main_teaching_activity || 'Interactive discussion, hands-on inquiry, and collaborative tasks.' }
    ],
    [
      { content: 'Assessment Ideas & Plenary:\n(Formative checks, exit tickets)', styles: { fontStyle: 'bold' as const } },
      { content: plan.assessment_ideas || 'Quick quiz, peer check, and recap of learning objectives.' }
    ],
    [
      { content: 'Resources & Materials:', styles: { fontStyle: 'bold' as const } },
      { content: plan.resources || 'Coursebook, worksheets, digital slides/devices.' }
    ],
    [
      { content: 'Differentiation & Support:', styles: { fontStyle: 'bold' as const } },
      { content: plan.differentiation || 'Scaffolded prompts for developing learners; extension challenges for advanced learners.' }
    ]
  ]

  autoTable(doc, {
    startY: procY + 1.5,
    body: procRows,
    theme: 'grid',
    margin: { left: leftM, right: rightM },
    styles: {
      fontSize: 7.5,
      cellPadding: 2.5,
      lineColor: [203, 213, 225],
      lineWidth: 0.2
    }
  })

  // 6. POST-LESSON REFLECTIONS & LEADERSHIP REVIEW
  const refY = (doc as any).lastAutoTable.finalY + 4
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(11, 79, 138)
  doc.text('3. POST-LESSON DELIVERY & EVALUATION', leftM, refY)

  const refRows = [
    [
      { content: 'Teacher Reflections & Evaluation:\n(Student engagement, areas for review)', styles: { fontStyle: 'bold' as const, cellWidth: 48 } },
      { content: plan.reflection_remarks || 'To be completed after lesson delivery.' }
    ],
    [
      { content: 'Review Status & Comments:', styles: { fontStyle: 'bold' as const } },
      { content: `Status: ${plan.status.toUpperCase()}${plan.review_comment ? ` — Note: ${plan.review_comment}` : ''}` }
    ]
  ]

  autoTable(doc, {
    startY: refY + 1.5,
    body: refRows,
    theme: 'grid',
    margin: { left: leftM, right: rightM, bottom: 15 },
    styles: {
      fontSize: 7.5,
      cellPadding: 2.5,
      lineColor: [203, 213, 225],
      lineWidth: 0.2
    }
  })

  // 7. BOTTOM BRAND GREEN FOOTER BAR
  const footerH = 8
  doc.setFillColor(112, 176, 32) // #70B020 Brand Green footer bar matching CAMBRIFY
  doc.rect(0, pageH - footerH, pageW, footerH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(255, 255, 255)
  doc.text(`© ${school.name.toUpperCase()} · CAMBRIDGE INTERNATIONAL CURRICULUM`, pageW / 2, pageH - 2.5, { align: 'center' })

  return doc
}
