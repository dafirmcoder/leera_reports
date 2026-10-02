/**
 * Semantic extraction: page grids -> metadata -> weeks -> objectives/remarks.
 *
 * Assignment rules (this is what keeps weeks from getting mixed up):
 *  1. every row is a band between two table rules;
 *  2. a row that contains a week number starts (or continues) that week;
 *  3. a row without a week number (print spill-over onto the next page, or a
 *     rule that splits a tall row) is appended to the week that is currently
 *     open — never to the week below it;
 *  4. a row that only contains a month banner updates the month context.
 */
import type { PageGeometry } from './geometry';
import { buildLines, splitLinesByColumns, stripRunningHeaderItems, type PositionedItem, type TextLine } from './textLines';
import { buildPageGrid, type PageGrid } from './grid';
import {
  canonicalMonth,
  monthFromText,
  repairMissingSpaces,
  splitLeadingCode,
  stripBullet,
  tidy,
  tryDeinterleave,
} from './text';
import type {
  ParsedWorkplan,
  WorkplanContentItem,
  WorkplanDebug,
  WorkplanWeek,
} from './types';

export interface PageInput {
  page: number;
  items: PositionedItem[];
  geometry: PageGeometry;
}

export interface ExtractOptions {
  fileName?: string | null;
  debug?: boolean;
}

const UNIT_HEADING_RE = /^UNIT\s*([0-9]{1,2}(?:\.[0-9]{1,2})?)\s*[:.·•\-–]?\s*(.*)$/i;
// section labels inside a week cell; a trailing ":" or "." is optional
// ("Learning Objectives:", "RESOURCES:", "ASSESSMENTS.")
const SECTION_HEADING_RE =
  /^(LEARNING OBJECTIVES?|OBJECTIVES?|WEEKLY LESSON BREAKDOWN.*|LESSON BREAKDOWN.*|TOPIC\/?\s*LEARNING.*|MATERIALS?|RESOURCES?|TOPICS?|ASSESSMENTS?|NOTES?)[:.]?$/i;
const ASSESSMENT_RE =
  /^(END OF|SEMESTER ASSESS|ASSESSMENT|EXAMS?|REVISION|MID[\s-]?TERM|END OF FIRST SEMESTER|FINAL ASSESS|CONTINUOUS ASSESS)/i;
const LESSON_RE = /^LESSON\s*([0-9]{1,2})\s*[:.]\s*(.*)$/i;
const RESOURCE_RE = /^(RESOURCES?|WEBSITES?|MATERIALS? TO OBTAIN|USE IN THIS PLAN|SUPPORTING RESOURCES|DIGITAL MATERIALS|WEBSITE\b)/i;

interface WorkingWeek extends WorkplanWeek {
  _remarksLines: string[];
}

function emptyWeek(week: number | null, label: string, dates: string | null, month: string | null, page: number): WorkingWeek {
  return {
    week,
    label,
    dates,
    month,
    monthInferred: false,
    unit: null,
    units: [],
    topics: [],
    objectives: [],
    lessons: [],
    assessments: [],
    remarks: null,
    remarksNote: null,
    remarkCodes: [],
    items: [],
    pages: [page],
    warnings: [],
    extraLines: [],
    _remarksLines: [],
  };
}

/**
 * "October 2026" -> "October": the month of a week is a plain month name in
 * every output; the academic year lives on the document (session / period).
 */
function bareMonth(value: string | null): string | null {
  return value ? value.replace(/\s+(20\d{2})$/, '') : null;
}

/**
 * Day numbers printed in a week's date cell. "24TH – 28TH" -> [24, 28],
 * "24–28 Aug 2026" -> [24, 28] (the year is ignored).
 */
function dateDays(value: string | null): [number, number] | null {
  // NB: \b\d{1,2}\b does not match "24TH" (no boundary between digit and
  // letter), hence the explicit "not part of a longer number" guards.
  const nums = [...(value || '').matchAll(/(?:^|\D)(\d{1,2})(?!\d)/g)].map((m) => Number(m[1]));
  if (!nums.length) return null;
  return [nums[0], nums[nums.length - 1]];
}

/**
 * Week anchors: "7", "WEEK 7", "Week 7". Dates like "31ST – 4TH" never match
 * because the ordinal suffix is part of the same line.
 *
 * Inside a week cell the week number is always printed *above* the date range,
 * so candidates are inspected top to bottom and checked against the week
 * sequence that is being read (a stray number such as a date day never wins).
 */
function findWeekAnchor(
  lines: TextLine[] | undefined,
  expectedWeek?: number | null,
): { n: number; line: TextLine } | null {
  if (!lines) return null;
  const candidates: Array<{ n: number; line: TextLine }> = [];
  for (const l of [...lines].sort((a, b) => a.y - b.y)) {
    const t = tidy(l.text);
    const m = t.match(/^WEEK\s*([0-9]{1,2})$/i) || t.match(/^([0-9]{1,2})$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 60) candidates.push({ n, line: l });
  }
  if (!candidates.length) return null;
  if (expectedWeek != null) {
    const plausible = candidates.find((c) => c.n === expectedWeek || c.n === expectedWeek + 1 || c.n === expectedWeek + 2);
    if (plausible) return plausible;
  }
  return candidates[0];
}

