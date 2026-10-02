/**
 * useWorkplanParser — the parser as a React hook.
 *
 * Everything runs in the browser: no server, no upload. Pass your app's own
 * pdf.js instance so the worker is configured exactly once, e.g.
 *
 * ```ts
 * // pdf.ts
 * import * as pdfjsLib from 'pdfjs-dist';
 * import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
 * pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
 * export { pdfjsLib };
 * ```
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  parseWorkplanPdf,
  toFlatRows,
  type ParsedWorkplan,
  type PdfJsLike,
  type WorkplanRow,
  type WorkplanSource,
} from '../lib/workplan';

export interface UseWorkplanParserOptions {
  /** Your configured pdf.js module (see the note above). */
  pdfjs: PdfJsLike;
  /** Include the table geometry in each result (useful while debugging a layout). */
  debug?: boolean;
}

export interface ParseProgress {
  /** 1-based index of the file being parsed. */
  file: number;
  files: number;
  fileName: string | null;
  page: number;
  pages: number;
}

export interface ParseError {
  message: string;
  file?: string;
}

export interface UseWorkplanParser {
  /** Parse one PDF. Resolves with the structured document (or null on failure). */
  parse: (source: WorkplanSource, fileName?: string) => Promise<ParsedWorkplan | null>;
  /** Parse many PDFs in sequence (keeps memory flat for long batches). */
  parseMany: (
    sources: WorkplanSource[],
    fileNames?: Array<string | null>,
  ) => Promise<{ docs: ParsedWorkplan[]; errors: ParseError[] }>;
  /** Every document parsed so far, in order. */
  docs: ParsedWorkplan[];
  /** Flat, spreadsheet friendly rows for every document parsed so far. */
  rows: WorkplanRow[];
  busy: boolean;
  progress: ParseProgress | null;
  errors: ParseError[];
  reset: () => void;
}

export function useWorkplanParser({ pdfjs, debug }: UseWorkplanParserOptions): UseWorkplanParser {
  const [docs, setDocs] = useState<ParsedWorkplan[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [errors, setErrors] = useState<ParseError[]>([]);
  const runId = useRef(0);

  const parseMany = useCallback(
    async (sources: WorkplanSource[], fileNames?: Array<string | null>) => {
      const id = ++runId.current;
      setBusy(true);
      setErrors([]);
      const out: ParsedWorkplan[] = [];
      const failures: ParseError[] = [];
      try {
        for (let i = 0; i < sources.length; i++) {
          const name = fileNames?.[i] ?? null;
          try {
            const doc = await parseWorkplanPdf(sources[i], {
              pdfjs,
              fileName: name ?? undefined,
              debug,
              onProgress: (page, pages) =>
                setProgress({ file: i + 1, files: sources.length, fileName: name, page, pages }),
            });
            out.push(doc);
          } catch (err) {
            failures.push({
              message: err instanceof Error ? err.message : String(err),
              file: name ?? undefined,
            });
          }
        }
        if (id === runId.current) {
          if (out.length) setDocs((prev) => [...prev, ...out]);
          if (failures.length) setErrors(failures);
        }
        return { docs: out, errors: failures };
      } finally {
        if (id === runId.current) {
          setBusy(false);
          setProgress(null);
        }
      }
    },
    [pdfjs, debug],
  );

  const parse = useCallback(
    async (source: WorkplanSource, fileName?: string): Promise<ParsedWorkplan | null> => {
      const result = await parseMany([source], [fileName ?? null]);
      return result.docs[0] ?? null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdfjs, debug],
  );

  const reset = useCallback(() => {
    runId.current++;
    setDocs([]);
    setErrors([]);
    setProgress(null);
    setBusy(false);
  }, []);

  const rows = useMemo(() => (docs.length ? toFlatRows(docs) : []), [docs]);

  return { parse, parseMany, docs, rows, busy, progress, errors, reset };
}
