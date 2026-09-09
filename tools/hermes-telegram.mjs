import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";

export const MAX_TELEGRAM_MESSAGE_LENGTH = 3800;
export const MAX_ROWS_PER_PAGE = 8;
// Only these commands are currently bound to the live TERAS Telegram
// transport. Internal projections for other views remain available to local
// callers but must not be advertised as live commands.
export const OPERATOR_COMMANDS = ["status", "tasks", "queue", "project", "help"];
export const REQUIRED_HUMAN_ACTIONS = ["NONE", "APPROVE", "REVIEW_SCOPE", "RESOLVE_DEPENDENCY", "RESOLVE_CONFLICT", "REFRESH_CONTEXT", "REVIEW_FINDINGS", "APPROVE_REPAIR", "MANUAL_INTERVENTION"];
export const NOTIFIABLE_EVENTS = new Set(["TASK_WAITING_APPROVAL", "TASK_READY", "TASK_STARTED", "TASK_BLOCKED", "TASK_INTERRUPTED", "TASK_REVIEW_PENDING", "TASK_REPAIR_REQUIRED", "TASK_COMPLETED", "TASK_FAILED"]);

const taskIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const bounded = (value, max = 240) => {
  let safe = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ");
  if (/openai_api_key|supabase_service_role_key|authorization\s*:\s*bearer|password\s*[:=]|toyyibpay|service[_ -]?role/i.test(safe)) safe = "[REDACTED_SENSITIVE_VALUE]";
  if (/\b(powershell(?:\.exe)?|pwsh|cmd(?:\.exe)?|bash|sh)\b|\bgit\s+(?:push|commit|merge|rebase)|\b(?:select|drop|truncate)\s+/i.test(safe)) safe = "[REDACTED_COMMAND]";
  safe = safe.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  safe = safe.replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[REDACTED_IDENTIFIER]");
  return safe.slice(0, max);
};
const oneLine = (value, max = 240) => bounded(value, max).replace(/\s+/g, " ").trim();
const list = (value, max = 5) => Array.isArray(value) ? value.slice(0, max).map((item) => oneLine(item, 120)).filter(Boolean) : [];
const short = (value, size = 8) => value ? String(value).slice(0, size) : "UNKNOWN";

function unsafeInput(value) {
  return /(?:^|\s)(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|git|sql|select\s+|drop\s+|truncate\s+|rm\s+-|del\s+|format\s+|[A-Za-z]:\\|\\\\)/i.test(String(value ?? ""));
}

export function parseOperatorCommand(input = "") {
  const raw = String(input).trim();
  if (!raw.startsWith("/")) return { ok: false, command: "help", reason: "COMMAND_MUST_START_WITH_SLASH" };
  if (unsafeInput(raw)) return { ok: false, command: "help", reason: "UNSUPPORTED_COMMAND_INPUT" };
  const parts = raw.split(/\s+/);
  const command = parts[0].slice(1).toLowerCase();
  if (!OPERATOR_COMMANDS.includes(command)) return { ok: false, command: "help", reason: "UNKNOWN_COMMAND" };
  if (["task", "audit"].includes(command)) {
    if (parts.length !== 2 || !taskIdPattern.test(parts[1])) return { ok: false, command: "help", reason: "TASK_ID_REQUIRED" };
    return { ok: true, command, taskId: parts[1] };
  }
  if (parts.length !== 1) return { ok: false, command: "help", reason: "UNEXPECTED_ARGUMENT" };
  return { ok: true, command };
}

export function authorizeOperator({ senderId, chatId, allowedUserIds = [], allowedChatIds = [] } = {}) {
  const userAllowed = allowedUserIds.length === 0 ? false : allowedUserIds.map(String).includes(String(senderId));
  const chatAllowed = allowedChatIds.length === 0 ? false : allowedChatIds.map(String).includes(String(chatId));
  return { allowed: userAllowed && chatAllowed, reason: userAllowed && chatAllowed ? "AUTHORIZED" : "UNAUTHORIZED_OPERATOR" };
}