function normalizeUnitLabel(text: string): string {
  const t = repairMissingSpaces(stripBullet(text));
  return t.replace(/\s*·\s*/g, ' · ');
}

/** Groups header lines that share a baseline (a word wrapped by the layout). */
function mergeHeaderLines(lines: TextLine[]): Array<{ text: string; y: number }> {
  const sorted = [...lines]
    .filter((l) => tidy(l.text))
    .map((l) => ({ text: tidy(l.text), y: l.y, x: l.x0 }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Array<{ text: string; y: number }> = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - l.y) <= 3) {
      last.text = tidy(`${last.text} ${l.text}`);
    } else {
      out.push({ text: l.text, y: l.y });
    }
  }
  return out;
}

const NOT_SUBJECT = /\b(PLAN|WORKPLAN|LONG[- ]?TERM|SEMESTER|SCHOOL|YEAR|GRADE|CURRICULUM|SCHEME OF WORK)\b/i;

/**
 * Extracts the class/level, subject, teacher, semester and session from the
 * merged header rows of the table (and the page title above it).
 */
function parseHeaderMeta(input: TextLine[]) {
  const lines = mergeHeaderLines(input);
  let title: string | null = null;
  let school: string | null = null;
  let level: string | null = null;
  let session: string | null = null;
  let semester: string | null = null;
  let period: string | null = null;
  let subject: string | null = null;
  let teacher: string | null = null;

  const subjectCandidates: string[] = [];
  const monthSpans: string[] = [];

  for (const { text } of lines) {
    if (/SEMESTER\s*WORK\s*PLAN/i.test(text)) {
      title = title || text;
      continue;
    }
    if (/SCHOOL/i.test(text) && text.length < 60) {
      school = school || text;
      continue;
    }
    const yearM = text.match(/YEAR\s*([0-9]{1,2})/i);
    if (yearM) {
      level = level || yearM[1];
      const ses = text.match(/(20[0-9]{2})\s*[\/–—-]\s*(20[0-9]{2})/);
      if (ses) session = session || `${ses[1]}/${ses[2]}`;
      const rest = tidy(
        text
          .replace(/YEAR\s*[0-9]{1,2}/i, '')
          .replace(/(20[0-9]{2})\s*[\/–—-]\s*(20[0-9]{2})/, '')
          .replace(/LONG[- ]?TERM\s*PLAN/i, '')
          .replace(/SEMESTER\s*WORK\s*PLAN/i, '')
          .replace(/[|·•-]\s*$/, ''),
      );
      if (rest && !NOT_SUBJECT.test(rest)) subjectCandidates.push(rest);
      continue;
    }
    // a separate session line ("2026/2027")
    const sesOnly = text.match(/^(20[0-9]{2})\s*[\/–—-]\s*(20[0-9]{2})$/);
    if (sesOnly) {
      session = session || `${sesOnly[1]}/${sesOnly[2]}`;
      continue;
    }
    subjectCandidates.push(text);
  }

  const segments: string[] = [];
  for (const t of subjectCandidates) {
    for (const part of t.split(/[|·•]/)) segments.push(tidy(part));
  }

  for (const seg of segments) {
    if (!seg) continue;
    const semM = seg.match(/SEMESTER\s*([0-9]|ONE|TWO)/i);
    if (semM) {
      const raw = semM[1].toUpperCase();
      semester = semester || (raw === 'ONE' ? '1' : raw === 'TWO' ? '2' : raw);
      const rest = tidy(seg.replace(/SEMESTER\s*([0-9]|ONE|TWO)/i, '').replace(/^[\s:,.-]+/, ''));
      const year = rest.match(/\b(20[0-9]{2})\b/);
      const months = rest.match(
        /\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/gi,
      );
      if (months && months.length) {
        const names = months.map((m) => canonicalMonth(m) || m);
        const span = names.length > 1 ? `${names[0]}–${names[names.length - 1]}` : names[0];
        period = period || (year ? `${span} ${year[1]}` : span);
        monthSpans.push(rest);
      } else if (rest && !period) {
        period = rest.replace(/^[()\s]+|[()\s]+$/g, '') || null;
      }
      continue;
    }
    const par = seg.match(/^([^()]+?)\s*\((.+)\)\s*$/);
    if (par) {
      const outside = tidy(par[1]);
      const inside = tidy(par[2]);
      if (outside && !NOT_SUBJECT.test(outside) && !/^SEMESTER/i.test(outside)) subject = subject || outside;
      if (inside && !NOT_SUBJECT.test(inside) && !monthFromText(inside)) teacher = teacher || inside;
      continue;
    }
    if (/^(MR|MRS|MS|MISS|DR|TR|SIR|MADAM|MADAME)\.?\s/i.test(seg)) {
      teacher = teacher || seg;
      continue;
    }
    if (/^[0-9]+$/.test(seg) || /^20[0-9]{2}$/.test(seg)) continue;
    if (seg.split(/\s+/).length <= 4) {
      // "AUGUST–DECEMBER 2026" / "AUG – DEC": keep the whole span
      const span = seg.match(new RegExp(`\\b(${MONTH_ALT})\\b[\\s–—\\-]*?(?:TO\\s+)?\\b(${MONTH_ALT})\\b`, 'i'));
      if (span) {
        const a = canonicalMonth(span[1]);
        const b = canonicalMonth(span[2]);
        if (a && b) {
          const y = seg.match(/\b(20[0-9]{2})\b/);
          if (!period) period = `${a}–${b}${y ? ` ${y[1]}` : ''}`;
          continue;
        }
      }
      if (monthFromText(seg)) {
        if (!period) period = monthFromText(seg);
        continue;
      }
    }
    if (NOT_SUBJECT.test(seg)) continue;
    if (!subject) {
      subject = seg;
    } else if (!teacher && !/[0-9]/.test(seg) && seg.split(/\s+/).length <= 5 && seg.length <= 40) {
      teacher = seg;
    }
  }
  return { title, school, level, session, semester, period, subject, teacher };
}

