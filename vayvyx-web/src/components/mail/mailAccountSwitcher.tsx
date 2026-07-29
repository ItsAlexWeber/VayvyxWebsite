import { Edit3, Inbox, Mail } from "lucide-react";
import type { MailAccountSummary } from "../../types/mail.ts";

type Props = {
  accounts: MailAccountSummary[];
  selectedId: string | null;
  isUnified: boolean;
  onSelectUnified: () => void;
  onSelectAccount: (account: MailAccountSummary) => void;
  canCompose: boolean;
  onCompose: () => void;
};

export function MailAccountSwitcher({
  accounts,
  selectedId,
  isUnified,
  onSelectUnified,
  onSelectAccount,
  canCompose,
  onCompose,
}: Props) {
  return (
    <section className="mail-sidebar-section" aria-label="Mailboxes">
      {canCompose && (
        <button className="mail-compose-nav-action" type="button" onClick={onCompose}>
          <Edit3 size={18} />
          <span>Compose</span>
        </button>
      )}

      <button
        className={`mail-nav-item ${isUnified ? "active" : ""}`}
        type="button"
        onClick={onSelectUnified}
      >
        <Inbox size={17} />
        <span>
          <strong>Unified Inbox</strong>
          <small>All assigned mailboxes</small>
        </span>
      </button>

      <div className="mail-account-list">
        {accounts.map((account) => (
          <button
            className={`mail-nav-item ${selectedId === account.id && !isUnified ? "active" : ""}`}
            key={account.id}
            type="button"
            onClick={() => onSelectAccount(account)}
          >
            <Mail size={17} />
            <span>
              <strong>{account.displayName}</strong>
              <small>{account.emailAddress}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
