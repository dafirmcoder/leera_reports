/**
 * Renders parsed work plans as "standard" work plan PDFs in the house style of
 * LIS -YEAR 12- SEMESTER 1 WORKPLAN - 26'27 (see ./style.ts for the palette).
 *
 * Browser and Node friendly: only jsPDF is needed.
 *
 * ```ts
 * import { renderWorkplanPdf, downloadWorkplanPdf } from './lib/render';
 * const doc = await parseWorkplanPdf(file, { pdfjs: pdfjsLib });
 * downloadWorkplanPdf(doc);                       // ENG-Year6-Semester1-workplan.pdf
 * const blob = renderWorkplanPdf(doc).output('blob');
 * ```
 */
import { jsPDF } from 'jspdf';
import type { ParsedWorkplan, WorkplanWeek } from '../workplan/types';
import {
  A4_LANDSCAPE,
  FONT_FAMILY,
  LETTER_LANDSCAPE,
  REFERENCE_PALETTE,
  type WorkplanMetrics,
  type WorkplanPalette,
} from './style';
import { CAMBRIDGE_LOGO, CAMBRIDGE_LOGO_ASPECT, SCHOOL_LOGO, SCHOOL_LOGO_ASPECT } from './assets';
import { FONT_BOLD, FONT_FACE, FONT_REGULAR } from './fonts';

export interface RenderWorkplanOptions {
  /** 'letter' (default, the reference format) or 'a4' — both landscape. */
  pageSize?: 'letter' | 'a4';
  /** School name in the first header row (default: `doc.school`). */
  schoolName?: string | null;
  /** Document title (default: `doc.title`, falling back to "SEMESTER WORK PLAN"). */
  title?: string | null;
  /**
   * Logo data URIs. Defaults to the logos extracted from the reference work
   * plan; pass `null` to leave one out.
   */
  logos?: { school?: string | null; cambridge?: string | null };
  /** Colour overrides, merged over the reference palette. */
  palette?: Partial<WorkplanPalette>;
  /** Highlight new UNIT headings in bright green (default true). */
  highlightUnits?: boolean;
  /** Render "Page x of y" and a generated-on stamp (default true). */
  footer?: boolean;
  /** Extra line under the header (e.g. "Prepared by …"). */
  footnote?: string | null;
  /** Scale every font by this factor (default 1). */
  fontScale?: number;
  /**
   * Font family to use. Defaults to the embedded `WorkplanSans`; pass
   * 'helvetica' to use jsPDF's built-in font (smaller file, but characters
   * outside WinAnsi will not print).
   */
  fontFamily?: string;
}

type Cell = { x: number; w: number };

interface RenderedLine {
  text: string;
  /** bold part drawn before `text` (objective / lesson codes) */
  lead?: string;
  kind: 'unit' | 'objective' | 'lesson' | 'assessment' | 'note' | 'heading';
  /** continuation lines are indented under their parent */
  indent?: boolean;
}

interface MeasuredRow {
  week: WorkplanWeek;
  lines: RenderedLine[];
  remarks: string[];
  height: number;
}

/* -------------------------------------------------------------- helpers -- */

/**
 * The PDF text layer uses Unicode "mathematical alphanumeric symbols"
 * (U+1D400–U+1D7FF: 𝑠, 𝐴, 𝒙, 𝟏, …) for anything set in maths italic. No
 * normal text font carries that block, so those characters would simply
 * disappear from the generated PDF. Map them back to their base letters (and a
 * handful of typographic characters) before measuring/drawing.
 */
