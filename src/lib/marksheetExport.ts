import ExcelJS from 'exceljs'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Student, UnitTest } from './types'

export interface SubjectWithTests {
  subject_id: string
  subject_name: string
  teacher_name: string
  tests: UnitTest[]
}

export interface MarksheetExportData {
  className: string
  schoolName: string
  academicYear: string
  semester: string
  students: Student[]
  subjectsWithTests: SubjectWithTests[]
  scoresMap: Record<string, Record<string, number | null>>
  studentMetrics: Map<string, {
    subjectAverages: Record<string, number | null>
    overallAggregatePct: number | null
  }>
  classAverages: {
    unitAverages: Record<string, number | null>
    subjectAverages: Record<string, number | null>
    classOverall: number | null
  }
  displayMode: 'pct' | 'raw' | 'both'
  isStudentEnrolledInSubject?: (studentId: string, subjectId: string) => boolean
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '').trim().slice(0, 31) || 'Marksheet'
}

function formatScore(
  rawScore: number | null | undefined,
  maxMark: number,
  displayMode: 'pct' | 'raw' | 'both',
  isAbsent = false,
  isPending = false
): string {
  if (rawScore === null || rawScore === undefined) {
    if (isPending) return '—'
    if (isAbsent) return '='
    return '—'
  }
  const pct = maxMark > 0 ? Math.round((rawScore / maxMark) * 100) : 0
  if (displayMode === 'raw') return `${rawScore}/${maxMark}`
  if (displayMode === 'both') return `${pct}% (${rawScore}/${maxMark})`
  return `${pct}%`
}

