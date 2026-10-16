import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'
import { buildExamReport, buildReport, EXAM_GRADING_SCALE, fmtDate, fmtPct, formatRollNo, getExamGradeInfo } from './report'
import type { School, Student, StudentReportRow, UnitTest } from './types'

// ---------------------------------------------------------------------------
// Report -> PDF. Mirrors the on-screen report sheet:
//   logos + red school-name band, "END OF UNIT TEST REPORT" band, info block,
//   tabulated marks, subject averages, blank rows between subjects,
//   overall average, green footer pinned to the bottom.
// ---------------------------------------------------------------------------

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 12

let schoolLogoData: string | null = null
let cambridgeLogoData: string | null = null

async function loadImageDataUrl(path: string): Promise<string> {
  const res = await fetch(path)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return 'data:image/png;base64,' + btoa(binary)
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

function pct(score: number, max: number): string {
  return `${((score / (max || 1)) * 100).toFixed(1)}%`
}

export function sanitizePdfText(text: string): string {
  if (!text) return ''
  return text
    .replace(/\u0130/g, 'I') // Capital dotted I (İ)
    .replace(/\u0131/g, 'i') // Small dotless i (ı)
    .replace(/\u015E/g, 'S') // Ş
    .replace(/\u015F/g, 's') // ş
    .replace(/\u011E/g, 'G') // Ğ
    .replace(/\u011F/g, 'g') // ğ
    .replace(/\u00C7/g, 'C') // Ç
    .replace(/\u00E7/g, 'c') // ç
    .replace(/\u00D6/g, 'O') // Ö
    .replace(/\u00F6/g, 'o') // ö
    .replace(/\u00DC/g, 'U') // Ü
    .replace(/\u00FC/g, 'u') // ü
}

export interface PdfContext {
  student: Student
  school: School
  className: string
  teacherName: string
  rows: StudentReportRow[]
  filterNotice?: string
  reportTitle?: string
}

export interface ExamPdfContext {
  student: Student
  school: School
  className: string
  teacherName: string
  rows: StudentReportRow[]
  learnerSubjects?: string[]
  selectedExamTitle?: string
  filterNotice?: string
}

/**
 * Shared Header & Student Info Block used by both End of Unit Test Reports
 * and Independent School Exam Reports. Returns the Y coordinate where the table starts.
 */
async function drawReportHeader(
  doc: jsPDF,
  opts: {
    student: Student
    school: School
    className: string
    teacherName: string
    titleBandText: string
    filterNotice?: string
    examName?: string
    subjectsLabel?: string
  }
): Promise<number> {
  const { student, school, className, teacherName, titleBandText, filterNotice, examName, subjectsLabel } = opts

  const schoolLogoW = 25.74
  const schoolLogoH = 22 // Height matches .logo-left { height: 22mm }
  const schoolLogoX = MARGIN
  const schoolLogoY = 10

  const cambridgeLogoW = 44.05
  const cambridgeLogoH = 7.4 // Height matches .logo-right { height: 7.4mm }
  const cambridgeLogoX = PAGE_W - MARGIN - cambridgeLogoW
  const cambridgeLogoY = 12 // Matches .logo-right { top: 2mm } relative to content top (10mm)

  if (school.show_school_logo) {
    if (!schoolLogoData) schoolLogoData = await loadImageDataUrl('/logos/school-logo.png')
    doc.addImage(schoolLogoData, 'PNG', schoolLogoX, schoolLogoY, schoolLogoW, schoolLogoH)
  }
  if (school.show_cambridge_logo) {
    if (!cambridgeLogoData) cambridgeLogoData = await loadImageDataUrl('/logos/cambridge-logo.png')
    doc.addImage(cambridgeLogoData, 'PNG', cambridgeLogoX, cambridgeLogoY, cambridgeLogoW, cambridgeLogoH)
  }

  // Determine available horizontal space for the center school title so it NEVER collides with logos
  const logoGap = 4
  const leftBound = school.show_school_logo ? schoolLogoX + schoolLogoW + logoGap : MARGIN
  const rightBound = school.show_cambridge_logo ? cambridgeLogoX - logoGap : PAGE_W - MARGIN

  // Keep title centered on page, capped to available safe clearance and max 96mm (as in .report-title-block)
  const centerX = PAGE_W / 2
  const maxAllowedHalfW = Math.min(centerX - leftBound, rightBound - centerX)
  const maxBandW = Math.min(96, Math.max(50, maxAllowedHalfW * 2))

  // School name — uppercase, auto-scaled bold font
  const name = school.name.toUpperCase()
  let fontSize = 13.5
  doc.setFont('helvetica', 'bold')
  while (fontSize > 8.5) {
    doc.setFontSize(fontSize)
    if (doc.getTextWidth(name) + 8 <= maxBandW) break
    fontSize -= 0.5
  }

  const nameW = doc.getTextWidth(name)
  const bandW = Math.min(nameW + 8, maxBandW)
  const bandH = 7.5
  const bandX = (PAGE_W - bandW) / 2
  const bandY = 12.5
  const [rr, rg, rb] = hexToRgb('#C00000')
  doc.setFillColor(rr, rg, rb)
  doc.roundedRect(bandX, bandY, bandW, bandH, 1.2, 1.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text(name, PAGE_W / 2, bandY + bandH / 2 + 0.3, { align: 'center', baseline: 'middle' })

  let headerContentBottom = bandY + bandH
  if (school.motto) {
    const mottoY = headerContentBottom + 3.8
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(107, 127, 138)
    doc.text(school.motto, PAGE_W / 2, mottoY, { align: 'center' })
    headerContentBottom = mottoY + 1.5
  }

  // Calculate bottom of all header content so the report band never slices through the logos
  let headerBottom = Math.max(headerContentBottom, schoolLogoY + schoolLogoH)
  if (school.show_cambridge_logo) {
    headerBottom = Math.max(headerBottom, cambridgeLogoY + cambridgeLogoH)
  }

  let y = headerBottom + 3.5
  const band2H = 7.5
  doc.setFillColor(31, 78, 95) // var(--teal) #1F4E5F
  doc.roundedRect(MARGIN, y, PAGE_W - 2 * MARGIN, band2H, 1.2, 1.2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text(sanitizePdfText(titleBandText), PAGE_W / 2, y + band2H / 2 + 0.3, { align: 'center', baseline: 'middle' })
  y += band2H + 3.5

  // ---- Structured 2-Row x 4-Column Learner Details Grid (No Grid Lines) -----
  const printed = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const rollVal = formatRollNo(student.roll_no || student.admission_no) || '—'
  const semVal = school.semester || school.term || '—'
  const subjVal = subjectsLabel || 'All Class Subjects'

  const colWidths = [68, 40, 36, 42] // sum = 186mm
  const rowH = 9.5
  const hasMetaStrip = Boolean(examName || filterNotice)
  const metaStripH = hasMetaStrip ? 5.8 : 0
  const totalCardH = rowH * 2 + metaStripH

  const fitCellText = (txt: string, maxW: number, fontSizePt: number): string => {
    const clean = sanitizePdfText(txt || '—')
    doc.setFontSize(fontSizePt)
    if (doc.getTextWidth(clean) <= maxW) return clean
    let cut = clean
    while (cut.length > 3 && doc.getTextWidth(`${cut}...`) > maxW) {
      cut = cut.slice(0, -1)
    }
    return `${cut}...`
  }

  const row1Cells = [
    { label: 'LEARNER NAME', value: student.full_name, isName: true },
    { label: 'ROLL NUMBER', value: rollVal, isName: false },
    { label: 'CLASS', value: className || '—', isName: false },
    { label: 'ACADEMIC YEAR', value: school.academic_year || '—', isName: false }
  ]

  const row2Cells = [
    { label: 'HOMEROOM TEACHER', value: teacherName || '—', isName: false },
    { label: 'SUBJECTS', value: subjVal, isName: false },
    { label: 'SEMESTER / TERM', value: semVal, isName: false },
    { label: 'DATE PRINTED', value: printed, isName: false }
  ]

  const drawGridRow = (cells: typeof row1Cells, rowTopY: number) => {
    let cx = MARGIN
    cells.forEach((cell, idx) => {
      const cw = colWidths[idx]
      const padX = 1.0
      // Uppercase micro-label
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.6)
      doc.setTextColor(31, 78, 95) // var(--teal)
      doc.text(cell.label, cx + padX, rowTopY + 3.2)

      // Bold value
      const valFontSize = cell.isName ? 9.6 : 9.1
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(valFontSize)
      doc.setTextColor(15, 23, 42) // #0f172a
      const fitted = fitCellText(cell.value, cw - padX * 2, valFontSize)
      doc.text(fitted, cx + padX, rowTopY + 7.5)

      cx += cw
    })
  }

  drawGridRow(row1Cells, y)
  drawGridRow(row2Cells, y + rowH)

  if (hasMetaStrip) {
    const stripY = y + rowH * 2
    let mx = MARGIN + 1.0
    const baselineY = stripY + 4.2
    if (examName) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.2)
      doc.setTextColor(31, 78, 95)
      const lbl = 'EXAMINATION: '
      doc.text(lbl, mx, baselineY)
      mx += doc.getTextWidth(lbl)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.4)
      doc.setTextColor(15, 23, 42)
      const val = sanitizePdfText(examName)
      doc.text(val, mx, baselineY)
      mx += doc.getTextWidth(val) + 8
    }
    if (filterNotice) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.2)
      doc.setTextColor(31, 78, 95)
      const lbl = 'SCOPE: '
      doc.text(lbl, mx, baselineY)
      mx += doc.getTextWidth(lbl)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.2)
      doc.setTextColor(15, 23, 42)
      const val = sanitizePdfText(filterNotice)
      doc.text(val, mx, baselineY)
    }
  }

  return y + totalCardH + 3.5
}

