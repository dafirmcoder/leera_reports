import ExcelJS from 'exceljs'
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
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '').trim().slice(0, 31) || 'Marksheet'
}

function formatScore(
  rawScore: number | null | undefined,
  maxMark: number,
  displayMode: 'pct' | 'raw' | 'both'
): string {
  if (rawScore === null || rawScore === undefined) return '—'
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
    displayMode
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
      if (sub.tests.length === 0) {
        const cell = ws.getCell(rowIdx, cIdx)
        cell.value = '—'
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
        cell.border = borderThin
        cIdx++
      } else {
        sub.tests.forEach((t) => {
          const rawScore = scoresMap[t.id]?.[st.id]
          const cell = ws.getCell(rowIdx, cIdx)
          cell.value = formatScore(rawScore, t.max_mark, displayMode)
          cell.alignment = { vertical: 'middle', horizontal: 'center' }
          cell.border = borderThin

          if (rawScore !== null && rawScore !== undefined && t.max_mark > 0) {
            const pct = Math.round((rawScore / t.max_mark) * 100)
            if (pct < 50) {
              cell.font = { color: { argb: 'B91C1C' }, bold: true }
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF2F2' } }
            } else if (pct >= 80) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F0FDF4' } }
            }
          }
          cIdx++
        })

        // Sub avg
        const subAvg = metrics?.subjectAverages[sub.subject_id] ?? null
        const avgCell = ws.getCell(rowIdx, cIdx)
        avgCell.value = subAvg !== null ? `${subAvg}%` : '—'
        avgCell.font = { bold: true, color: { argb: '0F172A' } }
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
    aggCell.font = { bold: true, color: { argb: aggText } }
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

  ws.mergeCells(avgRowIdx, 1, avgRowIdx, 3)
  const avgLabel = ws.getCell(avgRowIdx, 1)
  avgLabel.value = 'CLASS AVERAGE'
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
      cell.font = { bold: true, color: { argb: primaryBlue } }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } }
      cell.border = borderThin
      cIdx++
    }
  })

  // Aggregate class overall
  const overallCell = ws.getCell(avgRowIdx, aggCol)
  overallCell.value = classAverages.classOverall !== null ? `${classAverages.classOverall}%` : '—'
  overallCell.font = { bold: true, size: 11, color: { argb: aggText } }
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
    displayMode
  } = data

  const rows: string[][] = []

  const escapeCsv = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return ''
    const str = String(val)
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

  // Student rows
  students.forEach((st, sIdx) => {
    const row: string[] = [
      String(sIdx + 1),
      st.roll_no || st.student_no || st.admission_no || '',
      st.full_name
    ]

    const metrics = studentMetrics.get(st.id)

    subjectsWithTests.forEach((sub) => {
      if (sub.tests.length === 0) {
        row.push('—')
      } else {
        sub.tests.forEach((t) => {
          const rawScore = scoresMap[t.id]?.[st.id]
          row.push(formatScore(rawScore, t.max_mark, displayMode))
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
  const avgRow: string[] = ['CLASS AVERAGE', '', '']
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
