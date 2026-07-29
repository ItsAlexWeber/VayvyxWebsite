import type { MailAccountSummary, MailboxAccessRole } from "../../types/mail.ts";

const roleRank: Record<MailboxAccessRole | "admin", number> = {
  viewer: 1,
  sender: 2,
  manager: 3,
  owner: 4,
  admin: 5,
};

export function canUseRole(
  account: MailAccountSummary | null,
  required: MailboxAccessRole
) {
  if (!account) return false;
  return roleRank[account.currentUserRole] >= roleRank[required];
}

export function formatMailDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function addressLabel(name: string | null, address: string) {
  return name ? `${name} <${address}>` : address;
}