const MATH_ALPHANUMERIC_BASE = [
  // (start of the run, first char of the run)
  [0x1d400, 'A'], [0x1d41a, 'a'], [0x1d434, 'A'], [0x1d44e, 'a'],
  [0x1d468, 'A'], [0x1d482, 'a'], [0x1d49c, 'A'], [0x1d4b6, 'a'],
  [0x1d4d0, 'A'], [0x1d4ea, 'a'], [0x1d504, 'A'], [0x1d51e, 'a'],
  [0x1d538, 'A'], [0x1d552, 'a'], [0x1d56c, 'A'], [0x1d586, 'a'],
  [0x1d5a0, 'A'], [0x1d5ba, 'a'], [0x1d5d4, 'A'], [0x1d5ee, 'a'],
  [0x1d608, 'A'], [0x1d622, 'a'], [0x1d63c, 'A'], [0x1d656, 'a'],
  [0x1d670, 'A'], [0x1d68a, 'a'],
  [0x1d6a8, 'Α'], [0x1d6c2, 'α'], [0x1d6e2, 'Α'], [0x1d6fc, 'α'],
  [0x1d71c, 'Α'], [0x1d736, 'α'], [0x1d756, 'Α'], [0x1d770, 'α'],
  [0x1d790, 'Α'], [0x1d7aa, 'α'],
  [0x1d7ce, '0'], [0x1d7d8, '0'], [0x1d7e2, '0'], [0x1d7ec, '0'], [0x1d7f6, '0'],
] as const;

export function toPrintable(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x1d400 && cp <= 0x1d7ff) {
      let mapped = '';
      for (const [start, first] of MATH_ALPHANUMERIC_BASE) {
        if (cp >= start && cp <= start + 25) {
          mapped = String.fromCodePoint(first.codePointAt(0)! + (cp - start));
          break;
        }
      }
      out += mapped || '';
      continue;
    }
    // a few typographic singletons Word likes
    if (cp === 0x2032) out += "'"; // ′
    else if (cp === 0x2033) out += '"'; // ″
    else if (cp === 0x2212) out += '-'; // − minus sign
    else if (cp === 0x22ef || cp === 0x2026) out += '...'; // ⋯ / …
    else if (cp === 0x27a2 || cp === 0x27a4 || cp === 0x25b8) out += '•'; // ➢ ➤ ▸
    else out += ch;
  }
  return out;
}

/**
 * Font family used by the current render pass. jsPDF draws synchronously, so a
 * module-level slot is safe here and keeps the drawing helpers readable.
 */
let ACTIVE_FONT = FONT_FAMILY;

/** Registers the embedded subset font (no-op when it is already registered). */
function registerFonts(pdf: jsPDF): void {
  const internal = pdf as unknown as {
    getFontList?: () => Record<string, unknown>;
    addFileToVFS: (name: string, data: string) => void;
    addFont: (name: string, family: string, style: string) => void;
  };
  try {
    if (internal.getFontList && internal.getFontList()[FONT_FACE]) return;
    internal.addFileToVFS('WorkplanSans-Regular.ttf', FONT_REGULAR);
    internal.addFont('WorkplanSans-Regular.ttf', FONT_FACE, 'normal');
    internal.addFileToVFS('WorkplanSans-Bold.ttf', FONT_BOLD);
    internal.addFont('WorkplanSans-Bold.ttf', FONT_FACE, 'bold');
  } catch {
    // if the host app registered a different family, fall back to it silently
  }
}

function measure(
  pdf: jsPDF,
  text: string,
  width: number,
  size: number,
  bold: boolean,
  lineHeight: number,
): string[] {
  pdf.setFont(ACTIVE_FONT, bold ? 'bold' : 'normal');
  pdf.setFontSize(size);
  const lines = pdf.splitTextToSize(toPrintable(text) || '', width) as string[];
  void lineHeight;
  return lines.length ? lines : [''];
}