/** Month names + common abbreviations, longest first (for span matching). */
const MONTH_ALT =
  'JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC';

const SUBJECT_CODES: Record<string, string> = {
  ENGLISH: 'ENG',
  MATHEMATICS: 'MAT',
  MATH: 'MAT',
  COMPUTING: 'CMP',
  'COMPUTER SCIENCE': 'CMP',
  ICT: 'ICT',
  SCIENCE: 'SCI',
  BIOLOGY: 'BIO',
  CHEMISTRY: 'CHE',
  PHYSICS: 'PHY',
  GEOGRAPHY: 'GEO',
  HISTORY: 'HIS',
  FRENCH: 'FRE',
  KISWAHILI: 'KIS',
  SWAHILI: 'KIS',
  'BUSINESS STUDIES': 'BUS',
  BUSINESS: 'BUS',
  ECONOMICS: 'ECO',
  ACCOUNTING: 'ACC',
  ART: 'ART',
  'ART AND DESIGN': 'ART',
  MUSIC: 'MUS',
  'PHYSICAL EDUCATION': 'PE',
  PE: 'PE',
  PSHE: 'PSH',
  GLOBAL_PERSPECTIVES: 'GLP',
  'GLOBAL PERSPECTIVES': 'GLP',
  'ADDITIONAL MATHEMATICS': 'ADM',
};

/** Best effort document level subject code ("ENG", "MAT", …). */
export function resolveSubjectCode(subject: string | null): string | null {
  if (!subject) return null;
  const key = subject.toUpperCase().replace(/[^A-Z ]/g, '').trim();
  if (SUBJECT_CODES[key]) return SUBJECT_CODES[key];
  for (const [k, v] of Object.entries(SUBJECT_CODES)) if (key.startsWith(k) || k.startsWith(key)) return v;
  const letters = key.replace(/[^A-Z]/g, '');
  return letters ? letters.slice(0, 3) : null;
}

/** Detect the modal body font size, used to spot (and drop) page headers. */
function modalBodySize(items: PositionedItem[]): number {
  const counts = new Map<number, number>();
  for (const it of items) {
    const key = Math.round(it.size * 2) / 2;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = 10;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount && size >= 7 && size <= 16) {
      bestCount = count;
      best = size;
    }
  }
  return best;
}

interface ClassifiedLine {
  kind: WorkplanContentItem['kind'];
  code: string | null;
  strandCode: string | null;
  text: string;
  raw: string;
  scrambled?: boolean;
  headingText?: string;
}

/** Classifies one text line from the topic column. */
function classifyTopicLine(line: TextLine): ClassifiedLine {
  const repaired = repairMissingSpaces(line.text);
  const text = stripBullet(repaired);

  const unitM = text.match(UNIT_HEADING_RE);
  if (unitM) {
    return { kind: 'heading', code: null, strandCode: null, text, raw: repaired, headingText: normalizeUnitLabel(text) };
  }
  if (SECTION_HEADING_RE.test(text)) {
    return { kind: 'heading', code: null, strandCode: null, text, raw: repaired, headingText: text };
  }
  if (ASSESSMENT_RE.test(text)) {
    return { kind: 'assessment', code: null, strandCode: null, text, raw: repaired };
  }
  const lessonM = text.match(LESSON_RE);
  if (lessonM) {
    return { kind: 'lesson', code: `Lesson ${lessonM[1]}`, strandCode: null, text: tidy(lessonM[2]), raw: repaired };
  }
  const code = splitLeadingCode(text);
  if (code) {
    return {
      kind: 'objective',
      code: code.code,
      strandCode: code.strandCode,
      text: code.rest,
      raw: repaired,
      scrambled: code.scrambled,
    };
  }
  return { kind: 'note', code: null, strandCode: null, text, raw: repaired };
}

