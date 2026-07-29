import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditAction } from "./types.js";

type AuditInput = {
  actorUserId: string;
  mailAccountId?: string | null;
  action: AuditAction;
  targetType: string;
  targetIdentifier?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
};

export class AuditLogger {
  constructor(private readonly admin: SupabaseClient) {}

  async record(input: AuditInput) {
    const { error } = await this.admin.from("mail_audit_log").insert({
      actor_user_id: input.actorUserId,
      mail_account_id: input.mailAccountId ?? null,
      action: input.action,
      target_type: input.targetType,
      target_identifier: input.targetIdentifier ?? null,
      metadata: input.metadata ?? {},
      ip_address: input.ipAddress ?? null,
    });

    if (error) {
      console.error("Unable to write mail audit event", {
        action: input.action,
        mailAccountId: input.mailAccountId,
      });
    }
  }
}
