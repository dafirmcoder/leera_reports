import * as pdfjsLib from 'pdfjs-dist'
import { ParsedWorkPlan, ParsedWorkPlanWeek, ParsedWorkPlanObjective } from './types'

// Configure worker using CDN fallback
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
} catch {
  // worker fallback handled by pdfjs
}

const MONTH_MAP: Record<string, number> = {
  JAN: 0, JANUARY: 0,
  FEB: 1, FEBRUARY: 1,
  MAR: 2, MARCH: 2,
  APR: 3, APRIL: 3,
  MAY: 4,
  JUN: 5, JUNE: 5,
  JUL: 6, JULY: 6,
  AUG: 7, AUGUST: 7,
  SEP: 8, SEPT: 8, SEPTEMBER: 8,
  OCT: 9, OCTOBER: 9,
  NOV: 10, NOVEMBER: 10,
  DEC: 11, DECEMBER: 11
}

interface PositionedPdfItem {
  str: string
  x: number
  y: number
  w: number
  h: number
  page: number
}

/**
 * Extracts raw text items and joined text per page from a PDF File
 */
export async function extractWorkPlanTextFromPdf(file: File): Promise<{
  pagesText: string[]
  fullText: string
  lines: string[]
  positionedItems: PositionedPdfItem[]
  pagesItems: PositionedPdfItem[][]
}> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) })
  const pdf = await loadingTask.promise
  const pagesText: string[] = []
  const allLines: string[] = []
  const positionedItems: PositionedPdfItem[] = []
  const pagesItems: PositionedPdfItem[][] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const pageLines: string[] = []
    const pageItemsList: PositionedPdfItem[] = []

    for (const rawItem of content.items as any[]) {
      const str = (rawItem.str || '').trim()
      if (!str) continue

      const item: PositionedPdfItem = {
        str,
        x: Math.round(rawItem.transform[4] * 10) / 10,
        y: Math.round(rawItem.transform[5] * 10) / 10,
        w: Math.round((rawItem.width || 0) * 10) / 10,
        h: Math.round((rawItem.height || 0) * 10) / 10,
        page: pageNum
      }
      positionedItems.push(item)
      pageItemsList.push(item)
      pageLines.push(str)
    }

    // Sort page items top to bottom (y desc), then left to right (x asc)
    pageItemsList.sort((a, b) => b.y - a.y || a.x - b.x)
    pagesItems.push(pageItemsList)

    pagesText.push(pageLines.join('\n'))
    allLines.push(...pageLines)
  }

  return {
    pagesText,
    fullText: pagesText.join('\n\n'),
    lines: allLines,
    positionedItems,
    pagesItems
  }
}

const BLOOM_VERBS = new Set([
  'define', 'state', 'list', 'recall', 'identify', 'name', 'outline', 'recognise', 'recognize', 'label', 'mention',
  'explain', 'describe', 'discuss', 'distinguish', 'differentiate', 'summarise', 'summarize', 'clarify', 'interpret',
  'paraphrase', 'illustrate', 'understand', 'know', 'recap', 'overview',
  'apply', 'calculate', 'solve', 'demonstrate', 'draw', 'construct', 'use', 'implement', 'prepare', 'show', 'convert',
  'analyse', 'analyze', 'compare', 'contrast', 'categorise', 'categorize', 'classify', 'examine', 'investigate', 'explore',
  'evaluate', 'assess', 'justify', 'appraise', 'critique', 'review', 'judge', 'prioritise', 'prioritize',
  'design', 'formulate', 'create', 'compose', 'plan', 'devise', 'synthesise', 'synthesize', 'propose', 'build',
  'carry', 'sketch', 'select', 'locate', 'find', 'determine',
  'give', 'ask', 'spell', 'deduce', 'read', 'write'
])

export function isBloomObjective(text: string): boolean {
  const normalized = text.replace(/^([A-Z])\s+([a-z]{2,})/i, '$1$2')
  const clean = normalized.replace(/^[•*▪▫◦►✓✔\-\—\d\.\)\(\s\uF0B7\uF0A7\uFFFD]+/, '').trim().toLowerCase()
  const firstWord = clean.split(/\s+/)[0] || ''
  if (BLOOM_VERBS.has(firstWord)) return true
  const stemmed = firstWord.replace(/(?:ing|es|s|ed)$/, '')
  if (BLOOM_VERBS.has(stemmed)) return true
  if (BLOOM_VERBS.has(stemmed + 'e')) return true
  if (/^(?:learners?|students?)\s+(?:will|should|are able to|can)\b/i.test(clean)) return true
  if (/^(?:course overview|overview of|recap of)\b/i.test(clean)) return true
  return false
}

export function cleanJoinedText(str: string): string {
  return str
    .replace(/^([A-Z])\s+([a-z]{2,})/g, '$1$2')
    .replace(/\s+/g, ' ')
    .replace(/(\w+)\s*-\s*(\w+)/g, '$1-$2')
    .replace(/(\w+)\s*–\s*(\w+)/g, '$1 – $2')
    .trim()
}

function assembleVisualLines(items: PositionedPdfItem[]): Array<{ y: number; x: number; text: string }> {
  const lines: Array<{ y: number; x: number; text: string }> = []
  let cur: PositionedPdfItem[] = []
  let curY: number | null = null

  for (const it of items) {
    if (curY === null || Math.abs(it.y - curY) > 3.5) {
      if (cur.length > 0) {
        cur.sort((a, b) => a.x - b.x)
        lines.push({
          y: curY!,
          x: cur[0].x,
          text: cleanJoinedText(cur.map((ci) => ci.str).join(' '))
        })
      }
      cur = [it]
      curY = it.y
    } else {
      cur.push(it)
    }
  }

  if (cur.length > 0) {
    cur.sort((a, b) => a.x - b.x)
    lines.push({
      y: curY!,
      x: cur[0].x,
      text: cleanJoinedText(cur.map((ci) => ci.str).join(' '))
    })
  }

  return lines
}

