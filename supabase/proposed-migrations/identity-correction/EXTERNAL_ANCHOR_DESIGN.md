# External Audit Anchor: design and local prototype (Phase 3A)

**Status: LOCAL PROTOTYPE, NOT APPLIED, NOT OPERATIONAL.** Migration 09, the worker and the tests exist only in this branch. No real GitHub
evidence repository, timestamp service, e-mail channel, secret or account has been created. The identity-correction workflow must stay
disabled until the External Audit Anchor is **implemented and tested for real** (owner policy, 8 Nov 2026). Nothing here is a
Production-readiness or security-completion claim.

## What problem this solves
Everything the database says about itself (`verify_ledger()`, anchors, fingerprints) can be rewritten by whoever owns the database. An
anchor that never leaves the database therefore proves nothing against that person. The External Audit Anchor copies *hashes only*
(no personal data) to places the database owner cannot silently change, and re-derives the important values from outside.

## Trust model
| Credential | Held by | Can | Cannot |
|---|---|---|---|
| `idc_evidence_reader` login | verification worker | call `public.identity_evidence_snapshot()`; read `pg_catalog` | read any audit table, run workflow RPCs, write anything |
| `idc_evidence_acker` login | separate acknowledgement step | call `identity_evidence_ack` and `identity_evidence_heartbeat` (each inserts one validated, append-only row) | read the snapshot or any table, write anything else |
| Evidence-sink write token | verification worker only | append files to the evidence repository | rewrite or delete history (branch ruleset), reach the database owner role |
| Evidence-sink read token | acknowledgement step | read the repository | write to it |
| Worker signing key (Ed25519) | verification worker only | sign `anchor` and `verification` records | sign `genesis`, `key_rotation`, `restore_declared` |
| Owner signing key (Ed25519) | owner, offline | sign `genesis`, `key_rotation`, `restore_declared` | (not on any server) |
| Sealing private key (PGP) | owner, offline | decrypt sealed old/new values | (never near the worker, the database or the sink) |

An attacker holding only database credentials (including the database owner) cannot write to the sink or sign evidence. An attacker
holding only the sink cannot sign. Rewriting history silently needs the sink admin **and** the worker key **and** the e-mailed heads
**and** the offline mirror **and** the independent timestamps. The owner holding every secret is out of scope.

## Data flow
1. A correction is applied; `record_anchor()` inserts an anchor `{seq, ledger_rows, ledger_head, guard_fingerprint, created_at}`.
2. The **verification worker** (GitHub Actions in the real design; a local script here) reads `identity_evidence_snapshot()` with the
   read-only role and **recomputes the guard fingerprint itself** with `external-verify.sql` (catalog queries only; needs nothing
   but CONNECT). It compares the stored evidence chain with the database (altered / missing / rolled-back anchors, unanchored ledger
   rows, ledger linkage and anchored heads, fingerprint, acknowledgements, heartbeat ahead of evidence).
3. With no critical finding it appends one signed `anchor` record per new anchor, requests a timestamp, e-mails the head digest, pushes,
   and appends a signed `verification` record. With a critical finding it appends an `alert` verification record, e-mails an alert, and
   **does not bless anything**.
4. The **acknowledgement step** (separate process and credential) re-verifies the whole chain, then calls `identity_evidence_ack` per
   anchor and `identity_evidence_heartbeat` for the latest verification.
5. **Gate:** a new request, and the start of an apply, is refused unless the latest verification is `ok` and recent
   (`verification_max_age`, default 36 h) and every anchor is acknowledged. Approve, cancel and reject remain possible.

## Evidence record
Canonical JSON, hash-chained (`prev_hash`), Ed25519-signed, strict allow-list shape with **no free-text field**; only hashes, counters,
timestamps and enumerated codes. The chain starts at an owner-signed `genesis` whose hash and owner public key are **pinned out of
band** (the verifier never learns them from the sink). Key rotation and restore declarations are owner-signed. After a declared
restore, anchors carry an `epoch`, so a restored database re-using anchor sequence numbers is not mistaken for tampering.

