/**
 * WorkplanUploader — drop-in uploader for LIS "Semester Work Plan" PDFs.
 *
 * Usage (see ../README.md for the pdf.js worker one-liner):
 *
 * ```tsx
 * import { WorkplanUploader } from './react';
 * import { pdfjsLib } from './pdf';
 *
 * <WorkplanUploader
 *   pdfjs={pdfjsLib}
 *   onParsed={(docs) => console.log(docs)}
 *   onRows={(rows) => setRows(rows)}
 *   multiple
 * />
 * ```
 *
 * Everything is parsed in the browser; nothing is uploaded. Styling is inline
 * (no CSS file to import) and the component renders no global side effects, so
 * it can be dropped into any layout. Override the look with `className` and
 * the `styles` prop when needed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import {
  downloadFileName,
  downloadText,
  toCsv,
  toFlatRows,
  type ParsedWorkplan,
  type PdfJsLike,
  type WorkplanRow,
} from '../lib/workplan';
import { downloadWorkplanPdf, workplanPdfUrl, type RenderWorkplanOptions } from '../lib/render';
import { useWorkplanParser } from './useWorkplanParser';

export interface WorkplanUploaderProps {
  /** Your configured pdf.js module — see the README snippet. */
  pdfjs: PdfJsLike;
  /** Called with the parsed documents (one per file). */
  onParsed?: (docs: ParsedWorkplan[]) => void;
  /** Called with the flat, spreadsheet friendly rows of every parsed file. */
  onRows?: (rows: WorkplanRow[]) => void;
  /** Allow several files at once (default true). */
  multiple?: boolean;
  /** `accept` attribute of the hidden file input. */
  accept?: string;
  /** Heading shown at the top of the card. Pass null to hide it. */
  title?: string | null;
  /** Sub line under the title. */
  hint?: string;
  /** Render the results table under the drop zone (default true). */
  showResults?: boolean;
  /** Show the per-file JSON/CSV download buttons (default true). */
  downloads?: boolean;
  /** Show a "work plan PDF" button per document (default true). */
  workplanPdf?: boolean;
  /** Open the generated PDF in an inline preview when it is created (default false). */
  autoPreviewPdf?: boolean;
  /** Options forwarded to the standard work plan PDF generator. */
  pdfOptions?: RenderWorkplanOptions;
  /** Extra content rendered under everything. */
  children?: ReactNode;
  className?: string;
  /** Per-element overrides, merged over the built-in inline styles. */
  styles?: {
    card?: CSSProperties;
    dropZone?: CSSProperties;
    title?: CSSProperties;
    hint?: CSSProperties;
    button?: CSSProperties;
    table?: CSSProperties;
  };
}

