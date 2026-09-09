# Hermes MCP → ChatGPT development connection

This is the Phase 4.2 development procedure for the read-only Hermes MCP
gateway. It does not authorize production hosting, deployment, or credentials.

## Canonical state binding and freshness

Hermes resolves state from the canonical workspace:

```text
D:\Projects\terasuniversal-website-clean\.ai
```

MCP responses include the canonical workspace and freshness metadata.
`CURRENT` means the binding matches; `STALE` means a legacy or different
workspace was recorded; `NEEDS_REFRESH` means a document has no verifiable
workspace binding. Do not treat `STALE` or `NEEDS_REFRESH` project/roadmap
responses as current until the owning durable state is refreshed through the
normal Hermes workflow.

## Selected tunnel method

Use an organization-approved HTTPS development tunnel. The procedure below
uses **ngrok** as the concrete fallback because the repository does not include
OpenAI Secure MCP Tunnel tooling. If OpenAI Secure MCP Tunnel is enabled for
the account, use its equivalent HTTPS forwarding command and keep the same
gateway authentication requirements and `/mcp` suffix.

The gateway must remain bound to `127.0.0.1`. Do not bind it to `0.0.0.0` and
do not run a tunnel without gateway authentication.

## Secure local run

In PowerShell terminal 1, generate a temporary development token and start the
gateway. Keep the token private and do not commit it or place it in a tracked
file:

```powershell
$env:HERMES_MCP_TOKEN = '<random-long-development-token>'
$env:HERMES_REQUIRE_AUTH = '1'
node tools/hermes-gateway.mjs
```

The local endpoint is:

```text
http://127.0.0.1:8787/mcp
```

In PowerShell terminal 2, start the approved tunnel:

```powershell
ngrok http 8787
```

Copy the generated **HTTPS** forwarding URL and append `/mcp`, for example:

```text
https://<random-subdomain>.ngrok-free.app/mcp
```

The ChatGPT connection must send `Authorization: Bearer <token>` to this URL.
If the ChatGPT app setup does not provide bearer-token configuration, stop and
use the organization’s OpenAI Secure MCP Tunnel/auth flow instead; do not
remove the gateway token or fall back to an unauthenticated public tunnel.

## ChatGPT Developer Mode steps

1. Start the authenticated local gateway and HTTPS tunnel above.
2. In ChatGPT, open **Settings → Apps & Connectors → Advanced settings** and
   enable **Developer Mode**.
3. Open the app/connector creation screen and choose **Add app** (older UI may
   say **Add connector**).
4. Enter a recognizable name such as `Hermes MCP (local read-only)`.
5. Set the MCP server URL to the tunneled HTTPS URL ending in `/mcp`.
6. Configure the bearer token using the token from terminal 1. Never paste the
   token into source control, task state, reports, or ChatGPT conversation text.
7. Save/connect the app, refresh the app after tool metadata changes, and
   confirm that exactly these eight tools are listed:

   `hermes_status`, `hermes_gateway_health`, `hermes_project_status`,
   `hermes_roadmap`, `hermes_active_tasks`, `hermes_task_detail`,
   `hermes_recent_runs`, `hermes_agent_status`.

8. Exercise each tool with a read-only prompt. For `hermes_task_detail`, test
   once with no argument and once with the current task ID. Confirm no tool
   offers create, update, delete, shell, commit, push, merge, deploy, or
   migration operations.

## Security controls

- Loopback binding is the default (`127.0.0.1:8787`).
- Tunneled requests require the configured bearer token.
- No production credentials or database credentials are used.
- The tool registry is fixed to the eight Phase 1 read-only tools.
- Every tool advertises `readOnlyHint: true`, `destructiveHint: false`,
  `idempotentHint: true`, and `openWorldHint: false`.
- Unknown tools and methods return JSON-RPC errors; no shell dispatcher exists.
- Stop the gateway and tunnel when validation is complete.

## Manual step remaining

The local automated checks validate the MCP protocol and all eight tools, but a
human must still complete the ChatGPT Developer Mode connection using the
HTTPS tunnel and bearer-token UI available to their account.
