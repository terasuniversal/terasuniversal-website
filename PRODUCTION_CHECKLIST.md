# Production Readiness Checklist — TERAS UNIVERSAL

Every item checked against the live, connected Supabase project and the current codebase. No code was changed to produce this checklist (one exception, noted explicitly: the Participants module's database schema was fixed earlier in this same session, before this checklist was requested — its items below reflect that post-fix state, not the pre-fix state documented in `QA_REPORT.md`). Rating: **PASS** / **WARNING** / **FAIL**.

**Scoring methodology**: PASS = 1 point, WARNING = 0.5 points, FAIL = 0 points, out of the total item count. Stated explicitly so the score is reproducible, not a vibe.

---

## Authentication

| Item | Rating | Note |
|---|---|---|
| Primary login flow (`app/admin/login/actions.ts`) | PASS | Cookie-based session, checks `is_active`, audit-logs the event |
| Login rate limiting | WARNING | No throttle of its own — relies solely on Supabase Auth's default |
| Second login route (`/api/admin/login`) | FAIL | Orphaned, different auth source, returns raw tokens in JSON, no rate limit — live and reachable |
| Password reset flow | PASS | Correctly avoids user enumeration, has its own throttle |
| Session handling (`getUser()` vs cached `getSession()`) | PASS | Correctly revalidates every request |

## Authorization

| Item | Rating | Note |
|---|---|---|
| Role hierarchy logic (`lib/auth/rbac.ts`) | PASS | Correct ordinal comparison, no drift found |
| Route-level `MODULE_ACCESS` enforcement | PASS | Sidebar and guards agree |
| `courses`/`participants`/`certificates` RLS model | FAIL | Gated by `admin_users` binary membership, disconnected from `profiles.role`/`is_active` |
| Users & Roles management UI | FAIL | Read-only; no way to change a role or deactivate a user from the app |

## Database

| Item | Rating | Note |
|---|---|---|
| Schema alignment (most operations modules) | FAIL | Schedules/Trainers/Attendance/Assessment/Certificates(admin)/Automation/Reports/Audit still target non-existent tables/columns |
| `courses` table | PASS | Schema-correct, 125 real rows |
| `participants` table | PASS | Fixed this session — extended with the columns the admin module needs, additive, verified live |
| Migration history vs. repo file drift | WARNING | 5 of 6 compatibility-migration filenames don't byte-match live timestamps; 1 live migration has no repo file |
| `database.types.ts` accuracy | FAIL | Hand-written partial stub; most tables fall back to `any` |

## Storage

| Item | Rating | Note |
|---|---|---|
| Buckets provisioned | FAIL | Zero buckets exist live |
| Upload validation | FAIL | Client-side only; no server-side enforcement even if a bucket existed |

## Certificates

| Item | Rating | Note |
|---|---|---|
| Admin UI generation/management | FAIL | Writes columns absent from the live table |
| Legacy API route (`/api/admin/certificates`) | PASS | Matches live schema exactly |
| Certificate templates | FAIL | Table doesn't exist live |
| Certificate Register export | WARNING | Print-to-PDF placeholder, not real server-generated PDF; also depends on the broken admin-UI data path |

## QR Verification

| Item | Rating | Note |
|---|---|---|
| QR code generation on certificates | WARNING | Code exists (`verification_token`/`verification_url` fields) but the certificates that would carry it aren't generatable today (see Certificates above) |
| QR scan → verification result | FAIL | Resolves to `/verify/[token]`, which calls a non-existent RPC — every scan fails |

## Participant Flow

| Item | Rating | Note |
|---|---|---|
| Create / Edit / List / Search / Filter / Sort / Soft delete / Restore | PASS | Fixed this session; schema now matches the module's code |
| Detail page cross-module widgets (training history, certificates, attendance, assessment) | WARNING | Degrade gracefully to empty states rather than erroring, but show no real data until Schedules/Attendance/Assessment/Certificates are fixed in their own turns |
| CSV/Excel import | WARNING | Schema-aligned now; not yet independently re-tested end-to-end post-migration (pending `MODULE_REPORT.md`) |
| CSV/Excel export | PASS | Column set matches the now-live schema |

## Course Flow

| Item | Rating | Note |
|---|---|---|
| Full admin CRUD | PASS | Reference implementation, schema-correct |
| Validation | PASS | `courseSchema`, consistently applied |
| Public display (`/training/[slug]`, homepage listings) | PASS | Reads live via `lib/public-content.ts`, cached correctly |

## Attendance Flow

| Item | Rating | Note |
|---|---|---|
| Admin CRUD | FAIL | Live table shape doesn't match what the module writes |
| Check-in time accuracy | FAIL | Timezone bug independent of the schema issue — server-local parsing of a venue-local input |

## Assessment Flow

| Item | Rating | Note |
|---|---|---|
| Admin CRUD | FAIL | Live table shape doesn't match what the module writes |

## Reports

| Item | Rating | Note |
|---|---|---|
| Data source (`v_*` views) | FAIL | None of the 9 designed reporting views exist live |
| Front-end calculation logic | PASS | Percentage math, CSV export correctly implemented — just nothing to calculate from |

## Dashboard

| Item | Rating | Note |
|---|---|---|
| Widget data (6 of 8 queries) | FAIL | Target non-existent tables |
| Query structure/parallelization | PASS | Genuinely parallel `Promise.all`, no serialization bug |

## Public Website

| Item | Rating | Note |
|---|---|---|
| Rendering, navigation, static content | PASS | Works correctly across all public pages |
| CMS-bridged sections (courses, gallery, FAQ, company info) | PASS | Live via `lib/public-content.ts` |
| Upcoming-schedules section | FAIL | Queries a table (`schedules`) that exists in neither live schema — always empty |

## SEO

| Item | Rating | Note |
|---|---|---|
| `sitemap.xml` | PASS | Present, correctly structured |
| `robots.txt` | PASS | Present, correctly points at the sitemap |
| Per-page metadata (`generateMetadata`) | PASS | Present and scoped per public page |

## Performance

| Item | Rating | Note |
|---|---|---|
| Database indexing | WARNING | ~30 unindexed live foreign keys — fine today, will degrade with real data volume |
| Public-site caching | PASS | `unstable_cache`, 60s TTL, tag-based invalidation, correctly implemented |
| Known query bugs (N+1, serialized `Promise.all`, unbounded fetch) | FAIL | Confirmed live in bulk-cert-generation, trainer profile page, and (until this session's fix) participant import |

## Security Headers

| Item | Rating | Note |
|---|---|---|
| HSTS / X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy | PASS | All present, correctly configured, sitewide |
| Content-Security-Policy | FAIL | `script-src` allows `unsafe-inline`/`unsafe-eval`, undermining most of what CSP protects against |

## Environment Variables

| Item | Rating | Note |
|---|---|---|
| No secrets committed | PASS | `.env*` gitignored; only `.env.example`/placeholders tracked |
| `NEXT_PUBLIC_` usage correctness | PASS | No secret ever prefixed for browser exposure |

## Supabase Policies

| Item | Rating | Note |
|---|---|---|
| RLS enabled on all tables | PASS | Confirmed live on all 22 tables (including `companies`/`audit_logs`, added this session) |
| `FORCE ROW LEVEL SECURITY` | WARNING | Not set anywhere; low real-world impact since `anon`/`authenticated` lack `BYPASSRLS` regardless |
| Single authorization model | FAIL | `admin_users` vs. `profiles.role` split, see Authorization above |

## Error Logging

| Item | Rating | Note |
|---|---|---|
| Centralized error tracking (Sentry or equivalent) | FAIL | None configured — no error-tracking dependency found anywhere in `package.json` |
| Structured server-side error logging | WARNING | `console.error` used consistently in API routes with context objects, but nothing aggregates or alerts on it |

## Backup Strategy

| Item | Rating | Note |
|---|---|---|
| In-app manual backup/export | FAIL | Deliberately disabled — explicit in-app note that it needs a protected server job + retention policy first (correctly gated, but not built) |
| Automated database backups | WARNING | Supabase provides platform-level automated backups on paid tiers, but this was not independently confirmed for this project's specific plan/retention settings — verify directly in the Supabase dashboard rather than assuming |

---

## Production Readiness Score

**23 PASS + 10 WARNING (×0.5) + 20 FAIL, out of 53 total items**
= (23 + 5) / 53 × 100

# **Score: 53 / 100**

Per your instruction, a 100 requires every item to pass — this system is roughly half of the way there. The pattern is consistent with everything else established this session: the parts of the system built against the live schema (Courses, the public website, SEO, environment/secrets hygiene, security headers other than CSP) are solid and would score close to 100 on their own. The parts built against the never-applied designed schema (most operations modules, Storage, the certificate engine, Reports, Dashboard, QR verification) currently fail outright. **The single fastest way to move this score is the schema-consolidation work already identified in `MASTER_TODO.md`/`DATABASE_AUDIT.md` §10** — most of the FAILs above share that one root cause, the same way the Participants module's fix earlier this session flipped 4 FAILs to PASS with one migration.
