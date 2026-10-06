import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function run() {
  const filePath = "C:/Users/PC/Downloads/LIS_Semester_1_Workplan_Computing_Year_9_2026-2027 (3).pdf";
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  console.log(`Document loaded: ${doc.numPages} pages`);

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const textContent = await page.getTextContent();
    console.log(`\n=== PAGE ${p} ===`);
    const items = textContent.items.map(it => ({
      str: it.str,
      x: Math.round(it.transform[4]),
      y: Math.round(it.transform[5])
    })).filter(it => it.str.trim().length > 0);

    // Sort top to bottom, left to right
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // Group into visual lines
    let curY = null;
    let line = [];
    for (const it of items) {
      if (curY === null || Math.abs(it.y - curY) > 3) {
        if (line.length > 0) {
          console.log(`y=${curY}: ${line.map(i => `[x=${i.x}] ${i.str}`).join(' ')}`);
        }
        line = [it];
        curY = it.y;
      } else {
        line.push(it);
      }
    }
    if (line.length > 0) {
      console.log(`y=${curY}: ${line.map(i => `[x=${i.x}] ${i.str}`).join(' ')}`);
    }
  }
}

run().catch(console.error);
