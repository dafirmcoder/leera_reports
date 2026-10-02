/**
 * Text layer reconstruction.
 *
 * pdf.js returns individual text items with a transform matrix. We convert them
 * to top-down bounding boxes, cluster them into visual lines and rebuild the
 * string with correct spacing — Word PDFs split e.g. "6Rd.03Understand" or
 * "24TH – 28TH" into several items, so the join step matters.
 */
import type { PdfPageLike, PdfTextItem } from './types';

export interface TextLine {
  text: string;
  /** top-down baseline of the line */
  y: number;
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  /** dominant font size of the line */
  size: number;
  fontNames: string[];
  bold: boolean;
  page: number;
  /** rotation in degrees of the dominant items */
  rotation: number;
  /** source items (kept so lines can be re-split at column borders) */
  items: PositionedItem[];
}

export interface PositionedItem {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** baseline (top-down) */
  y: number;
  size: number;
  fontName: string;
  bold: boolean;
  page: number;
  /** rotation in degrees (0 = horizontal, 90 = sideways month labels) */
  rotation: number;
}

const stripInvisibles = (s: string) => s.replace(/[\u200b\u200c\u200d\ufeff]/g, '');
const isInvisible = (s: string) => stripInvisibles(s).replace(/\s/g, '') === '';

/**
 * Text-space dimensions.
 *
 * `item.width` is already expressed in device units, while `transform` maps
 * text space to device space — so the em box has to be normalised by the matrix
 * scale before it is transformed back.
 */
function itemGeometry(it: PdfTextItem, pageHeight: number) {
  const [a, b, c, d, e, f] = it.transform;
  const sx = Math.hypot(a, b) || 1;
  const w = (it.width || 0) / sx; // width in text space (em units)
  const corners: Array<[number, number]> = [
    [0, 0],
    [w, 0],
    [0, 1],
    [w, 1],
  ];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of corners) {
    const x = a * px + c * py + e;
    const y = b * px + d * py + f;
    xs.push(x);
    ys.push(pageHeight - y); // -> top-down
  }
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
    y: pageHeight - f,
  };
}

/** Convert raw pdf.js text content into positioned items (top-down space). */
export async function readPageItems(page: PdfPageLike, pageNumber: number): Promise<PositionedItem[]> {
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight = viewport.height;
  const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
  const items: PositionedItem[] = [];
  for (const raw of content.items as PdfTextItem[]) {
    const str = stripInvisibles(raw.str ?? '');
    if (!str) continue;
    const blank = isInvisible(str);
    // keep real space runs (they carry the word gaps), drop empty artifacts
    if (blank && (raw.width || 0) < 0.4) continue;
    const box = itemGeometry(raw, pageHeight);
    let fontName = raw.fontName || '';
    try {
      const font = page.commonObjs?.get(fontName);
      if (font?.name) fontName = font.name;
    } catch {
      /* commonObjs is an internal cache – keep the font id */
    }
    const size = raw.height || Math.hypot(raw.transform[2], raw.transform[3]) || 10;
    const rot = ((Math.atan2(raw.transform[1], raw.transform[0]) * 180) / Math.PI + 360) % 360;
    items.push({
      text: str,
      x0: box.x0,
      x1: box.x1,
      y0: box.y0,
      y1: box.y1,
      y: box.y,
      size,
      fontName,
      bold: /bold|black|heavy|semibold|demi/i.test(fontName),
      page: pageNumber,
      rotation: rot,
    });
  }
  return items;
}

/** Joins items of one line into a string, inserting the spaces that were lost. */
export function joinItems(items: PositionedItem[]) {
  const ordered = [...items].sort((a, b) => a.x0 - b.x0);
  let text = '';
  let prev: PositionedItem | null = null;
  for (const it of ordered) {
    if (prev) {
      const gap = it.x0 - prev.x1;
      const ref = Math.max(prev.size, it.size, 1);
      const alreadySpaced = /^\s/.test(it.text) || /\s$/.test(prev.text);
      // a gap wider than ~16% of the font size is a word gap
      if (!alreadySpaced && gap > ref * 0.16) text += ' ';
    }
    text += it.text;
    prev = it;
  }
  const norm = text.replace(/[ \t]+/g, ' ').trim();
  const widthBySize = new Map<number, number>();
  for (const it of ordered) {
    const key = Math.round(it.size * 2) / 2;
    widthBySize.set(key, (widthBySize.get(key) || 0) + Math.max(0, it.x1 - it.x0));
  }
  let size = ordered[0]?.size || 10;
  let best = -1;
  for (const [s, w] of widthBySize) if (w > best) ((best = w), (size = s));
  return {
    text: norm,
    x0: Math.min(...ordered.map((i) => i.x0)),
    x1: Math.max(...ordered.map((i) => i.x1)),
    y0: Math.min(...ordered.map((i) => i.y0)),
    y1: Math.max(...ordered.map((i) => i.y1)),
    y: ordered[0].y,
    size,
    fontNames: [...new Set(ordered.map((i) => i.fontName))],
    bold: ordered.some((i) => i.bold),
    page: ordered[0].page,
    rotation: ordered[0].rotation ?? 0,
  };
}

