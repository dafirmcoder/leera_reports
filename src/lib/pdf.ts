import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import JSZip from 'jszip'
import { buildReport, fmtDate, fmtPct, formatAdmissionNo } from './report'
import type { School, Student, StudentReportRow } from './types'

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
  const schoolLogoW = 24.5
  const schoolLogoH = 21 // Preserves ~1.17 aspect ratio of 400x342
  const schoolLogoX = MARGIN
  const schoolLogoY = 10

  const cambridgeLogoW = 44
  const cambridgeLogoH = 7.4 // Preserves ~5.95 aspect ratio of 1000x168
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

  // Determine available horizontal space for the center school title so it NEVER collides with logos
  const logoGap = 4
  const leftBound = school.show_school_logo ? schoolLogoX + schoolLogoW + logoGap : MARGIN
  const rightBound = school.show_cambridge_logo ? cambridgeLogoX - logoGap : PAGE_W - MARGIN

  // Keep title centered on page, capped to available safe clearance on both sides
  const centerX = PAGE_W / 2
  const maxAllowedHalfW = Math.min(centerX - leftBound, rightBound - centerX)
  const maxBandW = Math.max(50, maxAllowedHalfW * 2)

  // School name — auto-fit font size so it fits inside maxBandW without overlapping logos
  const name = school.name.toUpperCase()
  let fontSize = 16
  doc.setFont('helvetica', 'bold')
  while (fontSize > 8.5) {
    doc.setFontSize(fontSize)
    if (doc.getTextWidth(name) + 10 <= maxBandW) break
    fontSize -= 0.5
  }

  const nameW = doc.getTextWidth(name)
  const bandW = Math.min(nameW + 10, maxBandW)
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

  // Calculate bottom of all header content so the report band never slices through the logos
  let headerBottom = titleBottom
  if (school.show_school_logo) {
    headerBottom = Math.max(headerBottom, schoolLogoY + schoolLogoH)
  }
  if (school.show_cambridge_logo) {
    headerBottom = Math.max(headerBottom, cambridgeLogoY + cambridgeLogoH)
  }

  // "END OF UNIT TEST REPORT" band — placed strictly below ALL header elements with clean spacing
  let y = headerBottom + 4
  const band2H = 7
  doc.setFillColor(31, 78, 95)
  doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, band2H, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text('END OF UNIT TEST REPORT', PAGE_W / 2, y + band2H / 2, { align: 'center', baseline: 'middle' })
  y += band2H + 4

  // ---- info block ------------------------------------------------------------
  const printed = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const infoLines: Array<Array<[string, boolean]>> = [
    [['Student: ', true], [student.full_name, false]],
    [['Admission No.: ', true], [formatAdmissionNo(student.admission_no) || '—', false], ['   ·   ', false], ['Class: ', true], [className || '—', false]],
    [['Term: ', true], [school.term, false], ['   ·   ', false], ['Academic Year: ', true], [school.academic_year, false]],
    [['Teacher: ', true], [teacherName || '—', false], ['   ·   ', false], ['Printed: ', true], [printed, false]]
  ]
  doc.setFontSize(10)
  for (const segs of infoLines) {
    let x = MARGIN
    for (const [txt, bold] of segs) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setTextColor(bold ? 31 : 28, bold ? 78 : 43, bold ? 95 : 51)
      doc.text(txt, x, y)
      x += doc.getTextWidth(txt)
    }
    y += 5.3
  }
  const startY = y + 3

  // ---- table -----------------------------------------------------------------
  const report = buildReport(rows)
  const avgStyle = { fillColor: [221, 235, 241] as [number, number, number], fontStyle: 'bold' as const, textColor: [31, 78, 95] as [number, number, number], halign: 'center' as const }

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
            fillColor: [234, 243, 248] as [number, number, number],
            textColor: [31, 78, 95] as [number, number, number],
            fontStyle: 'bold',
            halign: 'center',
            valign: 'middle'
          }
        })
      }
      // rows covered by the subject rowSpan omit the subject column
      cells.push(r.title, fmtDate(r.test_date), String(r.score), String(r.max_mark), pct(r.score, r.max_mark))
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
    if (idx < report.subjects.length - 1) body.push(['__SPACER__', '', '', '', '', ''])
  })
  if (report.subjects.length > 0) {
    body.push([
      { content: `Overall Average: ${fmtPct(report.overall)}`, colSpan: 6, styles: { ...avgStyle } }
    ])
  } else {
    body.push([{ content: 'No end-of-unit tests recorded yet for this student.', colSpan: 6, styles: { textColor: [107, 127, 138], halign: 'center' } }])
  }

  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN, top: startY, bottom: 30 },
    head: [['Subject', 'Unit / Topic', 'Date', 'Score', 'Out of (Max)', 'Mark %']],
    body,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      cellPadding: 1.8,
      textColor: [28, 43, 51],
      lineColor: [212, 222, 228],
      lineWidth: 0.25
    },
    headStyles: { fillColor: [31, 78, 95], textColor: 255, fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 28, halign: 'center' },
      1: { cellWidth: 60 },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 26, halign: 'center' },
      5: { cellWidth: 34, halign: 'center' }
    },
    didParseCell: (data) => {
      const raw = data.row.raw as any[]
      if (data.section === 'body' && Array.isArray(raw) && raw[0] === '__SPACER__') {
        data.cell.styles.fillColor = [255, 255, 255]
        data.cell.styles.textColor = [255, 255, 255]
        data.cell.styles.lineColor = [255, 255, 255]
        data.cell.styles.lineWidth = 0
        data.cell.text = ['']
      }
    },
    didDrawPage: () => drawFooter(doc, school)
  })

  // if the table ended on the last page, the footer is already drawn there
  return doc
}

function drawFooter(doc: jsPDF, school: School): void {
  const fh = 8
  const fy = PAGE_H - MARGIN - fh
  const [fr, fg, fb] = hexToRgb(school.footer_color || '#1F8A5F')
  doc.setFillColor(fr, fg, fb)
  doc.rect(MARGIN, fy, PAGE_W - 2 * MARGIN, fh, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.text(school.footer_text || '', PAGE_W / 2, fy + fh / 2, { align: 'center', baseline: 'middle' })
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
