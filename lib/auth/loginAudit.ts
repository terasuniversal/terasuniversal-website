export type LoginAuditClient = {
  rpc: (functionName: string, parameters: Record<string, unknown>) => Promise<{ error: unknown }>
};

export type LoginAuditInput = {
  serviceRoleKey: string;
  userId: string;
  userEmail: string;
  fallbackEmail: string;
  createServiceClient: () => LoginAuditClient;
  warn?: (message: string) => void;
  error?: (message: string, details: { userId: string }) => void;
};

/**
 * Login auditing is informational. Authentication and authorization have
 * already succeeded before this helper is called, so audit availability must
 * never turn a successful login into an application error.
 */
export async function writeLoginAudit({
  serviceRoleKey,
  userId,
  userEmail,
  fallbackEmail,
  createServiceClient,
  warn = () => undefined,
  error = () => undefined,
}: LoginAuditInput): Promise<void> {
  if (!serviceRoleKey) {
    warn("loginAction: login audit skipped because the service role is not configured");
    return;
  }

  try {
    const service = createServiceClient();
    const { error: auditError } = await service.rpc("log_event_as_service", {
      p_actor_id: userId,
      p_actor_email: userEmail || fallbackEmail,
      p_action: "login",
      p_entity_type: "auth",
      p_summary: "Admin sign-in",
    });
    if (auditError) error("loginAction: failed to write login audit event", { userId });
  } catch {
    // A missing/invalid audit configuration or RPC failure must not block login.
    error("loginAction: login audit failed", { userId });
  }
}