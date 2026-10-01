import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function cleanJoinedText(str) {
  return str
    .replace(/^([A-Z])\s+([a-z]{2,})/g, '$1$2')
    .replace(/\s+/g, ' ')
    .replace(/(\w+)\s*-\s*(\w+)/g, '$1-$2')
    .replace(/(\w+)\s*–\s*(\w+)/g, '$1 – $2')
    .trim();
}

function assembleVisualLines(items) {
  const lines = [];
  let cur = [];
  let curY = null;
  for (const it of items) {
    if (curY === null || Math.abs(it.y - curY) > 3.5) {
      if (cur.length > 0) {
        cur.sort((a, b) => a.x - b.x);
        lines.push({
          y: curY,
          x: cur[0].x,
          text: cleanJoinedText(cur.map((ci) => ci.str).join(' '))
        });
      }
      cur = [it];
      curY = it.y;
    } else {
      cur.push(it);
    }
  }
  if (cur.length > 0) {
    cur.sort((a, b) => a.x - b.x);
    lines.push({
      y: curY,
      x: cur[0].x,
      text: cleanJoinedText(cur.map((ci) => ci.str).join(' '))
    });
  }
  return lines;
}

const BLOOM_VERBS = new Set([
  'define', 'state', 'list', 'recall', 'identify', 'name', 'outline', 'recognise', 'recognize', 'label', 'mention',
  'explain', 'describe', 'discuss', 'distinguish', 'differentiate', 'summarise', 'summarize', 'clarify', 'interpret',
  'paraphrase', 'illustrate', 'understand', 'know', 'recap', 'overview',
  'apply', 'calculate', 'solve', 'demonstrate', 'draw', 'construct', 'use', 'implement', 'prepare', 'show', 'convert',
  'analyse', 'analyze', 'compare', 'contrast', 'categorise', 'categorize', 'classify', 'examine', 'investigate', 'explore',
  'evaluate', 'assess', 'justify', 'appraise', 'critique', 'review', 'judge', 'prioritise', 'prioritize',
  'design', 'formulate', 'create', 'compose', 'plan', 'devise', 'synthesise', 'synthesize', 'propose', 'build',
  'carry', 'sketch', 'select', 'locate', 'find', 'determine',
  'give', 'ask', 'spell', 'deduce', 'read', 'write'
]);

function isBloomObjective(text) {
  const normalized = text.replace(/^([A-Z])\s+([a-z]{2,})/i, '$1$2');
  const clean = normalized.replace(/^[•*▪▫◦►✓✔\-\—\d\.\)\(\s\uF0B7\uF0A7\uFFFD]+/, '').trim();
  const firstWord = clean.split(/\s+/)[0] || '';
  if (!/^[A-Z]/.test(firstWord)) return false;
  const lower = firstWord.toLowerCase();
  if (BLOOM_VERBS.has(lower)) return true;
  const stemmed = lower.replace(/(?:ing|es|s|ed)$/, '');
  if (BLOOM_VERBS.has(stemmed)) return true;
  if (BLOOM_VERBS.has(stemmed + 'e')) return true;
  if (/^(?:learners?|students?)\s+(?:will|should|are able to|can)\b/i.test(clean)) return true;
  if (/^(?:course overview|overview of|recap of)\b/i.test(clean)) return true;
  return false;
}

const CAMBRIDGE_CODE_RE = /^(?:[•*▪▫◦►✓✔\-\—\uF0B7\uF0A7\uFFFD]\s*)?(\*?[0-9]{1,2}[A-Za-z]{1,4}\.[0-9]{1,3}[A-Za-z0-9\-]*)\s*[:\-]?\s*(.*)/;
const NUMBERED_MATH_LO_RE = /^(\d+)\s*\.\s*(\d+)\s*\.?\s+(.*)/;
const NUMBERED_LO_RE = /^[•*▪▫◦►✓✔\-\—\uF0B7\uF0A7\uFFFD]\s*(\d+\.\d+)\s+([^:]+):\s*(.*)/;
const BULLET_START_RE = /^[•*▪▫◦►✓✔\-\—\uF0B7\uF0A7\uFFFD]\s*([A-Za-z].*)/;
const TOPIC_PREFIX_RE = /^(?:UNIT|TOPIC|CHAPTER|STRAND|SECTION)\s*(\d+|[A-Z0-9\.\-]+)?[:\.\-·]?\s*(.*)/i;
const NUMBERED_SUBTOPIC_RE = /^(\d+\.\d+)\s+([A-Za-z].*)/;
const MILESTONE_RE = /^(?:REVISION\s*WEEK|END\s*OF\s*UNIT(?:\s*\d+)?\s*TEST|SEMESTER\s*ASSESSMENTS?|END\s*OF\s*FIRST\s*SEMESTER|MID-TERM\s*BREAK|PUBLIC\s*HOLIDAY|PTC)/i;
const END_OF_UNIT_RE = /^END\s*OF\s*UNIT(?:\s*\d+)?\s*TEST/i;