function header(title) { return `Hermes · ${title}`; }
function row(label, value) { return `${label}: ${oneLine(value || "UNKNOWN", 300)}`; }
function renderHelp() { return [header("Help"), "", "/status  /tasks  /queue", "/project  /help", "", "Read-only operator view. Actions never bypass Hermes safety gates."]; }

function boundedMessage(lines) {
  const output = lines.map((line) => oneLine(line, 500)).join("\n");
  if (output.length <= MAX_TELEGRAM_MESSAGE_LENGTH) return output;
  return `${output.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH - 34)}\n… [truncated; use a narrower command]`;
}

function renderStatus(state = {}) {
  const project = state.projectContext ?? {};
  const tasks = state.tasks ?? [];
  const queue = state.queueItems ?? [];
  const counts = (value) => queue.filter((item) => item.QueueState === value).length;
  return [header("Status"), row("Gateway", state.gatewayStatus ?? "AVAILABLE"), row("Project", project.ProjectName ?? "TERAS Universal Website / CRM"), row("Primary stream", project.DevelopmentStream?.PrimaryDevelopmentStream ?? "CRM"), row("Hermes stream", project.DevelopmentStream?.SecondaryDevelopmentStream ?? "HERMES"), row("Active tasks", tasks.length), row("Queue", `ready ${counts("READY")} · running ${counts("RUNNING")} · approval ${counts("WAITING_APPROVAL")} · blocked ${counts("BLOCKED")}`), row("Codex", state.agents?.Codex?.status ?? "NOT_RECORDED"), row("Claude", state.agents?.Claude?.status ?? "NOT_RECORDED"), row("Workspace", project.WorkspaceRole ?? "UNKNOWN"), row("Blockers", list(state.blockers ?? project.Blockers, 3).join(", ") || "NONE"), row("P5.2", state.p52Status ?? "BLOCKED_BY_PLATFORM/CONNECTOR")];
}

function renderTasks(state = {}) {
  const tasks = (state.tasks ?? []).slice(0, MAX_ROWS_PER_PAGE);
  if (!tasks.length) return [header("Tasks"), "No active tasks recorded."];
  return [header("Tasks"), ...tasks.map((task) => `${oneLine(task.TaskId, 80)} · ${oneLine(task.Title ?? task.Description, 80)}\n  ${oneLine(task.Risk, 20)} · ${oneLine(task.Domain, 40)} · ${oneLine(task.State ?? task.QueueState, 30)} · ${oneLine(task.ImplementerModel, 50)}\n  approval=${oneLine(task.ApprovalStatus, 30)} · action=${oneLine(task.RequiredHumanAction, 40)}`), ...(state.tasks?.length > MAX_ROWS_PER_PAGE ? [`Showing ${MAX_ROWS_PER_PAGE} of ${state.tasks.length}.`] : [])];
}

function renderQueue(state = {}) {
  const queue = (state.queueItems ?? []).filter((item) => ["READY", "RUNNING", "WAITING_APPROVAL", "WAITING_DEPENDENCY", "WAITING_CONFLICT", "BLOCKED"].includes(item.QueueState)).slice(0, MAX_ROWS_PER_PAGE);
  if (!queue.length) return [header("Queue"), "No queued work recorded."];
  return [header("Queue"), ...queue.map((item) => `${oneLine(item.Priority, 8)} · ${oneLine(item.TaskId, 80)} · ${oneLine(item.QueueState, 30)}\n  ${oneLine(item.WaitingReason ?? item.BlockReasonCodes?.[0] ?? "eligible", 100)} · ${oneLine(item.ImplementerModel, 60)}`)];
}

function renderBlockers(state = {}) {
  const blockers = state.blockers ?? state.operatorSummary?.Blockers ?? [];
  if (!blockers.length) return [header("Blockers"), "No blockers recorded."];
  return [header("Blockers"), ...blockers.slice(0, MAX_ROWS_PER_PAGE).map((blocker) => `• ${oneLine(typeof blocker === "string" ? blocker : blocker.code, 120)} → ${oneLine(typeof blocker === "string" ? state.requiredHumanAction ?? "MANUAL_INTERVENTION" : blocker.requiredHumanAction, 80)}`)];
}