interface Attempt {
  name: string;
  error: string;
}

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function WorkplanUploader({
  pdfjs,
  onParsed,
  onRows,
  multiple = true,
  accept = 'application/pdf,.pdf',
  title = 'Semester work plans',
  hint = 'Drop the LIS work plan PDFs here, or click to choose files. Nothing leaves the browser.',
  showResults = true,
  downloads = true,
  workplanPdf = true,
  autoPreviewPdf = false,
  pdfOptions,
  children,
  className,
  styles,
}: WorkplanUploaderProps) {
  const { parseMany, docs, rows, busy, progress, errors, reset } = useWorkplanParser({ pdfjs });
  const [dragging, setDragging] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const attempts: Attempt[] = useMemo(
    () => errors.filter((e) => !!e.file).map((e) => ({ name: e.file as string, error: e.message })),
    [errors],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList ?? []).filter(
        (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name),
      );
      if (!files.length) return;
      const list = multiple ? files : files.slice(0, 1);
      const { docs: parsed } = await parseMany(list, list.map((f) => f.name));
      if (parsed.length) {
        onParsed?.(parsed);
        onRows?.(parsed.flatMap((d) => toFlatRows(d)));
        if (autoPreviewPdf) {
          const keyOf = (d: ParsedWorkplan) => d.fileName ?? `doc-${d.weeks.length}`;
          setPreviewUrls((prev) => {
            const next = { ...prev };
            for (const d of parsed) {
              const k = keyOf(d);
              if (!next[k]) next[k] = workplanPdfUrl(d, pdfOptions);
            }
            return next;
          });
        }
      }
    },
    [autoPreviewPdf, multiple, onParsed, onRows, parseMany, pdfOptions],
  );

  const togglePreview = useCallback(
    (doc: ParsedWorkplan, key: string) => {
      setPreviewUrls((prev) => {
        if (prev[key]) {
          URL.revokeObjectURL(prev[key]);
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: workplanPdfUrl(doc, pdfOptions) };
      });
    },
    [pdfOptions],
  );

  // release the object URLs when the component goes away
  useEffect(
    () => () => {
      setPreviewUrls((prev) => {
        for (const url of Object.values(prev)) URL.revokeObjectURL(url);
        return prev;
      });
    },
    [],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer?.files ?? null);
  };

  const totalObjectives = docs.reduce(
    (n, d) => n + d.weeks.reduce((m, w) => m + w.objectives.length, 0),
    0,
  );

  return (
    <div className={className} style={{ ...s.card, ...styles?.card }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        style={{
          ...s.dropZone,
          ...(dragging ? s.dropZoneActive : null),
          ...(busy ? { opacity: 0.75, cursor: 'progress' } : null),
          ...styles?.dropZone,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {title !== null && <div style={{ ...s.title, ...styles?.title }}>{title}</div>}
        <div style={{ ...s.hint, ...styles?.hint }}>
          {busy && progress
            ? `Reading ${progress.fileName ?? 'file'} — page ${progress.page}/${progress.pages}${
                progress.files > 1 ? ` (file ${progress.file}/${progress.files})` : ''
              }`
            : hint}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ ...s.button, ...styles?.button }}>Choose PDF{multiple ? 's' : ''}</span>
          {docs.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reset();
              }}
              style={s.linkButton}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {attempts.map((a) => (
        <div key={a.name} style={s.error}>
          <strong>{a.name}</strong>: {a.error}
        </div>
      ))}

      {showResults &&
        docs.map((doc) => {
          const key = doc.fileName ?? `doc-${doc.weeks.length}`;
          const expanded = openDoc === key;
          return (
            <div key={key} style={s.docCard}>
              <button type="button" onClick={() => setOpenDoc(expanded ? null : key)} style={s.docHead}>
                <span style={{ fontWeight: 600 }}>{doc.fileName ?? 'Untitled'}</span>
                <span style={s.pill}>
                  {doc.levelLabel ?? doc.level ?? '?'} · {doc.subject ?? '—'}
                  {doc.teacher ? ` · ${doc.teacher}` : ''}
                </span>
                <span style={s.pill}>
                  {doc.weeks.length} weeks · {doc.weeks.reduce((n, w) => n + w.objectives.length, 0)}{' '}
                  objectives
                </span>
                {doc.warnings.length > 0 && (
                  <span style={{ ...s.pill, background: '#fef3c7', color: '#92400e' }}>
                    {doc.warnings.length} warning{doc.warnings.length > 1 ? 's' : ''}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', color: '#64748b' }}>{expanded ? '▴' : '▾'}</span>
              </button>

              {expanded && (
                <div style={{ padding: '4px 12px 12px' }}>
                  <div style={{ ...s.tableScroll, ...styles?.table }}>
                    <table style={s.table}>
                      <thead>
                        <tr>
                          {['Wk', 'Dates', 'Month', 'Objectives', 'Remarks'].map((h) => (
                            <th key={h} style={s.th}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {doc.weeks.map((w, wi) => (
                          <tr key={`${key}-${wi}`}>
                            <td style={s.td}>{w.week ?? w.label}</td>
                            <td style={s.td}>{w.dates ?? ''}</td>
                            <td style={s.td}>{w.month ?? ''}</td>
                            <td style={s.td}>
                              {w.objectives.length
                                ? w.objectives.map((o, oi) => (
                                    <div key={`${oi}-${o.code ?? 'obj'}`} style={s.obj}>
                                      <code style={s.code}>{o.code ?? '—'}</code> {o.text}
                                    </div>
                                  ))
                                : ''}
                            </td>
                            <td style={{ ...s.td, whiteSpace: 'pre-wrap' }}>{w.remarks ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {doc.warnings.length > 0 && (
                    <ul style={s.warnList}>
                      {doc.warnings.map((w, wi) => (
                        <li key={`${wi}-${w.slice(0, 20)}`}>{w}</li>
                      ))}
                    </ul>
                  )}

                  {downloads && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      {workplanPdf && (
                        <button
                          type="button"
                          style={{ ...s.smallButton, ...s.primarySmall }}
                          onClick={() => downloadWorkplanPdf(doc, pdfOptions)}
                        >
                          Download work plan PDF
                        </button>
                      )}
                      {workplanPdf && (
                        <button type="button" style={s.smallButton} onClick={() => togglePreview(doc, key)}>
                          {previewUrls[key] ? 'Hide PDF preview' : 'Preview work plan PDF'}
                        </button>
                      )}
                      <button
                        type="button"
                        style={s.smallButton}
                        onClick={() =>
                          downloadText(downloadFileName(doc, 'json'), JSON.stringify(doc, null, 2), 'application/json')
                        }
                      >
                        Download JSON
                      </button>
                      <button
                        type="button"
                        style={s.smallButton}
                        onClick={() =>
                          downloadText(downloadFileName(doc, 'csv'), toCsv(doc), 'text/csv')
                        }
                      >
                        Download CSV
                      </button>
                    </div>
                  )}

                  {workplanPdf && previewUrls[key] && (
                    <iframe
                      title={`work plan PDF — ${doc.fileName ?? 'document'}`}
                      src={previewUrls[key]}
                      style={s.pdfFrame}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}

      {showResults && rows.length > 0 && (
        <div style={{ ...s.summary }}>
          {docs.length} document{docs.length > 1 ? 's' : ''} parsed · {rows.length} week rows ·{' '}
          {totalObjectives} objectives
        </div>
      )}

      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ styles -- */

const s: Record<string, CSSProperties> = {
  card: { fontFamily: SANS, width: '100%', color: '#0f172a' },
  dropZone: {
    border: '2px dashed #cbd5e1',
    borderRadius: 12,
    background: '#f8fafc',
    padding: '22px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    cursor: 'pointer',
    transition: 'border-color .15s, background .15s',
  },
  dropZoneActive: { borderColor: '#2563eb', background: '#eff6ff' },
  title: { fontSize: 15, fontWeight: 600 },
  hint: { fontSize: 13, color: '#475569', lineHeight: 1.45 },
  button: {
    display: 'inline-block',
    background: '#2563eb',
    color: '#fff',
    borderRadius: 8,
    padding: '7px 12px',
    fontSize: 13,
    fontWeight: 600,
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: 13,
    cursor: 'pointer',
    padding: 4,
  },
  primarySmall: {
    background: '#0f172a',
    borderColor: '#0f172a',
    color: '#fff',
    fontWeight: 600,
  },
  pdfFrame: {
    width: '100%',
    height: 460,
    marginTop: 10,
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    background: '#fff',
  },
  smallButton: {
    background: '#fff',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    padding: '6px 10px',
    fontSize: 12.5,
    cursor: 'pointer',
    color: '#0f172a',
  },
  error: {
    marginTop: 10,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    borderRadius: 8,
    padding: '9px 11px',
    fontSize: 13,
  },
  docCard: {
    marginTop: 12,
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    background: '#fff',
    overflow: 'hidden',
  },
  docHead: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    width: '100%',
    textAlign: 'left',
    background: '#f8fafc',
    border: 'none',
    borderBottom: '1px solid #e2e8f0',
    padding: '10px 12px',
    cursor: 'pointer',
    fontSize: 13,
    color: '#0f172a',
  },
  pill: {
    background: '#e2e8f0',
    borderRadius: 999,
    padding: '2px 9px',
    fontSize: 11.5,
    color: '#334155',
    whiteSpace: 'nowrap',
  },
  tableScroll: { overflowX: 'auto', marginTop: 8 },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 12.5 },
  th: {
    textAlign: 'left',
    borderBottom: '1px solid #e2e8f0',
    padding: '6px 8px',
    color: '#64748b',
    fontWeight: 600,
    fontSize: 11.5,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  td: { borderBottom: '1px solid #f1f5f9', padding: '6px 8px', verticalAlign: 'top' },
  obj: { marginBottom: 3, lineHeight: 1.4 },
  code: { fontFamily: MONO, fontSize: 11.5, color: '#1d4ed8' },
  warnList: { margin: '10px 0 0', paddingLeft: 18, color: '#92400e', fontSize: 12.5, lineHeight: 1.5 },
  summary: { marginTop: 10, fontSize: 12.5, color: '#475569' },
};

export default WorkplanUploader;
