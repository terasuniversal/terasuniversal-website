import { createTerasReadOnlyBridge } from "./hermes-telegram-bridge.mjs";
import { HERMES_WORKSPACE } from "./hermes-project-config.mjs";

const MAX_INPUT = 8_000;
const ALLOWED_KEYS = new Set(["text", "senderId", "chatId", "chatType", "authorizedUserIds", "authorizedChatIds"]);

function fail(code) {
  process.stdout.write(JSON.stringify({ ok: false, code, message: code }));
}

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > MAX_INPUT) break;
}

if (input.length > MAX_INPUT) {
  fail("TERAS_OPERATOR_UNAVAILABLE");
  process.exit(0);
}

try {
  const request = JSON.parse(input);
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    fail("TERAS_OPERATOR_UNAVAILABLE");
    process.exit(0);
  }
  if (Object.keys(request).some((key) => !ALLOWED_KEYS.has(key))) {
    fail("UNSUPPORTED_TERAS_COMMAND");
    process.exit(0);
  }
  const bridge = createTerasReadOnlyBridge({
    projectRoot: HERMES_WORKSPACE,
    workspaceRole: "ISOLATED_HERMES",
    host: "127.0.0.1",
  });
  const result = await bridge.handle(request);
  process.stdout.write(JSON.stringify(result));
} catch {
  fail("TERAS_OPERATOR_UNAVAILABLE");
}