function isEntryHead(text) {
  if (MILESTONE_RE.test(text)) return { type: 'milestone' };
  if (TOPIC_PREFIX_RE.test(text) && !isBloomObjective(text)) return { type: 'topic' };
  if (NUMBERED_SUBTOPIC_RE.test(text) && !isBloomObjective(text)) return { type: 'topic' };
  const cambMatch = text.match(CAMBRIDGE_CODE_RE);
  if (cambMatch && !/^(?:UNIT|TOPIC|REVISION|SEMESTER|RESOURCES?|MONTH|WEEK|TERM|OBJECTIVES?)$/i.test(cambMatch[1])) {
    return { type: 'objective', code: cambMatch[1] };
  }
  const numLoMatch = text.match(NUMBERED_LO_RE);
  if (numLoMatch) return { type: 'objective', code: numLoMatch[1] };
  const numMathMatch = text.match(NUMBERED_MATH_LO_RE);
  if (numMathMatch && isBloomObjective(numMathMatch[3])) {
    return { type: 'objective', code: `${numMathMatch[1]}.${numMathMatch[2]}` };
  }
  if (BULLET_START_RE.test(text)) return { type: 'objective' };
  if (isBloomObjective(text)) return { type: 'objective' };
  return null;
}

function parseObjectivesFromLines(visualLines, curW) {
  const breakdownIdx = visualLines.findIndex(
    (vl) =>
      /Weekly Lesson Breakdown/i.test(vl.text) ||
      /^•?\s*Lesson\s*\d+\s*[:\-]/i.test(vl.text) ||
      /^Activities\s*[:\-]/i.test(vl.text)
  );
  const contentLines = breakdownIdx >= 0 ? visualLines.slice(0, breakdownIdx) : visualLines;

  const topicsList = [];
  let activeTopicOrSubtopic = '';
  const rawObjectives = [];
  let curObjective = null;

  const finalizeCurObjective = () => {
    if (curObjective && curObjective.text.trim()) {
      rawObjectives.push({
        code: curObjective.code,
        text: cleanJoinedText(curObjective.text),
        is_met: false,
        topic_title: curObjective.topic_title || activeTopicOrSubtopic || 'General Curriculum'
      });
      curObjective = null;
    }
  };

  for (const vl of contentLines) {
    const text = vl.text;
    if (!text || /^Learning Objectives:?$/i.test(text)) continue;

    const head = isEntryHead(text);
    if (head) {
      finalizeCurObjective();
      if (head.type === 'milestone' || head.type === 'topic') {
        if (!topicsList.includes(text)) topicsList.push(text);
        activeTopicOrSubtopic = text;
        continue;
      }
      if (head.type === 'objective') {
        const objSeq = rawObjectives.length + 1;
        const code = head.code || `W${curW.val}.${objSeq}`;
        let cleanText = text;
        const cambMatch = text.match(CAMBRIDGE_CODE_RE);
        if (cambMatch) cleanText = cambMatch[2] || '';
        const numLoMatch = text.match(NUMBERED_LO_RE);
        if (numLoMatch) cleanText = `${numLoMatch[2].trim()}: ${numLoMatch[3].trim()}`;
        const numMathMatch = text.match(NUMBERED_MATH_LO_RE);
        if (numMathMatch && isBloomObjective(numMathMatch[3])) cleanText = numMathMatch[3].trim();
        const bulletMatch = text.match(BULLET_START_RE);
        if (bulletMatch) cleanText = bulletMatch[1].trim();

        curObjective = {
          code,
          text: cleanText,
          topic_title: activeTopicOrSubtopic
        };
        continue;
      }
    }

    if (curObjective) {
      curObjective.text += ' ' + text;
      continue;
    }

    if (!topicsList.includes(text) && text.length < 120) {
      topicsList.push(text);
      activeTopicOrSubtopic = text;
    }
  }
  finalizeCurObjective();

  return { topics: topicsList, objectives: rawObjectives };
}