/** smallest difference between two angles in degrees */
const angleDelta = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function makeLine(items: PositionedItem[]): TextLine | null {
  const joined = joinItems(items);
  if (!joined.text) return null;
  return { ...joined, items: [...items].sort((a, b) => a.x0 - b.x0) };
}

const lineRotation = (l: TextLine) => l.items[0]?.rotation ?? 0;

/**
 * Cluster positioned items into visual lines (same baseline, ± size tolerance so
 * that superscripts stay attached).
 */
export function buildLines(items: PositionedItem[], opts: { absorb?: boolean } = {}): TextLine[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const groups: PositionedItem[][] = [];
  let current: PositionedItem[] = [];
  let anchorY = 0;
  let maxSize = 0;
  let maxX = -Infinity;

  for (const it of sorted) {
    const size = it.size || 10;
    // clustering is deliberately *tight*: items are only grouped when they
    // truly share a baseline. Superscripts (which Word draws a few points off
    // the baseline) are re-attached afterwards by absorbFragments().
    const tol = Math.max(1.6, 0.25 * Math.max(maxSize, size));
    const gapLimit = Math.max(30, 3 * Math.max(maxSize, size));
    const sameRotation = !current.length || angleDelta(it.rotation, current[0].rotation) <= 20;
    // ... and they must be horizontally adjacent: this keeps a word in one
    // table cell from being glued onto a word of the neighbouring cell
    const adjacent = !current.length || it.x0 - maxX <= gapLimit;
    if (!current.length || (sameRotation && adjacent && Math.abs(it.y - anchorY) <= tol)) {
      if (!current.length) {
        anchorY = it.y;
        maxSize = size;
        maxX = -Infinity;
      }
      maxSize = Math.max(maxSize, size);
      maxX = Math.max(maxX, it.x1);
      current.push(it);
    } else {
      groups.push(current);
      current = [it];
      anchorY = it.y;
      maxSize = size;
      maxX = it.x1;
    }
  }
  if (current.length) groups.push(current);

  const lines: TextLine[] = [];
  for (const group of groups) {
    const line = makeLine(group);
    if (line) lines.push(line);
  }
  const ordered = lines.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  // absorption is applied per table cell (see grid.ts) so that a fragment can
  // never travel from one column into the next
  return opts.absorb === true ? absorbFragments(ordered) : ordered;
}

/**
 * Absorbs ordinal / superscript fragments ("TH", "ST", "ND", superscript digits)
 * that Word places on a slightly different baseline into the line they belong
 * to, so that "14" + "TH" + "–" + "18" + "TH" becomes "14TH – 18TH".
 *
 * Each fragment is attached to the *nearest* eligible base line, and only when
 * the two are horizontally adjacent — that is what keeps a date fragment in the
 * week column from being pulled into the topic column next to it.
 */
