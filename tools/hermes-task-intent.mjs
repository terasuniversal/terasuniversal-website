import { CANONICAL_WORKSPACE, HERMES_WORKSPACE } from "./hermes-project-config.mjs";

export const CRM_WORKSPACE = CANONICAL_WORKSPACE;
export { HERMES_WORKSPACE };

const ROUTING = {
  codexProvider: "OpenAI Codex",
  codexModel: "GPT-5.6 Luna",
  claudeProvider: "Anthropic",
  claudeModel: "Claude Sonnet 5",
};

export const PROTECTED_PATH_FAMILIES = [
  "app/**", "components/**", "lib/**", "app/admin/**", "supabase/**",
  "public registration source", "staging", "production", "Vercel", "ToyyibPay", "Telegram runtime",
];

const MIXED_PATH_FAMILIES = [
  "AGENTS.md", "CLAUDE.md", "tools/db-runner.ps1", "tools/qa-runner.ps1", "tools/release-runner.ps1",
  "tools/push-runner.ps1", "tools/pr-runner.ps1", "package.json", "package-lock.json",
];

const HERMES_PATH_FAMILIES = ["tools/hermes-*.mjs", "tools/agent-*.ps1", "tools/*-runner.ps1", ".ai/MODEL_ROUTING.md", ".ai/ROUTING_RULES.md", ".ai/USAGE_POLICY.md", "docs/hermes-*.md"];

const includesAny = (text, values) => values.some((value) => text.includes(value));
const unique = (values) => [...new Set(values.filter(Boolean))];

function routeForRisk(risk) {
  return ["HIGH", "CRITICAL"].includes(risk)
    ? { Implementer: "Claude Code", ImplementerProvider: ROUTING.claudeProvider, ImplementerModel: ROUTING.claudeModel, Reviewer: "Human / Claude Code", ReviewerProvider: ROUTING.claudeProvider, ReviewerModel: ROUTING.claudeModel }
    : { Implementer: "Codex", ImplementerProvider: ROUTING.codexProvider, ImplementerModel: ROUTING.codexModel, Reviewer: "Claude Code", ReviewerProvider: ROUTING.claudeProvider, ReviewerModel: ROUTING.claudeModel };
}

export function classifyTaskDomain(description = "") {
  const text = String(description).toLowerCase();
  if (includesAny(text, ["production deploy", "deploy to vercel", "release to production", "merge and deploy"])) return "DEPLOYMENT";
  if (includesAny(text, ["migration", "supabase schema", "rls policy", "database schema", "database table", "alter table", "create table", "drop table"])) return "DATABASE_MIGRATION";
  if (includesAny(text, ["database", "supabase"]) && includesAny(text, ["read", "inspect", "status", "audit"])) return "DATABASE_READONLY";
  if (includesAny(text, ["public registration", "registration form", "public signup"])) return "PUBLIC_REGISTRATION";
  if (includesAny(text, ["certificate", "attendance certificate"])) return "CRM_CERTIFICATES";
  if (includesAny(text, ["schedule", "calendar", "booking schedule"])) return "CRM_SCHEDULES";
  if (includesAny(text, ["participant", "attendee", "member record"])) return "CRM_PARTICIPANTS";
  if (includesAny(text, ["sales", "lead", "pipeline", "deal"])) return "CRM_SALES";
  if (includesAny(text, ["marketing", "campaign", "campaigns"])) return "CRM_MARKETING";
  if (includesAny(text, ["security", "authentication", "authorization", "credential", "secret", "token"])) return "SECURITY";
  if (includesAny(text, ["hermes", "agent router", "model routing", "codex", "claude", "deepseek"])) {
    if (includesAny(text, ["mcp", "gateway", "tool registry"])) return "HERMES_MCP";
    if (includesAny(text, ["lease", "heartbeat", "crash", "restart", "reliability", "supervision"])) return "HERMES_RELIABILITY";
    if (includesAny(text, ["routing", "model", "provider"])) return "HERMES_ROUTING";
    return "HERMES_TOOLING";
  }
  if (includesAny(text, ["website", "landing page", "public page", "frontend", "ui"])) return "WEBSITE_PUBLIC";
  return "UNKNOWN";
}

