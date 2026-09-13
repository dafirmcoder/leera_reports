import ExcelJS from 'exceljs'
import type { DetailedAttendanceExport } from './types'

// Converts Excel column index (1-based) to Excel letters (1 -> A, 27 -> AA)
function colLetter(colIdx: number): string {
  let temp = ''
  let letter = ''
  while (colIdx > 0) {
    temp = String.fromCharCode(((colIdx - 1) % 26) + 65)
    letter = temp + letter
    colIdx = Math.floor((colIdx - 1) / 26)
  }
  return letter
}

/**
 * Generates the standard formatted file name:
 * e.g. LIS_Cambridge_Wing_Weekly_Attendance_07-11_Sept_2026.xlsx
 * or LIS_Cambridge_Wing_Monthly_Attendance_Sept_2026.xlsx
 */
export function getAttendanceReportFileName(
  exportData: DetailedAttendanceExport,
  extension: 'xlsx' | 'csv'
): string {
  const { periodType, startDate, endDate, dates } = exportData

  const startD = new Date(startDate + 'T00:00:00')
  // If we have specific school dates (e.g. Mon-Fri), use the last active school date for the label
  const lastActiveIso = dates.length > 0 ? dates[dates.length - 1] : endDate
  const endD = new Date(lastActiveIso + 'T00:00:00')

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
  const startDay = String(startD.getDate()).padStart(2, '0')
  const endDay = String(endD.getDate()).padStart(2, '0')
  const startMonth = monthNames[startD.getMonth()]
  const endMonth = monthNames[endD.getMonth()]
  const year = endD.getFullYear()

  let datePart = ''
  if (periodType === 'weekly') {
    if (startMonth === endMonth) {
      datePart = `${startDay}-${endDay}_${endMonth}_${year}`
    } else {
      datePart = `${startDay}_${startMonth}-${endDay}_${endMonth}_${year}`
    }
    return `LIS_Cambridge_Wing_Weekly_Attendance_${datePart}.${extension}`
  } else if (periodType === 'monthly') {
    datePart = `${endMonth}_${year}`
    return `LIS_Cambridge_Wing_Monthly_Attendance_${datePart}.${extension}`
  } else {
    datePart = `${startDay}_${startMonth}_${year}`
    return `LIS_Cambridge_Wing_Daily_Attendance_${datePart}.${extension}`
  }
}

/**
 * Builds and downloads the multi-sheet Excel (.xlsx) workbook.
 */
