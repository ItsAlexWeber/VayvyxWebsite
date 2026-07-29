import { Inbox, Mail, Settings } from "lucide-react";
import type { MailAccountSummary } from "../../types/mail.ts";

type Props = {
  accounts: MailAccountSummary[];
  selectedId: string | null;
  isUnified: boolean;
  onSelectUnified: () => void;
  onSelectAccount: (account: MailAccountSummary) => void;
  onSettings?: () => void;
};

export function MailAccountSwitcher({
  accounts,
  selectedId,
  isUnified,
  onSelectUnified,
  onSelectAccount,
  onSettings,
}: Props) {
  return (
    <section className="mail-sidebar-section" aria-label="Mailboxes">
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
            <em>{account.currentUserRole}</em>
          </button>
        ))}
      </div>

      {onSettings && (
        <button className="mail-nav-item subtle" type="button" onClick={onSettings}>
          <Settings size={17} />
          <span>
            <strong>Mail settings</strong>
            <small>Company mailboxes</small>
          </span>
        </button>
      )}
    </section>
  );
}