export function classifyOperation(description = "") {
  const text = String(description).toLowerCase();
  if (includesAny(text, ["deploy", "release", "publish"])) return "DEPLOYMENT";
  if (includesAny(text, ["migration", "alter table", "create table", "drop table", "rls policy"])) return "DATABASE_CHANGE";
  if (includesAny(text, ["auth", "authorization", "credential", "secret", "token", "permission"])) return "SECURITY_CHANGE";
  if (includesAny(text, ["run tests", "test only", "validate", "verification"])) return "TEST_ONLY";
  if (includesAny(text, ["read", "inspect", "audit", "status", "report"]) && !includesAny(text, ["change", "edit", "modify", "build"])) return "READ_ONLY";
  if (includesAny(text, ["config", "configuration", "environment variable"])) return "CONFIG_CHANGE";
  if (includesAny(text, ["run agent", "start process", "runtime", "supervise", "execute"])) return "RUNTIME_CONTROL";
  if (includesAny(text, ["edit", "fix", "implement", "add", "update", "refactor", "build"])) return "SOURCE_EDIT";
  return "UNKNOWN";
}

function inferPathFamilies(text, domain, operation) {
  const paths = [];
  if (domain.startsWith("HERMES_")) paths.push(...HERMES_PATH_FAMILIES);
  if (domain.startsWith("CRM_") || domain === "PUBLIC_REGISTRATION" || domain === "WEBSITE_PUBLIC") paths.push("app/**", "components/**", "lib/**");
  if (["DATABASE_MIGRATION", "DATABASE_READONLY"].includes(domain)) paths.push("supabase/**");
  if (domain === "DEPLOYMENT") paths.push("Vercel", "production");
  if (includesAny(text, MIXED_PATH_FAMILIES.map((value) => value.toLowerCase()))) paths.push(...MIXED_PATH_FAMILIES);
  if (operation === "DATABASE_CHANGE") paths.push("supabase/**");
  for (const family of PROTECTED_PATH_FAMILIES) {
    const marker = family.replace("/**", "").toLowerCase();
    if (text.includes(marker)) paths.push(family);
  }
  return unique(paths);
}

function determineRisk({ domain, operation, text, protectedPaths, mixedOwnership, crossStream }) {
  const reasons = [];
  if (includesAny(text, ["production", "destructive", "drop ", "credential", "secret", "arbitrary shell", "bypass approval"])) { reasons.push("irreversible or security boundary language"); return { risk: "CRITICAL", reasons }; }
  if (["DATABASE_MIGRATION", "DEPLOYMENT", "SECURITY"].includes(domain) || operation === "DATABASE_CHANGE" || operation === "DEPLOYMENT" || operation === "SECURITY_CHANGE") reasons.push("protected operational boundary");
  if (operation === "RUNTIME_CONTROL" || domain === "HERMES_RELIABILITY") reasons.push("process supervision or runtime behavior");
  if (mixedOwnership) reasons.push("mixed/shared ownership");
  if (crossStream) reasons.push("cross-development-stream scope");
  if (protectedPaths.length) reasons.push("protected path family implicated");
  if (reasons.length) return { risk: "HIGH", reasons };
  if (["READ_ONLY", "TEST_ONLY"].includes(operation)) return { risk: "LOW", reasons: [operation === "READ_ONLY" ? "read-only inspection" : "bounded validation"] };
  if (["HERMES_ROUTING", "HERMES_MCP", "HERMES_RELIABILITY"].includes(domain) || operation === "CONFIG_CHANGE" || operation === "SOURCE_EDIT") return { risk: "MEDIUM", reasons: reasons.length ? reasons : ["runtime or source behavior change"] };
  return { risk: "LOW", reasons: reasons.length ? reasons : [operation === "READ_ONLY" ? "read-only inspection" : "bounded low-impact task"] };
}