export function absorbFragments(lines: TextLine[]): TextLine[] {
  // "TH", but also several ordinals that share one baseline: "TH TH", "ST ND"
  const ORDINAL = /^(ST|ND|RD|TH)([\s,.]*\1)*([\s,.]+(ST|ND|RD|TH))*$/i;
  const SUPERSCRIPT = /^[0-9\u00b9\u00b2\u00b3\u2070-\u2079\/\-\+\s.'\u2032\u2033*]{1,8}$/;
  const PUNCT = /^[.,;:*\u2032\u2033'"\-\s]{1,3}$/;

  const isFragment = (l: TextLine, base: TextLine): boolean => {
    const text = l.text.trim();
    if (!text || text.length > 8) return false;
    const small = l.size;
    const big = base.size;
    if (small > big * 0.78 || big - small < 1.2) return false;
    if (ORDINAL.test(text)) return true;
    if (SUPERSCRIPT.test(text)) {
      // a pure number could be a week number or a date day: keep those safe
      if (/^[0-9]{1,2}$/.test(text)) return small <= 9.6 && small <= big * 0.62;
      return true;
    }
    return PUNCT.test(text) && small <= big * 0.7;
  };

  const out: TextLine[] = [];
  const consumed = new Set<TextLine>();
  for (const fragment of lines) {
    if (consumed.has(fragment)) continue;
    let best: TextLine | null = null;
    let bestScore = Infinity;
    for (const base of lines) {
      if (base === fragment || consumed.has(base)) continue;
      if (base.items.length === 0) continue;
      if (base.size < fragment.size) continue;
      if (angleDelta(lineRotation(base), lineRotation(fragment)) > 20) continue;
      if (!isFragment(fragment, base)) continue;
      const dy = Math.abs(base.y - fragment.y);
      if (dy > base.size * 0.6) continue;
      const gap = Math.max(base.x0, fragment.x0) - Math.min(base.x1, fragment.x1);
      if (gap > fragment.size * 0.9) continue;
      // prefer the closest baseline, then the tightest horizontal fit
      const score = dy * 4 + Math.max(0, gap);
      if (score < bestScore) {
        bestScore = score;
        best = base;
      }
    }
    if (!best) continue;
    const merged = makeLine([...best.items, ...fragment.items]);
    if (!merged) continue;
    merged.y = best.y;
    merged.size = best.size;
    best.items = merged.items;
    best.text = merged.text;
    best.x0 = merged.x0;
    best.x1 = merged.x1;
    best.y0 = Math.min(best.y0, merged.y0);
    best.y1 = Math.max(best.y1, merged.y1);
    best.bold = best.bold || fragment.bold;
    consumed.add(fragment);
  }
  for (const l of lines) if (!consumed.has(l)) out.push(l);
  return out.sort((a, b) => a.y - b.y || a.x0 - b.x0);
}

/**
 * Splits lines at the table's column borders so that a row line such as
 * "22 AUGUST UNIT 1: … Covered" becomes three cell-scoped lines. Only items
 * that sit on opposite sides of a border are separated; a single text item is
 * never cut (merged cells therefore keep their text intact).
 */
export function splitLinesByColumns(lines: TextLine[], boundaries: number[]): TextLine[] {
  if (!boundaries.length) return lines;
  const columnOf = (x: number) => {
    let idx = 0;
    for (let i = 0; i < boundaries.length; i++) if (x >= boundaries[i] - 0.5) idx = i;
    return idx;
  };
  const out: TextLine[] = [];
  for (const line of lines) {
    const ordered = [...line.items].sort((a, b) => a.x0 - b.x0);
    let bucket: PositionedItem[] = [];
    let bucketCol = -1;
    const flush = () => {
      if (!bucket.length) return;
      const l = makeLine(bucket);
      if (l) out.push(l);
      bucket = [];
    };
    for (const it of ordered) {
      const col = columnOf((it.x0 + it.x1) / 2);
      if (bucketCol === -1) bucketCol = col;
      if (col !== bucketCol) {
        flush();
        bucketCol = col;
      }
      bucket.push(it);
    }
    flush();
  }
  return out.sort((a, b) => a.y - b.y || a.x0 - b.x0);
}

const normKey = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Removes the repeating page header ("SEMESTER WORK PLAN", school name) that
 * some templates stamp across every page. It is printed on top of the table —
 * page 6 of one of the sample workplans literally overlaps an objective line —
 * so it has to be removed at *item* level, before lines are built; otherwise
 * the header text ends up inside a week's objective.
 */
export function stripRunningHeaderItems(
  items: PositionedItem[],
  headerStrings: string[],
  bodySize: number,
): { items: PositionedItem[]; removed: number } {
  if (!headerStrings.length) return { items, removed: 0 };
  const keys = headerStrings.map(normKey).filter(Boolean);
  let removed = 0;
  const out = items.filter((it) => {
    if (it.size < bodySize * 1.25) return true; // only the big stamp is a header
    const key = normKey(it.text);
    if (!key) return true;
    const isHeader = keys.some((k) => k && (k === key || k.includes(key) || key.includes(k)));
    if (isHeader) {
      removed++;
      return false;
    }
    return true;
  });
  return { items: out, removed };
}

/** @deprecated kept for backwards compatibility – use stripRunningHeaderItems */
export function stripRunningHeaders(
  lines: TextLine[],
  headerStrings: string[],
  bodySize: number,
): { lines: TextLine[]; removed: number } {
  const flat = lines.flatMap((l) => l.items);
  const { items, removed } = stripRunningHeaderItems(flat, headerStrings, bodySize);
  return { lines: buildLines(items, { absorb: false }), removed };
}
