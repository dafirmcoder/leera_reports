# ------------------------------------------------------------
# 1️⃣  Paths – adjust only if your folder layout differs
# ------------------------------------------------------------
$projectRoot   = 'E:/REPORT_LAB/Leera-Reports'          # <-- your Vite app root
$srcWorkplan   = Join-Path $projectRoot 'src/lib/workplan'
$srcReact      = Join-Path $projectRoot 'src/react'
$downloadRoot  = 'C:/Users/PC/Downloads/workspace-01a0fd0a-52f8-7ab3-a305-eda5366fd175/workplan-parser/src'
$newWorkplan   = Join-Path $downloadRoot 'lib/workplan'
$newReact      = Join-Path $downloadRoot 'react'

# ------------------------------------------------------------
# 2️⃣  Clean existing parser (optional – safe‑guard)
# ------------------------------------------------------------
if (Test-Path $srcWorkplan) {
    Write-Host "Removing old parser folder…" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $srcWorkplan
}
if (Test-Path $srcReact) {
    Write-Host "Removing old React bindings (if any)…" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $srcReact
}

# ------------------------------------------------------------
# 3️⃣  Copy new parser & UI bindings
# ------------------------------------------------------------
Write-Host "Copying new parser files…" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $srcWorkplan | Out-Null
Copy-Item -Path "$newWorkplan\*" -Destination "$srcWorkplan\" -Recurse -Force

Write-Host "Copying new React UI bindings…" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $srcReact | Out-Null
Copy-Item -Path "$newReact\*" -Destination "$srcReact\" -Recurse -Force

# ------------------------------------------------------------
# 4️⃣  Install pdf.js runtime dependency (once per project)
# ------------------------------------------------------------
Write-Host "Installing pdfjs-dist…" -ForegroundColor Cyan
npm i pdfjs-dist

# ------------------------------------------------------------
# 5️⃣  Add PDF‑worker helper (creates src/pdf.ts if missing)
# ------------------------------------------------------------
$pdfHelper = @"
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjsLib };
"@

$pdfFile = Join-Path $projectRoot 'src/pdf.ts'
if (-not (Test-Path $pdfFile)) {
    Write-Host "Creating pdf.ts worker wrapper…" -ForegroundColor Cyan
    $pdfHelper | Set-Content -Path $pdfFile -Encoding utf8
} else {
    Write-Host "pdf.ts already exists – skipping creation." -ForegroundColor Green
}

Write-Host "`n✅ Update complete!" -ForegroundColor Green