export async function generateStudentPdf(ctx: PdfContext): Promise<jsPDF> {
  const { student, school, className, teacherName, rows } = ctx
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  const isAllExam = rows.length > 0 && rows.every((r) => r.assessment_type === 'exam' || r.assessment_type === 'midterm')
  const titleBandText = ctx.reportTitle || (isAllExam ? 'EXAM REPORT' : 'END OF UNIT TEST REPORT')

  // ---- table -----------------------------------------------------------------
  const report = buildReport(rows)
  const subjectsLabel = `${report.subjects.length} Subject${report.subjects.length === 1 ? '' : 's'}`

  const startY = await drawReportHeader(doc, {
    student,
    school,
    className,
    teacherName,
    titleBandText,
    filterNotice: ctx.filterNotice,
    subjectsLabel
  })

  const avgStyle = {
    fillColor: [221, 235, 241] as [number, number, number], // #ddebf1
    fontStyle: 'bold' as const,
    textColor: [31, 78, 95] as [number, number, number],
    halign: 'center' as const
  }

  const body: any[] = []
  report.subjects.forEach((s, idx) => {
    // rowSpan always includes the average row (shown for all subjects, even single-test)
    const rowSpan = s.rows.length + 1
    s.rows.forEach((r, ri) => {
      const cells: any[] = []
      if (ri === 0) {
        cells.push({
          content: s.name,
          rowSpan,
          styles: {
            fillColor: [234, 243, 248] as [number, number, number], // #eaf3f8
            textColor: [31, 78, 95] as [number, number, number],
            fontStyle: 'bold',
            halign: 'center',
            valign: 'middle',
            lineWidth: 0.25,
            lineColor: [195, 211, 220] as [number, number, number]
          }
        })
      }
      cells.push(
        r.title,
        fmtDate(r.test_date),
        r.score !== null && r.score !== undefined ? String(r.score) : '—',
        String(r.max_mark),
        r.score !== null && r.score !== undefined ? fmtPct((r.score / (r.max_mark || 1)) * 100) : '—'
      )
      body.push(cells)
    })
    // Subject Average row — always shown, even when there is only one test
    body.push([
      { content: 'Subject Average', colSpan: 2, styles: { ...avgStyle, halign: 'left' } },
      { content: String(s.totalScore), styles: avgStyle },
      { content: String(s.totalMax), styles: avgStyle },
      { content: fmtPct(s.average), styles: avgStyle }
    ])
    if (idx < report.subjects.length - 1) {
      body.push(['__SPACER__', '', '', '', '', ''])
    }
  })

  if (report.subjects.length > 0) {
    body.push([
      {
        content: `Overall Average: ${fmtPct(report.overall)}`,
        colSpan: 6,
        styles: { ...avgStyle, cellPadding: 2.8, halign: 'center' }
      }
    ])
  } else {
    body.push([
      {
        content: 'No end-of-unit tests recorded yet for this student.',
        colSpan: 6,
        styles: { textColor: [107, 127, 138], halign: 'center', cellPadding: 6 }
      }
    ])
  }

  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN, top: 20, bottom: 26 },
    head: [['Subject', 'Unit / Topic', 'Date', 'Score', 'Out of (Max)', 'Mark %']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
      textColor: [28, 43, 51],
      lineColor: [212, 221, 227], // matches #d4dde3
      lineWidth: 0.22,
      valign: 'middle'
    },
    headStyles: {
      fillColor: [31, 78, 95], // var(--teal)
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9.5,
      cellPadding: { top: 2.4, bottom: 2.4, left: 2.5, right: 2.5 }
    },
    columnStyles: {
      0: { cellWidth: 38, halign: 'center' },
      1: { cellWidth: 64, halign: 'left' },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 22, halign: 'center' }
    },
    didParseCell: (data) => {
      // Align headers exactly like onscreen: columns 0 and 1 left aligned, 2-5 centered
      if (data.section === 'head') {
        if (data.column.index === 0 || data.column.index === 1) {
          data.cell.styles.halign = 'left'
        } else {
          data.cell.styles.halign = 'center'
        }
      }

      // Format spacer rows between subjects
      const raw = data.row.raw as any[]
      if (data.section === 'body' && Array.isArray(raw) && raw[0] === '__SPACER__') {
        data.cell.styles.fillColor = [255, 255, 255]
        data.cell.styles.textColor = [255, 255, 255]
        data.cell.styles.lineColor = [255, 255, 255]
        data.cell.styles.lineWidth = 0
        data.cell.styles.cellPadding = { top: 1.0, bottom: 1.0, left: 0, right: 0 }
        data.cell.text = ['']
      }

      // Green text color starts at 65% (pass mark)
      if (data.section === 'body') {
        const textVal = data.cell.text?.[0] || ''
        if (textVal.startsWith('Overall Average:')) {
          const match = textVal.match(/(\d+(?:\.\d+)?)\s*%/)
          if (match && parseFloat(match[1]) >= 65) {
            data.cell.styles.textColor = [21, 128, 61] // #15803d
            data.cell.styles.fontStyle = 'bold'
          }
        } else if ((data.column.index === 5 || data.column.index === 4) && textVal.includes('%')) {
          const num = parseFloat(textVal.replace('%', ''))
          if (!isNaN(num) && num >= 65) {
            data.cell.styles.textColor = [21, 128, 61] // #15803d
            data.cell.styles.fontStyle = 'bold'
          }
        }
      }
    }
  })

  // Footer placement:
  // If the table extends near the very bottom margin (or fills the page), the footer becomes fixed
  // at the bottom on the first page, while following pages resume our prior styling (immediately after the table).
  const pageCount = doc.getNumberOfPages()
  const finalY = (doc as any).lastAutoTable?.finalY ?? (PAGE_H - MARGIN - 12)
  const fh = 8.5
  const fixedBottomY = PAGE_H - MARGIN - fh
  const bottomThreshold = 245 // near bottom margin threshold (mm)

  if (pageCount > 1) {
    // 1. First page (and intermediate full pages): table extended to bottom margin -> footer is fixed at bottom
    for (let p = 1; p < pageCount; p++) {
      doc.setPage(p)
      drawFooterAtY(doc, school, fixedBottomY)
    }
    // 2. Following/last page: resume prior styling immediately after the table
    doc.setPage(pageCount)
    let followingPageY = finalY + 5
    if (followingPageY > fixedBottomY) {
      followingPageY = fixedBottomY
    }
    drawFooterAtY(doc, school, followingPageY)
  } else {
    // Single page
    if (finalY >= bottomThreshold) {
      // Table extends near the very bottom margin -> fixed at the bottom of the first page
      drawFooterAtY(doc, school, fixedBottomY)
    } else {
      // Prior styling: immediately after the table and pushed downwards as table grows
      drawFooterAtY(doc, school, finalY + 5)
    }
  }

  return doc
}