export function analyzeTaskIntent({ taskId = null, title = null, description = "", projectId = "teras-universal-website", projectContext = null, existingTask = null, createdAt = new Date().toISOString() } = {}) {
  const text = String(description).toLowerCase();
  const domain = classifyTaskDomain(description);
  const operationType = classifyOperation(description);
  const mentionsHermes = includesAny(text, ["hermes", "agent router", "mcp gateway", "codex", "claude", "deepseek"]);
  const mentionsCrm = includesAny(text, ["crm", "sales", "marketing", "participant", "schedule", "certificate", "registration", "website"]);
  const crossStream = mentionsHermes && mentionsCrm;
  const expectedTouchedPaths = inferPathFamilies(text, domain, operationType);
  const protectedPaths = unique(expectedTouchedPaths.filter((path) => PROTECTED_PATH_FAMILIES.some((family) => path.toLowerCase().startsWith(family.toLowerCase().replace("/**", "")) || family.toLowerCase().includes(path.toLowerCase()))));
  const mixedOwnership = expectedTouchedPaths.some((path) => MIXED_PATH_FAMILIES.includes(path));
  const riskInfo = determineRisk({ domain, operation: operationType, text, protectedPaths, mixedOwnership, crossStream });
  const decompositionReasons = [];
  if (crossStream) decompositionReasons.push("multiple development streams");
  if (operationType === "DEPLOYMENT" && (operationType === "SOURCE_EDIT" || mentionsHermes || mentionsCrm)) decompositionReasons.push("source work combined with deployment");
  if (includesAny(text, ["and deploy", "and migrate", "then deploy", "plus crm", "and sales"])) decompositionReasons.push("independent operational scope");
  if (mixedOwnership) decompositionReasons.push("shared or mixed-ownership paths");
  if (domain === "UNKNOWN" && operationType !== "READ_ONLY") decompositionReasons.push("unknown mutating intent");
  const decompositionRequired = decompositionReasons.length > 0;
  const routing = routeForRisk(riskInfo.risk);
  const suggestedWorkspace = domain.startsWith("HERMES_") ? HERMES_WORKSPACE : domain === "UNKNOWN" ? null : CRM_WORKSPACE;
  const workspaceRole = suggestedWorkspace === HERMES_WORKSPACE ? "ISOLATED_HERMES" : suggestedWorkspace === CRM_WORKSPACE ? "CANONICAL_ACTIVE" : "UNKNOWN";
  const dependencyMatch = text.match(/(?:depends on|requires|after)(?:\s+task)?\s+([a-z0-9._:-]{1,128})/i);
  const dependencies = dependencyMatch ? [{ Type: text.includes("after") ? "REVIEW_AFTER" : "REQUIRES", TaskId: dependencyMatch[1] }] : [];
  const blockers = [];
  if (domain === "UNKNOWN" && operationType !== "READ_ONLY") blockers.push("UNKNOWN_MUTATING_INTENT");
  if (crossStream) blockers.push("BLOCKED_CROSS_STREAM");
  if (protectedPaths.length && domain.startsWith("HERMES_")) blockers.push("PROTECTED_SCOPE_OUTSIDE_HERMES");
  if (decompositionRequired) blockers.push("DECOMPOSITION_REQUIRED");
  const subtasks = crossStream ? [
    { SubtaskId: `${taskId ?? "task"}-hermes`, ParentTaskId: taskId, Title: "Hermes isolated work", Domain: "HERMES_TOOLING", Risk: "MEDIUM", Workspace: HERMES_WORKSPACE, AllowedPaths: HERMES_PATH_FAMILIES, Dependencies: [], Implementer: "Codex", Reviewer: "Claude Code", ApprovalRequired: false, ValidationGate: ["Hermes tests", "gateway regression", "git diff --check"], ExecutionOrder: 1, Status: "PLANNED" },
    { SubtaskId: `${taskId ?? "task"}-crm`, ParentTaskId: taskId, Title: "CRM work", Domain: "CRM_SALES", Risk: "HIGH", Workspace: CRM_WORKSPACE, AllowedPaths: ["CRM-approved paths only"], Dependencies: [], Implementer: "Claude Code", Reviewer: "Human / Claude Code", ApprovalRequired: true, ValidationGate: ["scope review", "targeted validation"], ExecutionOrder: 2, Status: "BLOCKED_UNTIL_SEPARATE_APPROVAL" },
  ] : [];
  return {
    TaskId: taskId, Title: title ?? String(description).slice(0, 120), Intent: "BOUNDED_TASK_ANALYSIS", Domain: domain, ProjectId: projectId,
    ExpectedHeadSha: existingTask?.ExpectedHeadSha ?? null,
    DevelopmentStream: domain.startsWith("HERMES_") ? "HERMES" : domain === "UNKNOWN" ? "UNKNOWN" : "CRM",
    RequestedOutcome: String(description).slice(0, 4000), OperationType: operationType, Risk: riskInfo.risk, RiskReasons: riskInfo.reasons,
    SuggestedWorkspace: suggestedWorkspace, WorkspaceRole: workspaceRole, AllowedPathFamilies: domain.startsWith("HERMES_") ? HERMES_PATH_FAMILIES : [], ProtectedPathFamilies: PROTECTED_PATH_FAMILIES,
    ExpectedTouchedPaths: expectedTouchedPaths, CrossStreamDependencies: crossStream, Dependencies: dependencies, Conflicts: [], RequiresHumanApproval: ["HIGH", "CRITICAL"].includes(riskInfo.risk) || mixedOwnership,
    ...routing, ExecutionMode: decompositionRequired || blockers.length ? "PLAN_ONLY" : "SUPERVISED", ValidationRequirements: domain === "HERMES_RELIABILITY" ? ["lease tests", "crash/restart tests", "gateway tests"] : domain.startsWith("HERMES_") ? ["routing tests", "gateway regression", "git diff --check"] : operationType === "DATABASE_CHANGE" ? ["migration preflight", "disposable DB tests", "security review", "human approval"] : ["scope validation", "targeted tests", "git diff --check"],
    DecompositionRequired: decompositionRequired, Subtasks: subtasks, Warnings: unique([...(mixedOwnership ? ["MIXED_OWNERSHIP_REVIEW"] : []), ...(crossStream ? ["CROSS_STREAM_REVIEW"] : [])]), Blockers: unique(blockers), CreatedAt: createdAt,
    DependencyStatus: existingTask?.DependencyStatus ?? (dependencies.length ? "BLOCKED_BY_PREREQUISITE" : "READY"),
  };
}

