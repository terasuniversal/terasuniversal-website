# Hermes model-routing policy

This is the authoritative active routing policy for `tools/agent-router.ps1`.

| Risk | Active implementer | Provider | Model |
|---|---|---|---|
| LOW | Codex | OpenAI Codex | GPT-5.6 Luna |
| MEDIUM | Codex | OpenAI Codex | GPT-5.6 Luna |
| HIGH | Claude Code | Anthropic | Claude Sonnet 5 |
| CRITICAL | Claude Code | Anthropic | Claude Sonnet 5 |

DeepSeek is disabled for active routing. It must never be selected by normal
classification, `-PreferDeepSeek`, configuration, health checks, or fallback.
The legacy runner remains only for explicit manual/compatibility inspection of
historical task state. It is not an active implementer or fallback provider.

## Routing invariants

- The router returns concrete provider and model metadata in every new task
  classification and durable task state.
- HIGH and CRITICAL tasks require human approval and retain mandatory review
  behavior. They must not silently downgrade when Claude is unavailable.
- LOW and MEDIUM tasks must not silently downgrade when Codex is unavailable.
  The controlled runner reports an explicit unavailable/blocker result.
- Production Audit remains a deliberate full-repository audit mode: Codex
  implements the audit and Claude Sonnet 5 reviews it when review is required.
- No routing path authorizes arbitrary shell execution, Git mutation,
  deployment, SQL execution, migration apply, or production database access.

## Legacy compatibility

Historical `DEEPSEEK_FAST`, `CLAUDE_FAST`, `CLAUDE_DEEP`, and `CODEX_REVIEW`
labels may remain in old reports or compatibility code. They are not active
model selections. New routing must use the concrete labels above, and any
legacy DeepSeek task state is reconciled to the approved provider/model before
execution.
