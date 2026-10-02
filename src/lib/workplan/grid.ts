/**
 * Grid reconstruction: turns the vector rules of a page into columns, rows and
 * cells, and assigns text lines to cells.
 *
 * Row detection is the core of "don't mix things up": every week row is a band
 * between two horizontal rules. A band without its own week number is a
 * *continuation* of the previous week (the normal case when a week is split
 * across two pages by the print layout).
 */
import type { PageGeometry } from './geometry';
import { absorbFragments, splitLinesByColumns, type TextLine } from './textLines';

export type ColumnRole = 'month' | 'week' | 'topic' | 'remarks' | 'other';

export interface Column {
  x0: number;
  x1: number;
  role: ColumnRole;
  /** header text that produced the role, when known */
  header: string | null;
}

export interface GridRow {
  y0: number;
  y1: number;
  /** lines whose vertical centre falls inside the band */
  lines: TextLine[];
  /** text (if any) in each column band */
  cells: Map<ColumnRole | 'other', TextLine[]>;
}

export interface PageGrid {
  page: number;
  columns: Column[];
  rows: GridRow[];
  /** lines that are inside the table x-range but above the first row */
  headerLines: TextLine[];
  /** lines below the table (resource lists etc.) */
  belowTableLines: TextLine[];
  /** true when rows came from vector rules (precise) rather than a fallback */
  fromRules: boolean;
  /** y of the first body row (everything above is header/metadata) */
  bodyTop: number;
  pageGeometry: PageGeometry;
}

const HEADER_PATTERNS: Array<[RegExp, ColumnRole]> = [
  [/MONTH/i, 'month'],
  [/WEEK|ITEM/i, 'week'],
  [/TOPIC|OBJECTIVE|LEARNING|CONTENT|ACTIVIT/i, 'topic'],
  [/REMARK|COMMENT|USE IN THIS PLAN/i, 'remarks'],
];

const MONTH_RE =
  /\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/i;

/** coalesce rule coordinates that are absurdly close (Word emits slivers) */
function coalesce(values: number[], minGap = 10): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || v - out[out.length - 1] >= minGap) out.push(v);
  }
  // keep the last boundary if it got swallowed
  if (out.length && sorted[sorted.length - 1] - out[out.length - 1] > 2) out.push(sorted[sorted.length - 1]);
  return out;
}

function roleFromHeader(text: string): ColumnRole | null {
  for (const [re, role] of HEADER_PATTERNS) if (re.test(text)) return role;
  return null;
}

/**
 * Builds the logical grid of a page.
 *
 * @param items raw positioned items (already running-header filtered)
 * @param lines lines built from `items`
 */
