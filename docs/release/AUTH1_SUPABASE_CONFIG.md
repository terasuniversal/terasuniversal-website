# AUTH-1 — Proposed Supabase Auth configuration (NOT APPLIED)

Status: proposal only. Nothing here has been changed on Production (`iagzkrzeuawaxvacqprk`) or Staging (`eokiaehnvzbggmacifcf`). Each change needs separate Owner approval.

## Why

Invitation and recovery emails use GoTrue's default `{{ .ConfirmationURL }}`. GoTrue verifies the token on the **GET** (so a mail scanner can spend it), then redirects with the session in the URL **hash**. The admin browser client (`@supabase/ssr`, PKCE) rejects hash links ("Not a valid PKCE flow url"), so no session is created.

The AUTH-1 code handles both link formats:

| Link format | Where it lands | What happens |
|---|---|---|
| **Recommended**: `…/admin/auth/confirm?token_hash=…&type=invite\|recovery` | `/admin/auth/confirm` | GET only shows a "Teruskan" button; `verifyOtp` runs on the POST; session cookie set server-side; redirect to `/admin/auth/set-password` |
| **Current default** (`ConfirmationURL`, hash tokens) | `redirect_to` = `/admin/reset-password`, which forwards the hash to `/admin/auth/confirm` | Hash read client-side and removed from the address bar; `setSession` runs only on the button press |

The code keeps `redirect_to` on `/admin/reset-password`. GoTrue honoured that path for the 07:36 UTC invitation on 2026-11-22. So the default format works with the code alone, without any provider change. The recommended format (change 1) additionally stops mail scanners from spending the token before the person clicks.

## Change 1 — Email templates (Auth → Email Templates), per project

**Invite user**

```html
<h2>Jemputan ke TERAS CRM</h2>
<p>Anda telah dijemput ke TERAS CRM. Tekan pautan di bawah, kemudian tekan "Teruskan" untuk menetapkan kata laluan.</p>
<p><a href="{{ .SiteURL }}/admin/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Terima jemputan</a></p>
```

**Reset password**

```html
<h2>Tetapkan semula kata laluan TERAS CRM</h2>
<p>Tekan pautan di bawah, kemudian tekan "Teruskan" untuk menetapkan kata laluan baharu. Abaikan e-mel ini jika anda tidak memintanya.</p>
<p><a href="{{ .SiteURL }}/admin/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Tetapkan kata laluan</a></p>
```

`{{ .SiteURL }}` is used rather than `{{ .RedirectTo }}`, because an un-allowlisted `redirectTo` silently falls back to the Site URL root.

## Change 2 — Redirect URLs (Auth → URL Configuration) — optional, for a later direct redirect

Add exact paths only. No broad wildcards.

| Project | Add |
|---|---|
| Production | `https://www.terasuniversal.com.my/admin/auth/confirm` (and `https://terasuniversal.com.my/admin/auth/confirm` if the apex is used) |
| Staging | the Staging deployment origin + `/admin/auth/confirm` |

Keep `…/admin/reset-password` in the list while old emails are still in inboxes.

## Change 3 — Site URL (check only; do not change without review)

Observed on 2026-11-22: Production recovery links without a valid redirect fell back to `https://www.terasuniversal.com.my`. This is correct for change 1. For Staging, the Site URL must be the Staging origin, or Staging emails will point at Production.

## Testable without provider changes?

Partly.

| Testable now | Needs a provider change |
|---|---|
| All logic (18 local tests, mocked Supabase) | — |
| Hash-link path through the `/admin/reset-password` forwarder. GoTrue honoured that redirect for the 2026-11-22 invitation, so it is expected to work; Staging UAT must confirm it | — |
| — | Scanner-safe `token_hash` path: change 1 |
| — | Pointing `redirect_to` straight at `/admin/auth/confirm` (optional): change 2 plus a one-line code change |

One recovery verification on 2026-11-22 (07:42–07:43 UTC) redirected to the Site URL root even though `/admin/reset-password` was requested. That email may have been the one sent with no `redirect_to` at 07:41. Staging UAT must confirm that recovery emails land on `/admin/reset-password`.

## Rollback

Restore the previous templates (GoTrue default `{{ .ConfirmationURL }}`) and remove the added redirect URLs. The code keeps working with the default templates through the hash-link path.