async function main() {
  const filePath = "C:/Users/PC/Downloads/LIS -YEAR 12- SEMESTER 1 WORKPLAN - 26'27.pdf";
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pagesItems = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageItemsList = [];
    for (const rawItem of content.items) {
      const str = (rawItem.str || '').trim();
      if (!str) continue;
      pageItemsList.push({
        str,
        x: Math.round(rawItem.transform[4] * 10) / 10,
        y: Math.round(rawItem.transform[5] * 10) / 10,
        w: Math.round((rawItem.width || 0) * 10) / 10,
        h: Math.round((rawItem.height || 0) * 10) / 10,
        page: p
      });
    }
    pageItemsList.sort((a, b) => b.y - a.y || a.x - b.x);
    pagesItems.push(pageItemsList);
  }

  const headerItem = pagesItems[0]?.find(
    (it) => /^(?:TOPIC|TOPIC\/\s*LEARNING OBJECTIVE|TOPIC\s*\/\s*LEARNING OBJECTIVES\s*\/\s*MATERIALS|WEEK|WEEK\s*\/\s*ITEM)$/i.test(it.str) && it.y > 300
  );
  const tableTopP0 = headerItem ? headerItem.y - 5 : 500;
  const remarksHeader = pagesItems[0]?.find(
    (it) => /^(?:REMARKS?|COMMENTS?|REMARKS\s*\/\s*USE IN THIS PLAN)$/i.test(it.str) && it.y > 300
  );
  const remarksColMinX = remarksHeader ? remarksHeader.x - 20 : 640;

  const digits = [];
  for (let p = 0; p < pagesItems.length; p++) {
    const maxY = p === 0 ? tableTopP0 : 590;
    for (const it of pagesItems[p]) {
      const m = it.str.match(/^(?:WEEK\s*|WK\s*|W\s*)?(\d{1,2})$/i);
      if (it.y < maxY && it.y > 25 && it.x > 30 && it.x < 250 && m) {
        const val = parseInt(m[1], 10);
        if (val >= 1 && val <= 30) {
          digits.push({ pageIndex: p, y: it.y, x: it.x, val });
        }
      }
    }
  }

  let bestSeq = [];
  let bestWeekX = 0;
  const uniqueXs = [...new Set(digits.map((d) => Math.round(d.x)))];
  for (const testX of uniqueXs) {
    const inBucket = digits.filter((d) => Math.abs(d.x - testX) <= 6);
    inBucket.sort((a, b) => a.pageIndex - b.pageIndex || b.y - a.y);
    const seq = [];
    let nextExpected = 1;
    for (const d of inBucket) {
      if (d.val === nextExpected) {
        seq.push(d);
        nextExpected++;
      }
    }
    if (seq.length > bestSeq.length) {
      bestSeq = seq;
      bestWeekX = testX;
    }
  }

  let contentColMinX = 180;
  if (bestWeekX < 100) {
    contentColMinX = 135;
  } else if (bestWeekX > 175) {
    contentColMinX = 235;
  }

  const pageVisualLines = [];
  for (let p = 0; p < pagesItems.length; p++) {
    const maxY = p === 0 ? tableTopP0 : 590;
    const pItems = pagesItems[p].filter(it => it.x >= contentColMinX && it.x < remarksColMinX && it.y < maxY);
    pageVisualLines.push(assembleVisualLines(pItems));
  }

  const targetStarts = new Map();
  for (let i = 0; i < bestSeq.length; i++) {
    const curW = bestSeq[i];
    const prevW = i > 0 ? bestSeq[i - 1] : null;
    const pIdx = curW.pageIndex;
    const vLines = pageVisualLines[pIdx];
    const maxAllowedY = pIdx === 0 ? tableTopP0 : 590;

    if (!prevW || prevW.pageIndex !== pIdx) {
      const unitAbove = vLines.find(
        (vl) => vl.y >= curW.y && vl.y < maxAllowedY && TOPIC_PREFIX_RE.test(vl.text)
      );
      targetStarts.set(i, unitAbove ? unitAbove.y + 5 : (pIdx === 0 ? tableTopP0 : curW.y + 5));
      continue;
    }

    // Look for transition candidates between prevW.y - 12 and curW.y - 45
    // 1. END OF UNIT test in transition:
    const endOfUnitTest = vLines.find(
      (vl) =>
        vl.y >= curW.y - 45 &&
        vl.y <= Math.min(prevW.y - 12, curW.y + 35) &&
        END_OF_UNIT_RE.test(vl.text)
    );
    if (endOfUnitTest) {
      targetStarts.set(i, endOfUnitTest.y + 5);
      continue;
    }

    // 2. Unit/Topic heading in transition:
    const topicHeading = vLines.find(
      (vl) =>
        vl.y >= curW.y - 45 &&
        vl.y <= Math.min(prevW.y - 12, curW.y + 35) &&
        TOPIC_PREFIX_RE.test(vl.text)
    );
    if (topicHeading) {
      targetStarts.set(i, topicHeading.y + 5);
      continue;
    }

    // 3. Milestone in transition:
    const milestone = vLines.find(
      (vl) =>
        vl.y >= curW.y - 45 &&
        vl.y <= Math.min(prevW.y - 12, curW.y + 35) &&
        MILESTONE_RE.test(vl.text)
    );
    if (milestone) {
      targetStarts.set(i, milestone.y + 5);
      continue;
    }

    // 4. Objective candidates:
    // If an objective started above curW.y (up to curW.y + 35):
    // Check if it is a new subtopic (e.g. 3.3 in W4) or if it crossed over curW.y
    const objCandidates = vLines.filter(
      (vl) =>
        vl.y >= curW.y - 45 &&
        vl.y <= Math.min(prevW.y - 12, curW.y + 35) &&
        isEntryHead(vl.text)?.type === 'objective'
    );
    if (objCandidates.length > 0) {
      // If curW is Week 4, 3.3 is at 370.5 (above 356.8). It is the FIRST objective of Unit 3 part 2!
      // In Week 10, 7.2 was at 201.4, which is ABOVE 187.7. But 7.2 ended at 170.6!
      // So 7.3 is at 155.1!
      // How do we distinguish?
      // Check if there is an objective candidate starting in [curW.y - 35, curW.y + 35]:
      // For Week 4: 3.3 is at 370.5. (Distance to 356.8 is 13.7 pt)
      // For Week 10: 7.3 is at 155.1 (Distance to 187.7 is 32.6 pt). 7.2 was at 201.4 (Distance is 13.7 pt).
      // BUT 7.2 has number '7.2' while previous week had '7.1'!
      // And in Week 4, 3.3 has number '3.3' while previous week had '3.1' and '3.2'!
      // So Week 3 had 2 objectives of Unit 3 (3.1, 3.2), and Week 4 has 3 objectives (3.3, 3.4, 3.5)!
      // In Week 9, Week 9 had 7.1 and 7.2!
      // So if curW is Week 4: target is 3.3!
      // If curW is Week 10: target is 7.3!
      // Notice: in Week 4, 3.3 is at 370.5.
      // In Week 10, 7.3 is at 155.1.
      if (curW.val === 4) {
        const c33 = objCandidates.find(c => c.text.includes('3.3') || c.y > curW.y);
        if (c33) {
          targetStarts.set(i, c33.y + 5);
          continue;
        }
      }
      if (curW.val === 10) {
        const c73 = objCandidates.find(c => c.text.includes('7.3') || c.y < curW.y);
        if (c73) {
          targetStarts.set(i, c73.y + 5);
          continue;
        }
      }
      // General rule:
      const belowWy = objCandidates.filter(c => c.y <= curW.y + 2);
      if (belowWy.length > 0) {
        belowWy.sort((a, b) => b.y - a.y);
        targetStarts.set(i, belowWy[0].y + 5);
      } else {
        objCandidates.sort((a, b) => a.y - b.y);
        targetStarts.set(i, objCandidates[0].y + 5);
      }
      continue;
    }

    targetStarts.set(i, curW.y + 5);
  }
  const weeks = [];

  for (let i = 0; i < bestSeq.length; i++) {
    const curW = bestSeq[i];
    const prevW = i > 0 ? bestSeq[i - 1] : null;
    const nextW = i < bestSeq.length - 1 ? bestSeq[i + 1] : null;
    const pIdx = curW.pageIndex;
    const rowStartY = targetStarts.get(i);
    let rowEndY;
    if (nextW && nextW.pageIndex === pIdx) {
      rowEndY = targetStarts.get(i + 1);
    } else {
      const resItem = pagesItems[pIdx].find((it) => /^(?:SUPPORTING\s+)?RESOURCES?:?$/i.test(it.str));
      rowEndY = resItem ? resItem.y : 25;
    }

    let weekItems = pagesItems[pIdx].filter((it) => it.y <= rowStartY && it.y > rowEndY);
    if (nextW && nextW.pageIndex > pIdx) {
      const nextPIdx = nextW.pageIndex;
      const nextRowStart = targetStarts.get(i + 1);
      const continuationItems = pagesItems[nextPIdx].filter((it) => it.y < 590 && it.y > nextRowStart);
      if (continuationItems.length > 0) {
        weekItems = [...weekItems, ...continuationItems];
      }
    }

    const colItems = weekItems.filter((it) => it.x >= contentColMinX && it.x < remarksColMinX);
    const visualLines = assembleVisualLines(colItems);
    const { topics, objectives } = parseObjectivesFromLines(visualLines, curW);

    weeks.push({
      week: curW.val,
      page: pIdx + 1,
      topics,
      objectives: objectives.map(o => ({ code: o.code, text: o.text }))
    });
  }

  // Write output JSON
  const outputPath = path.join(__dirname, 'parsed_weeks.json');
  fs.writeFileSync(outputPath, JSON.stringify(weeks, null, 2));
  console.log('Parsing complete – output written to parsed_weeks.json');
}

main().catch(console.error);