## Failure behaviour
| Failure | Behaviour |
|---|---|
| Evidence push fails | exit 3, alert e-mail, records stay as local commits and are re-pushed next run; nothing unpushed is acknowledged; gate stays closed |
| E-mail fails | warning `WARN_MAIL_FAILED`, evidence still delivered; owner may make it blocking (`MAIL_FAILURE_BLOCKS`) |
| Timestamp service fails | warning; records stay valid; late stamps are added by the next run; missing stamps older than the grace period are reported |
| Verification becomes stale | gate closes (`IDC_EXTERNAL_EVIDENCE_REQUIRED`); reopens after a fresh `ok` heartbeat |
| Worker interrupted | atomic file writes; next run keeps an uncommitted record only if the chain still verifies, removes temp files |
| Database restored | alert until the owner signs `restore_declared`; then a new epoch |
| Worker key retired | the worker refuses to append (`WORKER_KEY_NOT_ACTIVE`); the verifier rejects records signed by it |

## Honest limits
- **The acker credential is a trusted bridge.** `identity_evidence_ack` and `identity_evidence_heartbeat` are database rows: someone holding
  the acker credential, or the database owner, can forge acknowledgements and heartbeats and so open the operational gate. Bounds, in
  decreasing strength: (1) every forged row is compared field for field with the signed evidence at the next worker run
  (`ACK_MISMATCH`, `HEARTBEAT_MISMATCH`, `HEARTBEAT_AHEAD_OF_EVIDENCE`, `HEARTBEAT_NOT_IN_EVIDENCE`, `HEARTBEAT_HISTORY_TRUNCATED`) and the
  alert is mailed and recorded externally; (2) an `ok` heartbeat is refused unless it covers every current anchor, so stale heartbeats
  cannot be replayed; (3) a request throttle (`policy.max_requests_per_day`, default 20) caps how many requests can be created in 24 hours
  whatever the gate says; (4) the worker and the ack step check at run time that their credential is exactly the intended least-privilege
  role. None of this PREVENTS a forged gate between two worker runs: the window is the time to the next independent verification, so
  run the verification more often than `verification_max_age` and event-driven after every anchor.
- Row *content* of the ledger cannot be recomputed from outside without exposing salted fingerprints; the verifier checks linkage and the
  externally anchored heads instead.
- A consistent history rewrite by someone holding the sink **and** the worker key is detected by the independent timestamp tokens (they bind
  the original hashes) unless the tokens are stripped too; a missing token is critical (`TSA_TOKEN_MISSING`) once the grace period has
  passed, and the e-mailed head digests (`KNOWN_GOOD_HEADS`) and the offline mirror expose it regardless.
- The mock timestamp authority, mock mailer and local bare repository are **simulations**. Real RFC 3161 handling, the Resend integration,
  the GitHub ruleset and the Actions workflow are NOT implemented and NOT tested.
- The verifier does not establish trust in its own source or in the pinned values it is given (pinning is mandatory: genesis hash and owner
  public key, held offline). Comparing an e-mailed head with the sink head is an owner procedure, not automated.
- The fingerprint depends on `pg_get_functiondef` text, function owner and ACL: a PostgreSQL major-version upgrade can change the text. Pin the
  server major version used for anchoring and treat a version upgrade as an owner-signed re-baselining event.
- Canonical JSON is `JSON.stringify` with sorted keys; because every string is restricted by the allow-list to ASCII identifiers, hashes or a
  PEM, and every number to a safe integer, the bytes equal RFC 8785 output for this domain. A verifier written in another language must
  reproduce that exactly.
- The heartbeat history grows by one row per worker/ack cycle (a few hundred bytes); archiving it needs an owner-signed checkpoint, which is
  not implemented.
- The command used to reach the database is split on whitespace (double quotes keep spaces) and run WITHOUT a shell; credentials belong in
  `PGPASSFILE`/`PGPASSWORD`, not in the command line.

## Not implemented (activation prerequisites remain open)
Real evidence repository and ruleset, real signing-key generation and custody, real timestamp authority, Resend/escalation wiring,
scheduled/independent execution, a dead-man's-switch for a missing worker, Staging rehearsal, and the owner policy decisions.