function drawFooterAtY(doc: jsPDF, school: School, fy: number): void {
  const fh = 8.5
  const [fr, fg, fb] = hexToRgb(school.footer_color || '#1F8A5F')
  doc.setFillColor(fr, fg, fb)
  doc.roundedRect(MARGIN, fy, PAGE_W - 2 * MARGIN, fh, 1.2, 1.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(school.footer_text || '', PAGE_W / 2, fy + fh / 2 + 0.3, { align: 'center', baseline: 'middle' })
}

// ---------------------------------------------------------------------------
// Independent School Exam Report -> PDF
// Imports the End of Unit Tests header and footer structure, renders all
// subjects a learner is taking with Score, Grade, and Remarks columns styled
// with Color Psychology, displays the Grading System Scale below the table,
// and includes Academic Coordinator's Signature, Head of School's Signature,
// and a Square Box Official Stamp placeholder.
// ---------------------------------------------------------------------------

export async function generateStudentExamPdf(ctx: ExamPdfContext): Promise<jsPDF> {
  const { student, school, className, teacherName, rows, learnerSubjects = [], selectedExamTitle, filterNotice } = ctx
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  const examReport = buildExamReport({
    rows,
    learnerSubjects,
    selectedExamTitle
  })

  const activeExamLabel =
    selectedExamTitle && selectedExamTitle !== '__ALL_EXAMS__'
      ? selectedExamTitle
      : examReport.examTitle || 'School Examination'

  const titleBandText =
    selectedExamTitle && selectedExamTitle !== '__ALL_EXAMS__'
      ? `SCHOOL EXAM REPORT — ${selectedExamTitle.toUpperCase()}`
      : 'SCHOOL EXAM REPORT'

  const subjectsLabel = `${examReport.subjects.length} Subject${examReport.subjects.length === 1 ? '' : 's'}`

  const startY = await drawReportHeader(doc, {
    student,
    school,
    className,
    teacherName,
    titleBandText,
    examName: activeExamLabel,
    filterNotice,
    subjectsLabel
  })

  const body: any[] = []

  if (examReport.subjects.length === 0) {
    body.push([
      {
        content: 'No subjects or exam records found for this learner.',
        colSpan: 4,
        styles: { textColor: [107, 127, 138], halign: 'center', cellPadding: 6 }
      }
    ])
  } else {
    examReport.subjects.forEach((sub) => {
      const gInfo = sub.gradeInfo
      const hasScore = sub.score !== null && sub.score !== undefined

      body.push([
        {
          content: sanitizePdfText(sub.subjectName),
          styles: {
            fillColor: [234, 243, 248] as [number, number, number],
            textColor: [31, 78, 95] as [number, number, number],
            fontStyle: 'bold',
            halign: 'left'
          }
        },
        {
          content: hasScore ? fmtPct(sub.score!) : '—',
          styles: {
            halign: 'center',
            fontStyle: hasScore ? 'bold' : 'normal',
            textColor: gInfo ? gInfo.textRgb : ([100, 116, 139] as [number, number, number])
          }
        },
        {
          content: gInfo ? gInfo.grade : '—',
          styles: {
            halign: 'center',
            fontStyle: 'bold',
            fillColor: gInfo ? gInfo.bgRgb : ([248, 250, 252] as [number, number, number]),
            textColor: gInfo ? gInfo.textRgb : ([148, 163, 184] as [number, number, number])
          }
        },
        {
          content: gInfo ? gInfo.remark : '—',
          styles: {
            halign: 'center',
            fontStyle: 'bold',
            fillColor: gInfo ? gInfo.bgRgb : ([248, 250, 252] as [number, number, number]),
            textColor: gInfo ? gInfo.textRgb : ([148, 163, 184] as [number, number, number])
          }
        }
      ])
    })

    const ovGrade = examReport.overallGrade
    body.push([
      {
        content: `Overall Exam Average (${examReport.scoredCount} / ${examReport.totalSubjects} Subjects)`,
        styles: {
          fillColor: [221, 235, 241] as [number, number, number],
          textColor: [31, 78, 95] as [number, number, number],
          fontStyle: 'bold',
          halign: 'left',
          cellPadding: 2.6
        }
      },
      {
        content: examReport.overallAverage !== null ? fmtPct(examReport.overallAverage) : '—',
        styles: {
          fillColor: [221, 235, 241] as [number, number, number],
          textColor: ovGrade ? ovGrade.textRgb : ([31, 78, 95] as [number, number, number]),
          fontStyle: 'bold',
          halign: 'center',
          cellPadding: 2.6
        }
      },
      {
        content: ovGrade ? ovGrade.grade : '—',
        styles: {
          fillColor: ovGrade ? ovGrade.bgRgb : ([221, 235, 241] as [number, number, number]),
          textColor: ovGrade ? ovGrade.textRgb : ([31, 78, 95] as [number, number, number]),
          fontStyle: 'bold',
          halign: 'center',
          cellPadding: 2.6
        }
      },
      {
        content: ovGrade ? ovGrade.remark : '—',
        styles: {
          fillColor: ovGrade ? ovGrade.bgRgb : ([221, 235, 241] as [number, number, number]),
          textColor: ovGrade ? ovGrade.textRgb : ([31, 78, 95] as [number, number, number]),
          fontStyle: 'bold',
          halign: 'center',
          cellPadding: 2.6
        }
      }
    ])
  }

  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN, top: 18, bottom: 22 },
    head: [['Subject', 'Score', 'Grade', 'Remarks']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9.2,
      cellPadding: { top: 2.0, bottom: 2.0, left: 2.8, right: 2.8 },
      textColor: [28, 43, 51],
      lineColor: [212, 221, 227],
      lineWidth: 0.22,
      valign: 'middle'
    },
    headStyles: {
      fillColor: [31, 78, 95],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9.5,
      cellPadding: { top: 2.3, bottom: 2.3, left: 2.8, right: 2.8 }
    },
    columnStyles: {
      0: { cellWidth: 74, halign: 'left' },
      1: { cellWidth: 28, halign: 'center' },
      2: { cellWidth: 26, halign: 'center' },
      3: { cellWidth: 58, halign: 'center' }
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        data.cell.styles.halign = data.column.index === 0 ? 'left' : 'center'
      }
    }
  })

  const tableEndPage = doc.getNumberOfPages()
  doc.setPage(tableEndPage)
  let curY = ((doc as any).lastAutoTable?.finalY ?? startY + 40) + 4

  // Ensure enough room for Grading Scale (21mm) + Signatures & Square Stamp (32mm) + Footer (10mm) = 63mm
  const fh = 8.5
  const fixedBottomY = PAGE_H - MARGIN - fh
  if (curY + 56 > fixedBottomY) {
    drawFooterAtY(doc, school, fixedBottomY)
    doc.addPage()
    curY = 14
  }

  // ---- Grading System Scale Box below the Scores Table ---------------------
  const boxW = PAGE_W - 2 * MARGIN // 186mm
  const scaleBoxH = 20.5
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.25)
  doc.roundedRect(MARGIN, curY, boxW, scaleBoxH, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.8)
  doc.setTextColor(31, 78, 95)
  doc.text('GRADING SYSTEM SCALE & PERFORMANCE DESCRIPTORS', PAGE_W / 2, curY + 3.8, {
    align: 'center'
  })

  const innerPadX = 2
  const gapX = 1.4
  const cardCount = EXAM_GRADING_SCALE.length // 7
  const cardW = (boxW - 2 * innerPadX - (cardCount - 1) * gapX) / cardCount
  const cardH = 13.5
  const cardY = curY + 5.5

  EXAM_GRADING_SCALE.forEach((item, idx) => {
    const cx = MARGIN + innerPadX + idx * (cardW + gapX)
    const centerCardX = cx + cardW / 2

    // Card background & border using Color Psychology
    doc.setFillColor(item.bgRgb[0], item.bgRgb[1], item.bgRgb[2])
    doc.setDrawColor(item.borderRgb[0], item.borderRgb[1], item.borderRgb[2])
    doc.setLineWidth(0.25)
    doc.roundedRect(cx, cardY, cardW, cardH, 1.0, 1.0, 'FD')

    // Grade Letter
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(item.textRgb[0], item.textRgb[1], item.textRgb[2])
    doc.text(item.grade, centerCardX, cardY + 3.6, { align: 'center' })

    // Range (e.g. 90-100, 80-90)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.4)
    doc.text(item.rangeLabel, centerCardX, cardY + 6.9, { align: 'center' })

    // Remark (split onto 2 lines if long like BASIC UNDERSTANDING / DEVELOPING UNDERSTANDING / NEEDS IMPROVEMENT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(5.4)
    const words = item.remark.split(' ')
    if (words.length > 1 && item.remark.length > 10) {
      doc.text(words[0], centerCardX, cardY + 9.8, { align: 'center' })
      doc.text(words.slice(1).join(' '), centerCardX, cardY + 12.1, { align: 'center' })
    } else {
      doc.text(item.remark, centerCardX, cardY + 10.8, { align: 'center' })
    }
  })

  curY += scaleBoxH + 4.5

  // ---- Signatures (Left Stacked) & Official Stamp Square Box (Right) -------
  const sigLineW = 72
  const sigLeftX = MARGIN + 2

  // 1. Academic Coordinator's Signature (First on the Left)
  const coordLineY = curY + 11
  doc.setDrawColor(30, 41, 59)
  doc.setLineWidth(0.35)
  doc.line(sigLeftX, coordLineY, sigLeftX + sigLineW, coordLineY)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.8)
  doc.setTextColor(31, 78, 95)
  doc.text("Academic Coordinator's Signature", sigLeftX, coordLineY + 4.2)

  // 2. Head of School's Signature (Below Academic Coordinator on the Left)
  const headLineY = coordLineY + 17
  doc.setDrawColor(30, 41, 59)
  doc.setLineWidth(0.35)
  doc.line(sigLeftX, headLineY, sigLeftX + sigLineW, headLineY)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.8)
  doc.setTextColor(31, 78, 95)
  doc.text("Head of School's Signature", sigLeftX, headLineY + 4.2)

  // 3. Official Stamp Placeholder "Square Box" (On the Right)
  const stampSize = 30 // 30mm x 30mm true square box
  const stampX = PAGE_W - MARGIN - stampSize - 2
  const stampY = curY + 2

  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(71, 85, 105)
  doc.setLineWidth(0.35)
  doc.rect(stampX, stampY, stampSize, stampSize, 'FD')

  // Subtle inner square border
  doc.setDrawColor(148, 163, 184)
  doc.setLineWidth(0.2)
  doc.rect(stampX + 1.2, stampY + 1.2, stampSize - 2.4, stampSize - 2.4, 'S')

  const stampCenterX = stampX + stampSize / 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.2)
  doc.setTextColor(148, 163, 184)
  doc.text('OFFICIAL', stampCenterX, stampY + stampSize / 2 - 1.2, { align: 'center' })
  doc.text('STAMP', stampCenterX, stampY + stampSize / 2 + 2.2, { align: 'center' })

  const endorsementBottomY = Math.max(headLineY + 7, stampY + stampSize + 4)
  const footerY = Math.max(endorsementBottomY, fixedBottomY)
  drawFooterAtY(doc, school, Math.min(footerY, fixedBottomY))

  return doc
}