/** layout of a body row: the lines of each cell, wrapped, ready to draw */
function layoutWeek(
  pdf: jsPDF,
  week: WorkplanWeek,
  cols: Cell[],
  m: WorkplanMetrics,
  scale: number,
): MeasuredRow {
  const size = m.fontCell * scale;
  const lh = size * m.lineHeight;
  const [, , topicCol, remarksCol] = cols;
  const topicWidth = topicCol.w - 12;
  const lines: RenderedLine[] = [];

  const seenUnits = new Set<string>();
  const units = week.units.length ? week.units : week.topics;
  for (const u of units) {
    if (!u || seenUnits.has(u)) continue;
    for (const [i, l] of measure(pdf, u, topicWidth, size + 0.5, true, m.lineHeight).entries()) {
      lines.push({ text: l, kind: 'unit', indent: i > 0 });
    }
    seenUnits.add(u);
  }

  // NB: jsPDF has two width helpers — getStringUnitWidth() returns em units
  // (so it must be multiplied by the font size) and getTextWidth() returns
  // points. Everything here uses getTextWidth().
  const leadWidthOf = (lead: string) => {
    pdf.setFont(ACTIVE_FONT, 'bold');
    pdf.setFontSize(size);
    return pdf.getTextWidth(lead);
  };
  const bulletWidth = () => {
    pdf.setFont(ACTIVE_FONT, 'normal');
    pdf.setFontSize(size);
    return pdf.getTextWidth('• ');
  };

  for (const o of week.objectives) {
    const lead = o.code ? `${o.code} ${o.text.includes(':') ? '' : ''}` : '';
    const indentWidth = bulletWidth() + (lead ? leadWidthOf(`${lead} `) : 0);
    const body = measure(pdf, o.text, Math.max(40, topicWidth - indentWidth), size, false, m.lineHeight);
    body.forEach((l, i) =>
      lines.push({ text: l, lead: i === 0 ? lead : '', kind: 'objective', indent: i > 0 }),
    );
  }

  for (const lesson of week.lessons) {
    const lead = lesson.code ? `${lesson.code}:` : '';
    const indentWidth = bulletWidth() + (lead ? leadWidthOf(`${lead} `) : 0);
    const body = measure(pdf, lesson.text, Math.max(40, topicWidth - indentWidth), size, false, m.lineHeight);
    body.forEach((l, i) =>
      lines.push({ text: l, lead: i === 0 ? lead : '', kind: 'lesson', indent: i > 0 }),
    );
  }

  // assessments that are not already printed in the remarks column
  const remarksText = (week.remarks ?? '').toLowerCase().replace(/\s+/g, ' ');
  for (const a of week.assessments) {
    if (remarksText.includes(a.toLowerCase().replace(/\s+/g, ' '))) continue;
    lines.push({ text: a, kind: 'assessment' });
  }

  const remarkSource = (week.remarksNote && week.remarksNote.trim() ? week.remarksNote : week.remarks) ?? '';
  const remarkLines = remarkSource
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((r) => measure(pdf, r, remarksCol.w - 10, size - 0.5, false, m.lineHeight));

  // ---- height -------------------------------------------------------------
  const bullets = lines.filter((l) => l.kind !== 'unit' && l.kind !== 'assessment').length;
  const unitLines = lines.filter((l) => l.kind === 'unit').length;
  const assessmentLines = lines.filter((l) => l.kind === 'assessment').length;
  const bodyHeight =
    lines.length * lh +
    unitLines * 2 + // a little air around unit headings
    assessmentLines * 2 +
    (bullets ? 2 : 0);
  const height = Math.max(m.minRowHeight, Math.max(bodyHeight, remarkLines.length * lh) + 10);

  return {
    week,
    lines,
    remarks: remarkLines,
    height,
  };
}

/* ------------------------------------------------------------- renderer -- */

const WEEK_COL_INDEX = 1;

function renderDocs(docs: ParsedWorkplan[], options: RenderWorkplanOptions = {}): jsPDF {
  const metrics: WorkplanMetrics =
    options.pageSize === 'a4' ? A4_LANDSCAPE : LETTER_LANDSCAPE;
  const palette: WorkplanPalette = { ...REFERENCE_PALETTE, ...options.palette };
  const scale = options.fontScale ?? 1;
  const highlightUnits = options.highlightUnits !== false;
  const showFooter = options.footer !== false;
  ACTIVE_FONT = options.fontFamily ?? FONT_FAMILY;

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [metrics.pageWidth, metrics.pageHeight],
    compress: true,
  });
  registerFonts(pdf);
  pdf.setFont(ACTIVE_FONT, 'normal');

  const marginX = metrics.marginX;
  const tableWidth = metrics.columns.reduce((n, w) => n + w, 0);
  const cols: Cell[] = [];
  let cx = marginX;
  for (const w of metrics.columns) {
    cols.push({ x: cx, w });
    cx += w;
  }

  docs.forEach((doc, docIndex) => {
    if (docIndex > 0) pdf.addPage([metrics.pageWidth, metrics.pageHeight], 'landscape');
    drawDocument(pdf, doc, { metrics, palette, scale, highlightUnits, showFooter, options, cols, tableWidth });
  });

  return pdf;
}

