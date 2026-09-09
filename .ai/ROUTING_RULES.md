# Hermes routing rules

The active router is risk-first and provider-explicit:

```text
LOW      -> OpenAI Codex / GPT-5.6 Luna
MEDIUM   -> OpenAI Codex / GPT-5.6 Luna
HIGH     -> Anthropic / Claude Sonnet 5
CRITICAL -> Anthropic / Claude Sonnet 5
```

DeepSeek is disabled for active routing. No task description, preference
switch, configuration flag, health result, or provider failure may select it.
The legacy DeepSeek runner is retained only for explicit manual/compatibility
operations and cannot enter the normal task pipeline.

## Risk and approval

- HIGH and CRITICAL require human approval before execution and retain their
  mandatory review requirements.
- Missing or unavailable approved providers/models fail closed with an
  explicit blocker; there is no silent downgrade or unapproved fallback.
- LOW and MEDIUM use Codex GPT-5.6 Luna. HIGH and CRITICAL use Claude Sonnet
  5. A required reviewer remains governed by the task risk and review policy.
- Where a full-repository audit is explicitly requested, Codex may implement
  the audit and Claude Sonnet 5 may review it.

These rules are encoded in `tools/agent-router.ps1` and exercised by the
Hermes routing tests.
