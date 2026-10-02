/**
 * Text helpers shared by the parser.
 */

export const MONTH_NAMES = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

const MONTH_ALIASES: Record<string, string> = {
  JAN: 'January',
  FEB: 'February',
  MAR: 'March',
  APR: 'April',
  JUN: 'June',
  JUL: 'July',
  AUG: 'August',
  SEP: 'September',
  SEPT: 'September',
  OCT: 'October',
  NOV: 'November',
  DEC: 'December',
};

export function canonicalMonth(token: string): string | null {
  const t = token.trim().toUpperCase();
  if (!t) return null;
  for (const m of MONTH_NAMES) if (m === t || m.startsWith(t) || t.startsWith(m.slice(0, 3))) {
    if (m.startsWith(t.slice(0, 3)) && t.length >= 3) {
      return m.charAt(0) + m.slice(1).toLowerCase();
    }
  }
  const alias = MONTH_ALIASES[t];
  if (alias) return alias;
  if (MONTH_NAMES.includes(t)) return t.charAt(0) + t.slice(1).toLowerCase();
  return null;
}

const MONTH_SCAN =
  /\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC)\b/i;

/** "SEPTEMBER 2026" / "AUGUST" → "September 2026" / "August" */
export function monthFromText(text: string): string | null {
  const m = text.match(MONTH_SCAN);
  if (!m) return null;
  const name = canonicalMonth(m[1]);
  if (!name) return null;
  const year = text.match(/\b(20\d{2})\b/);
  return year ? `${name} ${year[1]}` : name;
}

/** Collapse whitespace and remove zero-width characters. */
export function tidy(text: string): string {
  return text
    .replace(/[\u200b\u200c\u200d\u00a0\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Removes leading bullet glyphs (Word/Wingdings arrows, squares, dots). */
export function stripBullet(text: string): string {
  return tidy(text.replace(/^[\s\u2022\u25aa\u25cf\u25a0\u27a2\u27a4\u25b8\u25ba\u00b7\u2023\u2043\-–—•▪➢➤►›»*]+/, ''));
}

/** "END OF UNIT 4TEST – T4." → "END OF UNIT 4 TEST – T4." (source typo repair) */
export function repairMissingSpaces(text: string): string {
  return tidy(
    text
      .replace(/(\d)(TEST|T\d|SEMESTER|ASSESSMENT)/g, '$1 $2')
      .replace(/([a-z])([A-Z]{4,})/g, (m, a: string, b: string) =>
        /^(TEST|UNIT|END|SEMESTER|ASSESSMENT)$/.test(b) ? `${a} ${b}` : m,
      ),
  );
}

export interface ParsedCode {
  code: string;
  strandCode: string | null;
  rest: string;
  scrambled?: boolean;
}

const CODE_AT_START = [
  // 6Sc.01 / 9CS.02 / 12Ph.04 / 6Wor.01
  /^([0-9]{1,2}[A-Za-z]{2,5})[.,:\u2013\-\s]*([0-9]{1,2})(?![0-9])\.?\s*/,
  // single letter strands: 9P.02 / 8M.10 (uppercase only, so "9p" in prose is safe)
  /^([0-9]{1,2}[A-Z])[.,:\u2013\-\s]*([0-9]{1,2})(?![0-9])\.?\s*/,
  // 1.1. / 2.3 / 12.4
  /^([0-9]{1,2}\.[0-9]{1,2})\.?\s*(?=\S)/,
  // a standalone code with the number before the letters is rare, but seen in
  // hand edited workplans: e.g. "Sc6.01"
  /^([A-Za-z]{2,5}[0-9]{1,2})[.,:\s]*([0-9]{1,2})\.?\s*/,
];

/**
 * Splits a leading curriculum code ("6Sc.01 Give detailed information…") into
 * its parts. Returns null when the line does not start with a code — so a normal
 * sentence is never mistaken for an objective.
 */
export function splitLeadingCode(rawLine: string): ParsedCode | null {
  const line = stripBullet(rawLine);
  for (const re of CODE_AT_START) {
    const m = line.match(re);
    if (!m) continue;
    // never mistake an ordinal ("24TH – 28TH") for a strand — ordinals are
    // printed in upper case, so this must stay case sensitive ("6Rd.02" is a
    // real English strand code!)
    if (/^[0-9]{1,2}(ST|ND|RD|TH)$/.test(m[1])) continue;
    if (m.length >= 3 && m[2] != null) {
      const code = `${m[1]}.${m[2]}`;
      const strand = m[1].replace(/[0-9]/g, '') || null;
      return { code, strandCode: strand, rest: dropLeadingPunctuation(line.slice(m[0].length)) };
    }
    return { code: m[1], strandCode: strandOf(m[1]), rest: dropLeadingPunctuation(line.slice(m[0].length)) };
  }
  // scrambled code (interleaved with a page header): recover "6Ld.03" shape
  const loose = line.match(/([0-9])[.\s]*([A-Za-z]{1,4})[.\s]*([0-9])[.\s]*([0-9])?/);
  if (loose && /^[A-Za-z0-9.\s,'"-]{0,40}$/.test(line.slice(0, 40)) && !/[a-z]{4,}/.test(line.slice(0, 14))) {
    const cand = `${loose[1]}${loose[2]}.${(loose[3] || '') + (loose[4] || '')}`;
    const rest = tidy(line.replace(loose[0], '').replace(/^[.,:\s]+/, ''));
    return { code: cand, strandCode: strandOf(cand), rest, scrambled: true };
  }
  return null;
}

export function strandOf(code: string): string | null {
  const m = code.match(/^[0-9]{1,2}([A-Za-z]{1,5})/);
  if (!m) return null;
  if (/^(ST|ND|RD|TH)$/.test(m[1])) return null;
  return m[1];
}

/** "9CS.01: Identify …" → "Identify …" (a code is often followed by ":") */
function dropLeadingPunctuation(text: string): string {
  return tidy(text.replace(/^[.,:;\u2013\u2014-]\s*/, ''));
}

/** normalised comparison key for codes: ignores case and 0/O confusion */
export function codeKey(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9.]/g, '')
    .replace(/O/g, '0');
}

/**
 * Attempts to undo a page header that was drawn *on top of* a line of text.
 * Word sometimes merges the glyphs of the two texts in the extracted layer
 * (e.g. "S6LEd.0M3 DEedSTucE…" = "6Ld.03 Deduce…" interleaved with
 * "SEMESTER WORK PLAN"). Greedy case sensitive de-interleave against the known
 * header string; only accepted when the result looks like a better line.
 */
export function tryDeinterleave(text: string, header: string): string | null {
  if (!header) return null;
  const src = text;
  const head = header.toUpperCase();
  let h = 0;
  let content = '';
  for (const ch of src) {
    if (h < head.length && ch.toUpperCase() === head[h]) {
      h++;
    } else {
      content += ch;
    }
  }
  if (h < head.length * 0.9) return null;
  const cleaned = tidy(content);
  if (cleaned.length < 8) return null;
  // accept only if the repaired line is "better": starts with a code or has
  // far fewer single letter runs than the raw line
  const ratioRaw = countShortRuns(text);
  const ratioNew = countShortRuns(cleaned);
  const better = ratioNew < ratioRaw - 1 || !!splitLeadingCode(cleaned);
  return better ? cleaned : null;
}

function countShortRuns(text: string): number {
  return (text.match(/\b[A-Za-z]{1,2}\b/g) || []).length;
}
