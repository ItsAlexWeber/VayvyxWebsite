/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import type { MailAccountAdminSummary, MailAdminUserSearchResult, MailboxAccessRole } from "../../types/mail.ts";

type Props = {
  account: MailAccountAdminSummary;
  onSearchUsers: (query: string) => Promise<MailAdminUserSearchResult[]>;
  onAdd: (userId: string, role: MailboxAccessRole) => Promise<void>;
  onUpdate: (userId: string, role: MailboxAccessRole) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
};

const roles: MailboxAccessRole[] = ["viewer", "sender", "manager", "owner"];

export function MailMemberAccessPanel({ account, onSearchUsers, onAdd, onUpdate, onRemove }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MailAdminUserSearchResult[]>([]);
  const [role, setRole] = useState<MailboxAccessRole>("viewer");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      onSearchUsers(query).then(setResults).catch((error) => setStatus(error.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [onSearchUsers, query]);

  return (
    <div className="mail-admin-panel">
      <h3>Mailbox access</h3>
      <div className="mail-member-list">
        {(account.members ?? []).map((member) => (
          <div className="mail-member-row" key={member.userId}>
            <span>{member.userId}</span>
            <select value={member.accessRole} onChange={(event) => {
              const nextRole = event.target.value as MailboxAccessRole;
              if (nextRole !== member.accessRole && window.confirm("Change this member's role?")) {
                onUpdate(member.userId, nextRole).catch((error) => setStatus(error.message));
              }
            }}>
              {roles.map((item) => <option key={item}>{item}</option>)}
            </select>
            <button type="button" onClick={() => {
              if (window.confirm("Remove this member?")) {
                onRemove(member.userId).catch((error) => setStatus(error.message));
              }
            }}>Remove</button>
          </div>
        ))}
      </div>
      <label>
        Find user
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search email" />
      </label>
      <select value={role} onChange={(event) => setRole(event.target.value as MailboxAccessRole)}>
        {roles.map((item) => <option key={item}>{item}</option>)}
      </select>
      <div className="mail-user-results">
        {results.map((user) => (
          <button key={user.id} type="button" onClick={() => onAdd(user.id, role).catch((error) => setStatus(error.message))}>
            {user.email}
          </button>
        ))}
      </div>
      {status && <p className="mail-status" aria-live="polite">{status}</p>}
    </div>
  );
}
