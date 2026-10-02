/**
 * Visual style of the generated work plan PDFs.
 *
 * The palette and the table structure are taken from
 * "LIS -YEAR 12- SEMESTER 1 WORKPLAN - 26'27" (the reference export):
 *
 *   • blue brand band + school name + year/plan + subject + semester header rows
 *   • green column header row (MONTHS / WEEK / TOPIC · LEARNING OBJECTIVE / REMARKS)
 *   • light grey banding (#F1F2F1 / white) on alternate week rows
 *   • thin grey cell borders (0.5 pt)
 *   • bright green highlight behind each new UNIT heading
 *
 * Everything can be overridden per call (see RenderWorkplanOptions).
 */

export interface WorkplanPalette {
  /** thin cell borders */
  border: [number, number, number];
  /** brand band above the school name ("blue band" in the reference export) */
  brandBand: [number, number, number];
  /** header fills (school / plan / semester rows) */
  headerFill: [number, number, number];
  /** the column header row (MONTHS | WEEK | TOPIC… | REMARKS) */
  columnHeaderFill: [number, number, number];
  /** alternating body row fill (light) and its pair (white) */
  rowTint: [number, number, number];
  rowPlain: [number, number, number];
  /** highlight behind UNIT headings */
  unitHighlight: [number, number, number];
  text: [number, number, number];
  mutedText: [number, number, number];
}

export const REFERENCE_PALETTE: WorkplanPalette = {
  border: [191, 191, 191],
  brandBand: [0, 111, 192], // #006FC0
  headerFill: [241, 242, 241], // #F1F2F1
  columnHeaderFill: [0, 175, 80], // #00AF50
  rowTint: [241, 242, 241],
  rowPlain: [255, 255, 255],
  unitHighlight: [0, 255, 0], // #00FF00 (as used in the reference document)
  text: [0, 0, 0],
  mutedText: [120, 120, 120],
};

export interface WorkplanMetrics {
  pageWidth: number;
  pageHeight: number;
  marginX: number;
  /** column widths: month, week, topic, remarks */
  columns: [number, number, number, number];
  /** header block row heights */
  brandBandHeight: number;
  headerRowHeight: number;
  columnHeaderHeight: number;
  minRowHeight: number;
  /** fonts (pt) */
  fontTitle: number;
  fontHeader: number;
  fontColumnHeader: number;
  fontCell: number;
  fontMeta: number;
  fontFooter: number;
  /** text line height multiplier */
  lineHeight: number;
  /** logos */
  logoHeight: number;
  /** space between the logos row and the table */
  logoGap: number;
}

export const LETTER_LANDSCAPE: WorkplanMetrics = {
  pageWidth: 792,
  pageHeight: 612,
  marginX: 40,
  columns: [100, 90, 445, 77],
  brandBandHeight: 14,
  headerRowHeight: 17,
  columnHeaderHeight: 20,
  minRowHeight: 22,
  fontTitle: 17,
  fontHeader: 12.5,
  fontColumnHeader: 11,
  fontCell: 9.5,
  fontMeta: 9,
  fontFooter: 8,
  lineHeight: 1.3,
  logoHeight: 40,
  logoGap: 10,
};

export const A4_LANDSCAPE: WorkplanMetrics = {
  ...LETTER_LANDSCAPE,
  pageWidth: 842,
  pageHeight: 595,
  marginX: 42,
  columns: [108, 95, 478, 83],
};

/**
 * Base font. `WorkplanSans` is the embedded DejaVu Sans subset (see
 * fonts.ts) — it is the only way to print the maths, curly quotes and arrows
 * that occur in real work plans without garbling them. Set
 * `RenderWorkplanOptions.fontFamily` to 'helvetica' (or your own registered
 * face) to opt out.
 */
export const FONT_FAMILY = 'WorkplanSans';
