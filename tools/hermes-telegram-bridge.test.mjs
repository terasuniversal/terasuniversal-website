import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "./hermes-gateway.mjs";
import { CRM_WORKSPACE, HERMES_WORKSPACE, READ_ONLY_COMMANDS, TERAS_PROJECT_ID, createTerasReadOnlyBridge, validateLoopbackBinding, validateTerasProjectBinding } from "./hermes-telegram-bridge.mjs";

const state = {
  projectContext: { ProjectName: "TERAS Universal Website / CRM", ActiveWorkspace: HERMES_WORKSPACE, WorkspaceRole: "ISOLATED_HERMES", Branch: "isolate/hermes-source", Blockers: [] },
  task: null, taskIntent: null, operatorSummary: { Blockers: [], RequiredHumanAction: "NONE" }, approval: null, queue: null, operatorEvidence: null, auditExport: null,
};
const bridge = (overrides = {}) => createTerasReadOnlyBridge({ readState: async () => state, ...overrides });
const request = (text, overrides = {}) => bridge().handle({ text, senderId: "user-1", chatId: "chat-1", authorizedUserIds: ["user-1"], authorizedChatIds: ["chat-1"], ...overrides });

test("exact read-only commands route to the TERAS H8 bridge", async () => {
  for (const command of ["/help", "/status", "/project", "/tasks", "/queue"]) {
    const result = await request(command);
    assert.equal(result.ok, true, command);
    assert.equal(result.command, command.slice(1));
    assert.ok(result.message.length <= 3800);
  }
  assert.deepEqual([...READ_ONLY_COMMANDS].sort(), ["help", "project", "queue", "status", "tasks"]);
});

test("unknown/free-form, shell, SQL, and filesystem inputs never reach the bridge", async () => {
  for (const input of ["hello Hermes", "/status && whoami", "/status; git status", "/project C:\\secret", "/queue ../../", "/tasks --exec", "/approve task-1"]) {
    const result = await request(input);
    assert.equal(result.ok, false, input);
    assert.equal(result.code, "UNSUPPORTED_TERAS_COMMAND");
  }
});

test("strict authorization requires both approved user and chat", async () => {
  assert.equal((await request("/status")).ok, true);
  assert.equal((await request("/status", { senderId: "bad-user" })).code, "UNAUTHORIZED_OPERATOR");
  assert.equal((await request("/status", { chatId: "bad-chat" })).code, "UNAUTHORIZED_OPERATOR");
  assert.equal((await request("/status", { authorizedChatIds: [] })).code, "UNAUTHORIZED_OPERATOR");
  assert.equal((await request("/status", { authorizedUserIds: [] })).code, "UNAUTHORIZED_OPERATOR");
});

test("group/channel traffic requires an explicit approved chat ID", async () => {
  assert.equal((await request("/status", { chatType: "group", authorizedChatIds: [] })).code, "UNAUTHORIZED_OPERATOR");
  assert.equal((await request("/status", { chatType: "group", authorizedChatIds: ["chat-1"] })).ok, true);
});

test("project binding accepts only isolated Hermes and blocks CRM", async () => {
  assert.equal(validateTerasProjectBinding({ projectId: TERAS_PROJECT_ID, projectRoot: HERMES_WORKSPACE, workspaceRole: "ISOLATED_HERMES" }).allowed, true);
  assert.equal(validateTerasProjectBinding({ projectId: TERAS_PROJECT_ID, projectRoot: CRM_WORKSPACE, workspaceRole: "CANONICAL_ACTIVE" }).code, "PROJECT_BINDING_MISMATCH");
  assert.equal((await createTerasReadOnlyBridge({ projectRoot: CRM_WORKSPACE, readState: async () => state }).handle({ text: "/status", senderId: "user-1", chatId: "chat-1", authorizedUserIds: ["user-1"], authorizedChatIds: ["chat-1"] })).code, "PROJECT_BINDING_MISMATCH");
});

test("bridge is loopback-only and has no arbitrary destination or MCP tool input", async () => {
  assert.equal(validateLoopbackBinding({ host: "127.0.0.1" }).allowed, true);
  assert.equal(validateLoopbackBinding({ host: "8.8.8.8" }).code, "LOOPBACK_REQUIRED");
  const result = await createTerasReadOnlyBridge({ host: "https://example.invalid", readState: async () => state }).handle({ text: "/status", senderId: "user-1", chatId: "chat-1", authorizedUserIds: ["user-1"], authorizedChatIds: ["chat-1"] });
  assert.equal(result.code, "LOOPBACK_REQUIRED");
  assert.equal(Object.keys(TOOLS).length, 12);
});

test("bridge failure fails closed and never falls back to generic Hermes chat", async () => {
  const result = await createTerasReadOnlyBridge({ readState: async () => { throw new Error("unavailable"); } }).handle({ text: "/status", senderId: "user-1", chatId: "chat-1", authorizedUserIds: ["user-1"], authorizedChatIds: ["chat-1"] });
  assert.deepEqual(result, { ok: false, code: "STATE_UNAVAILABLE", message: "STATE_UNAVAILABLE" });
});

test("empty state is explicit and output is bounded/redacted", async () => {
  const empty = await request("/tasks");
  assert.match(empty.message, /No active tasks/);
  const safe = await createTerasReadOnlyBridge({ readState: async () => ({ ...state, task: null, projectContext: { ...state.projectContext, Blockers: ["OPENAI_API_KEY=secret", "user@example.com", "git push"] } }) }).handle({ text: "/status", senderId: "user-1", chatId: "chat-1", authorizedUserIds: ["user-1"], authorizedChatIds: ["chat-1"] });
  assert.ok(safe.message.length <= 3800);
  assert.equal(safe.message.includes("secret"), false);
  assert.equal(safe.message.includes("user@example.com"), false);
  assert.equal(safe.message.includes("git push"), false);
});

test("read-only bridge does not mutate injected state and MCP/routing remain unchanged", async () => {
  const before = JSON.stringify(state);
  await request("/help");
  assert.equal(JSON.stringify(state), before);
  assert.equal(TOOLS.length, 12);
  assert.equal(TOOLS.filter((tool) => tool.annotations.readOnlyHint).length, 8);
  assert.equal(TOOLS.filter((tool) => tool.annotations.readOnlyHint === false).length, 4);
});
