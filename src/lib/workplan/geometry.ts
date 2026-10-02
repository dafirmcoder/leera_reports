/**
 * Vector geometry extraction.
 *
 * Word / Google-Docs exported workplan tables are drawn with real vector
 * borders (thin filled rectangles or stroked lines). Recovering those rules is
 * what lets us find the true row boundaries of the table — including the rows
 * that silently continue onto the next page.
 */
import type { PdfPageLike } from './types';

/** pdf.js OPS enum values we care about (stable across pdfjs-dist v3/v4). */
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  endPath: 28,
  constructPath: 91,
};

export interface Rule {
  /** top-down coordinate: for a horizontal rule the y, for a vertical rule the x */
  pos: number;
  /** the other axis range covered by this rule */
  from: number;
  to: number;
}

export interface PageGeometry {
  horizontal: Rule[];
  vertical: Rule[];
  pageWidth: number;
  pageHeight: number;
  /** true when the page has a usable table grid */
  hasGrid: boolean;
}

type Matrix = number[]; // [a,b,c,d,e,f]

const mul = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

const applyMatrix = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

interface RawRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Walks the pdf.js operator list and returns every *painted* axis-aligned
 * rectangle. Clip paths (constructPath → eoClip → endPath) are ignored.
 */
export async function collectPaintedRects(page: PdfPageLike): Promise<RawRect[]> {
  const ol = await page.getOperatorList();
  const out: RawRect[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let pending: Array<{ rect?: RawRect; pt?: [number, number] }> = [];

  const flush = () => {
    if (!pending.length) return;
    for (const p of pending) if (p.rect) out.push(p.rect);
    const pts = pending.filter((p) => p.pt).map((p) => p.pt as [number, number]);
    for (let i = 0; i + 1 < pts.length; i++) {
      out.push({
        x0: Math.min(pts[i][0], pts[i + 1][0]),
        y0: Math.min(pts[i][1], pts[i + 1][1]),
        x1: Math.max(pts[i][0], pts[i + 1][0]),
        y1: Math.max(pts[i][1], pts[i + 1][1]),
      });
    }
    pending = [];
  };

  const { fnArray, argsArray } = ol;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
    else if (fn === OPS.constructPath) {
      // pdf.js gives either [ops, coords] or [[ops...], [coords...]] when a path has subpaths.
      const a = args as [unknown, unknown];
      const first = a[0] as unknown;
      const nested = Array.isArray(first) && Array.isArray((first as unknown[])[0]);
      const opGroups = (nested ? (a[0] as number[][]) : [a[0] as number[]]) || [];
      const coordGroups = (nested ? (a[1] as number[][]) : [a[1] as number[]]) || [];
      for (let g = 0; g < opGroups.length; g++) {
        const ops = opGroups[g] || [];
        const coords = coordGroups[g] || [];
        let k = 0;
        for (const op of ops) {
          if (op === OPS.rectangle) {
            const [x, y, w, h] = [coords[k], coords[k + 1], coords[k + 2], coords[k + 3]];
            k += 4;
            const p1 = applyMatrix(ctm, x, y);
            const p2 = applyMatrix(ctm, x + w, y + h);
            pending.push({
              rect: {
                x0: Math.min(p1[0], p2[0]),
                y0: Math.min(p1[1], p2[1]),
                x1: Math.max(p1[0], p2[0]),
                y1: Math.max(p1[1], p2[1]),
              },
            });
          } else if (op === OPS.moveTo || op === OPS.lineTo) {
            pending.push({ pt: applyMatrix(ctm, coords[k], coords[k + 1]) });
            k += 2;
          } else if (op === OPS.curveTo) k += 6;
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) k += 4;
        }
      }
    } else if (
      fn === OPS.fill ||
      fn === OPS.eoFill ||
      fn === OPS.fillStroke ||
      fn === OPS.eoFillStroke ||
      fn === OPS.stroke ||
      fn === OPS.closeStroke
    ) {
      flush();
    } else if (fn === OPS.endPath) {
      pending = [];
    }
  }
  return out;
}

/** Merge rule positions that are within `tol` points of each other. */
function mergeRules(rules: Rule[], tol = 1.6): Rule[] {
  const sorted = [...rules].sort((a, b) => a.pos - b.pos);
  const merged: Rule[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.pos - r.pos) <= tol) {
      last.from = Math.min(last.from, r.from);
      last.to = Math.max(last.to, r.to);
      last.pos = (last.pos + r.pos) / 2;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * Extracts the table grid of a page.
 *
 * All coordinates are returned in *top-down* space (y grows downwards from the
 * top of the page) so they can be compared directly with text line positions.
 */
export async function readPageGeometry(page: PdfPageLike): Promise<PageGeometry> {
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight = viewport.height;
  const pageWidth = viewport.width;
  const rects = await collectPaintedRects(page);

  const horizontal: Rule[] = [];
  const vertical: Rule[] = [];
  for (const r of rects) {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    // thin & long → table rule
    if (h <= 2.6 && w >= 40) {
      horizontal.push({ pos: pageHeight - r.y1, from: r.x0, to: r.x1 });
    } else if (w <= 2.6 && h >= 18) {
      vertical.push({ pos: r.x0, from: pageHeight - r.y1, to: pageHeight - r.y0 });
    }
  }

  const mergedH = mergeRules(horizontal);
  const mergedV = mergeRules(vertical);
  return {
    horizontal: mergedH,
    vertical: mergedV,
    pageWidth,
    pageHeight,
    hasGrid: mergedH.length >= 2 && mergedV.length >= 2,
  };
}
