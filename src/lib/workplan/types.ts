/**
 * Types produced by the workplan parser.
 *
 * The parser is layout-driven: it reads the PDF's text layer *and* its vector
 * table borders, rebuilds the table grid (rows / columns / cells) and only then
 * decides what belongs to which week. That is what prevents the usual
 * "everything ends up in the wrong week" failure mode of naive PDF parsers.
 */

/** A single learning objective / lesson / note line inside a week. */
export interface WorkplanContentItem {
  /** 'objective' = coded curriculum objective, 'lesson' = lesson breakdown,
   *  'assessment' = END OF UNIT/TEST line, 'heading' = section heading,
   *  'note' = anything else (kept verbatim so nothing is lost). */
  kind: 'objective' | 'lesson' | 'assessment' | 'heading' | 'note';
  /** Full curriculum code when present, e.g. "6Sc.01", "9CS.02", "1.4". */
  code: string | null;
  /** Code without the running number, e.g. "6Sc", "9CS" (a.k.a. strand). */
  strandCode: string | null;
  /** Human readable text with the code stripped and whitespace normalised. */
  text: string;
  /** Verbatim text as it appeared in the PDF (never cleaned away). */
  raw: string;
  /** Unit context (last "UNIT x: ..." heading seen before this line). */
  unit: string | null;
  /** 1-based page number the line was found on. */
  page: number;
}

export interface WorkplanWeek {
  /** Week number as printed (e.g. 1..17). null if the row had no week number. */
  week: number | null;
  /** Week label exactly as printed, e.g. "WEEK 1" or "1". */
  label: string;
  /** Date range printed under the week number, e.g. "24TH – 28TH" / "24–28 Aug 2026". */
  dates: string | null;
  /** Month the row sits in (from the MONTHS column / month banner / date text). */
  month: string | null;
  /**
   * True when no month label could be read for this week (some Word exports
   * rasterise the rotated month labels into images) and the month was
   * reconstructed from the week date sequence instead.
   */
  monthInferred?: boolean;
  /** Primary unit for the week (first/most frequent unit among its objectives). */
  unit: string | null;
  /** All unit headings that apply to this week. */
  units: string[];
  /** Topic line(s) shown for the week (e.g. "Unit 6.1 My world"). */
  topics: string[];
  /** Coded learning objectives. */
  objectives: WorkplanContentItem[];
  /** Weekly lesson breakdown ("Lesson 1: ...") when the template has one. */
  lessons: WorkplanContentItem[];
  /** Assessment lines (END OF UNIT 3 TEST – T3, SEMESTER ASSESSMENTS, ...). */
  assessments: string[];
  /** Comments / remarks column, verbatim (may be null when empty). */
  remarks: string | null;
  /** Same as remarks but with assessment lines removed (d4 keeps tests in the remarks column). */
  remarksNote: string | null;
  /** Objective codes referenced inside the remark cell, normalised (best effort). */
  remarkCodes: string[];
  /** Everything in the row, in reading order (lossless). */
  items: WorkplanContentItem[];
  /** 1-based page numbers this week spans. */
  pages: number[];
  /** Per-week diagnostics (e.g. "continuation of week 6 from a previous page"). */
  warnings: string[];
  /** Free-form: leftover text that could not be classified. */
  extraLines: string[];
}

export interface ParsedWorkplan {
  /** File name when the source was a File. */
  fileName: string | null;
  /** Document title, usually "SEMESTER WORK PLAN". */
  title: string | null;
  school: string | null;
  /** Class / level: "6", "9", "12" (null when not printed). */
  level: string | null;
  /** "Year 6" */
  levelLabel: string | null;
  subject: string | null;
  /** Document level subject code: "ENG", "MAT", "CMP" (derived, see resolveSubjectCode). */
  subjectCode: string | null;
  teacher: string | null;
  /** "1" / "2" (Semester number). */
  semester: string | null;
  semesterLabel: string | null;
  /** "2026/2027" */
  session: string | null;
  /** "AUGUST–DECEMBER 2026" when printed. */
  period: string | null;
  /** Distinct strand codes found in the document, e.g. ["6Sc","6Ug","6Wc"]. */
  strandCodes: string[];
  weeks: WorkplanWeek[];
  /** Resource / website lists printed after the table (kept as raw lines). */
  resources: string[];
  pageCount: number;
  /** Document level diagnostics. */
  warnings: string[];
  /** Present when options.debug is true. */
  debug?: WorkplanDebug;
}

/** One row of the flat, spreadsheet friendly output. */
export interface WorkplanRow {
  documentId: string;
  fileName: string | null;
  level: string | null;
  levelLabel: string | null;
  subject: string | null;
  subjectCode: string | null;
  teacher: string | null;
  semester: string | null;
  session: string | null;
  week: number | null;
  weekLabel: string;
  month: string | null;
  dates: string | null;
  unit: string | null;
  topic: string | null;
  /** "6Sc.01, 6Ug.04, ..." — every objective code for the week. */
  objectiveCodes: string;
  /** Objectives joined with " | " (each prefixed by its code). */
  objectives: string;
  lessons: string;
  assessments: string;
  remarks: string | null;
  /** True when at least one objective was found for the week. */
  hasObjectives: boolean;
  objectiveCount: number;
  pages: string;
}

export interface WorkplanDebug {
  pageGrids: Array<{
    page: number;
    rules: { horizontal: number[]; vertical: number[] };
    columns: Array<{ x0: number; x1: number; role: string | null }>;
    rows: Array<{ y0: number; y1: number; weekAnchor: number | null; month: string | null }>;
  }>;
}

/* ------------------------------------------------------------------ */
/* pdf.js structural typings (kept loose so the parser does not force  */
/* a specific pdfjs-dist version on the host app).                     */
/* ------------------------------------------------------------------ */

export interface PdfTextItem {
  str: string;
  dir?: string;
  width: number;
  height: number;
  transform: number[];
  fontName?: string;
  hasEOL?: boolean;
}

export interface PdfJsLike {
  getDocument: (params: Record<string, unknown>) => { promise: Promise<PdfDocumentLike> };
  GlobalWorkerOptions?: { workerSrc: string };
}

export interface PdfDocumentLike {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageLike>;
  destroy?: () => Promise<void>;
}

export interface PdfPageLike {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  getTextContent: (opts?: Record<string, unknown>) => Promise<{ items: PdfTextItem[] }>;
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  commonObjs?: { get: (id: string) => { name?: string } | undefined };
  cleanup?: () => void;
}
