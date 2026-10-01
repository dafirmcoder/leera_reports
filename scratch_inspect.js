import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function run() {
  const filePath = 'C:/Users/PC/Downloads/LIS -YEAR 12- SEMESTER 1 WORKPLAN - 26\'27.pdf';
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const ops = await page.getOperatorList();
    const hLines = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjsLib.OPS.constructPath) {
        const [pathOps, pathArgs] = ops.argsArray[i];
        let argIdx = 0;
        let curX = 0, curY = 0;
        for (let j = 0; j < pathOps.length; j++) {
          const op = pathOps[j];
          if (op === pdfjsLib.OPS.moveTo) {
            curX = pathArgs[argIdx++];
            curY = pathArgs[argIdx++];
          } else if (op === pdfjsLib.OPS.lineTo) {
            const nextX = pathArgs[argIdx++];
            const nextY = pathArgs[argIdx++];
            if (Math.abs(curY - nextY) < 1 && Math.abs(curX - nextX) > 100) {
              hLines.push({ y: Math.round(curY), x1: Math.min(curX, nextX), x2: Math.max(curX, nextX) });
            }
            curX = nextX;
            curY = nextY;
          }
        }
      }
    }
    const uniqueY = [...new Set(hLines.map(l => l.y))].sort((a,b) => b-a);
    console.log('Page ' + p + ' horizontal line Ys:', uniqueY);
  }
}
run();