// ---------------------------------------------------------------------------
// Subject Class Marksheet -> Landscape PDF
// Shows all students in a class with every unit test recorded for a subject,
// total marks, average %, and class performance summary.
// ---------------------------------------------------------------------------

export interface SubjectMarksheetContext {
  school: School
  className: string
  subjectName: string
  teacherName: string
  students: Student[]
  tests: UnitTest[]
  scoresByTest: Record<string, Record<string, number | null>>
}

export async function generateSubjectMarksheetPdf(ctx: SubjectMarksheetContext): Promise<jsPDF> {
  const { school, className, subjectName, teacherName, students, tests, scoresByTest } = ctx
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const PAGE_W = 297
  const PAGE_H = 210
  const MARGIN = 12

  // ---- header ---------------------------------------------------------------
  const schoolLogoW = 24.5
  const schoolLogoH = 21
  const schoolLogoX = MARGIN
  const schoolLogoY = 10

  const cambridgeLogoW = 44
  const cambridgeLogoH = 7.4
  const cambridgeLogoX = PAGE_W - MARGIN - cambridgeLogoW
  const cambridgeLogoY = 11.5

  if (school.show_school_logo) {
    if (!schoolLogoData) schoolLogoData = await loadImageDataUrl('/logos/school-logo.png')
    doc.addImage(schoolLogoData, 'PNG', schoolLogoX, schoolLogoY, schoolLogoW, schoolLogoH)
  }
  if (school.show_cambridge_logo) {
    if (!cambridgeLogoData) cambridgeLogoData = await loadImageDataUrl('/logos/cambridge-logo.png')
    doc.addImage(cambridgeLogoData, 'PNG', cambridgeLogoX, cambridgeLogoY, cambridgeLogoW, cambridgeLogoH)
  }

  const logoGap = 4
  const leftBound = school.show_school_logo ? schoolLogoX + schoolLogoW + logoGap : MARGIN
  const rightBound = school.show_cambridge_logo ? cambridgeLogoX - logoGap : PAGE_W - MARGIN

  const centerX = PAGE_W / 2
  const maxAllowedHalfW = Math.min(centerX - leftBound, rightBound - centerX)
  const maxBandW = Math.max(60, maxAllowedHalfW * 2)

  const name = school.name.toUpperCase()
  let fontSize = 17
  doc.setFont('helvetica', 'bold')
  while (fontSize > 9) {
    doc.setFontSize(fontSize)
    if (doc.getTextWidth(name) + 12 <= maxBandW) break
    fontSize -= 0.5
  }

  const nameW = doc.getTextWidth(name)
  const bandW = Math.min(nameW + 12, maxBandW)
  const bandH = 10
  const bandX = (PAGE_W - bandW) / 2
  const bandY = 11.5
  const [rr, rg, rb] = hexToRgb('#C00000')
  doc.setFillColor(rr, rg, rb)
  doc.roundedRect(bandX, bandY, bandW, bandH, 1.5, 1.5, 'F')
  doc.setTextColor(255, 255, 255)
  doc.text(name, PAGE_W / 2, bandY + bandH / 2, { align: 'center', baseline: 'middle' })

  let titleBottom = bandY + bandH
  if (school.motto) {
    const mottoY = titleBottom + 3.5
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(107, 127, 138)
    doc.text(school.motto, PAGE_W / 2, mottoY, { align: 'center' })
    titleBottom = mottoY + 2
  }

  let headerBottom = titleBottom
  if (school.show_school_logo) headerBottom = Math.max(headerBottom, schoolLogoY + schoolLogoH)
  if (school.show_cambridge_logo) headerBottom = Math.max(headerBottom, cambridgeLogoY + cambridgeLogoH)

  // Title band
  let y = headerBottom + 3.5
  const band2H = 7
  doc.setFillColor(31, 78, 95)
  doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, band2H, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text(`SUBJECT MARKSHEET — ${subjectName.toUpperCase()}`, PAGE_W / 2, y + band2H / 2, { align: 'center', baseline: 'middle' })
  y += band2H + 3.5

  // Info line
  const printed = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const infoCols: Array<Array<[string, boolean]>> = [
    [['Class: ', true], [className || '—', false], ['   ·   ', false], ['Subject: ', true], [subjectName || '—', false], ['   ·   ', false], ['Teacher: ', true], [teacherName || '—', false]],
    [['Academic Year: ', true], [school.academic_year || '—', false], ['   ·   ', false], ['Semester: ', true], [school.semester || school.term || '—', false], ['   ·   ', false], ['Printed: ', true], [printed, false]]
  ]
  doc.setFontSize(9.5)
  for (const segs of infoCols) {
    let x = MARGIN
    for (const [txt, bold] of segs) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setTextColor(bold ? 31 : 28, bold ? 78 : 43, bold ? 95 : 51)
      doc.text(txt, x, y)
      x += doc.getTextWidth(txt)
    }
    y += 4.8
  }
  const startY = y + 2

  // 1. Identify administered tests: at least one student in the class has a recorded mark
  const sortedStudents = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name))
  const administeredSet = new Set<string>()
  tests.forEach((t) => {
    const hasScore = sortedStudents.some((st) => {
      const sc = scoresByTest[t.id]?.[st.id]
      return sc !== null && sc !== undefined
    })
    if (hasScore) administeredSet.add(t.id)
  })

  // Table structure
  const headRow: string[] = ['#', 'Roll No.', 'Student Name']
  tests.forEach((t) => {
    const isPnd = !administeredSet.has(t.id)
    headRow.push(`${t.title}\n(${fmtDate(t.test_date)})\nMax: ${t.max_mark}${isPnd ? '\n[PND]' : ''}`)
  })
  headRow.push('Total')
  headRow.push('Average %')

  const body: any[] = []
  const testScoresList: number[][] = tests.map(() => [])
  let cohortEarnedSum = 0
  let cohortMaxSum = 0
  let assessedStudentsCount = 0
  const assessedStudentPcts: number[] = []
  const assessedStudentTotals: number[] = []
  const assessedStudentMaxTotals: number[] = []

  sortedStudents.forEach((student, idx) => {
    const rowCells: any[] = [
      String(idx + 1),
      formatRollNo(student.roll_no || student.admission_no) || '—',
      sanitizePdfText(student.full_name)
    ]

    // Determine if student has participated in at least one assessment in this subject
    const isAssessed = tests.some((t) => {
      const sc = scoresByTest[t.id]?.[student.id]
      return sc !== null && sc !== undefined
    })

    if (!isAssessed) {
      // Unassessed / on leave student
      tests.forEach(() => rowCells.push('—'))
      rowCells.push('—')
      rowCells.push('—')
      body.push(rowCells)
      return
    }

    let studentScoreSum = 0
    let studentMaxSum = 0

    tests.forEach((t, tIdx) => {
      if (!administeredSet.has(t.id)) {
        // Pending assessment (not yet administered to anyone)
        rowCells.push('—')
        return
      }

      const score = scoresByTest[t.id]?.[student.id]
      if (score !== null && score !== undefined) {
        rowCells.push(String(score))
        studentScoreSum += Number(score)
        studentMaxSum += t.max_mark
        testScoresList[tIdx].push(Number(score))
      } else {
        // Case A: Unexcused (ABS) - display double dashes (=) instead of 0 [ABS], while counting as 0 score with full max mark in denominator
        rowCells.push('=')
        studentScoreSum += 0
        studentMaxSum += t.max_mark
        testScoresList[tIdx].push(0)
      }
    })

    if (studentMaxSum > 0) {
      const studentPct = (studentScoreSum / studentMaxSum) * 100
      rowCells.push(`${studentScoreSum} / ${studentMaxSum}`)
      rowCells.push(`${studentPct.toFixed(1)}%`)
      cohortEarnedSum += studentScoreSum
      cohortMaxSum += studentMaxSum
      assessedStudentsCount += 1
      assessedStudentPcts.push(studentPct)
      assessedStudentTotals.push(studentScoreSum)
      assessedStudentMaxTotals.push(studentMaxSum)
    } else {
      rowCells.push('—')
      rowCells.push('—')
    }

    body.push(rowCells)
  })

  // Summary rows
  const avgLabel = assessedStudentsCount > 0
    ? `Class Average (N=${assessedStudentsCount} / ${sortedStudents.length})`
    : 'Class Average'
  const avgRow: any[] = [{ content: avgLabel, colSpan: 3, styles: { halign: 'left', fontStyle: 'bold', fillColor: [221, 235, 241], textColor: [31, 78, 95] } }]
  const highRow: any[] = [{ content: 'Highest Score', colSpan: 3, styles: { halign: 'left', fontStyle: 'bold', fillColor: [238, 246, 241], textColor: [20, 83, 45] } }]
  const lowRow: any[] = [{ content: 'Lowest Score', colSpan: 3, styles: { halign: 'left', fontStyle: 'bold', fillColor: [253, 242, 242], textColor: [153, 27, 27] } }]

  tests.forEach((t, tIdx) => {
    if (!administeredSet.has(t.id)) {
      avgRow.push({ content: '— [PND]', styles: { halign: 'center', fontStyle: 'bold', fillColor: [221, 235, 241], textColor: [100, 116, 139] } })
      highRow.push({ content: '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [238, 246, 241], textColor: [100, 116, 139] } })
      lowRow.push({ content: '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [253, 242, 242], textColor: [100, 116, 139] } })
    } else {
      const scores = testScoresList[tIdx]
      if (scores.length > 0) {
        const sum = scores.reduce((a, b) => a + b, 0)
        const avg = sum / scores.length
        const avgPct = (avg / (t.max_mark || 1)) * 100
        avgRow.push({ content: `${avg.toFixed(1)} (${avgPct.toFixed(1)}%)`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [221, 235, 241], textColor: [31, 78, 95] } })
        highRow.push({ content: String(Math.max(...scores)), styles: { halign: 'center', fontStyle: 'bold', fillColor: [238, 246, 241], textColor: [20, 83, 45] } })
        lowRow.push({ content: String(Math.min(...scores)), styles: { halign: 'center', fontStyle: 'bold', fillColor: [253, 242, 242], textColor: [153, 27, 27] } })
      } else {
        avgRow.push({ content: '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [221, 235, 241] } })
        highRow.push({ content: '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [238, 246, 241] } })
        lowRow.push({ content: '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [253, 242, 242] } })
      }
    }
  })

  // Total Column & Average % Column in Summary Rows
  if (assessedStudentsCount > 0 && cohortMaxSum > 0) {
    const avgScore = (cohortEarnedSum / assessedStudentsCount).toFixed(1)
    const avgMax = (cohortMaxSum / assessedStudentsCount).toFixed(0)
    const classWeightedPct = (cohortEarnedSum / cohortMaxSum) * 100

    avgRow.push({ content: `${avgScore} / ${avgMax} (${classWeightedPct.toFixed(1)}%)`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [221, 235, 241], textColor: [31, 78, 95] } })
    avgRow.push({ content: `${classWeightedPct.toFixed(1)}%`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [221, 235, 241], textColor: [31, 78, 95] } })

    const highestScore = Math.max(...assessedStudentTotals)
    const highestPct = Math.max(...assessedStudentPcts)
    const lowestScore = Math.min(...assessedStudentTotals)
    const lowestPct = Math.min(...assessedStudentPcts)

    highRow.push({ content: `${highestScore} / ${avgMax}`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [238, 246, 241], textColor: [20, 83, 45] } })
    highRow.push({ content: `${highestPct.toFixed(1)}%`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [238, 246, 241], textColor: [20, 83, 45] } })

    lowRow.push({ content: `${lowestScore} / ${avgMax}`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [253, 242, 242], textColor: [153, 27, 27] } })
    lowRow.push({ content: `${lowestPct.toFixed(1)}%`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [253, 242, 242], textColor: [153, 27, 27] } })
  } else {
    avgRow.push({ content: '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [221, 235, 241] } })
    avgRow.push({ content: '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [221, 235, 241] } })
    highRow.push({ content: '—', styles: { fillColor: [238, 246, 241] } })
    highRow.push({ content: '—', styles: { fillColor: [238, 246, 241] } })
    lowRow.push({ content: '—', styles: { fillColor: [253, 242, 242] } })
    lowRow.push({ content: '—', styles: { fillColor: [253, 242, 242] } })
  }

  if (tests.length > 0) {
    body.push(avgRow)
    body.push(highRow)
    body.push(lowRow)
  } else {
    body.push([{ content: 'No unit tests recorded yet for this subject.', colSpan: 5, styles: { textColor: [107, 127, 138], halign: 'center' } }])
  }

  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN, top: startY, bottom: 20 },
    head: [headRow],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 1.6,
      textColor: [28, 43, 51],
      lineColor: [212, 222, 228],
      lineWidth: 0.2
    },
    headStyles: {
      fillColor: [31, 78, 95],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle'
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 48, halign: 'left' }
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const textVal = data.cell.text?.[0] || ''
        if (textVal === '=') {
          data.cell.styles.textColor = [220, 38, 38]
          data.cell.styles.fontStyle = 'bold'
        } else if (textVal.includes('%')) {
          const match = textVal.match(/(\d+(?:\.\d+)?)\s*%/)
          if (match && parseFloat(match[1]) >= 65) {
            data.cell.styles.textColor = [21, 128, 61] // #15803d
            data.cell.styles.fontStyle = 'bold'
          }
        }
      }
    }
  })

  // Footer placement:
  // If the table extends near the very bottom margin (or fills the page), the footer becomes fixed
  // at the bottom on the first page, while following pages resume our prior styling (immediately after the table).
  const pageCount = doc.getNumberOfPages()
  const finalY = (doc as any).lastAutoTable?.finalY ?? (PAGE_H - MARGIN - 10)
  const fh = 7.5
  const fixedBottomY = PAGE_H - MARGIN - fh
  const bottomThreshold = 170 // near bottom margin threshold for landscape (mm)

  if (pageCount > 1) {
    for (let p = 1; p < pageCount; p++) {
      doc.setPage(p)
      drawFooterLandscapeAtY(doc, school, fixedBottomY)
    }
    doc.setPage(pageCount)
    let followingPageY = finalY + 5
    if (followingPageY > fixedBottomY) {
      followingPageY = fixedBottomY
    }
    drawFooterLandscapeAtY(doc, school, followingPageY)
  } else {
    if (finalY >= bottomThreshold) {
      drawFooterLandscapeAtY(doc, school, fixedBottomY)
    } else {
      drawFooterLandscapeAtY(doc, school, finalY + 5)
    }
  }

  return doc
}