function drawDocument(
  pdf: jsPDF,
  doc: ParsedWorkplan,
  ctx: {
    metrics: WorkplanMetrics;
    palette: WorkplanPalette;
    scale: number;
    highlightUnits: boolean;
    showFooter: boolean;
    options: RenderWorkplanOptions;
    cols: Cell[];
    tableWidth: number;
  },
) {
  const { metrics: m, palette: p, scale, cols, tableWidth } = ctx;
  const marginX = m.marginX;
  const logoTop = 26;
  const schoolLogo = ctx.options.logos?.school === undefined ? SCHOOL_LOGO : ctx.options.logos.school;
  const cambridgeLogo =
    ctx.options.logos?.cambridge === undefined ? CAMBRIDGE_LOGO : ctx.options.logos.cambridge;

  const wrapText = (text: string, width: number, size: number, bold = false) =>
    measure(pdf, text, width, size, bold, m.lineHeight);

  const drawHeader = (pageNumber: number) => {
    const y0 = logoTop;
    let y = y0;

    // ---- logos + title (on every page, like the reference export) ----------
    if (schoolLogo) {
      const h = m.logoHeight;
      const w = h * SCHOOL_LOGO_ASPECT;
      pdf.addImage(schoolLogo, 'PNG', marginX, y, w, h, undefined, 'FAST');
    }
    if (cambridgeLogo) {
      const h = m.logoHeight * 0.56;
      const w = h * CAMBRIDGE_LOGO_ASPECT;
      pdf.addImage(cambridgeLogo, 'PNG', marginX + tableWidth - w, y + 2, w, h, undefined, 'FAST');
    }
    pdf.setFont(ACTIVE_FONT, 'bold');
    pdf.setFontSize(m.fontTitle * scale);
    pdf.setTextColor(...p.text);
    pdf.text(
      toPrintable((ctx.options.title ?? doc.title ?? 'SEMESTER WORK PLAN').toUpperCase()),
      marginX + tableWidth / 2,
      y + m.logoHeight * 0.62,
      { align: 'center', baseline: 'middle' },
    );
    y += m.logoHeight + m.logoGap;

    // ---- blue brand band ---------------------------------------------------
    pdf.setFillColor(...p.brandBand);
    pdf.rect(marginX, y, tableWidth, m.brandBandHeight, 'F');
    y += m.brandBandHeight;

    const headerRow = (text: string, fill: [number, number, number], align: 'center' | 'left', h = m.headerRowHeight) => {
      pdf.setFillColor(...fill);
      pdf.rect(marginX, y, tableWidth, h, 'F');
      pdf.setDrawColor(...p.border);
      pdf.setLineWidth(0.5);
      pdf.rect(marginX, y, tableWidth, h, 'S');
      pdf.setFont(ACTIVE_FONT, 'bold');
      pdf.setFontSize(m.fontHeader * scale);
      pdf.setTextColor(...p.text);
      pdf.text(toPrintable(text), align === 'center' ? marginX + tableWidth / 2 : cols[WEEK_COL_INDEX].x + 6, y + h / 2, {
        align,
        baseline: 'middle',
      });
      y += h;
    };

    headerRow(toPrintable((ctx.options.schoolName ?? doc.school ?? '').toUpperCase()), p.headerFill, 'center');
    y += m.headerRowHeight * 0.8 - m.headerRowHeight; // spacer row (no fill)
    pdf.setFillColor(...p.rowPlain);
    pdf.rect(marginX, y, tableWidth, m.headerRowHeight * 0.8, 'F');
    pdf.rect(marginX, y, tableWidth, m.headerRowHeight * 0.8, 'S');
    y += m.headerRowHeight * 0.8;

    const planBits = [
      doc.level ? `YEAR ${doc.level}` : null,
      'LONG TERM PLAN',
      doc.session,
    ].filter(Boolean);
    headerRow(planBits.join(' '), p.headerFill, 'center');
    headerRow(
      [doc.subject, doc.teacher ? `(${doc.teacher})` : null].filter(Boolean).join(' '),
      p.rowPlain,
      'center',
    );
    headerRow(
      [doc.semester ? `SEMESTER ${doc.semester}` : null, doc.period ? `(${shortPeriod(doc.period)})` : null]
        .filter(Boolean)
        .join(' '),
      p.headerFill,
      'left',
    );

    // ---- green column header row ------------------------------------------
    pdf.setFillColor(...p.columnHeaderFill);
    pdf.rect(marginX, y, tableWidth, m.columnHeaderHeight, 'F');
    pdf.setDrawColor(...p.border);
    pdf.rect(marginX, y, tableWidth, m.columnHeaderHeight, 'S');
    const headers = ['MONTHS', 'WEEK', 'TOPIC/ LEARNING OBJECTIVE', 'REMARKS'];
    pdf.setFont(ACTIVE_FONT, 'bold');
    pdf.setFontSize(m.fontColumnHeader * scale);
    pdf.setTextColor(255, 255, 255);
    headers.forEach((h, i) => {
      pdf.text(h, cols[i].x + cols[i].w / 2, y + m.columnHeaderHeight / 2, {
        align: 'center',
        baseline: 'middle',
      });
    });
    pdf.setTextColor(...p.text);

    // vertical rules of the column header row
    for (let i = 0; i < cols.length; i++) {
      pdf.line(cols[i].x, y, cols[i].x, y + m.columnHeaderHeight);
    }
    y += m.columnHeaderHeight;
    return { y, pageNumber };
  };

  let { y: cursorTop } = drawHeader(1);
  const bottomLimit = m.pageHeight - 36;

  const drawFooter = (page: number, total: number) => {
    const withFooter = ctx.showFooter;
    if (!withFooter && !ctx.options.footnote) return;
    pdf.setFont(ACTIVE_FONT, 'normal');
    pdf.setFontSize(m.fontFooter * scale);
    pdf.setTextColor(...p.mutedText);
    if (withFooter) {
      pdf.text(toPrintable(ctx.options.footnote ?? generatedStamp(doc)), marginX, m.pageHeight - 18, {
        baseline: 'middle',
      });
      pdf.text(`Page ${page} of ${total}`, marginX + tableWidth, m.pageHeight - 18, {
        align: 'right',
        baseline: 'middle',
      });
    } else if (ctx.options.footnote) {
      pdf.text(toPrintable(ctx.options.footnote), marginX, m.pageHeight - 18, { baseline: 'middle' });
    }
    pdf.setTextColor(...p.text);
  };

  // ---- body ----------------------------------------------------------------
  const measured = doc.weeks.map((w) => layoutWeek(pdf, w, cols, m, scale));

  const pages: MeasuredRow[][] = [];
  let page: MeasuredRow[] = [];
  let used = 0;
  // the header is repeated on every page, so the usable body height is what is
  // left between the header and the footer
  const capacity = bottomLimit - cursorTop;
  for (const row of measured) {
    if (page.length && used + row.height > capacity) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(row);
    used += row.height;
  }
  if (page.length) pages.push(page);

  // resources list: drop duplicated "RESOURCES"/"RESOURCES:" headings that the
  // parser may have collected from the source document
  const resourceItems = doc.resources.filter((r) => !/^RESOURCES?:?$/i.test(r.trim()));
  const resourceLines: string[] = resourceItems.length ? ['RESOURCES', ...resourceItems] : [];

  const drawResources = (items: string[]) => {
    if (!items.length) return;
    pdf.setFont(ACTIVE_FONT, 'bold');
    pdf.setFontSize(m.fontHeader * scale);
    pdf.text(toPrintable(items[0]), marginX, cursorTop + 16, { baseline: 'middle' });
    cursorTop += 22;
    pdf.setFont(ACTIVE_FONT, 'normal');
    pdf.setFontSize(m.fontMeta * scale);
    const colWidth = tableWidth / 2 - 12;
    const half = Math.ceil((items.length - 1) / 2);
    const left = items.slice(1, 1 + half);
    const right = items.slice(1 + half);
    const drawList = (list: string[], x: number) => {
      let ly = cursorTop;
      for (const item of list) {
        for (const line of pdf.splitTextToSize(`•  ${item}`, colWidth) as string[]) {
          if (ly > bottomLimit) return ly;
          pdf.text(toPrintable(line), x, ly, { baseline: 'top' });
          ly += m.fontMeta * scale * 1.35;
        }
        ly += 1.5;
      }
      return ly;
    };
    const afterLeft = drawList(left, marginX);
    const afterRight = drawList(right, marginX + tableWidth / 2 + 12);
    cursorTop = Math.max(afterLeft, afterRight) + 14;
  };

  pages.forEach((rows, pageIndex) => {
    if (pageIndex > 0) {
      pdf.addPage([m.pageWidth, m.pageHeight], 'landscape');
      cursorTop = drawHeader(pageIndex + 1).y;
    }
    let y = cursorTop;

    // month blocks: consecutive rows that share a month keep one merged cell
    const blocks: Array<{ month: string | null; from: number; to: number }> = [];
    rows.forEach((r, i) => {
      const month = (r.week.month || '').trim() || null;
      const last = blocks[blocks.length - 1];
      if (last && month && last.month && last.month.toUpperCase() === month.toUpperCase()) {
        last.to = i;
      } else {
        blocks.push({ month, from: i, to: i });
      }
    });

    const rowHeight = (i: number) => rows[i].height;
    const blockTop = (i: number) => y + rows.slice(0, i).reduce((n, r) => n + r.height, 0);

    rows.forEach((row, i) => {
      const top = blockTop(i);
      const h = rowHeight(i);
      const tint = Math.floor(i / 1) % 2 === 0 ? p.rowTint : p.rowPlain;
      pdf.setFillColor(...(i % 2 === 0 ? p.rowTint : p.rowPlain));
      pdf.rect(marginX, top, tableWidth, h, 'F');
      void tint;

      // vertical cell borders
      pdf.setDrawColor(...p.border);
      pdf.setLineWidth(0.5);
      for (const c of cols) pdf.line(c.x, top, c.x, top + h);
      pdf.line(marginX + tableWidth, top, marginX + tableWidth, top + h);

      // ---- week cell -------------------------------------------------------
      const weekCol = cols[WEEK_COL_INDEX];
      pdf.setFont(ACTIVE_FONT, 'bold');
      pdf.setFontSize((m.fontCell + 1.5) * scale);
      pdf.setTextColor(...p.text);
      const hasDates = !!row.week.dates && row.week.dates.trim().length > 0;
      const rawWeekNum = row.week.week !== null ? String(row.week.week) : row.week.label;
      const weekLabel = rawWeekNum.toUpperCase().startsWith('WEEK') ? rawWeekNum : `Week ${rawWeekNum}`;

      if (hasDates) {
        pdf.text(toPrintable(weekLabel), weekCol.x + weekCol.w / 2, top + 13, {
          align: 'center',
          baseline: 'middle',
        });
        pdf.setFont(ACTIVE_FONT, 'bold');
        pdf.setFontSize((m.fontCell - 1) * scale);
        pdf.setTextColor(...p.mutedText);
        const dateLines = wrapText(row.week.dates ?? '', weekCol.w - 6, (m.fontCell - 1) * scale, true);
        for (const [li, line] of dateLines.entries()) {
          pdf.text(toPrintable(line), weekCol.x + weekCol.w / 2, top + 25 + li * ((m.fontCell - 1) * scale * 1.25), {
            align: 'center',
            baseline: 'middle',
          });
        }
        pdf.setTextColor(...p.text);
      } else {
        pdf.text(toPrintable(weekLabel), weekCol.x + weekCol.w / 2, top + h / 2, {
          align: 'center',
          baseline: 'middle',
        });
      }

      // ---- topic cell ------------------------------------------------------
      const topicCol = cols[2];
      let ty = top + 11;
      const lineH = m.fontCell * scale * m.lineHeight;
      for (const line of row.lines) {
        if (line.kind === 'unit') {
          const size = (m.fontCell + 0.5) * scale;
          pdf.setFont(ACTIVE_FONT, 'bold');
          pdf.setFontSize(size);
          const w = Math.min(topicCol.w - 12, pdf.getTextWidth(line.text) + 6);
          if (ctx.highlightUnits && !line.indent) {
            pdf.setFillColor(...p.unitHighlight);
            pdf.rect(topicCol.x + 5, ty - size * 0.95, w, size * 1.32, 'F');
            pdf.setTextColor(...p.text);
          }
          pdf.text(toPrintable(line.text), topicCol.x + 8, ty, { baseline: 'alphabetic' });
          ty += lineH + 2;
          continue;
        }
        if (line.kind === 'assessment') {
          pdf.setFont(ACTIVE_FONT, 'bold');
          pdf.setFontSize(m.fontCell * scale);
          pdf.text(toPrintable(line.text), topicCol.x + topicCol.w / 2, ty + 2, { align: 'center', baseline: 'middle' });
          ty += lineH + 2;
          continue;
        }
        const x = topicCol.x + 12;
        let bx = x;
        const isItem = line.kind === 'objective' || line.kind === 'lesson';
        if (isItem && !line.indent) {
          pdf.setFont(ACTIVE_FONT, 'normal');
          pdf.setFontSize(m.fontCell * scale);
          pdf.text('•', bx, ty, { baseline: 'alphabetic' });
          bx += pdf.getTextWidth('• ');
        } else if (line.indent) {
          bx += pdf.getTextWidth('• ');
        }
        if (line.lead) {
          pdf.setFont(ACTIVE_FONT, 'bold');
          pdf.setFontSize(m.fontCell * scale);
          pdf.text(toPrintable(line.lead), bx, ty, { baseline: 'alphabetic' });
          bx += pdf.getTextWidth(`${line.lead} `);
        }
        pdf.setFont(ACTIVE_FONT, 'normal');
        pdf.setFontSize(m.fontCell * scale);
        pdf.text(toPrintable(line.text), bx, ty, { baseline: 'alphabetic' });
        ty += lineH;
      }

      // ---- remarks cell ----------------------------------------------------
      if (row.remarks.length) {
        pdf.setFont(ACTIVE_FONT, 'normal');
        pdf.setFontSize((m.fontCell - 0.5) * scale);
        let ry = top + 11;
        for (const line of row.remarks) {
          pdf.text(toPrintable(line), cols[3].x + 5, ry, { baseline: 'alphabetic' });
          ry += lineH;
        }
      }

      // bottom border: avoid chopping through merged month cell
      const currentBlock = blocks.find((b) => i >= b.from && i <= b.to);
      const isBlockEnd = !currentBlock || currentBlock.to === i;
      const startX = isBlockEnd ? marginX : cols[WEEK_COL_INDEX].x;
      pdf.setDrawColor(...p.border);
      pdf.setLineWidth(0.5);
      pdf.line(startX, top + h, marginX + tableWidth, top + h);
    });

    // ---- merged month cells (drawn cleanly inside the merged block) -----
    blocks.forEach((block) => {
      if (!block.month) return;
      const top = blockTop(block.from);
      const bottom = top + rows.slice(block.from, block.to + 1).reduce((n, r) => n + r.height, 0);
      const monthCol = cols[0];
      const label = block.month.toUpperCase();

      pdf.setFont(ACTIVE_FONT, 'bold');
      let size = 11 * scale;
      pdf.setFontSize(size);
      const maxTextWidth = monthCol.w - 10;
      const textWidth = pdf.getTextWidth(label);
      if (textWidth > maxTextWidth) {
        size = Math.max(7.5, size * (maxTextWidth / textWidth));
        pdf.setFontSize(size);
      }
      pdf.setTextColor(...p.text);
      pdf.text(toPrintable(label), monthCol.x + monthCol.w / 2, (top + bottom) / 2, {
        align: 'center',
        baseline: 'middle',
      });
    });

    cursorTop = y + rows.reduce((n, r) => n + r.height, 0) + 14;

    // resources on the last page
    if (pageIndex === pages.length - 1 && resourceLines.length) {
      drawResources(resourceLines);
    }

    drawFooter(pageIndex + 1, pages.length);
  });

  if (!pages.length) {
    if (resourceLines.length) drawResources(resourceLines);
    drawFooter(1, 1);
  }
}

