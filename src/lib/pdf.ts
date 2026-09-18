import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'
import { buildReport, fmtDate, fmtPct, formatRollNo } from './report'
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

export interface PdfContext {
  student: Student
  school: School
  className: string
  teacherName: string
  rows: StudentReportRow[]
}

export async function generateStudentPdf(ctx: PdfContext): Promise<jsPDF> {
  const { student, school, className, teacherName, rows } = ctx
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  // ---- header ---------------------------------------------------------------
  // Exact layout matching .report-sheet and .report-header in styles.css
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

  // "END OF UNIT TEST REPORT" band — placed strictly below header with 4mm spacing
  let y = headerBottom + 4
  const band2H = 7.5
  doc.setFillColor(31, 78, 95) // var(--teal) #1F4E5F
  doc.roundedRect(MARGIN, y, PAGE_W - 2 * MARGIN, band2H, 1.2, 1.2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text('END OF UNIT TEST REPORT', PAGE_W / 2, y + band2H / 2 + 0.3, { align: 'center', baseline: 'middle' })
  y += band2H + 4.5

  // ---- info block ------------------------------------------------------------
  const printed = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const infoLines: Array<Array<{ text: string; type: 'lbl' | 'val' | 'sep' }>> = [
    [
      { text: 'Student: ', type: 'lbl' },
      { text: student.full_name, type: 'val' }
    ],
    [
      { text: 'Roll No.: ', type: 'lbl' },
      { text: formatRollNo(student.roll_no || student.admission_no) || '—', type: 'val' },
      { text: '   ·   ', type: 'sep' },
      { text: 'Class: ', type: 'lbl' },
      { text: className || '—', type: 'val' }
    ],
    [
      { text: 'Semester: ', type: 'lbl' },
      { text: school.semester || school.term || '—', type: 'val' },
      { text: '   ·   ', type: 'sep' },
      { text: 'Academic Year: ', type: 'lbl' },
      { text: school.academic_year, type: 'val' }
    ],
    [
      { text: 'Teacher: ', type: 'lbl' },
      { text: teacherName || '—', type: 'val' },
      { text: '   ·   ', type: 'sep' },
      { text: 'Printed: ', type: 'lbl' },
      { text: printed, type: 'val' }
    ]
  ]

  doc.setFontSize(9.8)
  for (const line of infoLines) {
    let x = MARGIN
    for (const seg of line) {
      if (seg.type === 'lbl') {
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(31, 78, 95) // var(--teal)
      } else if (seg.type === 'sep') {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(195, 211, 220) // var(--line)
      } else {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(28, 43, 51) // var(--text)
      }
      doc.text(seg.text, x, y)
      x += doc.getTextWidth(seg.text)
    }
    y += 5.2
  }
  const startY = y + 2.5

  // ---- table -----------------------------------------------------------------
  const report = buildReport(rows)
  const avgStyle = {
    fillColor: [221, 235, 241] as [number, number, number], // #ddebf1
    fontStyle: 'bold' as const,
    textColor: [31, 78, 95] as [number, number, number],
    halign: 'center' as const
  }

  const body: any[] = []
  report.subjects.forEach((s, idx) => {
    const rowSpan = s.rows.length + (s.count > 1 ? 1 : 0)
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
        String(r.score),
        String(r.max_mark),
        fmtPct((r.score / (r.max_mark || 1)) * 100)
      )
      body.push(cells)
    })
    if (s.count > 1) {
      body.push([
        { content: 'Subject Average', colSpan: 2, styles: { ...avgStyle, halign: 'left' } },
        { content: String(s.totalScore), styles: avgStyle },
        { content: String(s.totalMax), styles: avgStyle },
        { content: fmtPct(s.average), styles: avgStyle }
      ])
    }
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
    },
    didDrawPage: () => drawFooter(doc, school)
  })

  return doc
}

