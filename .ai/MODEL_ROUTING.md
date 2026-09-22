# TERAS model routing policy

## Active default routing

Hermes is the orchestrator. Auto Routing is the default development mode.

| Task | Provider | Model | Authority |
|---|---|---|---|
| LOW / BULK / RESEARCH / SCOUT | deepseek | deepseek-flash | Scout / fast worker only |
| MEDIUM research/scout/bulk | deepseek | deepseek-flash | Read-only or bounded fast work |
| MEDIUM implementation | openai-codex | gpt-5.6-luna | Main implementer |
| NORMAL development | openai-codex | gpt-5.6-luna | Main implementer |
| HIGH | openai-codex | gpt-5.6-luna | Implementation; Claude specialist review required |
| CRITICAL | openai-codex | gpt-5.6-luna | Implementation; Claude review, tests/E2E, and human approval required |

The router uses the logical alias `DEEPSEEK_FAST` for `deepseek-flash` and
`CODEX` for `openai-codex / gpt-5.6-luna` in task state. Provider selection is
session-scoped and does not change Hermes' default model.

## Safety boundary

DeepSeek must not independently perform or approve production deployment,
Supabase migrations, RLS/auth/security changes, payment changes, destructive
database operations, HIGH/CRITICAL approval, or production configuration.
Blocked-area keywords force the Codex + Claude review path. Provider failure
falls back without lowering risk or bypassing approval gates.

## Manual modes

1. Auto Routing — recommended/default
2. Codex — implementation
3. DeepSeek Flash — scout/audit/research
4. Claude — specialist review

The parent/default model remains `openai-codex / gpt-5.6-luna` unless a session
explicitly selects another provider/model.
