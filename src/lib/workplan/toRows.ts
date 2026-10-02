/**
 * Flat output helpers: one row per week, plus CSV / JSON export.
 * Handy for spreadsheets, grids and databases.
 */
import type { ParsedWorkplan, WorkplanRow } from './types';

const oneLine = (s: string | null | undefined) => (s ? s.replace(/\s*\n\s*/g, ' / ').trim() : '');

export function toFlatRows(source: ParsedWorkplan | ParsedWorkplan[]): WorkplanRow[] {
  if (Array.isArray(source)) return source.flatMap((d) => toFlatRows(d));
  const doc = source;
  const documentId = [
    doc.subjectCode || doc.subject || 'doc',
    doc.level ? `y${doc.level}` : null,
    doc.semester ? `s${doc.semester}` : null,
  ]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '');

  return doc.weeks.map((w) => {
    const codes = w.objectives.map((o) => o.code).filter((c): c is string => !!c);
    return {
      documentId,
      fileName: doc.fileName,
      level: doc.level,
      levelLabel: doc.levelLabel,
      subject: doc.subject,
      subjectCode: doc.subjectCode,
      teacher: doc.teacher,
      semester: doc.semester,
      session: doc.session,
      week: w.week,
      weekLabel: w.label,
      month: w.month,
      dates: w.dates,
      unit: w.unit,
      topic: w.topics.join(' | ') || null,
      objectiveCodes: codes.join(', '),
      objectives: w.objectives
        .map((o) => (o.code ? `${o.code} ${o.text}` : o.text))
        .join(' | '),
      lessons: w.lessons.map((l) => `${l.code ? `${l.code}: ` : ''}${l.text}`).join(' | '),
      assessments: w.assessments.join(' | '),
      remarks: oneLine(w.remarks),
      hasObjectives: w.objectives.length > 0,
      objectiveCount: w.objectives.length,
      pages: w.pages.join(', '),
    };
  });
}

const CSV_COLUMNS: Array<keyof WorkplanRow> = [
  'documentId',
  'fileName',
  'level',
  'levelLabel',
  'subject',
  'subjectCode',
  'teacher',
  'semester',
  'session',
  'week',
  'weekLabel',
  'month',
  'dates',
  'unit',
  'topic',
  'objectiveCodes',
  'objectives',
  'lessons',
  'assessments',
  'remarks',
  'hasObjectives',
  'objectiveCount',
  'pages',
];

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a header row (UTF-8, comma separated, newline safe). */
export function toCsv(docs: ParsedWorkplan | ParsedWorkplan[]): string {
  const list = Array.isArray(docs) ? docs : [docs];
  const rows = list.flatMap((d) => toFlatRows(d));
  const header = CSV_COLUMNS.join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => escapeCsv(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

/** Pretty JSON (structured output, includes remarks and warnings). */
export function toJson(docs: ParsedWorkplan | ParsedWorkplan[], pretty = true): string {
  return JSON.stringify(docs, null, pretty ? 2 : 0);
}

/** "ENG-Year6-Semester1-workplan.json" */
export function downloadFileName(doc: ParsedWorkplan, ext: 'json' | 'csv'): string {
  const parts = [
    doc.subjectCode || doc.subject || 'workplan',
    doc.level ? `Year${doc.level}` : null,
    doc.semester ? `Semester${doc.semester}` : null,
  ].filter(Boolean) as string[];
  const base = parts.join('-').replace(/[^A-Za-z0-9-]+/g, '');
  return `${base || 'workplan'}-parsed.${ext}`;
}

/**
 * Triggers a browser download of `text`. No-op outside the browser, so it is
 * safe to call from shared code.
 */
export function downloadText(
  fileName: string,
  text: string,
  mime = 'text/plain',
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return;
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