export function buildPageGrid(
  page: number,
  geometry: PageGeometry,
  lines: TextLine[],
  opts: { weekAnchorOf?: (line: TextLine) => number | null } = {},
): PageGrid {
  const inTableX = (l: TextLine) => {
    const xs = coalesce(
      geometry.vertical.map((v) => v.pos),
      8,
    );
    if (xs.length < 2) return true;
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    return l.x1 > left - 25 && l.x0 < right + 25;
  };

  const columnXs = coalesce(
    geometry.vertical.map((v) => v.pos),
    10,
  );
  const columns: Column[] = [];
  for (let i = 0; i + 1 < columnXs.length; i++) {
    columns.push({ x0: columnXs[i], x1: columnXs[i + 1], role: 'other', header: null });
  }

  const rowYs = coalesce(
    geometry.horizontal.map((h) => h.pos),
    2.2,
  );

  // ---- split row lines at the column borders --------------------------------
  const columnEdges = columns.map((c) => c.x0);
  const cellLines = absorbFragments(
    splitLinesByColumns(
      lines.filter(inTableX),
      columnEdges,
    ),
  );

  // ---- assign lines to rows -------------------------------------------------
  const usableLines = cellLines;
  const tableTop = rowYs.length ? rowYs[0] : -Infinity;
  const tableBottom = rowYs.length ? rowYs[rowYs.length - 1] : Infinity;

  const rows: GridRow[] = [];
  for (let i = 0; i + 1 < rowYs.length; i++) {
    rows.push({ y0: rowYs[i], y1: rowYs[i + 1], lines: [], cells: new Map() });
  }
  const outside: TextLine[] = [];
  for (const l of usableLines) {
    const centre = (l.y0 + l.y1) / 2 || l.y;
    if (centre < tableTop - 4 || centre > tableBottom) {
      outside.push(l);
      continue;
    }
    let placed = false;
    for (const row of rows) {
      if (centre >= row.y0 - 1.2 && centre <= row.y1 + 0.6) {
        row.lines.push(l);
        placed = true;
        break;
      }
    }
    if (!placed) outside.push(l);
  }

  // ---- column header row ----------------------------------------------------
  let headerRowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const text = rows[i].lines.map((l) => l.text).join(' ');
    const hits = HEADER_PATTERNS.filter(([re]) => re.test(text)).length;
    // the header row must be short and contain several keywords
    if (hits >= 2 && rows[i].lines.length <= 8 && rows[i].y1 - rows[i].y0 < 60) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex >= 0) {
    const headerRow = rows[headerRowIndex];
    for (const col of columns) {
      const cellLines = headerRow.lines.filter((l) => (l.x0 + l.x1) / 2 >= col.x0 && (l.x0 + l.x1) / 2 < col.x1);
      const text = cellLines.map((l) => l.text).join(' ');
      const role = roleFromHeader(text);
      if (role) {
        col.role = role;
        col.header = text;
      }
    }
    // month column often has no header (month banner row instead)
    if (!columns.some((c) => c.role === 'month')) {
      const idx = columns.findIndex((c) => c.role === 'other');
      if (idx === 0) columns[0].role = 'month';
    }
    if (!columns.some((c) => c.role === 'week')) {
      const idx = columns.findIndex((c) => c.role === 'other');
      if (idx >= 0) columns[idx].role = 'week';
    }
    if (!columns.some((c) => c.role === 'topic')) {
      // widest remaining column
      let best = -1;
      columns.forEach((c, i) => {
        if (c.role === 'other' && c.x1 - c.x0 > best) {
          best = c.x1 - c.x0;
          columns[i].role = 'topic';
        }
      });
    }
    if (!columns.some((c) => c.role === 'remarks')) {
      for (let i = columns.length - 1; i >= 0; i--) {
        if (columns[i].role === 'other') {
          columns[i].role = 'remarks';
          break;
        }
      }
    }
  } else {
    assignRolesByContent(columns, cellLines, opts);
  }

  if (!columns.some((c) => c.role === 'week') || !columns.some((c) => c.role === 'topic')) {
    assignRolesByContent(columns, cellLines, opts, true);
  }

  // ---- cells ---------------------------------------------------------------
  for (const row of rows) {
    for (const l of row.lines) {
      const centre = (l.x0 + l.x1) / 2;
      // pick by max overlap with the column bands
      let best: Column | null = null;
      let bestOverlap = 0;
      for (const col of columns) {
        const overlap = Math.min(l.x1, col.x1) - Math.max(l.x0, col.x0);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = col;
        }
      }
      if (!best) best = columns.find((c) => centre >= c.x0 && centre < c.x1) || columns[0];
      void centre;
      const key: ColumnRole | 'other' = best ? best.role : 'other';
      const list = row.cells.get(key) || [];
      list.push(l);
      row.cells.set(key, list);
    }
    for (const list of row.cells.values()) list.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  }

  const headerLines = headerRowIndex > 0 ? rows.slice(0, headerRowIndex).flatMap((r) => r.lines) : [];
  const bodyRows = (headerRowIndex >= 0 ? rows.slice(headerRowIndex + 1) : rows).sort((a, b) => a.y0 - b.y0);

  return {
    page,
    columns,
    rows: bodyRows,
    headerLines: headerLines.sort((a, b) => a.y - b.y),
    belowTableLines: outside.filter((l) => (l.y0 + l.y1) / 2 > tableBottom).sort((a, b) => a.y - b.y),
    fromRules: geometry.hasGrid,
    bodyTop: bodyRows.length ? bodyRows[0].y0 : tableTop,
    pageGeometry: geometry,
  };
}

/**
 * Fallback role inference (pages that continue the table and therefore have no
 * column header row). Columns are scored by their content:
 *   week    → lines that are week numbers or date ranges
 *   month   → month names (Word often rotates these letters, so single letter
 *             lines are also counted)
 *   topic   → the column with the most text
 *   remarks → right-most remaining column
 */
function assignRolesByContent(
  columns: Column[],
  cellLines: TextLine[],
  opts: { weekAnchorOf?: (line: TextLine) => number | null },
  onlyMissing = false,
): void {
  const inColumn = (c: Column) =>
    cellLines.filter((l) => {
      const centre = (l.x0 + l.x1) / 2;
      return centre >= c.x0 && centre < c.x1;
    });
  const dateish =
    /^[0-9]{1,2}\s*(ST|ND|RD|TH)?\s*[–—\-]\s*[0-9]{1,2}|[0-9]{1,2}\s*[–—\-]\s*[0-9]{1,2}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i;
  const anchors = columns.map(
    (c) =>
      inColumn(c).filter((l) => opts.weekAnchorOf?.(l) != null).length * 3 +
      inColumn(c).filter((l) => dateish.test(l.text)).length,
  );
  const months = columns.map((c) => inColumn(c).filter((l) => MONTH_RE.test(l.text)).length);
  const volume = columns.map((c) => inColumn(c).reduce((a, l) => a + l.text.length, 0));

  if (!columns.some((c) => c.role === 'week')) {
    let best = -1;
    anchors.forEach((n, i) => {
      if (n > 0 && (best < 0 || n > anchors[best])) best = i;
    });
    if (best >= 0) columns[best].role = 'week';
  }
  if (!columns.some((c) => c.role === 'month')) {
    let best = -1;
    months.forEach((n, i) => {
      if (n > 0 && (best < 0 || n > months[best])) best = i;
    });
    if (best >= 0 && columns[best].role === 'other') columns[best].role = 'month';
    else if (columns[0] && columns[0].role === 'other') columns[0].role = 'month';
  }
  if (!columns.some((c) => c.role === 'topic')) {
    let best = -1;
    volume.forEach((n, i) => {
      if (columns[i].role === 'other' && (best < 0 || n > volume[best])) best = i;
    });
    if (best >= 0) columns[best].role = 'topic';
  }
  if (!columns.some((c) => c.role === 'remarks')) {
    for (let i = columns.length - 1; i >= 0; i--) {
      if (columns[i].role === 'other') {
        columns[i].role = 'remarks';
        break;
      }
    }
  }
  void onlyMissing;
}

export { MONTH_RE };