interface RowContent {
  items: WorkplanContentItem[];
  remarksLines: string[];
  resourceLines: string[];
  unclassified: string[];
  anchors: TextLine[];
}

export function extractWorkplan(pages: PageInput[], options: ExtractOptions = {}): ParsedWorkplan {
  const warnings: string[] = [];
  const fileName = options.fileName ?? null;

  // ---------------------------------------------------------------- lines ---
  const rawLines = pages.map((p) => buildLines(p.items));
  const bodySize = modalBodySize(pages.flatMap((p) => p.items));

  // running page header (e.g. "SEMESTER WORK PLAN") detection: it is printed at
  // a much larger size and repeated on several pages.
  const firstTableTop = pages[0]?.geometry.horizontal.length
    ? Math.min(...pages[0].geometry.horizontal.map((h) => h.pos))
    : Infinity;
  const candidates = new Set<string>();
  for (const l of rawLines[0] || []) {
    if (l.y < firstTableTop && l.size >= bodySize * 1.15 && l.text.length < 40) candidates.add(l.text);
  }
  const headerStrings = [...candidates].filter(
    (c) => rawLines.filter((lines) => lines.some((l) => tidy(l.text) === c && l.size >= bodySize * 1.15)).length >= 2,
  );
  if (headerStrings.length) warnings.push(`Removed repeating page header: ${headerStrings.join(', ')}`);

  // the page header is removed at item level so it can never bleed into a line
  const pageItems = pages.map((p) => stripRunningHeaderItems(p.items, headerStrings, bodySize).items);
  const pageLines = pageItems.map((items) => buildLines(items));

  // ---------------------------------------------------------------- grids ---
  const grids: PageGrid[] = pages.map((p, i) =>
    buildPageGrid(p.page, p.geometry, pageLines[i], {
      weekAnchorOf: (l) => findWeekAnchor([l], null)?.n ?? null,
    }),
  );

  // -------------------------------------------------------------- metadata ---
  // metadata comes from every line above the first body row of page 1 (title,
  // school, year/plan, subject/teacher, semester) plus the other pages' headers
  const metaBodyTop = grids[0]?.bodyTop ?? firstTableTop;
  const metaLines = [
    ...(rawLines[0] || []).filter((l) => l.y < metaBodyTop - 1),
    ...grids.slice(1).flatMap((g) => g.headerLines),
  ];
  const meta = parseHeaderMeta(metaLines.length ? metaLines : rawLines[0] || []);
  const levelLabel = meta.level ? `Year ${meta.level}` : null;

  const weeks: WorkingWeek[] = [];
  const resources: string[] = [];
  /** resource lists printed underneath the last table row ("RESOURCES" blocks) */
  const belowTable: TextLine[] = [];

  // ---- rolling month state --------------------------------------------------
  // The month a week sits in is (1) the month label printed in its own cell /
  // banner row, (2) the month printed inside its date text, or (3) derived from
  // the week date sequence: the template files a week under the month of its
  // LAST day, so "31ST – 4TH" (Aug 31 – Sep 4) is September and "28TH – 2ND"
  // is October. The first month of the semester comes from the header period.
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  let month: string | null = bareMonth(meta.period ? monthFromText(meta.period) : null);
  /** end day of the previous week that had a date range; the month advances
   *  exactly when the day number goes backwards */
  let prevEndDay: number | null = null;
  const advanceMonth = () => {
    const i = month ? MONTH_NAMES.indexOf(month) : -1;
    if (i >= 0) month = MONTH_NAMES[(i + 1) % 12];
  };
  let current: WorkingWeek | null = null;
  let unitContext: string | null = null;
  let inAppendix = false;
  const knownCodes: string[] = [];
  const appendixLines: string[] = [];

  const pushItem = (week: WorkingWeek, item: WorkplanContentItem) => {
    week.items.push(item);
    if (item.kind === 'objective') {
      week.objectives.push(item);
      if (item.code && !knownCodes.includes(item.code)) knownCodes.push(item.code);
      if (item.unit && !week.units.includes(item.unit)) week.units.push(item.unit);
    } else if (item.kind === 'lesson') week.lessons.push(item);
    else if (item.kind === 'assessment') week.assessments.push(item.text);
    else if (item.kind === 'heading' && /^UNIT\b/i.test(item.text)) {
      if (!week.topics.includes(item.text)) week.topics.push(item.text);
      if (item.unit && !week.units.includes(item.unit)) week.units.push(item.unit);
    }
  };

  const classifyRow = (row: PageGrid['rows'][number]): RowContent => {
    const topicLines = row.cells.get('topic') || [];
    // month/other columns may carry resource labels ("RESOURCE 1") or, on the
    // website table, the resource name itself; month names are skipped
    const otherLines = [
      ...(row.cells.get('other') || []),
      ...(row.cells.get('month') || []).filter((l) => !monthFromText(l.text)),
    ];
    const remarksLines = (row.cells.get('remarks') || []).map((l) => l.text);
    const content: RowContent = { items: [], remarksLines, resourceLines: [], unclassified: [], anchors: [] };

    let previous: WorkplanContentItem | null = null;
    let previousLine: TextLine | null = null;

    const handleLine = (line: TextLine) => {
      let working = line;
      let text = tidy(working.text);

      // repair a line that a page header was drawn on top of
      const headerHit = headerStrings.find((h) => {
        const upper = text.toUpperCase();
        const head = h.toUpperCase().replace(/\s/g, '');
        let i = 0;
        for (const ch of upper.replace(/\s/g, '')) if (i < head.length && ch === head[i]) i++;
        return i >= head.length * 0.9;
      });
      if (headerHit && !splitLeadingCode(text)) {
        const fixed = tryDeinterleave(text, headerHit);
        if (fixed) {
          warnings.push(`Repaired a line that was overlapped by the page header on page ${line.page}: "${fixed.slice(0, 60)}…"`);
          working = { ...working, text: fixed };
          text = fixed;
        }
      }

      const isContinuationCandidate =
        previous != null &&
        !/^[•▪➢➤►‣⁃·]/.test(tidy(line.text)) &&
        (line.x0 > (previousLine?.x0 ?? 0) + 3 ||
          !/[.:;]$/.test(previous!.text) ||
          /^[a-z(]/.test(text));

      // A line that starts with a dash / en dash is a wrapped sub-line of the
      // item above (Word breaks "… strand (9P.01 – 9P.12): Python coding …"
      // across two lines and the second one starts with "– 9P.12)"). Bullets in
      // these templates are always •, ▪ or ➢, so a dash never starts a new item.
      if (previous && /^[-–—]\s*\S/.test(text)) {
        const stripped = tidy(text.replace(/^[-–—]\s*/, ''));
        previous.text = tidy(`${previous.text} ${stripped}`);
        previous.raw = tidy(`${previous.raw} ${text}`);
        return;
      }

      const classified = classifyTopicLine(working);
      if (classified.kind === 'note' && isContinuationCandidate && previous) {
        previous.text = tidy(`${previous.text} ${classified.text}`);
        previous.raw = tidy(`${previous.raw} ${classified.text}`);
        return;
      }
      const item: WorkplanContentItem = {
        kind: classified.kind,
        code: classified.code,
        strandCode: classified.strandCode,
        text: classified.text,
        raw: classified.raw,
        unit: unitContext,
        page: line.page,
      };
      if (classified.scrambled) {
        warnings.push(`Objective code on page ${line.page} looks scrambled in the source PDF: "${classified.raw.slice(0, 60)}"`);
      }
      if (classified.kind === 'heading' && /^UNIT\b/i.test(classified.text)) {
        unitContext = classified.headingText || normalizeUnitLabel(classified.text);
        item.unit = unitContext;
      }
      if (classified.kind === 'note') {
        content.unclassified.push(classified.text);
      }
      content.items.push(item);
      previous = item;
      previousLine = line;
    };

    // labels in the week column that are not the week number/date ("SUPPORTING
    // RESOURCES", "RESOURCE 1", "WEBSITE", ...) mark a resource table
    for (const line of row.cells.get('week') || []) {
      const t = tidy(line.text);
      if (RESOURCE_RE.test(t) && !/^week\s*[0-9]/i.test(t)) content.resourceLines.push(t);
    }

    const all = [...topicLines, ...otherLines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
    for (const line of all) {
      if (RESOURCE_RE.test(tidy(line.text)) && !splitLeadingCode(tidy(line.text))) {
        content.resourceLines.push(tidy(line.text));
      }
      handleLine(line);
    }
    return content;
  };

  // ---------------------------------------------------------------- weeks ---
  const debugGrids: WorkplanDebug['pageGrids'] = [];

  for (const grid of grids) {
    const allPageLines = pageLines[grid.page - 1] || [];

    if (!grid.fromRules) {
      // page without a table grid (resource/appendix page)
      const texts = allPageLines
        .map((l) => tidy(l.text))
        .filter((t) => t && !/^SEMESTER WORK PLAN$/i.test(t));
      appendixLines.push(...texts);
      if (texts.length && !texts.every((t) => RESOURCE_RE.test(t) || t.length < 80)) {
        warnings.push(
          `Page ${grid.page} has no table borders; its text was treated as an appendix (resources), not as week content.`,
        );
      }
      continue;
    }

    // month runs in the month column (handles Word's rotated month labels).
    // The lines are split at the column border first: Word likes to merge a
    // month label with the week number next to it ("AUGUST 1"), and the merged
    // line's centre falls outside the column.
    const monthCol = grid.columns.find((c) => c.role === 'month');
    const monthColumnLines: TextLine[] = [];
    if (monthCol) {
      const seen = new Set<string>();
      for (const l of splitLinesByColumns(allPageLines, [monthCol.x0, monthCol.x1]).slice().sort((a, b) => a.y - b.y)) {
        const centre = (l.x0 + l.x1) / 2;
        if (centre < monthCol.x0 - 0.5 || centre >= monthCol.x1) continue;
        const key = `${l.y.toFixed(1)}|${l.x0.toFixed(1)}|${l.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        monthColumnLines.push(l);
      }
    }
    const monthForRow = new Map<number, string>();
    {
      const runs: TextLine[][] = [];
      let run: TextLine[] = [];
      for (const l of monthColumnLines) {
        if (!run.length) run.push(l);
        else {
          const prev = run[run.length - 1];
          if (l.y - prev.y <= Math.max(6, prev.size * 1.5)) run.push(l);
          else {
            runs.push(run);
            run = [l];
          }
        }
      }
      if (run.length) runs.push(run);
      for (const r of runs) {
        const asc = r.map((l) => tidy(l.text)).join(' ');
        const desc = [...r].reverse().map((l) => tidy(l.text)).join(' ');
        const found = monthFromText(asc) ? asc : monthFromText(desc) ? desc : null;
        if (!found) continue;
        const mo = bareMonth(monthFromText(found));
        if (!mo) continue;
        const y0 = Math.min(...r.map((l) => l.y0));
        const y1 = Math.max(...r.map((l) => l.y1));
        // first row that overlaps this month label
        for (let i = 0; i < grid.rows.length; i++) {
          const row = grid.rows[i];
          if (row.y1 >= y0 && row.y0 <= y1) {
            if (!monthForRow.has(i)) monthForRow.set(i, mo);
            break;
          }
        }
      }
    }

    // Printed month labels that live in the month cell itself (or in a
    // full-width banner row) start a new month run at that row.
    for (let i = 0; i < grid.rows.length; i++) {
      if (monthForRow.has(i)) continue;
      const cellTexts = [
        ...(grid.rows[i].cells.get('month') || []),
        ...(grid.rows[i].cells.get('week') || []),
      ]
        .map((l) => tidy(l.text))
        .filter(Boolean);
      if (!cellTexts.length) continue;
      // a banner row is *only* a month phrase; a month cell may be rotated text
      const isBanner = cellTexts.every((t) => monthFromText(t) !== null && t.split(/\s+/).length <= 3);
      const mo = isBanner ? bareMonth(monthFromText(cellTexts.join(' '))) : null;
      if (mo) monthForRow.set(i, mo);
    }

    // "RESOURCES" lists underneath the table (e.g. the last page of d1/d3):
    // they are not week content, so they go straight into the resource list
    belowTable.push(...grid.belowTableLines);

    debugGrids.push({
      page: grid.page,
      rules: {
        horizontal: grid.pageGeometry.horizontal.map((h) => Math.round(h.pos * 10) / 10),
        vertical: grid.pageGeometry.vertical.map((v) => Math.round(v.pos * 10) / 10),
      },
      columns: grid.columns.map((c) => ({
        x0: Math.round(c.x0 * 10) / 10,
        x1: Math.round(c.x1 * 10) / 10,
        role: c.role,
      })),
      rows: grid.rows.map((r, i) => ({
        y0: Math.round(r.y0 * 10) / 10,
        y1: Math.round(r.y1 * 10) / 10,
        weekAnchor: findWeekAnchor(r.cells.get('week'), null)?.n ?? null,
        month: monthForRow.get(i) ?? null,
      })),
    });

    for (let i = 0; i < grid.rows.length; i++) {
      const row = grid.rows[i];
      const assignedMonth = bareMonth(monthForRow.get(i) ?? null);

      const anchor = findWeekAnchor(row.cells.get('week'), current?.week ?? null);
      const weekCellLines = row.cells.get('week') || [];
      let dates =
        weekCellLines
          .filter((l) => l !== anchor?.line)
          .map((l) => tidy(l.text))
          .filter(Boolean)
          .join(' ') || null;

      if (!dates && anchor?.line) {
        const fullAnchorText = tidy(anchor.line.text);
        const withoutWeekNum = fullAnchorText
          .replace(/^WEEK\s*[0-9]{1,2}\s*[:\-–—]?\s*/i, '')
          .replace(/^[0-9]{1,2}\s*[:\-–—]?\s*/, '')
          .trim();
        if (withoutWeekNum && (/\d/.test(withoutWeekNum) || monthFromText(withoutWeekNum))) {
          dates = withoutWeekNum;
        }
      }

      if (anchor) {
        const label = tidy(anchor.line.text);
        const printedMonth = bareMonth(monthFromText(dates || ''));
        const range = dateDays(dates);
        // the month changes when a week's *last* day is smaller than the
        // previous week's last day ("26TH – 30TH" → "2ND – 6TH")
        const rolls = !!range && prevEndDay !== null && range[1] < prevEndDay;
        const wouldBe = rolls
          ? month
            ? MONTH_NAMES[(MONTH_NAMES.indexOf(month) + 1) % 12]
            : null
          : month;
        if (assignedMonth && range && wouldBe && wouldBe !== assignedMonth) {
          // printed label and date sequence disagree (the week straddles a
          // month end): the printed label wins, but say so
          const note = `Week ${anchor.n} is printed under ${assignedMonth} but its dates (${dates}) run into ${wouldBe}; kept the printed month.`;
          if (!warnings.includes(note)) warnings.push(note);
        }
        if (!assignedMonth && !printedMonth && rolls) advanceMonth();
        const weekMonth = assignedMonth || printedMonth || month;
        month = weekMonth || month;
        if (range) prevEndDay = range[1];
        // a bare month row (no week anchor) only updates the running month
        // continuing the same week (a week split across pages repeats its number)
        if (current && current.week === anchor.n) {
          current.dates = current.dates || dates;
          current.month = current.month || month;
          if (!current.pages.includes(grid.page)) current.pages.push(grid.page);
        } else {
          const week = emptyWeek(anchor.n, label, dates, weekMonth, grid.page);
          if (!assignedMonth && !printedMonth) week.monthInferred = true;
          weeks.push(week);
          current = week;
        }
        const content = classifyRow(row);
        for (const item of content.items) pushItem(current, item);
        current._remarksLines.push(...content.remarksLines);
        resources.push(...content.resourceLines);
        continue;
      }

      // ---- row without a week number ------------------------------------
      const rowText = row.lines.map((l) => tidy(l.text)).join(' ');
      const monthOnly =
        !!monthFromText(rowText) &&
        !findWeekAnchor(row.cells.get('week')) &&
        !(row.cells.get('topic') || []).length &&
        !(row.cells.get('remarks') || []).length;
      if (monthOnly) continue; // month banner row

      const content = classifyRow(row);
      const hasSignal =
        content.items.some((it) => it.kind === 'objective' || it.kind === 'lesson' || it.kind === 'assessment' || it.kind === 'heading') ||
        content.remarksLines.length > 0;
      const resourceOnly =
        (content.resourceLines.length > 0 &&
          !content.items.some((it) => it.kind === 'objective' || it.kind === 'lesson' || it.kind === 'assessment')) ||
        // the resource/website table that follows the last week row
        (inAppendix &&
          !content.items.some((it) => it.kind === 'objective' || it.kind === 'lesson' || it.kind === 'assessment'));
      if (content.resourceLines.length > 0) inAppendix = true;
      if (resourceOnly && !current) {
        resources.push(...content.resourceLines, ...content.unclassified);
        continue;
      }
      if (!current) {
        if (content.items.length) {
          warnings.push(`Page ${grid.page}: found table text before the first week row; kept as notes.`);
          appendixLines.push(...content.items.map((it) => it.raw));
        }
        continue;
      }
      if (resourceOnly) {
        resources.push(
          ...content.resourceLines,
          ...content.unclassified,
          ...content.remarksLines,
          ...content.items.filter((it) => it.kind === 'heading' && RESOURCE_RE.test(it.text)).map((it) => it.text),
        );
        continue;
      }
      if (inAppendix) {
        resources.push(...content.items.map((it) => it.raw), ...content.remarksLines, ...content.unclassified);
        continue;
      }
      if (!hasSignal && !content.unclassified.length) continue;

      // continuation of the open week
      current.warnings.push(
        `Row without a week number on page ${grid.page} appended to week ${current.week ?? '?'} (continuation row).`,
      );
      if (!current.pages.includes(grid.page)) current.pages.push(grid.page);
      for (const item of content.items) pushItem(current, item);
      current._remarksLines.push(...content.remarksLines);
      resources.push(...content.resourceLines);
    }
  }

  // ------------------------------------------------------- month warnings ---
  const missingMonths = weeks.filter((w) => !w.month && w.week !== null).map((w) => w.week);
  if (missingMonths.length) {
    warnings.push(
      `Month could not be determined for week(s) ${missingMonths.join(', ')} (no month label in the export and the dates do not pin a month).`,
    );
  }

  // ------------------------------------------------------------- finalise ---
  const docCodes = knownCodes.slice();
  const weeksOut: WorkplanWeek[] = weeks.map((w) => {
    const unitCounts = new Map<string, number>();
    for (const o of w.objectives) if (o.unit) unitCounts.set(o.unit, (unitCounts.get(o.unit) || 0) + 1);
    let primary: string | null = null;
    let bestCount = -1;
    for (const [u, c] of unitCounts) if (c > bestCount) ((bestCount = c), (primary = u));
    const remarksRaw = w._remarksLines.join('\n').trim() || null;
    const remarkAssessments: string[] = [];
    const remarkNotes: string[] = [];
    for (const line of w._remarksLines) {
      const t = tidy(line);
      if (!t) continue;
      if (ASSESSMENT_RE.test(t)) remarkAssessments.push(t);
      else remarkNotes.push(t);
    }
    const remarkCodes = extractRemarkCodes(remarkNotes.join(' '), docCodes);
    const out: WorkplanWeek = {
      ...w,
      unit: primary || w.topics[0] || null,
      items: w.items,
      remarks: remarksRaw,
      remarksNote: remarkNotes.join('\n') || null,
      remarkCodes,
      assessments: dedupe([...w.assessments, ...remarkAssessments]),
      _remarksLines: undefined as unknown as string[],
    } as WorkplanWeek;
    delete (out as unknown as Record<string, unknown>)._remarksLines;
    return out;
  });

  const strandCodes = dedupe(
    weeksOut.flatMap((w) => w.objectives.map((o) => o.strandCode).filter((s): s is string => !!s)),
  );

  const subjectCode = resolveSubjectCode(meta.subject);

  const doc: ParsedWorkplan = {
    fileName,
    title: meta.title,
    school: meta.school,
    level: meta.level,
    levelLabel,
    subject: meta.subject,
    subjectCode,
    teacher: meta.teacher,
    semester: meta.semester,
    semesterLabel: meta.semester ? `Semester ${meta.semester}` : null,
    session: meta.session,
    period: meta.period,
    strandCodes,
    weeks: weeksOut,
    resources: dedupe([...resources, ...joinBelowTable(belowTable), ...appendixLines]),
    pageCount: pages.length,
    warnings,
  };

  if (weeksOut.every((w) => w.objectives.length === 0) && weeksOut.length > 0) {
    doc.warnings.push(
      'No coded learning objectives were recognised. The document may use a different code style — see README (custom patterns).',
    );
  }
  if (!weeksOut.length) {
    doc.warnings.push('No week rows were detected. The table borders may be missing from this PDF (exported as an image?).');
  }

  if (options.debug) {
    doc.debug = { pageGrids: debugGrids };
  }
  return doc;
}

/**
 * Lines below the table can be split into several runs that share a baseline
 * ("1. Cambridge" + "Primary English Learner's Book 6"); glue those back
 * together and drop the repeating page header stamp.
 */
function joinBelowTable(lines: TextLine[]): string[] {
  const out: Array<{ text: string; y: number; x1: number }> = [];
  for (const l of [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const t = tidy(l.text);
    if (!t || /^SEMESTER WORK PLAN$/i.test(t) || /^page\s+\d+$/i.test(t) || /^\d{1,2}$/.test(t)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(l.y - prev.y) < 2.5 && l.x0 - prev.x1 < 16 && !/[.:]$/.test(prev.text)) {
      // a word broken across two runs ("Camb" + "ridge") is glued without a space
      const glue =
        l.x0 - prev.x1 < 1.2 && /[a-z]$/.test(prev.text) && /^[a-z]/.test(t) ? '' : ' ';
      prev.text = `${prev.text}${glue}${t}`.replace(/\s+/g, ' ');
      prev.x1 = l.x1;
    } else {
      out.push({ text: t, y: l.y, x1: l.x1 });
    }
  }
  return out.map((o) => o.text);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = tidy(v).toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(tidy(v));
  }
  return out;
}

/**
 * Best effort: objective codes mentioned inside the remarks cell
 * ("0sc,06covered", "6ug.01 covered"). Matched against the codes that exist in
 * the document using their strand + number part, which is robust against the
 * typos these hand edited cells contain.
 */
function extractRemarkCodes(text: string, docCodes: string[]): string[] {
  if (!text) return [];
  const tokens = text.match(/[0-9Oo]{0,2}\s?[A-Za-z]{2,5}\s?[.,:]\s?[0-9Oo]{1,2}/g) || [];
  const out: string[] = [];
  for (const token of tokens) {
    const cleaned = token.replace(/[\s,:]/g, '.').replace(/\.+/g, '.');
    const m = cleaned.match(/^([0-9Oo]{0,2})([A-Za-z]{2,5})\.([0-9Oo]{1,2})$/);
    // "9 sept,2026" is a date, not an objective code
    if (m && canonicalMonth(m[2])) continue;
    if (!m) continue; // not code shaped (dates like "9 sept,2026" land here)
    const key = `${m[2].toUpperCase()}${m[3].replace(/[Oo]/g, '0')}`;
    const hit = key
      ? docCodes.find((c) => {
          const cm = c.match(/^[0-9]{1,2}([A-Za-z]{2,5})\.([0-9]{1,2})$/);
          return cm ? `${cm[1].toUpperCase()}${cm[2]}` === key : false;
        })
      : undefined;
    out.push(hit || cleaned);
  }
  return dedupe(out);
}
