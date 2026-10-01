import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function run() {
  const filePath = 'C:/Users/PC/Downloads/LIS -YEAR 12- SEMESTER 1 WORKPLAN - 26\'27.pdf';
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  console.log('Pages:', doc.numPages);

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    console.log('=== PAGE ' + p + ' ===');
    const items = content.items
      .map(it => ({
        str: it.str,
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
        w: Math.round(it.width || 0),
        h: Math.round(it.height || 0)
      }))
      .filter(it => it.str.trim());

    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // Group items by line
    let curY = null;
    let curLine = [];
    for (const it of items) {
      if (curY === null || Math.abs(it.y - curY) > 3.5) {
        if (curLine.length > 0) {
          curLine.sort((a, b) => a.x - b.x);
          console.log(`P${p} y=${curY.toString().padStart(3)}: ` + curLine.map(ci => `[x=${ci.x}] ${ci.str}`).join(' '));
        }
        curLine = [it];
        curY = it.y;
      } else {
        curLine.push(it);
      }
    }
    if (curLine.length > 0) {
      curLine.sort((a, b) => a.x - b.x);
      console.log(`P${p} y=${curY.toString().padStart(3)}: ` + curLine.map(ci => `[x=${ci.x}] ${ci.str}`).join(' '));
    }
  }
}

run().catch(console.error);