/**
 * Attempts to parse date range strings into ISO dates
 */
function parseTermDates(dateStr: string, defaultYear = 2026): { startDate: string | null; endDate: string | null } {
  if (!dateStr) return { startDate: null, endDate: null }

  const cleaned = dateStr.replace(/(\d+)(?:st|nd|rd|th)/gi, '$1').replace(/\s+/g, ' ').trim()

  // Format 1: "24 – 28 AUGUST" or "24TH – 28TH AUG" or "30 NOV – 4 DEC" or "31 AUG – 4 SEP"
  const wordMonthMatch = cleaned.match(/(\d{1,2})\s*([A-Za-z]{3,9})?\s*[–\-—]\s*(\d{1,2})\s*([A-Za-z]{3,9})/i)
  if (wordMonthMatch) {
    const startDay = parseInt(wordMonthMatch[1], 10)
    const m1Key = (wordMonthMatch[2] || '').toUpperCase().slice(0, 3)
    const endDay = parseInt(wordMonthMatch[3], 10)
    const m2Key = wordMonthMatch[4].toUpperCase().slice(0, 3)
    const endMonthIdx = MONTH_MAP[m2Key]
    const startMonthIdx = m1Key && MONTH_MAP[m1Key] !== undefined ? MONTH_MAP[m1Key] : (endMonthIdx !== undefined ? (startDay > endDay ? (endMonthIdx + 11) % 12 : endMonthIdx) : undefined)

    if (startMonthIdx !== undefined && endMonthIdx !== undefined && !isNaN(startDay) && !isNaN(endDay)) {
      const s = new Date(Date.UTC(defaultYear, startMonthIdx, startDay))
      const e = new Date(Date.UTC(defaultYear, endMonthIdx, endDay))
      return {
        startDate: s.toISOString().split('T')[0],
        endDate: e.toISOString().split('T')[0]
      }
    }
  }

  // Format 2: "15/01 - 19/01"
  const slashMatch = cleaned.match(/(\d{1,2})\/(\d{1,2})\s*[–\-—]\s*(\d{1,2})\/(\d{1,2})/)
  if (slashMatch) {
    const startDay = parseInt(slashMatch[1], 10)
    const startMonth = parseInt(slashMatch[2], 10) - 1
    const endDay = parseInt(slashMatch[3], 10)
    const endMonth = parseInt(slashMatch[4], 10) - 1
    const s = new Date(Date.UTC(defaultYear, startMonth, startDay))
    const e = new Date(Date.UTC(defaultYear, endMonth, endDay))
    return {
      startDate: s.toISOString().split('T')[0],
      endDate: e.toISOString().split('T')[0]
    }
  }

  return { startDate: null, endDate: null }
}

/**
 * Expands range expressions like "9CS.05 – 9CS.08" in remarks text into specific covered or uncovered code sets.
 */
function expandCodeRangeFromRemarks(remarks: string): { coveredCodes: Set<string>; uncoveredCodes: Set<string> } {
  const coveredCodes = new Set<string>()
  const uncoveredCodes = new Set<string>()
  if (!remarks) return { coveredCodes, uncoveredCodes }

  const clauses = remarks.split(/;|\n|\|/)
  for (const clause of clauses) {
    const isUncovered = /\b(?:not\s*(?:yet)?\s*covered|uncovered|rescheduled|pending|deferred)\b/i.test(clause)
    const isCovered = /\b(?:all covered|fully covered|covered|completed|commed|taught)\b/i.test(clause)

    // Range: e.g. "9CS.05 – 9CS.08" or "9DC.01 – 9DC.03"
    const rangeMatches = clause.matchAll(/(\d+[A-Za-z]+\.)(\d+)\s*[–\-—]\s*(\d+[A-Za-z]+\.)(\d+)/g)
    for (const rm of rangeMatches) {
      const p1 = rm[1]
      const sNum = parseInt(rm[2], 10)
      const p2 = rm[3]
      const eNum = parseInt(rm[4], 10)
      if (p1 === p2 && sNum <= eNum) {
        for (let n = sNum; n <= eNum; n++) {
          const code = `${p1}${n.toString().padStart(2, '0')}`
          if (isUncovered) uncoveredCodes.add(code)
          else if (isCovered) coveredCodes.add(code)
        }
      }
    }

    // Individual code: e.g. "9CS.01", "9CS.02"
    const codeMatches = clause.matchAll(/(\d+[A-Za-z]+\.\d{2})/g)
    for (const cm of codeMatches) {
      const code = cm[1]
      if (isUncovered) uncoveredCodes.add(code)
      else if (isCovered) coveredCodes.add(code)
    }
  }

  return { coveredCodes, uncoveredCodes }
}

/**
 * Evaluates coverage from remarks column text (covered vs uncovered for lesson planning).
 */