function drawFooter(doc: jsPDF, school: School): void {
  const fh = 8.5
  const fy = PAGE_H - MARGIN - fh
  const [fr, fg, fb] = hexToRgb(school.footer_color || '#1F8A5F')
  doc.setFillColor(fr, fg, fb)
  doc.roundedRect(MARGIN, fy, PAGE_W - 2 * MARGIN, fh, 1.2, 1.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(school.footer_text || '', PAGE_W / 2, fy + fh / 2 + 0.3, { align: 'center', baseline: 'middle' })
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

  // Table structure
  const headRow: string[] = ['#', 'Roll No.', 'Student Name']
  tests.forEach((t) => {
    headRow.push(`${t.title}\n(${fmtDate(t.test_date)})\nMax: ${t.max_mark}`)
  })
  headRow.push('Total')
  headRow.push('Average %')

  const sortedStudents = [...students].sort((a, b) => a.full_name.localeCompare(b.full_name))
  const body: any[] = []

  const testScoresList: number[][] = tests.map(() => [])
  let classTotalPctSum = 0
  let studentsWithMarksCount = 0

  sortedStudents.forEach((student, idx) => {
    const rowCells: any[] = [
      String(idx + 1),
      formatRollNo(student.roll_no || student.admission_no) || '—',
      student.full_name
    ]

    let studentScoreSum = 0
    let studentMaxSum = 0
    let studentTestsTaken = 0

    tests.forEach((t, tIdx) => {
      const score = scoresByTest[t.id]?.[student.id]
      if (score !== null && score !== undefined) {
        rowCells.push(String(score))
        studentScoreSum += score
        studentMaxSum += t.max_mark
        studentTestsTaken += 1
        testScoresList[tIdx].push(score)
      } else {
        rowCells.push('—')
      }
    })

    if (studentTestsTaken > 0 && studentMaxSum > 0) {
      const studentPct = (studentScoreSum / studentMaxSum) * 100
      rowCells.push(`${studentScoreSum} / ${studentMaxSum}`)
      rowCells.push(`${studentPct.toFixed(1)}%`)
      classTotalPctSum += studentPct
      studentsWithMarksCount += 1
    } else {
      rowCells.push('—')
      rowCells.push('—')
    }

    body.push(rowCells)
  })

  // Summary rows
  const avgRow: any[] = [{ content: 'Class Average', colSpan: 3, styles: { halign: 'left', fontStyle: 'bold', fillColor: [221, 235, 241], textColor: [31, 78, 95] } }]
  const highRow: any[] = [{ content: 'Highest Score', colSpan: 3, styles: { halign: 'left', fontStyle: 'bold', fillColor: [238, 246, 241], textColor: [20, 83, 45] } }]
  const lowRow: any[] = [{ content: 'Lowest Score', colSpan: 3, styles: { halign: 'left', fontStyle: 'bold', fillColor: [253, 242, 242], textColor: [153, 27, 27] } }]

  tests.forEach((t, tIdx) => {
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
  })

  const overallAvg = studentsWithMarksCount > 0 ? (classTotalPctSum / studentsWithMarksCount).toFixed(1) + '%' : '—'
  avgRow.push({ content: '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [221, 235, 241] } })
  avgRow.push({ content: overallAvg, styles: { halign: 'center', fontStyle: 'bold', fillColor: [221, 235, 241], textColor: [31, 78, 95] } })

  highRow.push({ content: '', styles: { fillColor: [238, 246, 241] } })
  highRow.push({ content: '', styles: { fillColor: [238, 246, 241] } })
  lowRow.push({ content: '', styles: { fillColor: [253, 242, 242] } })
  lowRow.push({ content: '', styles: { fillColor: [253, 242, 242] } })

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
    didDrawPage: () => drawFooterLandscape(doc, school)
  })

  return doc
}

function drawFooterLandscape(doc: jsPDF, school: School): void {
  const PAGE_W = 297
  const PAGE_H = 210
  const MARGIN = 12
  const fh = 7
  const fy = PAGE_H - MARGIN - fh
  const [fr, fg, fb] = hexToRgb(school.footer_color || '#1F8A5F')
  doc.setFillColor(fr, fg, fb)
  doc.rect(MARGIN, fy, PAGE_W - 2 * MARGIN, fh, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text(school.footer_text || '', PAGE_W / 2, fy + fh / 2, { align: 'center', baseline: 'middle' })
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
