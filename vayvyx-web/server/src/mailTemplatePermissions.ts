import { hasMailboxRole } from "./auth.js";
import type { MailTemplateScope } from "./mailTemplateTypes.js";
import type { MailboxAccessRole, PlatformRole } from "./types.js";

export type TemplatePermissionContext = {
  userId: string;
  platformRole: PlatformRole;
  mailboxRole: MailboxAccessRole | "admin" | null;
};

export type TemplatePermissionRow = {
  scope: MailTemplateScope;
  created_by: string | null;
  default_mail_account_id: string | null;
  is_active: boolean;
};

export function canReadTemplate(
  context: TemplatePermissionContext,
  row: TemplatePermissionRow
) {
  if (!row.is_active) return false;
  if (row.scope === "system") return true;
  if (row.scope === "personal") return row.created_by === context.userId;
  if (row.created_by === context.userId || context.platformRole === "admin") return true;
  return hasTemplateMailboxRole(context.mailboxRole, "viewer");
}

export function canEditTemplate(
  context: TemplatePermissionContext,
  row: TemplatePermissionRow
) {
  if (!row.is_active) return false;
  if (row.scope === "system") return context.platformRole === "admin";
  if (row.created_by === context.userId || context.platformRole === "admin") return true;
  if (row.scope !== "company") return false;
  return hasTemplateMailboxRole(context.mailboxRole, "manager");
}

function hasTemplateMailboxRole(
  actual: MailboxAccessRole | "admin" | null,
  required: MailboxAccessRole
) {
  if (actual === "admin") return true;
  return actual ? hasMailboxRole(actual, required) : false;
}