/** "August–December 2026" → "AUG – DEC 2026" (the reference header wording). */
function shortPeriod(period: string): string {
  const months = period.match(
    /\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)\b/gi,
  );
  const year = period.match(/\b(20\d{2})\b/);
  if (!months || !months.length) return period.toUpperCase();
  const names = months.map((mo) => mo.toUpperCase().slice(0, 3));
  const span = names.length > 1 ? `${names[0]} – ${names[names.length - 1]}` : names[0];
  return `${span}${year ? ` ${year[1]}` : ''}`;
}

function generatedStamp(doc: ParsedWorkplan): string {
  const bits = [doc.subject, doc.level ? `Year ${doc.level}` : null, doc.session].filter(Boolean);
  return `${bits.join(' · ')} · generated ${new Date().toLocaleDateString()}`;
}

/* -------------------------------------------------------------- exports -- */

/** Renders one parsed work plan and returns the jsPDF document. */
export function renderWorkplanPdf(doc: ParsedWorkplan, options: RenderWorkplanOptions = {}): jsPDF {
  return renderDocs([doc], options);
}

/** Renders several parsed work plans into a single PDF (one per document). */
export function renderWorkplansPdf(docs: ParsedWorkplan[], options: RenderWorkplanOptions = {}): jsPDF {
  return renderDocs(docs, options);
}

