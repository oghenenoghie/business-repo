import type { PoolClient } from "pg";

export interface AuditEventInput {
  orgId: string;
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/** Every mutation writes one of these, in the same transaction as the mutation itself. */
export async function writeAuditEvent(client: PoolClient, event: AuditEventInput): Promise<void> {
  await client.query(
    `insert into audit_events (org_id, actor_id, action, target_type, target_id, metadata)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      event.orgId,
      event.actorId,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}
