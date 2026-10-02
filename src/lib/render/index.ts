/** Standard work plan PDF generator (reference look: LIS Year 12 export). */
export {
  renderWorkplanPdf,
  renderWorkplansPdf,
  workplanPdfBlob,
  workplanPdfUrl,
  downloadWorkplanPdf,
  workplanPdfFileName,
} from './renderPdf';
export type { RenderWorkplanOptions } from './renderPdf';
export { A4_LANDSCAPE, LETTER_LANDSCAPE, REFERENCE_PALETTE } from './style';
export type { WorkplanMetrics, WorkplanPalette } from './style';
export { SCHOOL_LOGO, CAMBRIDGE_LOGO } from './assets';
export { workPlanToParsedWorkplan } from './convert';