function evaluateCoverageFromRemarks(
  remarks: string,
  objectives: ParsedWorkPlanObjective[]
): { isCommed: boolean; updatedObjectives: ParsedWorkPlanObjective[] } {
  const text = (remarks || '').trim()
  if (!text) {
    // Uncovered by default for lesson planning
    const updated = objectives.map((o) => ({ ...o, is_met: false }))
    return { isCommed: false, updatedObjectives: updated }
  }

  const { coveredCodes, uncoveredCodes } = expandCodeRangeFromRemarks(text)

  const updated = objectives.map((obj) => {
    if (uncoveredCodes.has(obj.code)) {
      return { ...obj, is_met: false }
    }
    if (coveredCodes.has(obj.code)) {
      return { ...obj, is_met: true }
    }
    if (/\b(?:not\s*(?:yet)?\s*covered|uncovered|rescheduled)\b/i.test(text) && !/\ball covered\b/i.test(text)) {
      return { ...obj, is_met: false }
    }
    if (/\b(?:all covered|fully covered|covered)\b/i.test(text)) {
      return { ...obj, is_met: true }
    }
    return { ...obj, is_met: false }
  })

  const isCommed = updated.length > 0 && updated.every((o) => o.is_met)
  return { isCommed, updatedObjectives: updated }
}

/**
 * High-precision tabular parser for Semester Work Plans using bounding box column detection.
 */
