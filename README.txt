TERAS UNIVERSAL — Training Methodology Update

1. Copy BOTH files in this ZIP into:
   C:\WEBSITE\terasuniversal-website

2. Open PowerShell in that folder.

3. Run:
   powershell -ExecutionPolicy Bypass -File .\apply-training-methodology-update.ps1

4. Test and publish:
   npm run build
   git add .
   git commit -m "Enhance training methodology section"
   git push origin main

The script updates app/page.js and app/globals.css automatically.