export async function downloadAttendanceExcel(exportData: DetailedAttendanceExport): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Leera Reports'
  wb.lastModifiedBy = 'Leera Reports'
  wb.created = new Date()
  wb.modified = new Date()

  const PRIMARY_COLOR = '1F4E5F'
  const LIGHT_COLOR = 'EAF3F8'
  const TOTAL_BG = 'DDEBF1'
  const BORDER_COLOR = 'B7C9D1'

  const borderThin: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF' + BORDER_COLOR } },
    left: { style: 'thin', color: { argb: 'FF' + BORDER_COLOR } },
    bottom: { style: 'thin', color: { argb: 'FF' + BORDER_COLOR } },
    right: { style: 'thin', color: { argb: 'FF' + BORDER_COLOR } }
  }

  const headerFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF' + PRIMARY_COLOR }
  }

  const titleFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF' + PRIMARY_COLOR }
  }

  const totalFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF' + TOTAL_BG }
  }

  const lightFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF' + LIGHT_COLOR }
  }

  // -------------------------------------------------------------------------
  // 1. SUMMARY SHEET
  // -------------------------------------------------------------------------
  const wsSummary = wb.addWorksheet('Summary', {
    views: [{ showGridLines: true }],
    properties: { tabColor: { argb: 'FF1F8A5F' } }
  })

  const { classesData, dates, dateLabels, dayNames, periodType, periodLabel, startDate } = exportData
  const numDays = dates.length

  // Calculate total columns needed for Summary sheet
  // Col 1: Class (A)
  // Col 2: Total Students (B)
  // Col 3 .. 2 + numDays*3: Day P, A & E triplets
  // Followed by: Total Present, Total Absent, Total Excused, Weekly %
  const totalPresColIdx = 2 + numDays * 3 + 1
  const totalAbsColIdx = totalPresColIdx + 1
  const totalExcColIdx = totalAbsColIdx + 1
  const pctColIdx = totalExcColIdx + 1
  const totalCols = pctColIdx

  // Row 1: Main Title
  const periodTitle = periodType === 'weekly' ? 'WEEKLY' : periodType === 'monthly' ? 'MONTHLY' : 'DAILY'
  wsSummary.mergeCells(1, 1, 1, totalCols)
  const titleCell = wsSummary.getCell(1, 1)
  titleCell.value = `CAMBRIDGE WING - ${periodTitle} ATTENDANCE TRACKER`
  titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  titleCell.fill = titleFill
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  wsSummary.getRow(1).height = 26

  // Row 2: Subtitle & Note
  wsSummary.getCell(2, 1).value = periodType === 'monthly' ? 'Month:' : 'Week Starting:'
  wsSummary.getCell(2, 1).font = { bold: true, color: { argb: 'FF' + PRIMARY_COLOR } }

  wsSummary.getCell(2, 2).value = startDate
  wsSummary.getCell(2, 2).font = { bold: true }

  wsSummary.mergeCells(2, 4, 2, totalCols)
  const noteCell = wsSummary.getCell(2, 4)
  noteCell.value = `${periodLabel}. Enter P (Present), A (Absent), or E (Excused) in each class sheet. The Summary updates automatically.`
  noteCell.font = { italic: true, size: 9, color: { argb: 'FF555555' } }
  noteCell.alignment = { vertical: 'middle' }
  wsSummary.getRow(2).height = 20

  // Row 3: Day Names (e.g. MONDAY, TUESDAY...)
  for (let i = 0; i < numDays; i++) {
    const startC = 3 + i * 3
    const endC = startC + 2
    wsSummary.mergeCells(3, startC, 3, endC)
    const dayCell = wsSummary.getCell(3, startC)
    dayCell.value = dayNames[i] || dateLabels[i]
    dayCell.font = { bold: true, size: 10, color: { argb: 'FF' + PRIMARY_COLOR } }
    dayCell.fill = lightFill
    dayCell.alignment = { vertical: 'middle', horizontal: 'center' }
    dayCell.border = borderThin
    wsSummary.getCell(3, startC + 1).border = borderThin
    wsSummary.getCell(3, endC).border = borderThin
  }

  // Row 4: Column Headers
  wsSummary.getCell(4, 1).value = 'Class'
  wsSummary.getCell(4, 2).value = 'Total Students'

  for (let i = 0; i < numDays; i++) {
    const pCol = 3 + i * 3
    const aCol = pCol + 1
    const eCol = pCol + 2
    wsSummary.getCell(4, pCol).value = 'P'
    wsSummary.getCell(4, aCol).value = 'A'
    wsSummary.getCell(4, eCol).value = 'E'
  }

  wsSummary.getCell(4, totalPresColIdx).value = 'Total Present'
  wsSummary.getCell(4, totalAbsColIdx).value = 'Total Absent'
  wsSummary.getCell(4, totalExcColIdx).value = 'Total Excused'
  wsSummary.getCell(4, pctColIdx).value = periodType === 'weekly' ? 'Weekly %' : periodType === 'monthly' ? 'Monthly %' : 'Rate %'

  for (let c = 1; c <= totalCols; c++) {
    const cell = wsSummary.getCell(4, c)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = headerFill
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = borderThin
  }
  wsSummary.getRow(4).height = 22

  // Class Rows: Row 5 to (5 + classesData.length - 1)
  let curRow = 5
  const firstClassRow = 5
  const lastClassRow = firstClassRow + classesData.length - 1

  let overallTotP = 0
  let overallTotA = 0
  let overallTotE = 0
  let overallTotStudents = 0
  const dayPGrandTotals: number[] = new Array(numDays).fill(0)
  const dayAGrandTotals: number[] = new Array(numDays).fill(0)
  const dayEGrandTotals: number[] = new Array(numDays).fill(0)

  // Keep track of sheet names to formulas
  classesData.forEach((cd) => {
    const r = curRow
    const sheetName = cd.classInfo.name
    const safeSheet = `'${sheetName.replace(/'/g, "''")}'`
    const maxStudentRow = 4 + Math.max(cd.students.length, 1) + 10 // enrolled + 10 blank buffer rows

    overallTotStudents += cd.students.length

    // Class Name
    const cellA = wsSummary.getCell(r, 1)
    cellA.value = cd.classInfo.name
    cellA.font = { bold: true }
    cellA.border = borderThin

    // Total Students formula: =COUNTA('Year 5'!B5:B23)
    const cellB = wsSummary.getCell(r, 2)
    cellB.value = { formula: `COUNTA(${safeSheet}!B5:B${maxStudentRow})`, result: cd.students.length }
    cellB.alignment = { horizontal: 'center' }
    cellB.border = borderThin

    const dayPCellCoords: string[] = []
    const dayACellCoords: string[] = []
    const dayECellCoords: string[] = []
    let classPresTotal = 0
    let classAbsTotal = 0
    let classExcTotal = 0

    for (let i = 0; i < numDays; i++) {
      const pCol = 3 + i * 3
      const aCol = pCol + 1
      const eCol = pCol + 2
      const classDayColLet = colLetter(3 + i) // Single day column in class sheet starts at Col C (3)
      const dateIso = dates[i]

      // Count actual records for this class & day
      let dayPCount = 0
      let dayACount = 0
      let dayECount = 0
      for (const st of cd.students) {
        const stStatus = cd.attendanceRecords[`${st.id}_${dateIso}`]
        if (stStatus === 'P') dayPCount++
        else if (stStatus === 'A') dayACount++
        else if (stStatus === 'E') dayECount++
      }
      classPresTotal += dayPCount
      classAbsTotal += dayACount
      classExcTotal += dayECount
      dayPGrandTotals[i] += dayPCount
      dayAGrandTotals[i] += dayACount
      dayEGrandTotals[i] += dayECount

      const pCell = wsSummary.getCell(r, pCol)
      pCell.value = { formula: `COUNTIF(${safeSheet}!${classDayColLet}5:${classDayColLet}${maxStudentRow},"P")`, result: dayPCount }
      pCell.alignment = { horizontal: 'center' }
      pCell.border = borderThin
      dayPCellCoords.push(`${colLetter(pCol)}${r}`)

      const aCell = wsSummary.getCell(r, aCol)
      aCell.value = { formula: `COUNTIF(${safeSheet}!${classDayColLet}5:${classDayColLet}${maxStudentRow},"A")`, result: dayACount }
      aCell.alignment = { horizontal: 'center' }
      aCell.border = borderThin
      dayACellCoords.push(`${colLetter(aCol)}${r}`)

      const eCell = wsSummary.getCell(r, eCol)
      eCell.value = { formula: `COUNTIF(${safeSheet}!${classDayColLet}5:${classDayColLet}${maxStudentRow},"E")`, result: dayECount }
      eCell.alignment = { horizontal: 'center' }
      eCell.border = borderThin
      dayECellCoords.push(`${colLetter(eCol)}${r}`)
    }

    overallTotP += classPresTotal
    overallTotA += classAbsTotal
    overallTotE += classExcTotal

    // Total Present: =SUM(C5,F5,I5...)
    const cellTotP = wsSummary.getCell(r, totalPresColIdx)
    cellTotP.value = { formula: `SUM(${dayPCellCoords.join(',')})`, result: classPresTotal }
    cellTotP.font = { bold: true }
    cellTotP.alignment = { horizontal: 'center' }
    cellTotP.border = borderThin

    // Total Absent: =SUM(D5,G5,J5...)
    const cellTotA = wsSummary.getCell(r, totalAbsColIdx)
    cellTotA.value = { formula: `SUM(${dayACellCoords.join(',')})`, result: classAbsTotal }
    cellTotA.font = { bold: true }
    cellTotA.alignment = { horizontal: 'center' }
    cellTotA.border = borderThin

    // Total Excused: =SUM(E5,H5,K5...)
    const cellTotE = wsSummary.getCell(r, totalExcColIdx)
    cellTotE.value = { formula: `SUM(${dayECellCoords.join(',')})`, result: classExcTotal }
    cellTotE.font = { bold: true }
    cellTotE.alignment = { horizontal: 'center' }
    cellTotE.border = borderThin

    // Weekly %: =IF((P+A+E)=0,"",P/(P+A+E))
    const pLetter = colLetter(totalPresColIdx)
    const aLetter = colLetter(totalAbsColIdx)
    const eLetter = colLetter(totalExcColIdx)
    const cellPct = wsSummary.getCell(r, pctColIdx)
    const classTot = classPresTotal + classAbsTotal + classExcTotal
    const classRate = classTot > 0 ? classPresTotal / classTot : undefined
    cellPct.value = { formula: `IF((${pLetter}${r}+${aLetter}${r}+${eLetter}${r})=0,"",${pLetter}${r}/(${pLetter}${r}+${aLetter}${r}+${eLetter}${r}))`, result: classRate }
    cellPct.numFmt = '0.0%'
    cellPct.font = { bold: true }
    cellPct.alignment = { horizontal: 'center' }
    cellPct.border = borderThin

    wsSummary.getRow(r).height = 19
    curRow++
  })

  // Total Summary Row
  const totalRow = curRow
  const cellTotTitle = wsSummary.getCell(totalRow, 1)
  cellTotTitle.value = 'CAMBRIDGE WING TOTAL'
  cellTotTitle.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  cellTotTitle.fill = headerFill
  cellTotTitle.border = borderThin

  // Students sum
  const cellTotStud = wsSummary.getCell(totalRow, 2)
  cellTotStud.value = { formula: `SUM(B${firstClassRow}:B${lastClassRow})`, result: overallTotStudents }
  cellTotStud.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  cellTotStud.fill = headerFill
  cellTotStud.alignment = { horizontal: 'center' }
  cellTotStud.border = borderThin

  for (let i = 0; i < numDays; i++) {
    const pCol = 3 + i * 3
    const aCol = pCol + 1
    const eCol = pCol + 2
    const pLet = colLetter(pCol)
    const aLet = colLetter(aCol)
    const eLet = colLetter(eCol)

    const cellP = wsSummary.getCell(totalRow, pCol)
    cellP.value = { formula: `SUM(${pLet}${firstClassRow}:${pLet}${lastClassRow})`, result: dayPGrandTotals[i] }
    cellP.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cellP.fill = headerFill
    cellP.alignment = { horizontal: 'center' }
    cellP.border = borderThin

    const cellA = wsSummary.getCell(totalRow, aCol)
    cellA.value = { formula: `SUM(${aLet}${firstClassRow}:${aLet}${lastClassRow})`, result: dayAGrandTotals[i] }
    cellA.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cellA.fill = headerFill
    cellA.alignment = { horizontal: 'center' }
    cellA.border = borderThin

    const cellE = wsSummary.getCell(totalRow, eCol)
    cellE.value = { formula: `SUM(${eLet}${firstClassRow}:${eLet}${lastClassRow})`, result: dayEGrandTotals[i] }
    cellE.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cellE.fill = headerFill
    cellE.alignment = { horizontal: 'center' }
    cellE.border = borderThin
  }

  // Grand Total Present, Absent & Excused cells
  const totPLetter = colLetter(totalPresColIdx)
  const totALetter = colLetter(totalAbsColIdx)
  const totELetter = colLetter(totalExcColIdx)

  const cellOverallPres = wsSummary.getCell(totalRow, totalPresColIdx)
  cellOverallPres.value = { formula: `SUM(${totPLetter}${firstClassRow}:${totPLetter}${lastClassRow})`, result: overallTotP }
  cellOverallPres.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  cellOverallPres.fill = headerFill
  cellOverallPres.alignment = { horizontal: 'center' }
  cellOverallPres.border = borderThin

  const cellOverallAbs = wsSummary.getCell(totalRow, totalAbsColIdx)
  cellOverallAbs.value = { formula: `SUM(${totALetter}${firstClassRow}:${totALetter}${lastClassRow})`, result: overallTotA }
  cellOverallAbs.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  cellOverallAbs.fill = headerFill
  cellOverallAbs.alignment = { horizontal: 'center' }
  cellOverallAbs.border = borderThin

  const cellOverallExc = wsSummary.getCell(totalRow, totalExcColIdx)
  cellOverallExc.value = { formula: `SUM(${totELetter}${firstClassRow}:${totELetter}${lastClassRow})`, result: overallTotE }
  cellOverallExc.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  cellOverallExc.fill = headerFill
  cellOverallExc.alignment = { horizontal: 'center' }
  cellOverallExc.border = borderThin

  // Overall Rate: =IF((TotP+TotA+TotE)=0,"",TotP/(TotP+TotA+TotE))
  const grandTotRecords = overallTotP + overallTotA + overallTotE
  const overallRate = grandTotRecords > 0 ? overallTotP / grandTotRecords : undefined
  const cellOverallPct = wsSummary.getCell(totalRow, pctColIdx)
  cellOverallPct.value = { formula: `IF((${totPLetter}${totalRow}+${totALetter}${totalRow}+${totELetter}${totalRow})=0,"",${totPLetter}${totalRow}/(${totPLetter}${totalRow}+${totALetter}${totalRow}+${totELetter}${totalRow}))`, result: overallRate }
  cellOverallPct.numFmt = '0.0%'
  cellOverallPct.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  cellOverallPct.fill = headerFill
  cellOverallPct.alignment = { horizontal: 'center' }
  cellOverallPct.border = borderThin
  wsSummary.getRow(totalRow).height = 22

  // Snapshot Block
  const snapStartRow = totalRow + 3
  wsSummary.mergeCells(snapStartRow, 1, snapStartRow, 2)
  const snapHeader = wsSummary.getCell(snapStartRow, 1)
  snapHeader.value = `${periodTitle} SNAPSHOT`
  snapHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  snapHeader.fill = titleFill
  snapHeader.alignment = { vertical: 'middle', horizontal: 'center' }
  snapHeader.border = borderThin
  wsSummary.getCell(snapStartRow, 2).border = borderThin

  const snapLabels = [
    { label: 'Total Students', formula: `B${totalRow}`, result: overallTotStudents, fmt: undefined },
    { label: 'Present Records', formula: `${totPLetter}${totalRow}`, result: overallTotP, fmt: undefined },
    { label: 'Absent Records', formula: `${totALetter}${totalRow}`, result: overallTotA, fmt: undefined },
    { label: 'Excused Records', formula: `${totELetter}${totalRow}`, result: overallTotE, fmt: undefined },
    { label: 'Attendance Rate', formula: `${colLetter(pctColIdx)}${totalRow}`, result: overallRate, fmt: '0.0%' }
  ]

  snapLabels.forEach((item, idx) => {
    const rowIdx = snapStartRow + 1 + idx
    const cellL = wsSummary.getCell(rowIdx, 1)
    cellL.value = item.label
    cellL.font = { bold: true, color: { argb: 'FF' + PRIMARY_COLOR } }
    cellL.border = borderThin
    cellL.fill = lightFill

    const cellV = wsSummary.getCell(rowIdx, 2)
    cellV.value = { formula: item.formula, result: item.result }
    cellV.font = { bold: true }
    cellV.alignment = { horizontal: 'center' }
    cellV.border = borderThin
    if (item.fmt) cellV.numFmt = item.fmt
  })

  // Set column widths on Summary
  wsSummary.getColumn(1).width = 24
  wsSummary.getColumn(2).width = 15
  for (let c = 3; c <= totalExcColIdx; c++) {
    wsSummary.getColumn(c).width = 8
  }
  wsSummary.getColumn(totalPresColIdx).width = 14
  wsSummary.getColumn(totalAbsColIdx).width = 14
  wsSummary.getColumn(totalExcColIdx).width = 14
  wsSummary.getColumn(pctColIdx).width = 14

  // -------------------------------------------------------------------------
  // 2. INDIVIDUAL CLASS SHEETS (Single day column format)
  // -------------------------------------------------------------------------
  classesData.forEach((cd) => {
    const sheetName = cd.classInfo.name.slice(0, 31) // Excel 31 char sheet limit
    const ws = wb.addWorksheet(sheetName, {
      views: [{ showGridLines: true }],
      properties: { tabColor: { argb: 'FF' + PRIMARY_COLOR } }
    })

    const classTotalCols = 2 + numDays + 4 // S/N, Name, Days..., Total P, Total A, Total E, Weekly %
    const classTotPColIdx = 2 + numDays + 1
    const classTotAColIdx = classTotPColIdx + 1
    const classTotEColIdx = classTotAColIdx + 1
    const classPctColIdx = classTotEColIdx + 1

    // Row 1: Header
    ws.mergeCells(1, 1, 1, classTotalCols)
    const cTitle = ws.getCell(1, 1)
    cTitle.value = `${cd.classInfo.name.toUpperCase()} - ${periodTitle} ATTENDANCE REGISTER`
    cTitle.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
    cTitle.fill = titleFill
    cTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    ws.getRow(1).height = 26

    // Row 2: Week Starting
    ws.getCell(2, 1).value = periodType === 'monthly' ? 'Month:' : 'Week Starting:'
    ws.getCell(2, 1).font = { bold: true, color: { argb: 'FF' + PRIMARY_COLOR } }

    ws.getCell(2, 2).value = { formula: 'Summary!B2', result: startDate }
    ws.getCell(2, 2).font = { bold: true }

    ws.mergeCells(2, 4, 2, classTotalCols)
    const cNote = ws.getCell(2, 4)
    cNote.value = 'Use P = Present, A = Absent, E = Excused. Rows below the roster are pre-formatted for new admissions.'
    cNote.font = { italic: true, size: 9, color: { argb: 'FF555555' } }
    cNote.alignment = { vertical: 'middle' }
    ws.getRow(2).height = 20

    // Row 4: Column Headers
    ws.getCell(4, 1).value = 'S/N'
    ws.getCell(4, 2).value = 'Student Name'

    for (let i = 0; i < numDays; i++) {
      ws.getCell(4, 3 + i).value = dateLabels[i]
    }

    ws.getCell(4, classTotPColIdx).value = 'Total P'
    ws.getCell(4, classTotAColIdx).value = 'Total A'
    ws.getCell(4, classTotEColIdx).value = 'Total E'
    ws.getCell(4, classPctColIdx).value = periodType === 'weekly' ? 'Weekly %' : periodType === 'monthly' ? 'Monthly %' : 'Rate %'

    for (let c = 1; c <= classTotalCols; c++) {
      const cell = ws.getCell(4, c)
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = headerFill
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      cell.border = borderThin
    }
    ws.getRow(4).height = 22

    // Enrolled Students Rows
    let stRow = 5
    const firstStRow = 5
    const enrolledCount = cd.students.length
    const bufferCount = 10
    const totalStudentRows = enrolledCount + bufferCount

    const dayStartColLet = colLetter(3)
    const dayEndColLet = colLetter(2 + numDays)

    let classPresSum = 0
    let classAbsSum = 0
    let classExcSum = 0

    for (let i = 0; i < totalStudentRows; i++) {
      const r = stRow
      const st = cd.students[i] // might be undefined for buffer rows

      // S/N
      const snCell = ws.getCell(r, 1)
      snCell.value = i + 1
      snCell.alignment = { horizontal: 'center' }
      snCell.border = borderThin

      // Student Name
      const nameCell = ws.getCell(r, 2)
      nameCell.value = st ? st.full_name.toUpperCase() : ''
      nameCell.border = borderThin

      let stPresCount = 0
      let stAbsCount = 0
      let stExcCount = 0

      // Attendance values: single cell per day
      for (let d = 0; d < numDays; d++) {
        const dateIso = dates[d]
        const dCell = ws.getCell(r, 3 + d)
        if (st) {
          const status = cd.attendanceRecords[`${st.id}_${dateIso}`] || ''
          dCell.value = status
          if (status === 'P') stPresCount++
          else if (status === 'A') stAbsCount++
          else if (status === 'E') stExcCount++
        } else {
          dCell.value = ''
        }
        dCell.alignment = { horizontal: 'center' }
        dCell.border = borderThin
      }

      classPresSum += stPresCount
      classAbsSum += stAbsCount
      classExcSum += stExcCount

      // Total P formula: =COUNTIF(C5:G5,"P")
      const totPCell = ws.getCell(r, classTotPColIdx)
      totPCell.value = { formula: `COUNTIF(${dayStartColLet}${r}:${dayEndColLet}${r},"P")`, result: stPresCount }
      totPCell.alignment = { horizontal: 'center' }
      totPCell.border = borderThin

      // Total A formula: =COUNTIF(C5:G5,"A")
      const totACell = ws.getCell(r, classTotAColIdx)
      totACell.value = { formula: `COUNTIF(${dayStartColLet}${r}:${dayEndColLet}${r},"A")`, result: stAbsCount }
      totACell.alignment = { horizontal: 'center' }
      totACell.border = borderThin

      // Total E formula: =COUNTIF(C5:G5,"E")
      const totECell = ws.getCell(r, classTotEColIdx)
      totECell.value = { formula: `COUNTIF(${dayStartColLet}${r}:${dayEndColLet}${r},"E")`, result: stExcCount }
      totECell.alignment = { horizontal: 'center' }
      totECell.border = borderThin

      // Weekly % formula: =IF((P+A+E)=0,"",P/(P+A+E))
      const pLet = colLetter(classTotPColIdx)
      const aLet = colLetter(classTotAColIdx)
      const eLet = colLetter(classTotEColIdx)
      const pctCell = ws.getCell(r, classPctColIdx)
      const stTotal = stPresCount + stAbsCount + stExcCount
      const stRate = stTotal > 0 ? stPresCount / stTotal : undefined
      pctCell.value = { formula: `IF((${pLet}${r}+${aLet}${r}+${eLet}${r})=0,"",${pLet}${r}/(${pLet}${r}+${aLet}${r}+${eLet}${r}))`, result: stRate }
      pctCell.numFmt = '0.0%'
      pctCell.alignment = { horizontal: 'center' }
      pctCell.border = borderThin

      ws.getRow(r).height = 19
      stRow++
    }

    const lastStRow = stRow - 1

    // Class Weekly Total Row
    const classTotRow = stRow
    const totTitleCell = ws.getCell(classTotRow, 1)
    totTitleCell.value = `CLASS ${periodTitle} TOTAL`
    totTitleCell.font = { bold: true }
    totTitleCell.fill = totalFill
    totTitleCell.border = borderThin

    const totStudCell = ws.getCell(classTotRow, 2)
    totStudCell.value = enrolledCount
    totStudCell.font = { bold: true }
    totStudCell.alignment = { horizontal: 'center' }
    totStudCell.fill = totalFill
    totStudCell.border = borderThin

    for (let c = 3; c <= 2 + numDays; c++) {
      const cell = ws.getCell(classTotRow, c)
      cell.fill = totalFill
      cell.border = borderThin
    }

    const classTotPLet = colLetter(classTotPColIdx)
    const classTotALet = colLetter(classTotAColIdx)
    const classTotELet = colLetter(classTotEColIdx)

    const classSumP = ws.getCell(classTotRow, classTotPColIdx)
    classSumP.value = { formula: `SUM(${classTotPLet}${firstStRow}:${classTotPLet}${lastStRow})`, result: classPresSum }
    classSumP.font = { bold: true }
    classSumP.alignment = { horizontal: 'center' }
    classSumP.fill = totalFill
    classSumP.border = borderThin

    const classSumA = ws.getCell(classTotRow, classTotAColIdx)
    classSumA.value = { formula: `SUM(${classTotALet}${firstStRow}:${classTotALet}${lastStRow})`, result: classAbsSum }
    classSumA.font = { bold: true }
    classSumA.alignment = { horizontal: 'center' }
    classSumA.fill = totalFill
    classSumA.border = borderThin

    const classSumE = ws.getCell(classTotRow, classTotEColIdx)
    classSumE.value = { formula: `SUM(${classTotELet}${firstStRow}:${classTotELet}${lastStRow})`, result: classExcSum }
    classSumE.font = { bold: true }
    classSumE.alignment = { horizontal: 'center' }
    classSumE.fill = totalFill
    classSumE.border = borderThin

    const classGrandTot = classPresSum + classAbsSum + classExcSum
    const classGrandRate = classGrandTot > 0 ? classPresSum / classGrandTot : undefined
    const classSumPct = ws.getCell(classTotRow, classPctColIdx)
    classSumPct.value = { formula: `IF((${classTotPLet}${classTotRow}+${classTotALet}${classTotRow}+${classTotELet}${classTotRow})=0,"",${classTotPLet}${classTotRow}/(${classTotPLet}${classTotRow}+${classTotALet}${classTotRow}+${classTotELet}${classTotRow}))`, result: classGrandRate }
    classSumPct.numFmt = '0.0%'
    classSumPct.font = { bold: true }
    classSumPct.alignment = { horizontal: 'center' }
    classSumPct.fill = totalFill
    classSumPct.border = borderThin
    ws.getRow(classTotRow).height = 21

    // Enrolled vs buffer note
    const noteRow = classTotRow + 2
    ws.mergeCells(noteRow, 1, noteRow, classTotalCols)
    const infoCell = ws.getCell(noteRow, 1)
    infoCell.value = `Enrolled students: ${enrolledCount}  |  Extra blank rows ready for new admissions: ${bufferCount}`
    infoCell.font = { italic: true, size: 9, color: { argb: 'FF666666' } }

    // Column widths
    ws.getColumn(1).width = 6
    ws.getColumn(2).width = 32
    for (let d = 0; d < numDays; d++) {
      ws.getColumn(3 + d).width = 13
    }
    ws.getColumn(classTotPColIdx).width = 11
    ws.getColumn(classTotAColIdx).width = 11
    ws.getColumn(classTotEColIdx).width = 11
    ws.getColumn(classPctColIdx).width = 12
  })

  // Write workbook to buffer and trigger browser download
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const fileName = getAttendanceReportFileName(exportData, 'xlsx')

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Builds and downloads the clean CSV (.csv) attendance export.
 */
