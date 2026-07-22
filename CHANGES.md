# TERAS UNIVERSAL Website — Consolidated Update (18 files)

This is ALL the changes made so far, combined into one package, so there's
only one extract → one build → one commit instead of five separate batches.

## Part 1 — Build fix (14 files)
The build was failing before any of this work started (a pre-existing bug),
because `lib/supabase/server.ts` and `lib/supabase/middleware.ts` create the
Supabase client without telling TypeScript what the database schema looks
like. That caused every place the code reads or writes a database table to
fail type-checking with a `never`/`any` mismatch error.

The fix is the same one-line pattern everywhere it was needed — casting the
Supabase table reference so TypeScript stops guessing incorrectly. No
queries, logic, or runtime behaviour changed anywhere — this is purely a
TypeScript compile-time fix.

Files:
- `lib/supabase/server.ts`
- `lib/supabase/middleware.ts`
- `app/admin/(protected)/courses/actions.ts`
- `app/admin/(protected)/attendance/actions.ts`
- `app/admin/login/actions.ts`
- `app/admin/(protected)/search/page.tsx`
- `app/admin/(protected)/attendance/page.tsx`
- `app/admin/(protected)/audit/page.tsx`
- `app/admin/(protected)/courses/[id]/page.tsx`
- `app/admin/(protected)/courses/[id]/preview/page.tsx`
- `app/admin/(protected)/courses/page.tsx`
- `app/admin/(protected)/layout.tsx`
- `app/admin/(protected)/dashboard/page.tsx`
- `lib/auth/session.ts`
- `lib/public-content.ts`

I re-scanned the entire codebase for this specific pattern (every
`.insert()`, `.update()`, `.upsert()`, `.delete()`, `.rpc()`, `.select()`,
`.from()` call) after fixing it, so this should be complete.

## Part 2 — About page: verified corporate content (4 files)
Sourced from the official TERAS UNIVERSAL Corporate Profile 2026 PDF you
provided. No numbers or facts were invented — anything not explicitly
stated in that document was left out.

Files:
- `data/companyProfile.js` — real Vision/Mission text, the correct 6-part
  TERAS core values, verified accreditations (JKKP/DOSH, HRD Corp, CIDB,
  MOF, SSM), verified leadership bios, and the verified founder timeline.
  Also keeps an explicit list of unverified claims (25+ professionals,
  10,000+ trained, 200+ clients, ISO claims) that must NOT be published
  until you confirm them.
- `app/about/page.js` — renders the new data: corrected core values (was
  showing the wrong 5-value acronym, now the real 6-value TERAS+I),
  new Accreditations section, new Leadership section, new Timeline section.
- `app/globals.css` — the styling for those new sections, appended to the
  end of the file. Nothing existing was changed or removed.

## What was NOT touched
No other page, route, or component. The Resend email integration, Google
Sheets CRM forwarding, Request Proposal workflow, and Contact Form are all
untouched.

---

## How to apply (PowerShell) — ONE script, run top to bottom

```powershell
# ====================================================================
# TERAS UNIVERSAL — Consolidated update (build fix + About page)
# ====================================================================

# 1. Confirm git and npm actually work in THIS terminal before doing anything else
git --version
npm --version
# If either shows "not recognized", STOP here and fix that first
# (close and reopen VS Code fully, or restart the computer).

# 2. Set paths — change $repoPath if your repo is somewhere else
$repoPath    = "C:\WEBSITE\terasuniversal-website"
$zipPath     = "$env:USERPROFILE\Downloads\teras-update-consolidated.zip"
$extractPath = "$env:USERPROFILE\Downloads\teras-update-consolidated"

if (-not (Test-Path $repoPath)) {
    Write-Host "ERROR: Repo not found at $repoPath" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $zipPath)) {
    Write-Host "ERROR: ZIP not found at $zipPath — download it first." -ForegroundColor Red
    exit 1
}

# 3. Extract
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
Write-Host "Extracted to $extractPath" -ForegroundColor Green

# 4. Copy every changed file over the repo in one go (folder structure matches)
Copy-Item "$extractPath\app"  -Destination $repoPath -Recurse -Force
Copy-Item "$extractPath\lib"  -Destination $repoPath -Recurse -Force
Copy-Item "$extractPath\data" -Destination $repoPath -Recurse -Force
Write-Host "18 files copied into the repo." -ForegroundColor Green

# 5. Build — the real confirmation
Set-Location $repoPath
git status
npm run build
```

**If the build passes** (look for `✓ Compiled successfully` and no
`Type error`), also spot-check the site locally before pushing:

```powershell
npm run dev
# open http://localhost:3000/about — check Accreditations, Leadership,
# Timeline sections, desktop and mobile widths
# also open http://localhost:3000/admin/dashboard to sanity-check the
# admin area still works (Ctrl+C stops the dev server when done)
```

**Then commit and push:**

```powershell
git add .
git commit -m "Fix Supabase typing across admin; add verified About page content (accreditations, leadership, timeline, corrected core values)"
git push origin main
```

**If `npm run build` fails** — copy the full error text here (not just a
screenshot crop if possible) and I'll trace it the same careful way as
before.
