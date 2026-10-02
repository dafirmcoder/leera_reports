/**
 * Public API of the workplan parser.
 *
 * ```ts
 * import { parseWorkplanPdf } from './lib/workplan';
 * const doc = await parseWorkplanPdf(file);
 * console.log(doc.level, doc.subject, doc.weeks.length);
 * ```
 */
import { readPageGeometry } from './geometry';
import { readPageItems } from './textLines';
import { extractWorkplan, type PageInput } from './extract';
import type { ParsedWorkplan, PdfJsLike } from './types';

export * from './types';
export { extractWorkplan } from './extract';
export { resolveSubjectCode } from './extract';
export { toFlatRows, toCsv, toJson, downloadFileName, downloadText } from './toRows';
export { parseWorkPlanPdf, type WorkPlanParseProgress, type WorkPlanParseProgressCallback } from './adapter';

export interface ParseWorkplanOptions {
  /**
   * A configured pdf.js module. Pass your app's own instance to reuse the
   * worker setup: `parseWorkplanPdf(file, { pdfjs })`.
   * When omitted, `pdfjs-dist` is imported dynamically.
   */
  pdfjs?: PdfJsLike;
  /** File name to record in the result (defaults to File.name). */
  fileName?: string;
  /** Include table geometry (rows/columns/rules per page) in the result. */
  debug?: boolean;
  /** Called after each page, for progress bars. */
  onProgress?: (page: number, total: number) => void;
  /** Password for encrypted PDFs. */
  password?: string;
}

export type WorkplanSource = File | Blob | ArrayBuffer | Uint8Array;

let cachedPdfjs: PdfJsLike | null = null;

async function resolvePdfjs(opts?: ParseWorkplanOptions): Promise<PdfJsLike> {
  if (opts?.pdfjs) return opts.pdfjs;
  if (cachedPdfjs) return cachedPdfjs;
  const mod = (await import('pdfjs-dist')) as unknown as PdfJsLike;
  cachedPdfjs = mod;
  return mod;
}

async function toBytes(src: WorkplanSource): Promise<Uint8Array> {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof Blob !== 'undefined' && src instanceof Blob) return new Uint8Array(await src.arrayBuffer());
  throw new Error('Unsupported source: expected File, Blob, ArrayBuffer or Uint8Array');
}

/** Parses a single workplan PDF. */
export async function parseWorkplanPdf(
  source: WorkplanSource,
  options: ParseWorkplanOptions = {},
): Promise<ParsedWorkplan> {
  const pdfjs = await resolvePdfjs(options);
  const data = await toBytes(source);
  const fileName =
    options.fileName ?? (typeof File !== 'undefined' && source instanceof File ? source.name : null);

  const doc = await pdfjs.getDocument({
    data,
    password: options.password,
    // keep the parser tolerant: missing system fonts must never abort a parse
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages: PageInput[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const [items, geometry] = await Promise.all([readPageItems(page, p), readPageGeometry(page)]);
      pages.push({ page: p, items, geometry });
      page.cleanup?.();
      options.onProgress?.(p, doc.numPages);
    }
  } finally {
    await doc.destroy?.();
  }

  return extractWorkplan(pages, { fileName, debug: options.debug });
}

/** Parses several workplans, in sequence (keeps memory flat for big batches). */
export async function parseWorkplanPdfs(
  sources: WorkplanSource[],
  options: ParseWorkplanOptions = {},
): Promise<ParsedWorkplan[]> {
  const out: ParsedWorkplan[] = [];
  for (const src of sources) out.push(await parseWorkplanPdf(src, options));
  return out;
}