export function downloadAttendanceCsv(exportData: DetailedAttendanceExport): void {
  const { summary, classesData, periodType, periodLabel, schoolName, dates, dateLabels } = exportData

  const lines: string[] = []

  const escapeCsv = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return ''
    const str = String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  // Header metadata
  lines.push(`${escapeCsv(schoolName.toUpperCase())} - ATTENDANCE REPORT`)
  lines.push(`Period Type,${escapeCsv(periodType.toUpperCase())}`)
  lines.push(`Period,${escapeCsv(periodLabel)}`)
  lines.push(`Generated Date,${escapeCsv(new Date().toLocaleString('en-GB'))}`)
  lines.push('')

  // SECTION 1: School Overview Summary
  lines.push('--- SCHOOL ATTENDANCE OVERVIEW ---')
  lines.push('Total Records,Total Present,Present %,Total Absent,Absent %,Total Excused,Excused %,Overall Attendance Rate %')
  lines.push([
    summary.totalRecords,
    summary.present,
    `${summary.presentPct}%`,
    summary.absent,
    `${summary.absentPct}%`,
    summary.excused,
    `${summary.excusedPct}%`,
    `${summary.presentPct}%`
  ].map(escapeCsv).join(','))
  lines.push('')

  // SECTION 2: Class Breakdown Summary
  lines.push('--- CLASS-BY-CLASS SUMMARY ---')
  lines.push('Class Name,Homeroom Teacher,Days Marked,Present,Present %,Absent,Absent %,Excused,Excused %,Total Records,Attendance Rate %')
  summary.classBreakdown.forEach((c) => {
    lines.push([
      c.class_name,
      c.homeroom_teacher_name || 'Unassigned',
      c.daysMarked,
      c.present,
      `${c.presentPct}%`,
      c.absent,
      `${c.absentPct}%`,
      c.excused,
      `${c.excusedPct}%`,
      c.total,
      `${c.presentPct}%`
    ].map(escapeCsv).join(','))
  })
  lines.push('')

  // SECTION 3: Class Roster Daily Matrix
  lines.push('--- STUDENT ATTENDANCE REGISTER ---')
  const rosterHeaders = ['Class', 'Student No.', 'Student Name', ...dateLabels, 'Total Present', 'Total Absent', 'Total Excused', 'Attendance Rate %']
  lines.push(rosterHeaders.map(escapeCsv).join(','))

  classesData.forEach((cd) => {
    cd.students.forEach((st) => {
      let pCount = 0
      let aCount = 0
      let eCount = 0
      const dayStatuses: string[] = []

      dates.forEach((dateIso) => {
        const stat = cd.attendanceRecords[`${st.id}_${dateIso}`] || ''
        if (stat === 'P') pCount++
        else if (stat === 'A') aCount++
        else if (stat === 'E') eCount++
        dayStatuses.push(stat)
      })

      const totalMarked = pCount + aCount + eCount
      const ratePct = totalMarked > 0 ? `${((pCount / totalMarked) * 100).toFixed(1)}%` : '0.0%'

      lines.push([
        cd.classInfo.name,
        st.student_no,
        st.full_name,
        ...dayStatuses,
        pCount,
        aCount,
        eCount,
        ratePct
      ].map(escapeCsv).join(','))
    })
  })
  lines.push('')

  // SECTION 4: Recorded Absences with Reasons
  if (summary.absences.length > 0) {
    lines.push(`--- RECORDED ABSENCES (${summary.absences.length}) ---`)
    lines.push('Date,Class,Student No.,Student Name,Reason')
    summary.absences.forEach((a) => {
      lines.push([
        a.date,
        a.class_name,
        a.student_no,
        a.student_name,
        a.reason || 'No reason provided'
      ].map(escapeCsv).join(','))
    })
  }

  // Prepend UTF-8 Byte Order Mark (BOM) so Excel reads unicode correctly on Windows
  const csvContent = '\uFEFF' + lines.join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const fileName = getAttendanceReportFileName(exportData, 'csv')

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