function renderApprovals(state = {}) {
  const approvals = (state.approvals ?? []).filter((approval) => ["PENDING", "APPROVED", "EXPIRED", "INVALIDATED", "REJECTED", "REVOKED"].includes(approval.ApprovalState)).slice(0, MAX_ROWS_PER_PAGE);
  if (!approvals.length) return [header("Approvals"), "No approval records available.", "Approval actions are read-only in H8."];
  return [header("Approvals"), ...approvals.map((approval) => `${oneLine(approval.TaskId, 80)} · ${oneLine(approval.ApprovalState, 30)} · risk=${oneLine(approval.ApprovedRisk, 20)}\n  ${oneLine(approval.ApprovedWorkspace, 120)} · ${oneLine(approval.ApprovedBranch, 80)} · HEAD ${short(approval.ApprovedHead)}\n  fingerprint=${short(approval.InputFingerprint, 10)} · expires=${oneLine(approval.ExpiresAt, 40)} · action=${approval.ApprovalState === "PENDING" ? "APPROVE" : "NONE"}`), "Approval actions are read-only in H8."];
}

function renderProject(state = {}) {
  const p = state.projectContext ?? {};
  return [header("Project"), row("Project", p.ProjectName), row("Canonical", p.CanonicalWorkspace), row("Hermes worktree", p.ActiveWorkspace), row("Role", p.WorkspaceRole), row("Branch", p.Branch), row("HEAD", p.HeadSha), row("origin/main", p.OriginMainSha), row("Ahead/behind", `${p.AheadCount ?? "UNKNOWN"}/${p.BehindCount ?? "UNKNOWN"}`), row("Tree", `${p.WorkingTreeState} · staged ${p.StagedCount ?? "UNKNOWN"}`), row("Remote", p.RemoteFreshness), row("Streams", `${p.DevelopmentStream?.PrimaryDevelopmentStream ?? "CRM"} primary / ${p.DevelopmentStream?.SecondaryDevelopmentStream ?? "HERMES"} secondary`), row("Protection", "CRM canonical workspace is read-only")];
}

function renderAgents(state = {}) {
  const agents = state.agents ?? {};
  return [header("Agents"), row("Codex", `${agents.Codex?.provider ?? "OpenAI Codex"} / ${agents.Codex?.model ?? "GPT-5.6 Luna"} · ${agents.Codex?.status ?? "NOT_RECORDED"}`), row("Claude", `${agents.Claude?.provider ?? "Anthropic"} / ${agents.Claude?.model ?? "Claude Sonnet 5"} · ${agents.Claude?.status ?? "NOT_RECORDED"}`), "DeepSeek: inactive"];
}

function renderTask(state, taskId, audit = false) {
  const task = (state.tasks ?? []).find((item) => item.TaskId === taskId) ?? (state.task?.TaskId === taskId ? state.task : null);
  if (!task) return [header(audit ? "Audit" : "Task"), "Task not found or not visible."];
  const evidence = audit ? (state.auditByTask?.[taskId] ?? state.operatorEvidence) : null;
  const lines = [header(audit ? "Audit" : "Task"), row("Task", task.TaskId), row("Title", task.Title ?? task.Description), row("Intent", task.IntentSummary), row("Domain", task.Domain), row("Risk", task.Risk), row("Workspace", task.Workspace), row("Branch", task.Branch), row("Allowed", list(task.AllowedScope, 3).join(", ")), row("Protected", list(task.ProtectedScope, 3).join(", ")), row("Dependencies", list(task.Dependencies, 3).join(", ") || "NONE"), row("Conflicts", list(task.Conflicts, 3).join(", ") || "NONE"), row("Decision", task.DecisionStatus), row("Approval", task.ApprovalStatus), row("Implementer", `${task.ImplementerProvider ?? "UNKNOWN"} / ${task.ImplementerModel ?? "UNKNOWN"}`), row("Reviewer", `${task.ReviewerProvider ?? "UNKNOWN"} / ${task.ReviewerModel ?? "UNKNOWN"}`), row("Execution", task.ExecutionStatus), row("Repair", `${task.RepairAttempts ?? 0}/2`), row("Review", task.ReviewStatus), row("Action", task.RequiredHumanAction ?? "MANUAL_INTERVENTION"), row("Blockers", list(task.Blockers, 3).join(", ") || "NONE")];
  if (evidence) lines.push(row("Evidence digest", evidence.ExportDigest ?? evidence.ExportDigestShort), row("Final state", evidence.FinalState ?? evidence.EvidenceStatus));
  return lines;
}