export function analyzeTaskPlan(tasks = []) {
  const conflicts = [];
  for (let i = 0; i < tasks.length; i += 1) for (let j = i + 1; j < tasks.length; j += 1) {
    const left = tasks[i]; const right = tasks[j];
    const sameWorkspace = left.SuggestedWorkspace && left.SuggestedWorkspace === right.SuggestedWorkspace;
    const leftPaths = left.AllowedPathFamilies ?? []; const rightPaths = right.AllowedPathFamilies ?? [];
    const overlap = leftPaths.some((a) => rightPaths.some((b) => a === b || a === "tools/**" || b === "tools/**"));
    if ((sameWorkspace && overlap) || (sameWorkspace && left.Domain === right.Domain)) conflicts.push({ Type: "WRITE_CONFLICT", TaskIds: [left.TaskId, right.TaskId], Reason: "same workspace with overlapping domain or path scope" });
  }
  return { Conflicts: conflicts, Concurrent: conflicts.length === 0 && tasks.every((task) => task.CrossStreamDependencies !== true), Status: conflicts.length ? "BLOCKED" : "SAFE_TO_CONCURRENT" };
}

export function validateTaskIntentForAction(action, intent, { projectContext = null, task = null } = {}) {
  const blockers = [...(intent?.Blockers ?? [])];
  if (!intent || intent.Domain === "UNKNOWN") blockers.push("UNKNOWN_MUTATING_INTENT");
  if (intent?.DecompositionRequired) blockers.push("DECOMPOSITION_REQUIRED");
  if (intent?.DependencyStatus && intent.DependencyStatus !== "READY") blockers.push("DEPENDENCY_INCOMPLETE");
  if (intent?.Conflicts?.length) blockers.push("WRITE_CONFLICT");
  if (projectContext?.WorkspaceRole === "UNKNOWN") blockers.push("UNKNOWN_WORKSPACE_ROLE");
  if (task?.WorkspaceBoundary?.CanonicalWorkspace && projectContext?.ActiveWorkspace && task.WorkspaceBoundary.CanonicalWorkspace.toLowerCase() !== projectContext.ActiveWorkspace.toLowerCase()) blockers.push("TASK_WORKSPACE_MISMATCH");
  return { allowed: blockers.length === 0, status: blockers.length ? "BLOCKED" : "ALLOWED", blockers: unique(blockers), reason: blockers.length ? `H3 blocked ${action}: ${unique(blockers).join(", ")}` : `H3 intent checks passed for ${action}.` };
}