function tryParseTabularWorkPlan(
  pagesItems: PositionedPdfItem[][],
  academicYear: string,
  defaultSubjectCode: string
): ParsedWorkPlanWeek[] | null {
  if (!pagesItems || pagesItems.length === 0) return null

  // 1. Table Header detection on page 0
  const headerItem = pagesItems[0]?.find(
    (it) => /^(?:TOPIC|TOPIC\/\s*LEARNING OBJECTIVE|TOPIC\s*\/\s*LEARNING OBJECTIVES\s*\/\s*MATERIALS|WEEK|WEEK\s*\/\s*ITEM)$/i.test(it.str) && it.y > 300
  )
  const tableTopP0 = headerItem ? headerItem.y - 5 : 500
  const remarksHeader = pagesItems[0]?.find(
    (it) => /^(?:REMARKS?|COMMENTS?|REMARKS\s*\/\s*USE IN THIS PLAN)$/i.test(it.str) && it.y > 300
  )
  const remarksColMinX = remarksHeader ? remarksHeader.x - 20 : 640

  // 2. Week Sequence detection (monotonically increasing 1..30 across pages)
  const digits: Array<{ pageIndex: number; y: number; x: number; val: number }> = []
  for (let p = 0; p < pagesItems.length; p++) {
    const maxY = p === 0 ? tableTopP0 : 590
    for (const it of pagesItems[p]) {
      const m = it.str.match(/^(?:WEEK\s*|WK\s*|W\s*)?(\d{1,2})$/i)
      if (it.y < maxY && it.y > 25 && it.x > 30 && it.x < 250 && m) {
        const val = parseInt(m[1], 10)
        if (val >= 1 && val <= 30) {
          digits.push({ pageIndex: p, y: it.y, x: it.x, val })
        }
      }
    }
  }

  let bestSeq: Array<{ pageIndex: number; y: number; x: number; val: number }> = []
  let bestWeekX = 0
  const uniqueXs = [...new Set(digits.map((d) => Math.round(d.x)))]
  for (const testX of uniqueXs) {
    const inBucket = digits.filter((d) => Math.abs(d.x - testX) <= 6)
    inBucket.sort((a, b) => a.pageIndex - b.pageIndex || b.y - a.y)
    const seq: Array<{ pageIndex: number; y: number; x: number; val: number }> = []
    let nextExpected = 1
    for (const d of inBucket) {
      if (d.val === nextExpected) {
        seq.push(d)
        nextExpected++
      }
    }
    if (seq.length > bestSeq.length) {
      bestSeq = seq
      bestWeekX = testX
    }
  }

  if (bestSeq.length < 4) return null

  // Dynamic content column start
  let contentColMinX = 180
  if (bestWeekX < 100) {
    contentColMinX = 135
  } else if (bestWeekX > 175) {
    contentColMinX = 235
  }

  // Helper: determine the start Y of a week row on its page
  function getWeekRowStartY(
    w: { pageIndex: number; y: number; x: number; val: number },
    prevW: { pageIndex: number; y: number; x: number; val: number } | null,
    pageIndex: number
  ): number {
    const pItems = pagesItems[pageIndex]
    const maxAllowedY = pageIndex === 0 ? tableTopP0 : 590

    if (!prevW || prevW.pageIndex !== pageIndex) {
      // First week starting on this page: check if there is a UNIT heading above it
      const unitAbove = pItems.find(
        (it) =>
          it.y >= w.y &&
          it.y < maxAllowedY &&
          it.x >= contentColMinX &&
          it.x < remarksColMinX &&
          /^(?:UNIT|TOPIC|CHAPTER)\b/i.test(it.str)
      )
      if (unitAbove) return unitAbove.y + 5
      return pageIndex === 0 ? tableTopP0 : w.y + 5
    }

    // Previous week was on this same page:
    // Look for UNIT heading or Milestone between prevW.y - 12 and w.y
    const unitBetween = pItems.filter(
      (it) =>
        it.y < prevW.y - 12 &&
        it.y >= w.y &&
        it.x >= contentColMinX &&
        it.x < remarksColMinX &&
        (/^(?:UNIT|TOPIC|CHAPTER)\b/i.test(it.str) ||
          /^(?:END\s*OF\s*UNIT|REVISION\s*WEEK|SEMESTER\s*ASSESSMENT)/i.test(it.str))
    )
    if (unitBetween.length > 0) {
      unitBetween.sort((a, b) => b.y - a.y)
      return unitBetween[0].y + 5
    }

    return w.y + 5
  }

  let defaultYearNum = 2026
  try {
    defaultYearNum = parseInt(academicYear.split('/')[0], 10) || 2026
  } catch {}

  const parsedWeeks: ParsedWorkPlanWeek[] = []
  let currentMonth = 'AUGUST'

  for (let i = 0; i < bestSeq.length; i++) {
    const curW = bestSeq[i]
    const prevW = i > 0 ? bestSeq[i - 1] : null
    const nextW = i < bestSeq.length - 1 ? bestSeq[i + 1] : null
    const pIdx = curW.pageIndex

    const rowStartY = getWeekRowStartY(curW, prevW, pIdx)

    // Row end Y on this page
    let rowEndY: number
    if (nextW && nextW.pageIndex === pIdx) {
      rowEndY = getWeekRowStartY(nextW, curW, pIdx)
    } else {
      const resItem = pagesItems[pIdx].find((it) => /^(?:SUPPORTING\s+)?RESOURCES?:?$/i.test(it.str))
      rowEndY = resItem ? resItem.y : 25
    }

    let weekItems = pagesItems[pIdx].filter((it) => it.y <= rowStartY && it.y > rowEndY)

    // Multi-page continuation
    if (nextW && nextW.pageIndex > pIdx) {
      const nextPIdx = nextW.pageIndex
      const nextRowStart = getWeekRowStartY(nextW, curW, nextPIdx)
      // Continuation items are strictly those on nextPIdx above nextRowStart
      const continuationItems = pagesItems[nextPIdx].filter((it) => it.y < 590 && it.y > nextRowStart)
      if (continuationItems.length > 0) {
        weekItems = [...weekItems, ...continuationItems]
      }
    }

    // 1. Month update in x < 100
    const mItem = weekItems.find(
      (it) => it.x < 100 && it.str.length > 2 && !it.str.includes('MONTH') && !it.str.includes('SEMESTER')
    )
    if (mItem) {
      currentMonth = mItem.str.toUpperCase()
    }

    // 2. Dates in week gutter
    const dateItems = weekItems.filter(
      (it) => it.x < contentColMinX && it.x >= 35 && Math.abs(it.y - curW.y) > 2
    )
    const termDates = dateItems.map((it) => it.str).join(' ').replace(/\s*–\s*/g, ' – ')

    // 3. Remarks
    const remarksItems = weekItems.filter((it) => it.x >= remarksColMinX).map((it) => it.str)
    const remarks = cleanJoinedText(remarksItems.join(' '))

    // 4. Learning Objectives & Topics in content column
    const colItems = weekItems.filter((it) => it.x >= contentColMinX && it.x < remarksColMinX)
    const visualLines = assembleVisualLines(colItems)

    // Filter out everything after "Weekly Lesson Breakdown" or lesson activities
    const breakdownIdx = visualLines.findIndex(
      (vl) =>
        /Weekly Lesson Breakdown/i.test(vl.text) ||
        /^•?\s*Lesson\s*\d+\s*[:\-]/i.test(vl.text) ||
        /^Activities\s*[:\-]/i.test(vl.text)
    )
    const contentLines = breakdownIdx >= 0 ? visualLines.slice(0, breakdownIdx) : visualLines

    // Structure parser for Topic, Subtopics, and Objectives
    const topicsList: string[] = []
    let activeTopicOrSubtopic = ''
    const rawObjectives: ParsedWorkPlanObjective[] = []
    let curObjective: { code: string; text: string; topic_title?: string } | null = null

    const finalizeCurObjective = () => {
      if (curObjective && curObjective.text.trim()) {
        rawObjectives.push({
          code: curObjective.code,
          text: cleanJoinedText(curObjective.text),
          is_met: false,
          topic_title: curObjective.topic_title || activeTopicOrSubtopic || 'General Curriculum'
        })
        curObjective = null
      }
    }

    const CAMBRIDGE_CODE_RE = /^(?:[•*▪▫◦►✓✔\-\—\uF0B7\uF0A7\uFFFD]\s*)?(\*?[0-9]{1,2}[A-Za-z]{1,4}\.[0-9]{1,3}[A-Za-z0-9\-]*)\s*[:\-]?\s*(.*)/
    const NUMBERED_MATH_LO_RE = /^(\d+)\s*\.\s*(\d+)\s*\.?\s+(.*)/
    const NUMBERED_LO_RE = /^[•*▪▫◦►✓✔\-\—\uF0B7\uF0A7\uFFFD]\s*(\d+\.\d+)\s+([^:]+):\s*(.*)/
    const BULLET_START_RE = /^[•*▪▫◦►✓✔\-\—\uF0B7\uF0A7\uFFFD]\s*(.*)/
    const TOPIC_PREFIX_RE = /^(?:UNIT|TOPIC|CHAPTER|STRAND|SECTION)\s*(\d+|[A-Z0-9\.\-]+)?[:\.\-·]?\s*(.*)/i
    const NUMBERED_SUBTOPIC_RE = /^(\d+\.\d+)\s+([A-Za-z].*)/
    const MILESTONE_RE = /^(?:REVISION\s*WEEK|END\s*OF\s*UNIT\s*TEST|SEMESTER\s*ASSESSMENTS?|END\s*OF\s*FIRST\s*SEMESTER|MID-TERM\s*BREAK|PUBLIC\s*HOLIDAY|PTC)/i

    for (const vl of contentLines) {
      const text = vl.text
      if (!text) continue

      if (/^Learning Objectives:?$/i.test(text)) {
        finalizeCurObjective()
        continue
      }

      // Cambridge explicit code: "• 9CS.01: Identify improvements..."
      const cambMatch = text.match(CAMBRIDGE_CODE_RE)
      if (cambMatch && !/^(?:UNIT|TOPIC|REVISION|SEMESTER|RESOURCES?|MONTH|WEEK|TERM|OBJECTIVES?)$/i.test(cambMatch[1])) {
        finalizeCurObjective()
        curObjective = {
          code: cambMatch[1].replace(/^\*/, '').trim(),
          text: cambMatch[2] || '',
          topic_title: activeTopicOrSubtopic
        }
        continue
      }

      // Numbered LO with subtopic description: "• 5.1 Living standards: explain..."
      const numLoMatch = text.match(NUMBERED_LO_RE)
      if (numLoMatch) {
        finalizeCurObjective()
        const code = numLoMatch[1]
        const subTitle = numLoMatch[2].trim()
        const desc = numLoMatch[3].trim()
        curObjective = {
          code,
          text: `${subTitle}: ${desc}`,
          topic_title: activeTopicOrSubtopic || subTitle
        }
        continue
      }

      // Numbered Math objective: "1.1. Carry out..."
      const numMathMatch = text.match(NUMBERED_MATH_LO_RE)
      if (numMathMatch && isBloomObjective(numMathMatch[3])) {
        finalizeCurObjective()
        const code = `${numMathMatch[1]}.${numMathMatch[2]}`
        curObjective = {
          code,
          text: numMathMatch[3].trim(),
          topic_title: activeTopicOrSubtopic
        }
        continue
      }

      // Milestone / Non-instructional event line
      if (MILESTONE_RE.test(text)) {
        finalizeCurObjective()
        if (!topicsList.includes(text)) topicsList.push(text)
        activeTopicOrSubtopic = text
        continue
      }

      // Numbered subtopic or Topic heading
      const isNumSubtopic = NUMBERED_SUBTOPIC_RE.test(text) && !isBloomObjective(text)
      const isTopicHead = TOPIC_PREFIX_RE.test(text) && !isBloomObjective(text)

      if (isNumSubtopic || isTopicHead) {
        finalizeCurObjective()
        if (!topicsList.includes(text)) topicsList.push(text)
        activeTopicOrSubtopic = text
        continue
      }

      // Standard bullet point objective
      const bulletMatch = text.match(BULLET_START_RE)
      if (bulletMatch) {
        finalizeCurObjective()
        const objSeq = rawObjectives.length + 1
        const code = `${defaultSubjectCode ? defaultSubjectCode + '.' : ''}W${curW.val}.${objSeq}`
        curObjective = {
          code,
          text: bulletMatch[1].trim(),
          topic_title: activeTopicOrSubtopic
        }
        continue
      }

      // Continuation of current objective
      if (curObjective) {
        curObjective.text += ' ' + text
        continue
      }

      // Unbulleted action-verb objective
      if (isBloomObjective(text)) {
        finalizeCurObjective()
        const objSeq = rawObjectives.length + 1
        const code = `${defaultSubjectCode ? defaultSubjectCode + '.' : ''}W${curW.val}.${objSeq}`
        curObjective = {
          code,
          text: text.trim(),
          topic_title: activeTopicOrSubtopic
        }
        continue
      }

      // Unmatched leading text: title/topic component
      if (!topicsList.includes(text) && text.length < 120) {
        topicsList.push(text)
        activeTopicOrSubtopic = text
      }
    }
    finalizeCurObjective()

    const topic = topicsList.join(' — ').replace(/\s*—\s*—\s*/g, ' — ') || activeTopicOrSubtopic || 'General Curriculum'
    const { isCommed, updatedObjectives } = evaluateCoverageFromRemarks(remarks, rawObjectives)
    const { startDate, endDate } = parseTermDates(
      termDates ? `${termDates} ${currentMonth}` : '',
      defaultYearNum
    )

    const isInstructional = !/(?:REVISION|ASSESSMENT|PTC|EXAM|HOLIDAY|BREAK)/i.test(topic) || rawObjectives.length > 0

    parsedWeeks.push({
      sequence: curW.val,
      week_label: `Week ${curW.val}`,
      month_label: currentMonth,
      term_dates: termDates,
      start_date: startDate,
      end_date: endDate,
      is_instructional: isInstructional,
      topic_title: topic,
      challenge_title: '',
      subtopic_title: '',
      lessons_per_week: 3,
      remarks,
      objectives: updatedObjectives,
      is_commed: isCommed
    })
  }

  return parsedWeeks.length > 0 ? parsedWeeks : null
}