/** The rendered PDF as a Blob (browser). */
export function workplanPdfBlob(doc: ParsedWorkplan | ParsedWorkplan[], options: RenderWorkplanOptions = {}): Blob {
  return renderDocs(Array.isArray(doc) ? doc : [doc], options).output('blob');
}

/** The rendered PDF as an object URL — feed it to an <iframe> for a preview. */
export function workplanPdfUrl(doc: ParsedWorkplan | ParsedWorkplan[], options: RenderWorkplanOptions = {}): string {
  return URL.createObjectURL(workplanPdfBlob(doc, options));
}

/**
 * File name for a generated work plan, e.g.
 * "ENG-Year6-Semester1-workplan.pdf" (falls back to the subject / "workplan").
 */
export function workplanPdfFileName(doc: ParsedWorkplan): string {
  const parts = [
    doc.subjectCode || doc.subject || 'workplan',
    doc.level ? `Year${doc.level}` : null,
    doc.semester ? `Semester${doc.semester}` : null,
  ].filter(Boolean) as string[];
  const base = parts.join('-').replace(/[^A-Za-z0-9-]+/g, '');
  return `${base || 'workplan'}-workplan.pdf`;
}

/** Triggers a browser download of the rendered PDF. */
export function downloadWorkplanPdf(
  doc: ParsedWorkplan | ParsedWorkplan[],
  options: RenderWorkplanOptions = {},
  fileName?: string,
): void {
  const list = Array.isArray(doc) ? doc : [doc];
  const name = fileName ?? (list.length === 1 ? workplanPdfFileName(list[0]) : 'workplans.pdf');
  renderDocs(list, options).save(name);
}