export function renderOperatorCommand(parsed, state = {}) {
  if (!parsed?.ok) return boundedMessage([...renderHelp(), `\nUnsupported request: ${parsed?.reason ?? "UNKNOWN_COMMAND"}`]);
  let lines;
  switch (parsed.command) {
    case "help": lines = renderHelp(); break;
    case "status": lines = renderStatus(state); break;
    case "tasks": lines = renderTasks(state); break;
    case "task": lines = renderTask(state, parsed.taskId); break;
    case "queue": lines = renderQueue(state); break;
    case "blockers": lines = renderBlockers(state); break;
    case "approvals": lines = renderApprovals(state); break;
    case "runs": lines = [header("Runs"), ...(state.runs ?? []).slice(0, MAX_ROWS_PER_PAGE).map((run) => `${oneLine(run.name, 80)} · ${oneLine(run.status, 40)} · ${oneLine(run.updatedAt, 40)}`)]; break;
    case "agents": lines = renderAgents(state); break;
    case "project": lines = renderProject(state); break;
    case "audit": lines = renderTask(state, parsed.taskId, true); break;
    default: lines = renderHelp();
  }
  return boundedMessage(lines);
}

export function notificationKey(event) { return createHash("sha256").update(`${event.TaskId ?? ""}|${event.Type ?? ""}|${event.Timestamp ?? ""}|${event.Attempt ?? ""}`, "utf8").digest("hex").slice(0, 16); }

export function selectOperatorNotifications(events = [], existingKeys = []) {
  const seen = new Set(existingKeys);
  const selected = [];
  for (const event of events) {
    if (!NOTIFIABLE_EVENTS.has(event?.Type) || event.Type === "HEARTBEAT") continue;
    const key = notificationKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ NotificationId: `notification-${randomUUID()}`, DeduplicationKey: key, TaskId: bounded(event.TaskId, 128), Type: event.Type, Timestamp: event.Timestamp ?? null, Summary: oneLine(event.Summary ?? event.Type, 240), RequiredHumanAction: REQUIRED_HUMAN_ACTIONS.includes(event.RequiredHumanAction) ? event.RequiredHumanAction : "MANUAL_INTERVENTION" });
  }
  return selected;
}

function notificationPaths(root) { const directory = join(root, ".ai", "hermes-notifications"); return { directory, latest: join(directory, "notifications.json"), history: join(directory, "events.jsonl") }; }
async function readLines(path) { try { return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } }

export async function recordOperatorNotifications(root, events = []) {
  const paths = notificationPaths(root);
  await mkdir(paths.directory, { recursive: true });
  const existing = await readLines(paths.history);
  const additions = selectOperatorNotifications(events, existing.map((event) => event.DeduplicationKey));
  if (additions.length) await writeFile(paths.history, `${additions.map((event) => JSON.stringify(event)).join("\n")}\n`, { encoding: "utf8", flag: "a" });
  const all = [...existing, ...additions].slice(-500);
  const temp = `${paths.latest}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify({ Events: all, UpdatedAt: new Date().toISOString() }, null, 2), "utf8");
  await rename(temp, paths.latest);
  return additions;
}

export async function readOperatorNotifications(root) { return readLines(notificationPaths(root).history); }
