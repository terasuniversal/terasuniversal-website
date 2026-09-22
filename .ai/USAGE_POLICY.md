# TERAS usage policy

Auto Routing is the default development policy.

- LOW / BULK / RESEARCH / SCOUT: DeepSeek Flash (`deepseek / deepseek-flash`).
- MEDIUM research/scout/bulk: DeepSeek Flash.
- MEDIUM implementation and NORMAL development: Codex (`openai-codex / gpt-5.6-luna`).
- HIGH: Codex implementation plus Claude specialist independent review.
- CRITICAL: Codex implementation, Claude independent review, required tests/E2E,
  and explicit human approval.

DeepSeek is a bounded terminal scout/fast worker only. It cannot independently
perform production deployment, migrations, RLS/auth/security, payment logic,
destructive database operations, production configuration, or HIGH/CRITICAL
approval. No provider fallback may silently change risk or approval requirements.

Manual session selection remains available: Auto Routing (default), Codex,
DeepSeek Flash, and Claude specialist review. Telegram and production gateway
routing are outside this policy.