/**
 * Main parser for Semester Work Plans (supporting Cambridge & Leera/CambriFy layouts)
 */
export async function parseWorkPlanPdf(file: File): Promise<ParsedWorkPlan> {
  const { lines, fullText, pagesItems } = await extractWorkPlanTextFromPdf(file)
  const textLower = fullText.toLowerCase()

  // First 35 lines for header inspection
  const headerLines = lines.slice(0, 35).join(' ')

  // 1. Detect Framework
  let framework = 'CAMBRIDGE_LOWER_SECONDARY'
  if (/as\s*&?\s*a\s*level|year\s*(?:12|13)|grade\s*(?:12|13)/i.test(headerLines)) {
    framework = 'CAMBRIDGE_AS_A_LEVEL'
  } else if (/igcse|year\s*(?:10|11)|grade\s*(?:10|11)/i.test(headerLines)) {
    framework = 'CAMBRIDGE_IGCSE'
  } else if (/year\s*(?:7|8|9)|stage\s*(?:7|8|9)|grade\s*(?:7|8|9)|lower\s*secondary/i.test(headerLines)) {
    framework = 'CAMBRIDGE_LOWER_SECONDARY'
  } else if (/primary|year\s*[1-6]|stage\s*[1-6]|grade\s*[1-6]/i.test(headerLines)) {
    framework = 'CAMBRIDGE_PRIMARY'
  } else if (textLower.includes('as & a level') || textLower.includes('a level')) {
    framework = 'CAMBRIDGE_AS_A_LEVEL'
  } else if (textLower.includes('igcse')) {
    framework = 'CAMBRIDGE_IGCSE'
  }

  // 2. Detect Subject Name
  let subjectName = ''
  if (/computing/i.test(headerLines) || textLower.includes('computing')) {
    subjectName = 'Computing'
  } else if (/computer\s*science/i.test(headerLines) || textLower.includes('computer science')) {
    subjectName = 'Computer Science'
  } else if (/mathematics|maths/i.test(headerLines) || textLower.includes('mathematics')) {
    subjectName = 'Mathematics'
  } else if (/biology/i.test(headerLines) || textLower.includes('biology')) {
    subjectName = 'Biology'
  } else if (/chemistry/i.test(headerLines) || textLower.includes('chemistry')) {
    subjectName = 'Chemistry'
  } else if (/physics/i.test(headerLines) || textLower.includes('physics')) {
    subjectName = 'Physics'
  } else if (/global\s*perspectives/i.test(headerLines) || textLower.includes('global perspective')) {
    subjectName = 'Global Perspectives'
  } else if (/english/i.test(headerLines) || textLower.includes('english')) {
    subjectName = 'English'
  } else if (/science/i.test(headerLines) || textLower.includes('science')) {
    subjectName = 'Science'
  } else if (/business\s*studies/i.test(headerLines)) {
    subjectName = 'Business Studies'
  } else if (/economics/i.test(headerLines)) {
    subjectName = 'Economics'
  }

  // 3. Detect Subject Code (4-digit Cambridge Code)
  let subjectCode = ''
  const fileCodeMatch = file.name.match(/\b(0\d{3}|1\d{3}|9\d{3})\b/)
  if (fileCodeMatch) subjectCode = fileCodeMatch[1]

  if (!subjectCode) {
    for (let i = 0; i < Math.min(35, lines.length); i++) {
      const m = lines[i].match(/\b(0\d{3}|1\d{3}|9\d{3})\b/)
      if (m) {
        subjectCode = m[1]
        break
      }
    }
  }

  // Canonical Cambridge Subject Code defaults
  if (!subjectCode) {
    if (framework === 'CAMBRIDGE_LOWER_SECONDARY') {
      if (subjectName === 'Computing') subjectCode = '0860'
      else if (subjectName === 'Mathematics') subjectCode = '0862'
      else if (subjectName === 'Science') subjectCode = '0893'
      else if (subjectName === 'English') subjectCode = '0861'
      else if (subjectName === 'Global Perspectives') subjectCode = '1129'
    } else if (framework === 'CAMBRIDGE_PRIMARY') {
      if (subjectName === 'Computing') subjectCode = '0059'
      else if (subjectName === 'Mathematics') subjectCode = '0096'
      else if (subjectName === 'Science') subjectCode = '0097'
      else if (subjectName === 'English') subjectCode = '0058'
      else if (subjectName === 'Global Perspectives') subjectCode = '0838'
    } else if (framework === 'CAMBRIDGE_IGCSE') {
      if (subjectName === 'Computer Science') subjectCode = '0478'
      else if (subjectName === 'Economics') subjectCode = '0455'
      else if (subjectName === 'Business Studies' || subjectName === 'Business') subjectCode = '0450'
      else if (subjectName === 'Mathematics') subjectCode = '0580'
      else if (subjectName === 'Biology') subjectCode = '0610'
      else if (subjectName === 'Chemistry') subjectCode = '0620'
      else if (subjectName === 'Physics') subjectCode = '0625'
      else if (subjectName === 'English') subjectCode = '0500'
      else if (subjectName === 'Global Perspectives') subjectCode = '0457'
    } else if (framework === 'CAMBRIDGE_AS_A_LEVEL') {
      if (subjectName === 'Computer Science') subjectCode = '9618'
      else if (subjectName === 'Economics') subjectCode = '9708'
      else if (subjectName === 'Business Studies' || subjectName === 'Business') subjectCode = '9609'
      else if (subjectName === 'Mathematics') subjectCode = '9709'
      else if (subjectName === 'Biology') subjectCode = '9700'
      else if (subjectName === 'Chemistry') subjectCode = '9701'
      else if (subjectName === 'Physics') subjectCode = '9702'
      else if (subjectName === 'Global Perspectives') subjectCode = '9239'
    }
  }

  // 4. Detect Class / Year Group
  let className = ''
  const classMatch = headerLines.match(/\b(Year\s*\d+|Grade\s*\d+|Stage\s*\d+|AS\s*Level|A\s*Level)\b/i)
  if (classMatch) {
    className = classMatch[1].replace(/\s+/g, ' ')
  }

  // 5. Detect Academic Year & Semester
  let academicYear = '2026/2027'
  const yearMatch = fullText.match(/\b(202[4-9]\s*[\/-]\s*202[5-9]|202[4-9])\b/)
  if (yearMatch) {
    academicYear = yearMatch[1].replace(/\s+/g, '')
    if (!academicYear.includes('/')) {
      const yrNum = parseInt(academicYear, 10)
      academicYear = `${yrNum}/${yrNum + 1}`
    }
  }

  let semester = '1'
  if (/semester\s*2|term\s*2/i.test(headerLines)) semester = '2'
  else if (/semester\s*3|term\s*3/i.test(headerLines)) semester = '3'

  // 6. Detect Teacher Name
  let teacherName = ''
  for (let i = 0; i < Math.min(35, lines.length); i++) {
    const m = lines[i].match(/(?:Teacher|Facilitator|Instructor|Prepared By)\s*[:\-]\s*([A-Za-z\.\s]+)/i)
    if (m) {
      teacherName = m[1].trim()
      break
    }
  }
  if (!teacherName) {
    const lineMatch = headerLines.match(/[·•]\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)\s*(?:\||SEMESTER)/)
    if (lineMatch) teacherName = lineMatch[1].trim()
  }

  // 7. Parse Table of Weeks, Term Dates, Topics, Objectives, Coverage
  // Strategy 1: High-precision Tabular Parser using 2D coordinates
  const tabularWeeks = tryParseTabularWorkPlan(pagesItems, academicYear, subjectCode)
  if (tabularWeeks && tabularWeeks.length > 0) {
    return {
      raw_text: fullText,
      title: `${subjectName || 'Subject'} Semester ${semester} Work Plan`,
      framework,
      subject_code: subjectCode || undefined,
      subject_name: subjectName || undefined,
      class_name: className || undefined,
      teacher_name: teacherName || undefined,
      academic_year: academicYear,
      semester,
      needs_subject_code: !subjectCode,
      weeks: tabularWeeks,
      resources: '',
      notes: 'Imported from teacher Semester 1 work plan'
    }
  }

  // Strategy 2: Sequential line-by-line fallback
  const weeks: ParsedWorkPlanWeek[] = []
  let currentMonth = 'MONTH 1'
  let currentWeek: Partial<ParsedWorkPlanWeek> | null = null

  const finalizeCurrentWeek = () => {
    if (currentWeek && currentWeek.sequence !== undefined) {
      const { isCommed, updatedObjectives } = evaluateCoverageFromRemarks(
        currentWeek.remarks || '',
        currentWeek.objectives || []
      )

      weeks.push({
        sequence: currentWeek.sequence,
        week_label: currentWeek.week_label || `Week ${currentWeek.sequence}`,
        month_label: currentWeek.month_label || currentMonth,
        term_dates: currentWeek.term_dates || '',
        start_date: currentWeek.start_date || null,
        end_date: currentWeek.end_date || null,
        is_instructional: currentWeek.is_instructional ?? true,
        event_label: currentWeek.event_label || '',
        topic_title: currentWeek.topic_title || '',
        challenge_title: currentWeek.challenge_title || '',
        subtopic_title: currentWeek.subtopic_title || '',
        lessons_per_week: currentWeek.lessons_per_week || 1,
        remarks: currentWeek.remarks || '',
        objectives: updatedObjectives,
        is_commed: isCommed
      })
      currentWeek = null
    }
  }

  const DATE_RANGE_PATTERN = /(\d{1,2}(?:st|nd|rd|th)?\s*[–\-—]\s*\d{1,2}(?:st|nd|rd|th)?\s*(?:[A-Za-z]{3,9})|\d{1,2}\/\d{1,2}\s*[–\-—]\s*\d{1,2}\/\d{1,2})/i
  const TOPIC_PREFIX_PATTERN = /^(?:TOPIC|UNIT|CHAPTER|STRAND|SECTION)\s*(\d+|[A-Z])?[:\.\-]?\s*(.*)/i
  const OBJECTIVE_BULLET_PATTERN = /^(?:\[[✓xX✔\s]\]|[✓✔•\*\-]|LO\s*\d+)\s*(.*)/i

  let defaultYearNum = 2026
  try {
    defaultYearNum = parseInt(academicYear.split('/')[0], 10) || 2026
  } catch {}

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim()
    if (!rawLine) continue

    const upperLine = rawLine.toUpperCase()
    if (
      (MONTH_MAP[upperLine.slice(0, 3)] !== undefined && upperLine.length <= 15) ||
      /^MONTH\s*\d+/i.test(upperLine)
    ) {
      currentMonth = upperLine
      continue
    }

    const regexMatch = rawLine.match(/^(?:Week\s*(\d+)|Wk\s*(\d+)|(\d{1,2})\s*[\.:\-]\s*(\d{1,2}[a-z]{0,2}\s*[–\-—]\s*\d{1,2}[a-z]{0,2}))/i)
    const isStandaloneDigit = /^\d{1,2}$/.test(rawLine) && i + 1 < lines.length && (DATE_RANGE_PATTERN.test(lines[i + 1]) || /\b\d{1,2}(?:st|nd|rd|th)\b/i.test(lines.slice(i + 1, i + 4).join(' ')))

    if (regexMatch || isStandaloneDigit) {
      finalizeCurrentWeek()

      const seq = parseInt(regexMatch ? regexMatch[1] || regexMatch[2] || regexMatch[3] || rawLine : rawLine, 10)
      const termDateWindow = lines.slice(i + 1, i + 5).join(' ')
      const dateInWindow = termDateWindow.match(DATE_RANGE_PATTERN)
      const termDateStr = dateInWindow ? dateInWindow[1] : ''

      const { startDate, endDate } = parseTermDates(
        termDateStr ? `${termDateStr} ${currentMonth}` : '',
        defaultYearNum
      )

      currentWeek = {
        sequence: seq,
        week_label: `Week ${seq}`,
        month_label: currentMonth,
        term_dates: termDateStr,
        start_date: startDate,
        end_date: endDate,
        is_instructional: true,
        topic_title: '',
        challenge_title: '',
        subtopic_title: '',
        lessons_per_week: 1,
        remarks: '',
        objectives: []
      }
      continue
    }

    if (!currentWeek) continue

    if (/(?:MID-TERM|BREAK|HOLIDAY|EXAM|INDUCTION|REVISION\s*WEEK)/i.test(rawLine)) {
      currentWeek.is_instructional = false
      currentWeek.event_label = rawLine.toUpperCase()
      continue
    }

    const topicMatch = rawLine.match(TOPIC_PREFIX_PATTERN)
    if (topicMatch) {
      currentWeek.topic_title = topicMatch[2].trim() || topicMatch[0].trim()
      continue
    }

    const objBulletMatch = rawLine.match(OBJECTIVE_BULLET_PATTERN)
    const SEQ_CODE_RE = /^(\*?[0-9]{1,2}[A-Za-z]{1,4}\.[0-9]{1,3}[A-Za-z0-9\-]*)\s*[:\-]?\s*(.*)/
    const NUMBERED_LO_RE = /^[•*▪▫◦►✓✔\-]\s*(\d+\.\d+)\s+([^:]+):\s*(.*)/
    const codeMatch = rawLine.match(SEQ_CODE_RE)
    const numLoMatch = rawLine.match(NUMBERED_LO_RE)
    const isBloom = isBloomObjective(rawLine)

    if (objBulletMatch || codeMatch || numLoMatch || isBloom) {
      if (/^Lesson\s*\d+/i.test(rawLine) || /Weekly Lesson Breakdown/i.test(rawLine) || /^Activities/i.test(rawLine)) {
        continue
      }

      let code = ''
      let text = ''

      if (numLoMatch) {
        code = numLoMatch[1]
        text = cleanJoinedText(`${numLoMatch[2].trim()}: ${numLoMatch[3].trim()}`)
      } else if (codeMatch) {
        const candidateCode = codeMatch[1].replace(/^\*/, '').trim()
        if (/^(?:UNIT|TOPIC|REVISION|SEMESTER|RESOURCES?|MONTH|WEEK|TERM|OBJECTIVES?)$/i.test(candidateCode)) {
          // Fall through to topic/remarks handling below
        } else {
          code = candidateCode
          text = cleanJoinedText(codeMatch[2])
        }
      }

      if (!code && objBulletMatch) {
        const afterBullet = objBulletMatch[1].trim()
        const innerCodeMatch = afterBullet.match(SEQ_CODE_RE)
        if (innerCodeMatch) {
          code = innerCodeMatch[1].replace(/^\*/, '').trim()
          text = cleanJoinedText(innerCodeMatch[2])
        } else {
          const objSeq = (currentWeek.objectives?.length || 0) + 1
          code = `${subjectCode ? subjectCode + '.' : ''}W${currentWeek.sequence || 1}.${objSeq}`
          text = cleanJoinedText(afterBullet)
        }
      }

      if (!code && isBloom) {
        const objSeq = (currentWeek.objectives?.length || 0) + 1
        code = `${subjectCode ? subjectCode + '.' : ''}W${currentWeek.sequence || 1}.${objSeq}`
        text = cleanJoinedText(rawLine)
      }

      if (code && text && !text.includes('Weekly Lesson Breakdown') && !code.startsWith('Lesson')) {
        currentWeek.objectives = currentWeek.objectives || []
        currentWeek.objectives.push({
          code,
          text,
          is_met: false,
          topic_title: currentWeek.topic_title || '',
          challenge_title: currentWeek.challenge_title || ''
        })
      }
      continue
    }

    if (/^(?:REMARKS?|COMMENTS?|NOTES?|OBSERVATIONS?|COVERAGE|STATUS)\s*[:\-]?\s*(.*)/i.test(rawLine)) {
      const rmMatch = rawLine.match(/^(?:REMARKS?|COMMENTS?|NOTES?|OBSERVATIONS?|COVERAGE|STATUS)\s*[:\-]?\s*(.*)/i)
      currentWeek.remarks = (currentWeek.remarks ? `${currentWeek.remarks}\n` : '') + (rmMatch ? rmMatch[1] : rawLine)
      continue
    }

    if (/\b(?:covered|not covered|uncovered|pending|carried forward|carry forward|roll\s*over|rollover|completed|commed|tested|quiz|revision|homework|incomplete|taught|done|finished|achieved|not met|postponed|deferred|except)\b/i.test(rawLine)) {
      currentWeek.remarks = (currentWeek.remarks ? `${currentWeek.remarks} | ` : '') + rawLine
    } else if (!currentWeek.topic_title && rawLine.length < 80 && !rawLine.includes('http')) {
      currentWeek.topic_title = rawLine
    }
  }

  finalizeCurrentWeek()

  return {
    raw_text: fullText,
    title: `${subjectName || 'Subject'} Semester ${semester} Work Plan`,
    framework,
    subject_code: subjectCode || undefined,
    subject_name: subjectName || undefined,
    class_name: className || undefined,
    teacher_name: teacherName || undefined,
    academic_year: academicYear,
    semester,
    needs_subject_code: !subjectCode,
    weeks,
    resources: '',
    notes: 'Imported from teacher Semester 1 work plan'
  }
}