function drawFooterLandscapeAtY(doc: jsPDF, school: School, fy: number): void {
  const PAGE_W = 297
  const fh = 7.5
  const [fr, fg, fb] = hexToRgb(school.footer_color || '#1F8A5F')
  doc.setFillColor(fr, fg, fb)
  doc.roundedRect(MARGIN, fy, PAGE_W - 2 * MARGIN, fh, 1.2, 1.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text(school.footer_text || '', PAGE_W / 2, fy + fh / 2 + 0.2, { align: 'center', baseline: 'middle' })
}

export async function downloadSubjectMarksheetPdf(ctx: SubjectMarksheetContext): Promise<void> {
  const doc = await generateSubjectMarksheetPdf(ctx)
  triggerDownload(doc.output('blob'), safeName(`${ctx.className} - ${ctx.subjectName} Marksheet`) + '.pdf')
}

// ---------------------------------------------------------------------------
// File-name + download helpers
// ---------------------------------------------------------------------------

export function safeName(s: string): string {
  const cleaned = (s || '').replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned || 'report'
}

function reportFileName(ctx: PdfContext): string {
  return safeName(`${ctx.className} - ${ctx.student.full_name} (${ctx.student.student_no})`) + '.pdf'
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Download one student's report as a PDF. */
export async function downloadStudentPdf(ctx: PdfContext): Promise<void> {
  const doc = await generateStudentPdf(ctx)
  triggerDownload(doc.output('blob'), reportFileName(ctx))
}

function examReportFileName(ctx: ExamPdfContext): string {
  const examTag = ctx.selectedExamTitle && ctx.selectedExamTitle !== '__ALL_EXAMS__'
    ? ` - ${ctx.selectedExamTitle}`
    : ' - Exam Report'
  return safeName(`${ctx.className}${examTag} - ${ctx.student.full_name} (${ctx.student.student_no})`) + '.pdf'
}

/** Download one student's Independent School Exam Report as a PDF. */
export async function downloadStudentExamPdf(ctx: ExamPdfContext): Promise<void> {
  const doc = await generateStudentExamPdf(ctx)
  triggerDownload(doc.output('blob'), examReportFileName(ctx))
}

export function canSaveToFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

// ---------------------------------------------------------------------------
// Bulk: individual PDFs delivered together
// ---------------------------------------------------------------------------

export interface BulkOptions {
  students: Student[]
  rowsByStudent: Record<string, StudentReportRow[]>
  school: School
  className: string
  teacherName: string
  filterNotice?: string
  reportTitle?: string
  onProgress?: (done: number, total: number) => void
}

export interface BulkExamOptions {
  students: Student[]
  rowsByStudent: Record<string, StudentReportRow[]>
  learnerSubjectsByStudent: Record<string, string[]>
  selectedExamTitle?: string
  school: School
  className: string
  teacherName: string
  filterNotice?: string
  onProgress?: (done: number, total: number) => void
}

/** One zip file that extracts into a folder of individual per-student PDFs. */
export async function downloadClassReportsZip(opts: BulkOptions): Promise<void> {
  const zip = new JSZip()
  const total = opts.students.length
  for (let i = 0; i < total; i++) {
    const st = opts.students[i]
    const doc = await generateStudentPdf({
      student: st,
      school: opts.school,
      className: opts.className,
      teacherName: opts.teacherName,
      filterNotice: opts.filterNotice,
      reportTitle: opts.reportTitle,
      rows: opts.rowsByStudent[st.id] ?? []
    })
    zip.file(reportFileName({ ...opts, student: st, rows: opts.rowsByStudent[st.id] ?? [] }), doc.output('arraybuffer'))
    opts.onProgress?.(i + 1, total)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  triggerDownload(blob, safeName(`Leera_Reports_${opts.className}`) + '.zip')
}

/** Write the individual PDFs directly into a folder the user picks (Chromium). */
export async function saveClassReportsToFolder(opts: BulkOptions): Promise<void> {
  const w = window as any
  if (!w.showDirectoryPicker) throw new Error('This browser does not support saving to a folder.')
  const dir = await w.showDirectoryPicker()
  const total = opts.students.length
  for (let i = 0; i < total; i++) {
    const st = opts.students[i]
    const doc = await generateStudentPdf({
      student: st,
      school: opts.school,
      className: opts.className,
      teacherName: opts.teacherName,
      filterNotice: opts.filterNotice,
      reportTitle: opts.reportTitle,
      rows: opts.rowsByStudent[st.id] ?? []
    })
    const blob = doc.output('blob')
    const handle = await dir.getFileHandle(reportFileName({ ...opts, student: st, rows: opts.rowsByStudent[st.id] ?? [] }), { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    opts.onProgress?.(i + 1, total)
  }
}

/** One zip file of individual per-student Independent School Exam Report PDFs. */
export async function downloadClassExamReportsZip(opts: BulkExamOptions): Promise<void> {
  const zip = new JSZip()
  const total = opts.students.length
  for (let i = 0; i < total; i++) {
    const st = opts.students[i]
    const ctx: ExamPdfContext = {
      student: st,
      school: opts.school,
      className: opts.className,
      teacherName: opts.teacherName,
      filterNotice: opts.filterNotice,
      selectedExamTitle: opts.selectedExamTitle,
      learnerSubjects: opts.learnerSubjectsByStudent[st.id] ?? [],
      rows: opts.rowsByStudent[st.id] ?? []
    }
    const doc = await generateStudentExamPdf(ctx)
    zip.file(examReportFileName(ctx), doc.output('arraybuffer'))
    opts.onProgress?.(i + 1, total)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const examSlug = opts.selectedExamTitle && opts.selectedExamTitle !== '__ALL_EXAMS__'
    ? `_${opts.selectedExamTitle}`
    : '_Exam_Reports'
  triggerDownload(blob, safeName(`Leera_Exam_Reports_${opts.className}${examSlug}`) + '.zip')
}

/** Write the individual per-student Independent School Exam Report PDFs directly into a folder. */
export async function saveClassExamReportsToFolder(opts: BulkExamOptions): Promise<void> {
  const w = window as any
  if (!w.showDirectoryPicker) throw new Error('This browser does not support saving to a folder.')
  const dir = await w.showDirectoryPicker()
  const total = opts.students.length
  for (let i = 0; i < total; i++) {
    const st = opts.students[i]
    const ctx: ExamPdfContext = {
      student: st,
      school: opts.school,
      className: opts.className,
      teacherName: opts.teacherName,
      filterNotice: opts.filterNotice,
      selectedExamTitle: opts.selectedExamTitle,
      learnerSubjects: opts.learnerSubjectsByStudent[st.id] ?? [],
      rows: opts.rowsByStudent[st.id] ?? []
    }
    const doc = await generateStudentExamPdf(ctx)
    const blob = doc.output('blob')
    const handle = await dir.getFileHandle(examReportFileName(ctx), { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    opts.onProgress?.(i + 1, total)
  }
}

