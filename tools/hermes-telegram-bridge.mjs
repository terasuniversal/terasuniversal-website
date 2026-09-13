import { authorizeOperator, parseOperatorCommand, renderOperatorCommand } from "./hermes-telegram.mjs";
import { HERMES_WORKSPACE, readHermesState } from "./hermes-gateway.mjs";

export { HERMES_WORKSPACE };

export const TERAS_PROJECT_ID = "TERAS_UNIVERSAL_HERMES";
export const CRM_WORKSPACE = "D:\\Projects\\terasuniversal-website-clean";
export const READ_ONLY_COMMANDS = new Set(["help", "status", "project", "tasks", "queue"]);
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const normalizePath = (value) => String(value ?? "").replaceAll("/", "\\").replace(/[\\]+$/, "").toLowerCase();
const samePath = (left, right) => normalizePath(left) === normalizePath(right);
const bounded = (value, max = 240) => String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, max);

export function validateTerasProjectBinding({ projectId = TERAS_PROJECT_ID, projectRoot = HERMES_WORKSPACE, workspaceRole = "ISOLATED_HERMES" } = {}) {
  if (projectId !== TERAS_PROJECT_ID || workspaceRole !== "ISOLATED_HERMES" || !samePath(projectRoot, HERMES_WORKSPACE)) return { allowed: false, code: "PROJECT_BINDING_MISMATCH", reason: "TERAS operator binding must target the isolated Hermes worktree." };
  if (samePath(projectRoot, CRM_WORKSPACE)) return { allowed: false, code: "CRM_WORKSPACE_BLOCKED", reason: "The CRM canonical workspace is never an H8 operator state source." };
  return { allowed: true, code: null, reason: "TERAS isolated Hermes binding is valid." };
}

export function validateLoopbackBinding({ host = "127.0.0.1" } = {}) {
  return LOOPBACK_HOSTS.has(String(host).toLowerCase()) ? { allowed: true, code: null } : { allowed: false, code: "LOOPBACK_REQUIRED", reason: "The TERAS operator bridge is loopback-only." };
}

export function normalizeReadOnlyState(state = {}) {
  const task = state.task ?? null;
  const taskSummary = task ? {
    TaskId: task.TaskId, Title: task.Description, IntentSummary: state.taskIntent?.RequestedOutcome, Domain: state.taskIntent?.Domain ?? "UNKNOWN", Risk: state.taskIntent?.Risk ?? task.Risk,
    Workspace: state.projectContext?.ActiveWorkspace, Branch: state.projectContext?.Branch, AllowedScope: state.taskIntent?.AllowedPathFamilies, ProtectedScope: state.taskIntent?.ProtectedPathFamilies,
    Dependencies: state.taskIntent?.Dependencies ?? [], Conflicts: state.taskIntent?.Conflicts ?? [], DecisionStatus: state.operatorSummary?.DecisionStatus ?? state.lastDecision?.Decision,
    ApprovalStatus: state.operatorSummary?.ApprovalStatus ?? state.approval?.ApprovalState, ImplementerProvider: state.taskIntent?.ImplementerProvider, ImplementerModel: state.taskIntent?.ImplementerModel,
    ReviewerProvider: state.taskIntent?.ReviewerProvider, ReviewerModel: state.taskIntent?.ReviewerModel, ExecutionStatus: task.ExecutionStatus ?? "NOT_STARTED", RepairAttempts: task.RepairCyclesUsed ?? 0,
    ReviewStatus: task.ClaudeReviewStatus ?? "NOT_STARTED", RequiredHumanAction: state.operatorSummary?.RequiredHumanAction ?? "MANUAL_INTERVENTION", Blockers: state.operatorSummary?.Blockers ?? [],
  } : null;
  return {
    gatewayStatus: "AVAILABLE", projectContext: state.projectContext, tasks: taskSummary ? [taskSummary] : [], task: taskSummary, queueItems: state.queue ? [state.queue] : [],
    blockers: state.operatorSummary?.Blockers ?? state.projectContext?.Blockers ?? [], requiredHumanAction: state.operatorSummary?.RequiredHumanAction ?? "NONE",
    approvals: state.approval ? [{ ...state.approval, TaskId: task?.TaskId }] : [], agents: {
      Codex: { provider: "OpenAI Codex", model: "GPT-5.6 Luna", status: "CONFIGURED" },
      Claude: { provider: "Anthropic", model: "Claude Sonnet 5", status: "CONFIGURED" },
    }, operatorEvidence: state.operatorEvidence, auditByTask: task ? { [task.TaskId]: state.auditExport } : {}, runs: [],
  };
}

export function createTerasReadOnlyBridge({ projectId = TERAS_PROJECT_ID, projectRoot = HERMES_WORKSPACE, workspaceRole = "ISOLATED_HERMES", host = "127.0.0.1", readState = readHermesState } = {}) {
  const projectBinding = validateTerasProjectBinding({ projectId, projectRoot, workspaceRole });
  const networkBinding = validateLoopbackBinding({ host });
  return {
    projectBinding, networkBinding,
    async handle({ text = "", senderId, chatId, chatType = "private", authorizedUserIds = [], authorizedChatIds = [] } = {}) {
      if (!projectBinding.allowed) return { ok: false, code: projectBinding.code, message: "PROJECT_BINDING_MISMATCH" };
      if (!networkBinding.allowed) return { ok: false, code: networkBinding.code, message: "TERAS_OPERATOR_UNAVAILABLE" };
      const parsed = parseOperatorCommand(text);
      if (!parsed.ok || !READ_ONLY_COMMANDS.has(parsed.command)) return { ok: false, code: "UNSUPPORTED_TERAS_COMMAND", message: "Unsupported TERAS read-only command." };
      if (chatType !== "private" && !authorizedChatIds.map(String).includes(String(chatId))) return { ok: false, code: "UNAUTHORIZED_OPERATOR", message: "UNAUTHORIZED_OPERATOR" };
      const authorization = authorizeOperator({ senderId, chatId, allowedUserIds: authorizedUserIds, allowedChatIds: authorizedChatIds });
      if (!authorization.allowed) return { ok: false, code: "UNAUTHORIZED_OPERATOR", message: "UNAUTHORIZED_OPERATOR" };
      let state;
      try { state = normalizeReadOnlyState(await readState()); } catch { return { ok: false, code: "STATE_UNAVAILABLE", message: "STATE_UNAVAILABLE" }; }
      try { return { ok: true, code: "OK", command: parsed.command, message: bounded(renderOperatorCommand(parsed, state), 3800) }; } catch { return { ok: false, code: "TERAS_OPERATOR_UNAVAILABLE", message: "TERAS_OPERATOR_UNAVAILABLE" }; }
    },
  };
}
