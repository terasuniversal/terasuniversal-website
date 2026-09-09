# Hermes usage and routing policy

Normal active routing is fixed as follows:

- LOW/MEDIUM: OpenAI Codex GPT-5.6 Luna.
- HIGH/CRITICAL: Anthropic Claude Sonnet 5.
- DeepSeek: disabled for active routing.

The router must not silently change providers when an approved model is
missing or unavailable. The controlled runner returns an explicit blocker and
leaves the task pending human action. HIGH/CRITICAL approval gates remain
mandatory.

DeepSeek code and reports may remain for historical compatibility and explicit
manual inspection only. They are never selected by normal classification,
configuration, `-PreferDeepSeek`, provider-health checks, or fallback logic.

Codex and Claude receive only the bounded handoff context required by the
task. No routing policy authorizes arbitrary shell execution, Git mutation,
deployment, SQL execution, migration application, or production access.

Repair and review limits remain unchanged: bounded repair cycles, explicit
human approval, and no automatic release actions.
