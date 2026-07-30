/* eslint-disable react-hooks/set-state-in-effect */
import {
  ArrowLeft,
  Mail,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { NavigateWithTransition } from "../app.tsx";
import { accessApi } from "../lib/accessApi.ts";
import { mailApi, MailApiRequestError } from "../lib/mailApi.ts";
import type {
  AccessMailboxOption,
  AccessPersonDetail,
  AccessPersonSummary,
  AccessType,
  AccountStatus,
  InvitePersonInput,
  PlatformRole,
} from "../types/access.ts";
import type { MailboxAccessRole } from "../types/mail.ts";
import type {
  MailTemplateDetail,
  MailTemplateRendered,
  MailTemplateSummary,
} from "../types/mail.ts";
import "../styles/accessAdminPage.css";

type Props = {
  onNavigate: NavigateWithTransition;
};

const roleLabels: Record<PlatformRole, string> = {
  user: "User",
  admin: "Admin",
};

const accessTypeLabels: Record<AccessType, string> = {
  beta: "Private beta",
  licensed: "Licensed",
  mail_only: "Mail only",
  none: "No app access",
};

const mailboxRoleLabels: Record<MailboxAccessRole, string> = {
  viewer: "Viewer: read messages",
  sender: "Sender: read and send",
  manager: "Manager: organize and manage access where permitted",
  owner: "Owner: full mailbox administration",
};

const blankInvite: InvitePersonInput = {
  email: "",
  fullName: "",
  platformRole: "user",
  accessType: "beta",
  accessExpiresAt: null,
  mailboxAssignments: [],
  adminNotes: null,
};

export function AccessAdminPage({ onNavigate }: Props) {
  const [people, setPeople] = useState<AccessPersonSummary[]>([]);
  const [mailboxes, setMailboxes] = useState<AccessMailboxOption[]>([]);
  const [authTemplates, setAuthTemplates] = useState<MailTemplateSummary[]>([]);
  const [selectedAuthTemplate, setSelectedAuthTemplate] =
    useState<MailTemplateDetail | null>(null);
  const [authTemplateDraft, setAuthTemplateDraft] =
    useState<MailTemplateDetail | null>(null);
  const [authTemplatePreview, setAuthTemplatePreview] =
    useState<MailTemplateRendered | null>(null);
  const [authTemplateTestEmail, setAuthTemplateTestEmail] = useState("");
  const [selected, setSelected] = useState<AccessPersonDetail | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AccountStatus | "all">("all");
  const [platformRole, setPlatformRole] = useState<PlatformRole | "all">("all");
  const [accessType, setAccessType] = useState<AccessType | "all">("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(blankInvite);
  const [selectedInviteMailbox, setSelectedInviteMailbox] = useState("");
  const [selectedInviteRole, setSelectedInviteRole] =
    useState<MailboxAccessRole>("viewer");
  const [selectedMailbox, setSelectedMailbox] = useState("");
  const [selectedMailboxRole, setSelectedMailboxRole] =
    useState<MailboxAccessRole>("viewer");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const activeMailboxes = useMemo(
    () => mailboxes.filter((mailbox) => mailbox.isActive),
    [mailboxes],
  );

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [peopleResult, mailboxResult] = await Promise.all([
        accessApi.listPeople({
          search,
          status,
          platformRole,
          accessType,
        }),
        accessApi.listMailboxes(),
      ]);
      setPeople(peopleResult);
      setMailboxes(mailboxResult);
      const templates = await mailApi.getTemplates({ scope: "system" }).catch(() => []);
      setAuthTemplates(templates.filter((template) => template.systemKey?.startsWith("auth_")));
    } catch (error) {
      if (error instanceof MailApiRequestError && error.code === "AUTH_REQUIRED") {
        onNavigate("/login");
      } else if (error instanceof MailApiRequestError && error.code === "ACCESS_DENIED") {
        setMessage("You do not have permission to manage access.");
      } else if (
        error instanceof MailApiRequestError &&
        (error.code === "ACCESS_DISABLED" || error.code === "ACCESS_EXPIRED")
      ) {
        setMessage("Your Vayvyx access is unavailable. Contact support.");
      } else {
        setMessage("Access management is temporarily unavailable.");
      }
    } finally {
      setLoading(false);
    }
  }, [accessType, onNavigate, platformRole, search, status]);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  async function openPerson(person: AccessPersonSummary) {
    setBusy(true);
    setMessage("");
    try {
      setSelected(await accessApi.getPerson(person.id));
    } catch {
      setMessage("Person details are temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function invitePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await accessApi.invitePerson({
        ...inviteForm,
        email: inviteForm.email.trim().toLowerCase(),
        fullName: inviteForm.fullName.trim(),
        accessExpiresAt: inviteForm.accessExpiresAt || null,
        adminNotes: inviteForm.adminNotes?.trim() || null,
      });
      setInviteOpen(false);
      setInviteForm(blankInvite);
      await loadPeople();
      setMessage(inviteResultMessage(result.result));
      setSelected(result.person);
    } catch (error) {
      setMessage(
        error instanceof MailApiRequestError
          ? error.message
          : "Invitation could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  function addInviteMailbox() {
    if (!selectedInviteMailbox) return;
    if (
      inviteForm.mailboxAssignments.some(
        (assignment) => assignment.mailAccountId === selectedInviteMailbox,
      )
    ) {
      setMessage("That mailbox is already included in the invitation.");
      return;
    }
    setInviteForm((current) => ({
      ...current,
      mailboxAssignments: [
        ...current.mailboxAssignments,
        {
          mailAccountId: selectedInviteMailbox,
          accessRole: selectedInviteRole,
        },
      ],
    }));
    setSelectedInviteMailbox("");
    setSelectedInviteRole("viewer");
  }

  async function updateSelected(input: Parameters<typeof accessApi.updatePerson>[1]) {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await accessApi.updatePerson(selected.id, input);
      setSelected(next);
      await loadPeople();
      setMessage("Access profile updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Access profile could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    if (!selected) return;
    setBusy(true);
    try {
      await accessApi.sendPasswordReset(selected.id);
      setMessage("Password reset email sent.");
    } catch {
      setMessage("Password reset email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function sendWelcomeInvitation() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await accessApi.resendInvite(selected.id);
      setSelected(result.person);
      setMessage(
        result.result === "account_already_active"
          ? "This account is already active. Send a password reset instead."
          : "Welcome invitation sent.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Welcome invitation could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function resendInvite() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await accessApi.resendInvite(selected.id);
      setSelected(result.person);
      setMessage(inviteResultMessage(result.result));
    } catch {
      setMessage("Invitation could not be resent.");
    } finally {
      setBusy(false);
    }
  }

  async function sendSetupReminder() {
    if (!selected) return;
    setBusy(true);
    try {
      await accessApi.sendSetupReminder(selected.id);
      setSelected(await accessApi.getPerson(selected.id));
      setMessage("Setup reminder sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Setup reminder could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function openAuthTemplate(templateId: string) {
    setBusy(true);
    setMessage("");
    try {
      const detail = await mailApi.getTemplate(templateId);
      setSelectedAuthTemplate(detail);
      setAuthTemplateDraft(detail);
      setAuthTemplatePreview(
        await mailApi.renderTemplatePreview(detail.id, authPreviewVariables(detail.systemKey)),
      );
    } catch {
      setMessage("Authentication email template could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAuthTemplate() {
    if (!authTemplateDraft) return;
    setBusy(true);
    try {
      const updated = await mailApi.updateTemplate(authTemplateDraft.id, {
        name: authTemplateDraft.name,
        description: authTemplateDraft.description,
        subjectTemplate: authTemplateDraft.subjectTemplate,
        htmlContent: authTemplateDraft.htmlContent,
        plainTextContent: authTemplateDraft.plainTextContent,
      });
      setSelectedAuthTemplate(updated);
      setAuthTemplateDraft(updated);
      setAuthTemplatePreview(
        await mailApi.renderTemplatePreview(updated.id, authPreviewVariables(updated.systemKey)),
      );
      setAuthTemplates((templates) =>
        templates.map((template) => (template.id === updated.id ? updated : template)),
      );
      setMessage("Authentication email template updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication email template could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreAuthTemplateDefault() {
    if (!selectedAuthTemplate) return;
    if (!window.confirm("Restore this authentication email to the Vayvyx default?")) return;
    setBusy(true);
    try {
      const restored = await mailApi.restoreTemplateDefault(selectedAuthTemplate.id);
      setSelectedAuthTemplate(restored);
      setAuthTemplateDraft(restored);
      setAuthTemplatePreview(
        await mailApi.renderTemplatePreview(restored.id, authPreviewVariables(restored.systemKey)),
      );
      setAuthTemplates((templates) =>
        templates.map((template) => (template.id === restored.id ? restored : template)),
      );
      setMessage("Authentication email restored to default.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication email could not be restored.");
    } finally {
      setBusy(false);
    }
  }

  async function sendAuthTemplateTest() {
    if (!selectedAuthTemplate || !authTemplateTestEmail.trim()) return;
    setBusy(true);
    try {
      await mailApi.sendAuthTemplateTest(
        selectedAuthTemplate.id,
        authTemplateTestEmail.trim().toLowerCase(),
      );
      setMessage("Test authentication email sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test authentication email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function disableSelected() {
    if (!selected) return;
    if (!window.confirm("Disable this person's Vayvyx access?")) return;
    setBusy(true);
    try {
      setSelected(await accessApi.disablePerson(selected.id));
      await loadPeople();
      setMessage("Access disabled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Access could not be disabled.");
    } finally {
      setBusy(false);
    }
  }

  async function reactivateSelected() {
    if (!selected) return;
    setBusy(true);
    try {
      setSelected(await accessApi.reactivatePerson(selected.id));
      await loadPeople();
      setMessage("Access reactivated.");
    } catch {
      setMessage("Access could not be reactivated.");
    } finally {
      setBusy(false);
    }
  }

  async function repairProfile() {
    if (!selected) return;
    setBusy(true);
    try {
      setSelected(await accessApi.repairProfile(selected.id));
      await loadPeople();
      setMessage("Profile repaired.");
    } catch {
      setMessage("Profile could not be repaired.");
    } finally {
      setBusy(false);
    }
  }

  async function addMailboxAccess() {
    if (!selected || !selectedMailbox) return;
    setBusy(true);
    try {
      const assignments = await accessApi.addMailbox(
        selected.id,
        selectedMailbox,
        selectedMailboxRole,
      );
      setSelected({ ...selected, assignedMailboxes: assignments });
      setSelectedMailbox("");
      setSelectedMailboxRole("viewer");
      setMessage("Mailbox access added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mailbox access could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function updateMailboxAccess(mailAccountId: string, role: MailboxAccessRole) {
    if (!selected) return;
    const assignments = await accessApi.updateMailbox(selected.id, mailAccountId, role);
    setSelected({ ...selected, assignedMailboxes: assignments });
    setMessage("Mailbox role updated.");
  }

  async function removeMailboxAccess(mailAccountId: string) {
    if (!selected) return;
    const assignments = await accessApi.removeMailbox(selected.id, mailAccountId);
    setSelected({ ...selected, assignedMailboxes: assignments });
    setMessage("Mailbox access removed.");
  }

  return (
    <main className="access-admin-page">
      <header className="access-admin-header">
        <button type="button" onClick={() => onNavigate("/account")}>
          <ArrowLeft size={17} /> Account
        </button>
        <div>
          <p className="access-admin-eyebrow">Company administration</p>
          <h1>Access Center</h1>
        </div>
        <button type="button" onClick={loadPeople}>
          <RefreshCcw size={17} /> Refresh
        </button>
      </header>

      {message && (
        <p className="access-admin-message" role="status" aria-live="polite">
          {message}
        </p>
      )}

      <section className="access-admin-toolbar" aria-label="Access filters">
        <label className="access-admin-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people"
            aria-label="Search people"
          />
        </label>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as AccountStatus | "all")}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="invited">Invited</option>
          <option value="setup_incomplete">Setup incomplete</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="expired">Access expired</option>
          <option value="auth_issue">Authentication issue</option>
          <option value="profile_missing">Profile missing</option>
          <option value="auth_missing">Auth account missing</option>
        </select>
        <select
          value={platformRole}
          onChange={(event) => setPlatformRole(event.target.value as PlatformRole | "all")}
          aria-label="Filter by platform role"
        >
          <option value="all">All platform roles</option>
          <option value="user">Users</option>
          <option value="admin">Admins</option>
        </select>
        <select
          value={accessType}
          onChange={(event) => setAccessType(event.target.value as AccessType | "all")}
          aria-label="Filter by access type"
        >
          <option value="all">All access types</option>
          <option value="beta">Private beta</option>
          <option value="licensed">Licensed</option>
          <option value="mail_only">Mail only</option>
          <option value="none">No app access</option>
        </select>
        <button
          className="access-admin-primary"
          type="button"
          onClick={() => setInviteOpen(true)}
        >
          <UserPlus size={17} /> Invite person
        </button>
      </section>

      <section className="access-auth-email-panel" aria-label="Authentication Emails">
        <div className="access-auth-email-header">
          <div>
            <p className="access-admin-eyebrow">System emails</p>
            <h2>Authentication Emails</h2>
          </div>
          <span>Sent from Vayvyx Support</span>
        </div>
        <div className="access-auth-email-layout">
          <div className="access-auth-template-list">
            {authTemplates.length === 0 && <p>No authentication templates available.</p>}
            {authTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={selectedAuthTemplate?.id === template.id ? "active" : ""}
                onClick={() => openAuthTemplate(template.id)}
              >
                <strong>{template.name}</strong>
                <small>{template.systemKey}</small>
              </button>
            ))}
          </div>
          {authTemplateDraft ? (
            <div className="access-auth-template-editor">
              <div className="access-auth-template-fields">
                <label>
                  <span>Subject</span>
                  <input
                    value={authTemplateDraft.subjectTemplate ?? ""}
                    onChange={(event) =>
                      setAuthTemplateDraft({
                        ...authTemplateDraft,
                        subjectTemplate: event.target.value || null,
                      })
                    }
                  />
                </label>
                <label>
                  <span>HTML</span>
                  <textarea
                    value={authTemplateDraft.htmlContent}
                    onChange={(event) =>
                      setAuthTemplateDraft({
                        ...authTemplateDraft,
                        htmlContent: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Plain-text fallback</span>
                  <textarea
                    value={authTemplateDraft.plainTextContent ?? ""}
                    onChange={(event) =>
                      setAuthTemplateDraft({
                        ...authTemplateDraft,
                        plainTextContent: event.target.value || null,
                      })
                    }
                  />
                </label>
                <div className="access-auth-template-actions">
                  <button type="button" onClick={saveAuthTemplate} disabled={busy}>
                    Save template
                  </button>
                  <button type="button" onClick={restoreAuthTemplateDefault} disabled={busy}>
                    Reset to default
                  </button>
                </div>
                <div className="access-auth-template-test">
                  <input
                    type="email"
                    value={authTemplateTestEmail}
                    onChange={(event) => setAuthTemplateTestEmail(event.target.value)}
                    placeholder="test@example.com"
                    aria-label="Authentication template test email"
                  />
                  <button
                    type="button"
                    onClick={sendAuthTemplateTest}
                    disabled={busy || !authTemplateTestEmail.trim()}
                  >
                    Send test
                  </button>
                </div>
              </div>
              <iframe
                className="access-auth-template-preview"
                title="Authentication email preview"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                srcDoc={authTemplatePreview?.htmlContent ?? authTemplateDraft.htmlContent}
              />
            </div>
          ) : (
            <p className="access-admin-state">Select an authentication email to preview or edit it.</p>
          )}
        </div>
      </section>

      <section className="access-people-panel">
        {loading && <div className="access-admin-state">Loading people...</div>}
        {!loading && people.length === 0 && (
          <div className="access-admin-state">No people match these filters.</div>
        )}
        {!loading && people.length > 0 && (
          <div className="access-people-list" role="list" aria-label="People">
            {people.map((person) => (
              <button
                key={person.id}
                type="button"
                className="access-person-row"
                onClick={() => openPerson(person)}
              >
                <span className="access-person-avatar" aria-hidden="true">
                  {initials(person.fullName ?? person.email ?? "?")}
                </span>
                <span className="access-person-main">
                  <strong>{person.fullName ?? "Name unavailable"}</strong>
                  <small>{person.email ?? "Email unavailable"}</small>
                </span>
                <span className={`access-status-pill access-status-${person.status}`}>
                  {person.statusLabel}
                </span>
                <span>{roleLabels[person.platformRole]}</span>
                <span>{accessTypeLabels[person.accessType]}</span>
                <span>{person.invitationStatus.replace(/_/g, " ")}</span>
                <span>{formatDate(person.lastSignInAt)}</span>
                <span>{person.assignedMailboxes.length}</span>
                <span>{formatDate(person.createdAt)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {inviteOpen && (
        <div className="access-admin-modal-backdrop" role="presentation">
          <section
            className="access-admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-heading"
          >
            <div className="access-drawer-header">
              <div>
                <p className="access-admin-eyebrow">Invite</p>
                <h2 id="invite-heading">Invite person</h2>
              </div>
              <button type="button" onClick={() => setInviteOpen(false)} aria-label="Close invite">
                <X size={18} />
              </button>
            </div>
            <form className="access-admin-form" onSubmit={invitePerson}>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })}
                  placeholder="person@company.com"
                  required
                />
              </label>
              <label>
                <span>Full name</span>
                <input
                  value={inviteForm.fullName}
                  onChange={(event) => setInviteForm({ ...inviteForm, fullName: event.target.value })}
                  placeholder="Full name"
                  required
                />
              </label>
              <div className="access-admin-form-grid">
                <label>
                  <span>Platform role</span>
                  <select
                    value={inviteForm.platformRole}
                    onChange={(event) =>
                      setInviteForm({ ...inviteForm, platformRole: event.target.value as PlatformRole })
                    }
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label>
                  <span>Access type</span>
                  <select
                    value={inviteForm.accessType}
                    onChange={(event) =>
                      setInviteForm({ ...inviteForm, accessType: event.target.value as AccessType })
                    }
                  >
                    <option value="beta">Private beta</option>
                    <option value="licensed">Licensed</option>
                    <option value="mail_only">Mail only</option>
                    <option value="none">No app access</option>
                  </select>
                </label>
              </div>
              <label>
                <span>Access expiration</span>
                <input
                  type="date"
                  value={dateInputValue(inviteForm.accessExpiresAt)}
                  onChange={(event) =>
                    setInviteForm({
                      ...inviteForm,
                      accessExpiresAt: event.target.value
                        ? `${event.target.value}T23:59:59.000Z`
                        : null,
                    })
                  }
                />
              </label>
              <label>
                <span>Admin notes</span>
                <textarea
                  value={inviteForm.adminNotes ?? ""}
                  onChange={(event) => setInviteForm({ ...inviteForm, adminNotes: event.target.value })}
                  placeholder="Optional notes visible only to admins"
                />
              </label>
              <div className="access-mail-add-row">
                <select
                  value={selectedInviteMailbox}
                  onChange={(event) => setSelectedInviteMailbox(event.target.value)}
                  aria-label="Invitation mailbox"
                >
                  <option value="">Optional mailbox access</option>
                  {activeMailboxes.map((mailbox) => (
                    <option key={mailbox.id} value={mailbox.id}>
                      {mailbox.displayName} - {mailbox.emailAddress}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedInviteRole}
                  onChange={(event) => setSelectedInviteRole(event.target.value as MailboxAccessRole)}
                  aria-label="Invitation mailbox role"
                >
                  {Object.entries(mailboxRoleLabels).map(([role, label]) => (
                    <option key={role} value={role}>
                      {label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addInviteMailbox}>
                  <Plus size={16} /> Add access
                </button>
              </div>
              {inviteForm.mailboxAssignments.length > 0 && (
                <div className="access-mail-chip-row">
                  {inviteForm.mailboxAssignments.map((assignment) => {
                    const mailbox = mailboxes.find((item) => item.id === assignment.mailAccountId);
                    return (
                      <span key={assignment.mailAccountId}>
                        {mailbox?.displayName ?? "Mailbox"}: {assignment.accessRole}
                      </span>
                    );
                  })}
                </div>
              )}
              <button className="access-admin-primary" type="submit" disabled={busy}>
                {busy ? "Inviting..." : "Send invitation"}
              </button>
            </form>
          </section>
        </div>
      )}

      {selected && (
        <aside
          className="access-person-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="person-detail-heading"
        >
          <div className="access-drawer-header">
            <div>
              <p className="access-admin-eyebrow">Person details</p>
              <h2 id="person-detail-heading">{selected.fullName ?? selected.email ?? "Person"}</h2>
              <p>{selected.email ?? "Email unavailable"}</p>
            </div>
            <button type="button" onClick={() => setSelected(null)} aria-label="Close details">
              <X size={18} />
            </button>
          </div>

          <div className="access-detail-stack">
            <section>
              <h3><ShieldCheck size={17} /> Access</h3>
              <div className="access-admin-form-grid">
                <label>
                  <span>Full name</span>
                  <input
                    defaultValue={selected.fullName ?? ""}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value && value !== selected.fullName) {
                        updateSelected({ fullName: value });
                      }
                    }}
                  />
                </label>
                <label>
                  <span>Platform role</span>
                  <select
                    value={selected.platformRole}
                    onChange={(event) => {
                      const nextRole = event.target.value as PlatformRole;
                      const confirmed =
                        selected.platformRole === "admin" && nextRole === "user"
                          ? window.confirm("Demote this platform administrator?")
                          : true;
                      if (confirmed) {
                        updateSelected({
                          platformRole: nextRole,
                          confirmAdminDemotion: selected.platformRole === "admin" && nextRole === "user",
                        });
                      }
                    }}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label>
                  <span>Access type</span>
                  <select
                    value={selected.accessType}
                    onChange={(event) =>
                      updateSelected({ accessType: event.target.value as AccessType })
                    }
                  >
                    <option value="beta">Private beta</option>
                    <option value="licensed">Licensed</option>
                    <option value="mail_only">Mail only</option>
                    <option value="none">No app access</option>
                  </select>
                </label>
                <label>
                  <span>Access expiration</span>
                  <input
                    type="date"
                    value={dateInputValue(selected.accessExpiresAt)}
                    onChange={(event) =>
                      updateSelected({
                        accessExpiresAt: event.target.value
                          ? `${event.target.value}T23:59:59.000Z`
                          : null,
                      })
                    }
                  />
                </label>
              </div>
              <dl className="access-diagnostics">
                <div><dt>Status</dt><dd>{selected.statusLabel}</dd></div>
                <div><dt>Last sign-in</dt><dd>{formatDate(selected.lastSignInAt)}</dd></div>
                <div><dt>Created</dt><dd>{formatDate(selected.createdAt)}</dd></div>
                <div><dt>Last invitation</dt><dd>{formatDate(selected.lastInvitationSentAt)}</dd></div>
                <div><dt>Last setup reminder</dt><dd>{formatDate(selected.lastSetupReminderSentAt)}</dd></div>
                <div><dt>Last reset request</dt><dd>{formatDate(selected.lastPasswordResetRequestedAt)}</dd></div>
                <div><dt>Last delivery</dt><dd>{selected.lastDeliveryResult ?? "Unavailable"}</dd></div>
              </dl>
              <div className="access-diagnostic-list">
                {selected.diagnostics.map((diagnostic) => (
                  <span key={diagnostic}>{diagnostic}</span>
                ))}
                {selected.diagnostics.length === 0 && <span>No access issues detected</span>}
              </div>
              <label className="access-admin-notes">
                <span>Admin notes</span>
                <textarea
                  defaultValue={selected.adminNotes ?? ""}
                  onBlur={(event) => updateSelected({ adminNotes: event.target.value.trim() || null })}
                />
              </label>
              <div className="access-admin-actions">
                {selected.status !== "active" && (
                  <button type="button" onClick={sendWelcomeInvitation} disabled={busy || selected.authMissing}>
                    Send welcome invitation
                  </button>
                )}
                {selected.status !== "active" && (
                  <button type="button" onClick={resendInvite} disabled={busy || selected.authMissing}>
                    Resend invitation
                  </button>
                )}
                {selected.status !== "active" && (
                  <button type="button" onClick={sendSetupReminder} disabled={busy || selected.authMissing}>
                    Send setup reminder
                  </button>
                )}
                <button type="button" onClick={sendReset} disabled={busy || selected.authMissing}>
                  Send password reset
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const firstTemplate = authTemplates[0];
                    if (firstTemplate) void openAuthTemplate(firstTemplate.id);
                  }}
                  disabled={busy || authTemplates.length === 0}
                >
                  Preview system email template
                </button>
                {selected.profileMissing && (
                  <button type="button" onClick={repairProfile} disabled={busy}>
                    Repair profile
                  </button>
                )}
                {selected.status === "disabled" ? (
                  <button type="button" onClick={reactivateSelected} disabled={busy}>
                    Reactivate access
                  </button>
                ) : (
                  <button type="button" onClick={disableSelected} disabled={busy}>
                    Disable access
                  </button>
                )}
              </div>
            </section>

            <section>
              <h3><Mail size={17} /> Mail Access</h3>
              <div className="access-mail-list">
                {selected.assignedMailboxes.length === 0 && (
                  <p>No mailbox access assigned.</p>
                )}
                {selected.assignedMailboxes.map((assignment) => (
                  <div key={assignment.mailAccountId} className="access-mail-row">
                    <span>
                      <strong>{assignment.displayName}</strong>
                      <small>{assignment.emailAddress}</small>
                    </span>
                    <select
                      value={assignment.accessRole}
                      onChange={(event) =>
                        updateMailboxAccess(
                          assignment.mailAccountId,
                          event.target.value as MailboxAccessRole,
                        )
                      }
                    >
                      {Object.entries(mailboxRoleLabels).map(([role, label]) => (
                        <option key={role} value={role}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeMailboxAccess(assignment.mailAccountId)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <div className="access-mail-add-row">
                <select
                  value={selectedMailbox}
                  onChange={(event) => setSelectedMailbox(event.target.value)}
                  aria-label="Mailbox"
                >
                  <option value="">Choose mailbox</option>
                  {activeMailboxes.map((mailbox) => (
                    <option key={mailbox.id} value={mailbox.id}>
                      {mailbox.displayName} - {mailbox.emailAddress}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedMailboxRole}
                  onChange={(event) => setSelectedMailboxRole(event.target.value as MailboxAccessRole)}
                  aria-label="Mailbox role"
                >
                  {Object.entries(mailboxRoleLabels).map(([role, label]) => (
                    <option key={role} value={role}>
                      {label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={addMailboxAccess} disabled={!selectedMailbox || busy}>
                  Add access
                </button>
              </div>
            </section>

            <section>
              <h3>Access history</h3>
              <div className="access-history-list">
                {selected.audit.length === 0 && <p>No access history yet.</p>}
                {selected.audit.map((event) => (
                  <div key={event.id}>
                    <strong>{event.action.replace(/_/g, " ")}</strong>
                    <span>{formatDate(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>Email delivery history</h3>
              <div className="access-history-list">
                {selected.emailDeliveries.length === 0 && <p>No authentication emails sent yet.</p>}
                {selected.emailDeliveries.map((event) => (
                  <div key={event.id}>
                    <strong>{event.emailType.replace(/_/g, " ")}</strong>
                    <span>
                      {event.status}
                      {event.failureCategory ? ` (${event.failureCategory})` : ""}
                    </span>
                    <small>{formatDate(event.sentAt ?? event.createdAt)}</small>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>
      )}
    </main>
  );
}

function inviteResultMessage(result: string) {
  const messages: Record<string, string> = {
    invited: "Invitation sent.",
    account_already_active: "This account is already active. Send a password reset instead.",
    invitation_already_pending: "Invitation already pending.",
    existing_account_needs_access_assignment: "Existing account needs access assignment.",
  };
  return messages[result] ?? "Access request completed.";
}

function initials(value: string) {
  return value
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function dateInputValue(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function authPreviewVariables(systemKey: string | null) {
  return {
    first_name: "Jordan",
    full_name: "Jordan Smith",
    email: "jordan@example.com",
    action_url:
      systemKey === "auth_password_changed"
        ? ""
        : "https://vayvyx.com/auth/v1/verify?preview=true",
    action_label:
      systemKey === "auth_password_reset"
        ? "Reset your password"
        : systemKey === "auth_confirm_signup"
          ? "Confirm email"
          : systemKey === "auth_password_changed"
            ? ""
            : "Complete account setup",
    support_email: "support@vayvyx.com",
    company_name: "Vayvyx",
    current_year: String(new Date().getFullYear()),
    access_type: "Private beta",
    expiration_notice:
      systemKey === "auth_password_changed"
        ? "Jul 30, 2026, 11:30 AM"
        : "For security, this link expires automatically.",
  };
}