export async function downloadMarksheetExcel(data: MarksheetExportData): Promise<void> {
  const {
    className,
    schoolName,
    academicYear,
    semester,
    students,
    subjectsWithTests,
    scoresMap,
    studentMetrics,
    classAverages,
    displayMode,
    isStudentEnrolledInSubject
  } = data

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Leera Reports'
  wb.created = new Date()

  const sheetName = sanitizeSheetName(className)
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 6 }]
  })

  // Theme colors
  const primaryBlue = '1E3A8A'
  const lightHeaderBg = 'F1F5F9'
  const aggHeaderBg = 'E0E7FF'
  const aggText = '3730A3'
  const classAvgBg = 'F8FAFC'

  const borderThin: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'CBD5E1' } },
    left: { style: 'thin', color: { argb: 'CBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
    right: { style: 'thin', color: { argb: 'CBD5E1' } }
  }

  // Row 1: School Title
  ws.mergeCells(1, 1, 1, 6)
  const cellSchool = ws.getCell(1, 1)
  cellSchool.value = schoolName.toUpperCase()
  cellSchool.font = { name: 'Arial', size: 14, bold: true, color: { argb: '0F172A' } }
  cellSchool.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(1).height = 24

  // Row 2: Sheet Title
  ws.mergeCells(2, 1, 2, 6)
  const cellTitle = ws.getCell(2, 1)
  cellTitle.value = `${className} — End of Unit Marksheet Broadsheet`
  cellTitle.font = { name: 'Arial', size: 12, bold: true, color: { argb: primaryBlue } }
  cellTitle.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(2).height = 20

  // Row 3: Metadata
  ws.mergeCells(3, 1, 3, 6)
  const cellMeta = ws.getCell(3, 1)
  cellMeta.value = `Academic Year: ${academicYear} | Semester: ${semester} | Mode: ${displayMode.toUpperCase()} | Generated: ${new Date().toLocaleDateString()}`
  cellMeta.font = { name: 'Arial', size: 9.5, italic: true, color: { argb: '64748B' } }
  cellMeta.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(3).height = 18

  // Row 4: Spacer
  ws.getRow(4).height = 8

  // Header Rows: 5 and 6
  ws.getRow(5).height = 26
  ws.getRow(6).height = 24

  // Static columns: S/N (1), Roll No (2), Student Name (3)
  ws.mergeCells(5, 1, 6, 1)
  const snHeader = ws.getCell(5, 1)
  snHeader.value = 'S/N'
  snHeader.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 }
  snHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryBlue } }
  snHeader.alignment = { vertical: 'middle', horizontal: 'center' }
  snHeader.border = borderThin

  ws.mergeCells(5, 2, 6, 2)
  const rollHeader = ws.getCell(5, 2)
  rollHeader.value = 'ROLL NO'
  rollHeader.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 }
  rollHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryBlue } }
  rollHeader.alignment = { vertical: 'middle', horizontal: 'center' }
  rollHeader.border = borderThin

  ws.mergeCells(5, 3, 6, 3)
  const nameHeader = ws.getCell(5, 3)
  nameHeader.value = 'STUDENT NAME'
  nameHeader.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 }
  nameHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryBlue } }
  nameHeader.alignment = { vertical: 'middle', horizontal: 'left' }
  nameHeader.border = borderThin

  let currentCol = 4

  // Subject headers
  subjectsWithTests.forEach((sub) => {
    const testCount = sub.tests.length
    const colSpan = testCount > 0 ? testCount + 1 : 1
    const endCol = currentCol + colSpan - 1

    // Super header (Subject Name)
    if (colSpan > 1) {
      ws.mergeCells(5, currentCol, 5, endCol)
    }
    const subHeader = ws.getCell(5, currentCol)
    subHeader.value = sub.subject_name.toUpperCase()
    subHeader.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 }
    subHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryBlue } }
    subHeader.alignment = { vertical: 'middle', horizontal: 'center' }
    for (let c = currentCol; c <= endCol; c++) {
      ws.getCell(5, c).border = borderThin
      ws.getCell(5, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: primaryBlue } }
    }

    // Sub header row 6
    if (testCount === 0) {
      const noneCell = ws.getCell(6, currentCol)
      noneCell.value = 'No tests'
      noneCell.font = { italic: true, size: 9, color: { argb: '94A3B8' } }
      noneCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightHeaderBg } }
      noneCell.alignment = { vertical: 'middle', horizontal: 'center' }
      noneCell.border = borderThin
      currentCol++
    } else {
      sub.tests.forEach((t, tIdx) => {
        const tCell = ws.getCell(6, currentCol)
        tCell.value = `U${tIdx + 1} (${t.max_mark}m)`
        tCell.font = { bold: true, size: 9, color: { argb: '1E293B' } }
        tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lightHeaderBg } }
        tCell.alignment = { vertical: 'middle', horizontal: 'center' }
        tCell.border = borderThin
        currentCol++
      })

      // Subject Average column
      const avgCell = ws.getCell(6, currentCol)
      avgCell.value = 'Avg %'
      avgCell.font = { bold: true, size: 9, color: { argb: '1E293B' } }
      avgCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } }
      avgCell.alignment = { vertical: 'middle', horizontal: 'center' }
      avgCell.border = borderThin
      currentCol++
    }
  })

  // Final Column: Overall Aggregate
  const aggCol = currentCol
  ws.mergeCells(5, aggCol, 6, aggCol)
  const aggHeader = ws.getCell(5, aggCol)
  aggHeader.value = 'AGGREGATE %'
  aggHeader.font = { bold: true, color: { argb: aggText }, size: 10 }
  aggHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: aggHeaderBg } }
  aggHeader.alignment = { vertical: 'middle', horizontal: 'center' }
  aggHeader.border = borderThin
  ws.getCell(6, aggCol).border = borderThin

  // Discovered administered tests
  const administeredTestIds = new Set<string>()
  subjectsWithTests.forEach((sub) => {
    sub.tests.forEach((t) => {
      const hasAnyScore = students.some((st) => {
        const isEnrolled = isStudentEnrolledInSubject ? isStudentEnrolledInSubject(st.id, sub.subject_id) : true
        if (!isEnrolled) return false
        const s = scoresMap[t.id]?.[st.id]
        return s !== undefined && s !== null
      })
      if (hasAnyScore) administeredTestIds.add(t.id)
    })
  })

  // Student Rows (Row 7 onwards)
  let rowIdx = 7
  students.forEach((st, sIdx) => {
    const isEven = sIdx % 2 === 0
    const rowFillColor = isEven ? 'FFFFFF' : 'F8FAFC'
    const row = ws.getRow(rowIdx)
    row.height = 20

    // S/N
    const snCell = ws.getCell(rowIdx, 1)
    snCell.value = sIdx + 1
    snCell.alignment = { vertical: 'middle', horizontal: 'center' }
    snCell.border = borderThin

    // Roll No
    const rollCell = ws.getCell(rowIdx, 2)
    rollCell.value = st.roll_no || st.student_no || st.admission_no || '—'
    rollCell.alignment = { vertical: 'middle', horizontal: 'center' }
    rollCell.border = borderThin

    // Name
    const nameCell = ws.getCell(rowIdx, 3)
    nameCell.value = st.full_name
    nameCell.font = { bold: true, color: { argb: '1E293B' } }
    nameCell.alignment = { vertical: 'middle', horizontal: 'left' }
    nameCell.border = borderThin

    let cIdx = 4
    const metrics = studentMetrics.get(st.id)

    subjectsWithTests.forEach((sub) => {
      const isEnrolled = isStudentEnrolledInSubject ? isStudentEnrolledInSubject(st.id, sub.subject_id) : true

      if (!isEnrolled) {
        if (sub.tests.length === 0) {
          const cell = ws.getCell(rowIdx, cIdx)
          cell.value = 'N/A'
          cell.alignment = { vertical: 'middle', horizontal: 'center' }
          cell.font = { color: { argb: '94A3B8' } }
          cell.border = borderThin
          cIdx++
        } else {
          sub.tests.forEach(() => {
            const cell = ws.getCell(rowIdx, cIdx)
            cell.value = 'N/A'
            cell.alignment = { vertical: 'middle', horizontal: 'center' }
            cell.font = { color: { argb: '94A3B8' } }
            cell.border = borderThin
            cIdx++
          })
          const avgCell = ws.getCell(rowIdx, cIdx)
          avgCell.value = 'N/A'
          avgCell.font = { color: { argb: '94A3B8' } }
          avgCell.alignment = { vertical: 'middle', horizontal: 'center' }
          avgCell.border = borderThin
          cIdx++
        }
        return
      }

      if (sub.tests.length === 0) {
        const cell = ws.getCell(rowIdx, cIdx)
        cell.value = '—'
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
        cell.border = borderThin
        cIdx++
      } else {
        const hasAnyScoreInSub = sub.tests.some((t) => {
          const raw = scoresMap[t.id]?.[st.id]
          return raw !== undefined && raw !== null
        })

        sub.tests.forEach((t) => {
          const rawScore = scoresMap[t.id]?.[st.id]
          const isTestAdmin = administeredTestIds.has(t.id)
          const isAbsent = hasAnyScoreInSub && isTestAdmin && (rawScore === null || rawScore === undefined)
          const isPending = !isTestAdmin && (rawScore === null || rawScore === undefined)

          const cell = ws.getCell(rowIdx, cIdx)
          cell.value = formatScore(rawScore, t.max_mark, displayMode, isAbsent, isPending)
          cell.alignment = { vertical: 'middle', horizontal: 'center' }
          cell.border = borderThin

          if (rawScore !== null && rawScore !== undefined && t.max_mark > 0) {
            const pct = Math.round((rawScore / t.max_mark) * 100)
            if (pct >= 65) {
              cell.font = { color: { argb: '15803D' }, bold: true }
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDF4' } }
            } else if (pct < 50) {
              cell.font = { color: { argb: 'B91C1C' }, bold: true }
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } }
            }
          } else if (isAbsent) {
            cell.font = { color: { argb: '64748B' }, bold: true }
          }
          cIdx++
        })

        // Sub avg
        const subAvg = metrics?.subjectAverages[sub.subject_id] ?? null
        const avgCell = ws.getCell(rowIdx, cIdx)
        avgCell.value = subAvg !== null ? `${subAvg}%` : '—'
        avgCell.font = { bold: true, color: { argb: subAvg !== null && subAvg >= 65 ? '15803D' : '0F172A' } }
        avgCell.alignment = { vertical: 'middle', horizontal: 'center' }
        avgCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } }
        avgCell.border = borderThin
        cIdx++
      }
    })

    // Overall Aggregate
    const aggCell = ws.getCell(rowIdx, aggCol)
    const aggVal = metrics?.overallAggregatePct ?? null
    aggCell.value = aggVal !== null ? `${aggVal}%` : '—'
    aggCell.font = { bold: true, color: { argb: aggVal !== null && aggVal >= 65 ? '15803D' : aggText } }
    aggCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: aggHeaderBg } }
    aggCell.alignment = { vertical: 'middle', horizontal: 'center' }
    aggCell.border = borderThin

    // Apply zebra row backgrounds to remaining cells without specific highlight
    for (let c = 1; c <= aggCol; c++) {
      const cell = ws.getCell(rowIdx, c)
      if (!cell.fill) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFillColor } }
      }
    }

    rowIdx++
  })

  // Class Average Summary Row
  const avgRowIdx = rowIdx
  const avgRow = ws.getRow(avgRowIdx)
  avgRow.height = 24

  const assessedStudentsCount = students.filter((st) => {
    const m = studentMetrics.get(st.id)
    return m && m.overallAggregatePct !== null
  }).length

  ws.mergeCells(avgRowIdx, 1, avgRowIdx, 3)
  const avgLabel = ws.getCell(avgRowIdx, 1)
  avgLabel.value = `CLASS AVERAGE (N=${assessedStudentsCount} / ${students.length})`
  avgLabel.font = { bold: true, size: 10, color: { argb: '0F172A' } }
  avgLabel.alignment = { vertical: 'middle', horizontal: 'right' }
  avgLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } }
  ws.getCell(avgRowIdx, 1).border = borderThin
  ws.getCell(avgRowIdx, 2).border = borderThin
  ws.getCell(avgRowIdx, 3).border = borderThin

  let cIdx = 4
  subjectsWithTests.forEach((sub) => {
    if (sub.tests.length === 0) {
      const cell = ws.getCell(avgRowIdx, cIdx)
      cell.value = '—'
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: classAvgBg } }
      cell.border = borderThin
      cIdx++
    } else {
      sub.tests.forEach((t) => {
        const unitAvg = classAverages.unitAverages[t.id] ?? null
        const cell = ws.getCell(avgRowIdx, cIdx)
        cell.value = unitAvg !== null ? `${unitAvg}%` : '—'
        cell.font = { bold: true, color: { argb: '0F172A' } }
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: classAvgBg } }
        cell.border = borderThin
        cIdx++
      })

      const subClassAvg = classAverages.subjectAverages[sub.subject_id] ?? null
      const cell = ws.getCell(avgRowIdx, cIdx)
      cell.value = subClassAvg !== null ? `${subClassAvg}%` : '—'
      cell.font = { bold: true, color: { argb: subClassAvg !== null && subClassAvg >= 65 ? '15803D' : primaryBlue } }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } }
      cell.border = borderThin
      cIdx++
    }
  })

  // Aggregate class overall
  const overallCell = ws.getCell(avgRowIdx, aggCol)
  overallCell.value = classAverages.classOverall !== null ? `${classAverages.classOverall}%` : '—'
  overallCell.font = { bold: true, size: 11, color: { argb: classAverages.classOverall !== null && classAverages.classOverall >= 65 ? '15803D' : aggText } }
  overallCell.alignment = { vertical: 'middle', horizontal: 'center' }
  overallCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: aggHeaderBg } }
  overallCell.border = borderThin

  // Column width configuration
  ws.getColumn(1).width = 6 // S/N
  ws.getColumn(2).width = 13 // Roll No
  ws.getColumn(3).width = 26 // Student Name

  let c = 4
  subjectsWithTests.forEach((sub) => {
    if (sub.tests.length === 0) {
      ws.getColumn(c).width = 11
      c++
    } else {
      sub.tests.forEach(() => {
        ws.getColumn(c).width = displayMode === 'both' ? 14 : 10
        c++
      })
      ws.getColumn(c).width = 11 // Avg %
      c++
    }
  })
  ws.getColumn(aggCol).width = 14

  // Trigger download in browser
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  const cleanClassName = className.replace(/[^a-zA-Z0-9_-]/g, '_')
  const fileName = `Leera_${cleanClassName}_Marksheet_Broadsheet_${academicYear.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadMarksheetCsv(data: MarksheetExportData): void {
  const {
    className,
    schoolName,
    academicYear,
    semester,
    students,
    subjectsWithTests,
    scoresMap,
    studentMetrics,
    classAverages,
    displayMode,
    isStudentEnrolledInSubject
  } = data

  const rows: string[][] = []

  const escapeCsv = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return ''
    const str = String(val)
    if (str === '=') return '="="'
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  // Header metadata rows
  rows.push([schoolName])
  rows.push([`${className} — End of Unit Marksheet Broadsheet`])
  rows.push([`Academic Year: ${academicYear}`, `Semester: ${semester}`, `Mode: ${displayMode.toUpperCase()}`, `Date: ${new Date().toLocaleDateString()}`])
  rows.push([])

  // Header row
  const headerCols: string[] = ['S/N', 'Roll No', 'Student Name']
  subjectsWithTests.forEach((sub) => {
    if (sub.tests.length === 0) {
      headerCols.push(`${sub.subject_name} (No Tests)`)
    } else {
      sub.tests.forEach((t, idx) => {
        headerCols.push(`${sub.subject_name} - U${idx + 1} (${t.max_mark}m)`)
      })
      headerCols.push(`${sub.subject_name} - Avg %`)
    }
  })
  headerCols.push('Overall Aggregate %')
  rows.push(headerCols)

  // Discovered administered tests
  const administeredTestIds = new Set<string>()
  subjectsWithTests.forEach((sub) => {
    sub.tests.forEach((t) => {
      const hasAnyScore = students.some((st) => {
        const isEnrolled = isStudentEnrolledInSubject ? isStudentEnrolledInSubject(st.id, sub.subject_id) : true
        if (!isEnrolled) return false
        const s = scoresMap[t.id]?.[st.id]
        return s !== undefined && s !== null
      })
      if (hasAnyScore) administeredTestIds.add(t.id)
    })
  })

  // Student rows
  students.forEach((st, sIdx) => {
    const row: string[] = [
      String(sIdx + 1),
      st.roll_no || st.student_no || st.admission_no || '',
      st.full_name
    ]

    const metrics = studentMetrics.get(st.id)

    subjectsWithTests.forEach((sub) => {
      const isEnrolled = isStudentEnrolledInSubject ? isStudentEnrolledInSubject(st.id, sub.subject_id) : true
      if (!isEnrolled) {
        if (sub.tests.length === 0) {
          row.push('N/A')
        } else {
          sub.tests.forEach(() => row.push('N/A'))
          row.push('N/A')
        }
        return
      }

      if (sub.tests.length === 0) {
        row.push('—')
      } else {
        const hasAnyScoreInSub = sub.tests.some((t) => {
          const raw = scoresMap[t.id]?.[st.id]
          return raw !== undefined && raw !== null
        })

        sub.tests.forEach((t) => {
          const rawScore = scoresMap[t.id]?.[st.id]
          const isTestAdmin = administeredTestIds.has(t.id)
          const isAbsent = hasAnyScoreInSub && isTestAdmin && (rawScore === null || rawScore === undefined)
          const isPending = !isTestAdmin && (rawScore === null || rawScore === undefined)
          row.push(formatScore(rawScore, t.max_mark, displayMode, isAbsent, isPending))
        })
        const subAvg = metrics?.subjectAverages[sub.subject_id] ?? null
        row.push(subAvg !== null ? `${subAvg}%` : '—')
      }
    })

    const aggVal = metrics?.overallAggregatePct ?? null
    row.push(aggVal !== null ? `${aggVal}%` : '—')
    rows.push(row)
  })

  // Class Average row
  const assessedStudentsCount = students.filter((st) => {
    const m = studentMetrics.get(st.id)
    return m && m.overallAggregatePct !== null
  }).length

  const avgRow: string[] = [`CLASS AVERAGE (N=${assessedStudentsCount} / ${students.length})`, '', '']
  subjectsWithTests.forEach((sub) => {
    if (sub.tests.length === 0) {
      avgRow.push('—')
    } else {
      sub.tests.forEach((t) => {
        const unitAvg = classAverages.unitAverages[t.id] ?? null
        avgRow.push(unitAvg !== null ? `${unitAvg}%` : '—')
      })
      const subClassAvg = classAverages.subjectAverages[sub.subject_id] ?? null
      avgRow.push(subClassAvg !== null ? `${subClassAvg}%` : '—')
    }
  })
  avgRow.push(classAverages.classOverall !== null ? `${classAverages.classOverall}%` : '—')
  rows.push(avgRow)

  // Convert to CSV string and download
  const csvContent = '\uFEFF' + rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const cleanClassName = className.replace(/[^a-zA-Z0-9_-]/g, '_')
  const fileName = `Leera_${cleanClassName}_Marksheet_Broadsheet_${academicYear.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function downloadMarksheetPdf(data: MarksheetExportData): Promise<void> {
  const {
    className,
    schoolName,
    academicYear,
    semester,
    students,
    subjectsWithTests,
    scoresMap,
    studentMetrics,
    classAverages,
    displayMode,
    isStudentEnrolledInSubject
  } = data

  const totalCols = 3 + subjectsWithTests.reduce((sum, s) => sum + Math.max(1, s.tests.length) + 1, 0) + 1
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: totalCols > 25 ? 'a3' : 'a4'
  })

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 10

  // 1. Header Band
  doc.setFillColor(30, 58, 138) // Deep Navy
  doc.rect(margin, 8, pageWidth - 2 * margin, 11, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(schoolName.toUpperCase(), pageWidth / 2, 15, { align: 'center', baseline: 'middle' })

  // 2. Title & Subtitle
  doc.setTextColor(15, 23, 42)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(`${className.toUpperCase()} — TABULATED CLASS MARKSHEET (BROADSHEET)`, margin, 24)

  // 3. Metadata
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  const metaText = `Academic Year: ${academicYear}   |   Semester: ${semester}   |   Learners: ${students.length}   |   Pass Mark: 65%   |   Generated: ${new Date().toLocaleDateString('en-GB')}`
  doc.text(metaText, margin, 29)

  // Discovered administered tests
  const administeredTestIds = new Set<string>()
  subjectsWithTests.forEach((sub) => {
    sub.tests.forEach((t) => {
      const hasAnyScore = students.some((st) => {
        const isEnrolled = isStudentEnrolledInSubject ? isStudentEnrolledInSubject(st.id, sub.subject_id) : true
        if (!isEnrolled) return false
        const s = scoresMap[t.id]?.[st.id]
        return s !== undefined && s !== null
      })
      if (hasAnyScore) administeredTestIds.add(t.id)
    })
  })

  // Two-level headers
  // Level 1:
  const headRow1: any[] = [
    { content: 'S/N', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
    { content: 'Roll No.', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
    { content: 'Student Name', rowSpan: 2, styles: { halign: 'left', valign: 'middle' } }
  ]

  // Level 2:
  const headRow2: any[] = []

  subjectsWithTests.forEach((sub) => {
    const colSpan = Math.max(1, sub.tests.length) + 1
    headRow1.push({
      content: sub.subject_name + (sub.teacher_name ? `\n(Tr: ${sub.teacher_name})` : ''),
      colSpan,
      styles: { halign: 'center', valign: 'middle' }
    })

    if (sub.tests.length === 0) {
      headRow2.push({ content: 'No tests', styles: { halign: 'center' } })
    } else {
      sub.tests.forEach((t, tIdx) => {
        const isExam = t.assessment_type === 'exam' || t.assessment_type === 'midterm'
        headRow2.push({
          content: `${isExam ? 'Exam' : tIdx + 1}${displayMode !== 'pct' ? `\n/${t.max_mark}` : ''}`,
          styles: { halign: 'center', textColor: isExam ? [194, 65, 12] : [51, 65, 85] }
        })
      })
    }
    headRow2.push({ content: 'Avg %', styles: { halign: 'center', fontStyle: 'bold', fillColor: [240, 253, 244] } })
  })

  headRow1.push({
    content: 'Aggregate\n(Overall %)',
    rowSpan: 2,
    styles: { halign: 'center', valign: 'middle', fillColor: [224, 231, 255], textColor: [55, 48, 163] }
  })

  // Body rows
  const bodyRows: any[] = []
  students.forEach((st, sIdx) => {
    const metrics = studentMetrics.get(st.id)
    const row: any[] = [
      String(sIdx + 1),
      st.roll_no || st.student_no || st.admission_no || '—',
      st.full_name
    ]

    subjectsWithTests.forEach((sub) => {
      const isEnrolled = isStudentEnrolledInSubject ? isStudentEnrolledInSubject(st.id, sub.subject_id) : true
      if (!isEnrolled) {
        if (sub.tests.length === 0) {
          row.push('N/A')
        } else {
          sub.tests.forEach(() => row.push('N/A'))
          row.push('N/A')
        }
        return
      }

      if (sub.tests.length === 0) {
        row.push('—')
        row.push('—')
      } else {
        const hasAnyScoreInSub = sub.tests.some((t) => {
          const raw = scoresMap[t.id]?.[st.id]
          return raw !== undefined && raw !== null
        })

        sub.tests.forEach((t) => {
          const rawScore = scoresMap[t.id]?.[st.id]
          const isTestAdmin = administeredTestIds.has(t.id)
          const isAbsent = hasAnyScoreInSub && isTestAdmin && (rawScore === null || rawScore === undefined)
          const isPending = !isTestAdmin && (rawScore === null || rawScore === undefined)
          row.push(formatScore(rawScore, t.max_mark, displayMode, isAbsent, isPending))
        })
        const subAvg = metrics?.subjectAverages[sub.subject_id] ?? null
        row.push(subAvg !== null ? `${subAvg}%` : '—')
      }
    })

    const aggVal = metrics?.overallAggregatePct ?? null
    row.push(aggVal !== null ? `${aggVal}%` : '—')
    bodyRows.push(row)
  })

  // Footer Row
  const assessedStudentsCount = students.filter((st) => {
    const m = studentMetrics.get(st.id)
    return m && m.overallAggregatePct !== null
  }).length

  const footRow: any[] = [
    { content: `CLASS AVERAGE (N=${assessedStudentsCount} / ${students.length})`, colSpan: 3, styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } }
  ]

  subjectsWithTests.forEach((sub) => {
    if (sub.tests.length === 0) {
      footRow.push('—')
      footRow.push('—')
    } else {
      sub.tests.forEach((t) => {
        const unitAvg = classAverages.unitAverages[t.id] ?? null
        footRow.push({ content: unitAvg !== null ? `${unitAvg}%` : '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [248, 250, 252] } })
      })
      const subClassAvg = classAverages.subjectAverages[sub.subject_id] ?? null
      footRow.push({ content: subClassAvg !== null ? `${subClassAvg}%` : '—', styles: { halign: 'center', fontStyle: 'bold', fillColor: [226, 232, 240] } })
    }
  })

  footRow.push({
    content: classAverages.classOverall !== null ? `${classAverages.classOverall}%` : '—',
    styles: { halign: 'center', fontStyle: 'bold', fillColor: [199, 210, 254], textColor: [30, 27, 75] }
  })

  autoTable(doc, {
    startY: 32,
    margin: { left: margin, right: margin, top: 12, bottom: 12 },
    head: [headRow1, headRow2],
    body: bodyRows,
    foot: [footRow],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: totalCols > 25 ? 7 : 7.5,
      cellPadding: { top: 1.5, bottom: 1.5, left: 1.2, right: 1.2 },
      textColor: [30, 41, 59],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
      valign: 'middle',
      halign: 'center'
    },
    headStyles: {
      fillColor: [30, 58, 138],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: totalCols > 25 ? 7 : 7.5,
      lineWidth: 0.2,
      lineColor: [148, 163, 184]
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: totalCols > 25 ? 32 : 36, halign: 'left' }
    },
    didParseCell: (hookData) => {
      const textVal = hookData.cell.text?.[0] || ''
      if (hookData.section === 'body') {
        if (textVal === 'N/A') {
          hookData.cell.styles.textColor = [148, 163, 184]
          hookData.cell.styles.fillColor = [248, 250, 252]
        } else if (textVal === '=') {
          hookData.cell.styles.textColor = [220, 38, 38] // Absence
          hookData.cell.styles.fontStyle = 'bold'
        } else if (textVal.includes('%')) {
          const match = textVal.match(/(\d+(?:\.\d+)?)\s*%/)
          if (match) {
            const num = parseFloat(match[1])
            if (num >= 65) {
              hookData.cell.styles.textColor = [21, 128, 61] // Pass mark >= 65% green
              hookData.cell.styles.fontStyle = 'bold'
            } else if (num < 50) {
              hookData.cell.styles.textColor = [185, 28, 28] // Fail mark red
              hookData.cell.styles.fontStyle = 'bold'
            }
          }
        }
      } else if (hookData.section === 'foot') {
        if (textVal.includes('%')) {
          const match = textVal.match(/(\d+(?:\.\d+)?)\s*%/)
          if (match) {
            const num = parseFloat(match[1])
            if (num >= 65) {
              hookData.cell.styles.textColor = [21, 128, 61] // Class avg >= 65% green
            }
          }
        }
      }
    },
    didDrawPage: (hookData) => {
      doc.setFontSize(8)
      doc.setTextColor(148, 163, 184)
      const pageStr = `Page ${hookData.pageNumber} of ${doc.getNumberOfPages()}`
      doc.text(pageStr, pageWidth - margin, pageHeight - 6, { align: 'right' })
    }
  })

  const cleanClassName = className.replace(/[^a-zA-Z0-9_-]/g, '_')
  const fileName = `Leera_${cleanClassName}_Marksheet_Broadsheet_${academicYear.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`
  doc.save(fileName)
}
