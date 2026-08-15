import "server-only";

import { createSupabaseServerClient, createSupabaseServiceClient } from "../supabase/server";

type AuditEvent = {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Writes audit events through a service-only RPC after verifying the current
 * authenticated session. This module must remain server-only.
 */
export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  try {
    const sessionClient = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await sessionClient.auth.getUser();
    if (userError || !user) return;

    const { data: profile } = await sessionClient
      .from("profiles")
      .select("email")
      .eq("id", user.id)
      .maybeSingle();

    const serviceClient = createSupabaseServiceClient();
    const { error: rpcError } = await serviceClient.rpc("log_event_as_service", {
      p_actor_id: user.id,
      p_actor_email: profile?.email ?? user.email ?? null,
      p_action: event.action,
      p_entity_type: event.entityType ?? null,
      p_entity_id: event.entityId ?? null,
      p_summary: event.summary ?? null,
      p_metadata: event.metadata ?? {},
    });

    if (rpcError) {
      console.error("Audit event write failed", { message: rpcError.message });
    }
  } catch (error) {
    console.error("Audit event write failed", {
      message: error instanceof Error ? error.message : "Unknown audit error",
    });
  }
}
