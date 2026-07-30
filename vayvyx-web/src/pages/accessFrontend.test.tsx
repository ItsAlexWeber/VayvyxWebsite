/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessAdminPage } from "./accessAdminPage.tsx";
import { AcceptInvitePage } from "./acceptInvitePage.tsx";
import { AccountPage } from "./accountPage.tsx";
import { MailApiRequestError } from "../lib/mailApi.ts";

type AuthCallback = (event: string, session: unknown) => void;

const accessApiMock = vi.hoisted(() => ({
  listPeople: vi.fn(),
  getPerson: vi.fn(),
  invitePerson: vi.fn(),
  completeInvite: vi.fn(),
  updatePerson: vi.fn(),
  sendPasswordReset: vi.fn(),
  resendInvite: vi.fn(),
  sendSetupReminder: vi.fn(),
  disablePerson: vi.fn(),
  reactivatePerson: vi.fn(),
  repairProfile: vi.fn(),
  listMailboxes: vi.fn(),
  addMailbox: vi.fn(),
  updateMailbox: vi.fn(),
  removeMailbox: vi.fn(),
}));

const mailApiMock = vi.hoisted(() => ({
  getAccess: vi.fn(),
  getTemplates: vi.fn(),
  getTemplate: vi.fn(),
  renderTemplatePreview: vi.fn(),
  updateTemplate: vi.fn(),
  restoreTemplateDefault: vi.fn(),
  sendAuthTemplateTest: vi.fn(),
}));

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(),
}));

vi.mock("../lib/accessApi.ts", () => ({
  accessApi: accessApiMock,
}));

vi.mock("../lib/mailApi.ts", async () => {
  const actual = await vi.importActual<typeof import("../lib/mailApi.ts")>(
    "../lib/mailApi.ts",
  );
  return {
    ...actual,
    mailApi: mailApiMock,
  };
});

vi.mock("../lib/supabaseClient.ts", () => ({
  supabase: supabaseMock,
}));

const person = {
  id: "person-1",
  email: "josh@vayvyx.com",
  fullName: "Josh Builder",
  status: "profile_missing",
  statusLabel: "Profile missing",
  platformRole: "user",
  accessType: "beta",
  invitationStatus: "setup_incomplete",
  setupCompletedAt: null,
  mustSetPassword: true,
  accessExpiresAt: null,
  lastSignInAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  lastInvitationSentAt: "2026-07-01T00:00:00.000Z",
  lastSetupReminderSentAt: null,
  lastPasswordResetRequestedAt: null,
  lastDeliveryResult: "sent",
  assignedMailboxes: [
    {
      id: "member-1",
      mailAccountId: "mailbox-1",
      displayName: "Support",
      emailAddress: "support@vayvyx.com",
      accessRole: "viewer",
      isActive: true,
    },
  ],
  diagnostics: ["Profile missing", "Mailbox access assigned"],
  profileMissing: true,
  authMissing: false,
};

const detail = {
  ...person,
  adminNotes: "needs setup help",
  audit: [
    {
      id: "audit-1",
      actorUserId: "admin-user",
      targetUserId: "person-1",
      action: "profile_repaired",
      metadata: {},
      createdAt: "2026-07-02T00:00:00.000Z",
    },
  ],
  emailDeliveries: [
    {
      id: "delivery-1",
      emailType: "auth_welcome_invite",
      status: "sent",
      providerMessageId: "message-1",
      sentAt: "2026-07-01T00:00:00.000Z",
      failureCategory: null,
      actorUserId: "admin-user",
      correlationId: "correlation-1",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
  ],
};

const authTemplate = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Welcome invitation",
  description: "Branded invite",
  subjectTemplate: "Welcome {{first_name}}",
  scope: "system",
  defaultMailAccountId: null,
  previewMetadata: null,
  createdBy: null,
  updatedAt: "2026-07-01T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  isActive: true,
  systemKey: "auth_welcome_invite",
  isDeleteProtected: true,
  htmlContent: '<a href="{{action_url}}">{{action_label}}</a>',
  plainTextContent: "{{action_url}}",
  variables: ["action_url", "action_label", "first_name"],
  assets: [],
  defaultSubjectTemplate: "Welcome {{first_name}}",
  defaultHtmlContent: '<a href="{{action_url}}">{{action_label}}</a>',
  defaultPlainTextContent: "{{action_url}}",
};

const mailbox = {
  id: "mailbox-1",
  displayName: "Support",
  emailAddress: "support@vayvyx.com",
  isActive: true,
};

let authCallback: AuthCallback | null = null;
let unsubscribe = vi.fn();

beforeEach(() => {
  authCallback = null;
  unsubscribe = vi.fn();
  accessApiMock.listPeople.mockResolvedValue([person]);
  accessApiMock.getPerson.mockResolvedValue(detail);
  accessApiMock.listMailboxes.mockResolvedValue([mailbox]);
  accessApiMock.invitePerson.mockResolvedValue({
    result: "invited",
    person: detail,
  });
  accessApiMock.completeInvite.mockResolvedValue({ ok: true });
  accessApiMock.updatePerson.mockResolvedValue(detail);
  accessApiMock.sendPasswordReset.mockResolvedValue({ ok: true });
  accessApiMock.resendInvite.mockResolvedValue({
    result: "invited",
    person: detail,
  });
  accessApiMock.sendSetupReminder.mockResolvedValue({ ok: true });
  accessApiMock.disablePerson.mockResolvedValue({
    ...detail,
    status: "disabled",
    statusLabel: "Disabled",
  });
  accessApiMock.repairProfile.mockResolvedValue({
    ...detail,
    profileMissing: false,
    status: "active",
    statusLabel: "Active",
  });
  accessApiMock.addMailbox.mockResolvedValue(detail.assignedMailboxes);
  accessApiMock.updateMailbox.mockResolvedValue(detail.assignedMailboxes);
  accessApiMock.removeMailbox.mockResolvedValue([]);
  mailApiMock.getAccess.mockResolvedValue({
    authenticated: true,
    platformAdmin: true,
    hasMailAccess: true,
    mailboxCount: 1,
  });
  mailApiMock.getTemplates.mockResolvedValue([authTemplate]);
  mailApiMock.getTemplate.mockResolvedValue(authTemplate);
  mailApiMock.renderTemplatePreview.mockResolvedValue({
    subject: "Welcome Jordan",
    htmlContent: "<p>Preview</p>",
    plainTextContent: "Preview",
    unresolvedVariables: [],
  });
  mailApiMock.updateTemplate.mockResolvedValue(authTemplate);
  mailApiMock.restoreTemplateDefault.mockResolvedValue(authTemplate);
  mailApiMock.sendAuthTemplateTest.mockResolvedValue({
    status: "sent",
    messageId: "message-2",
  });
  supabaseMock.auth.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: "browser-token",
        user: {
          id: "invite-user",
          email: "invite@vayvyx.com",
          user_metadata: { full_name: "Invited Person" },
        },
      },
    },
    error: null,
  });
  supabaseMock.auth.onAuthStateChange.mockImplementation(
    (callback: AuthCallback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe } } };
    },
  );
  supabaseMock.auth.updateUser.mockResolvedValue({ data: {}, error: null });
  supabaseMock.auth.signOut.mockResolvedValue({ error: null });
  supabaseMock.from.mockReturnValue(createLicenseQuery());
  vi.spyOn(window, "confirm").mockReturnValue(true);
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("access management frontend", () => {
  it("shows Access management on the account page for platform admins", async () => {
    render(<AccountPage onNavigate={vi.fn()} />);

    expect(await screen.findByText("Access management")).toBeTruthy();
  });

  it("renders searchable people, diagnostics, mailbox access, and repair action", async () => {
    render(<AccessAdminPage onNavigate={vi.fn()} />);

    expect(await screen.findByText("Josh Builder")).toBeTruthy();
    expect(screen.getByLabelText("Search people")).toBeTruthy();
    fireEvent.click(screen.getByText("Josh Builder"));

    expect(await screen.findByText("Mail Access")).toBeTruthy();
    expect(screen.getAllByText("Profile missing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Viewer: read messages").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Repair profile"));
    await waitFor(() => expect(accessApiMock.repairProfile).toHaveBeenCalledWith("person-1"));
  });

  it("invites a person with normalized email and optional mailbox access", async () => {
    render(<AccessAdminPage onNavigate={vi.fn()} />);

    await screen.findByText("Josh Builder");
    fireEvent.click(screen.getByText("Invite person"));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "  NEW@VAYVYX.COM  " },
    });
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "New Person" },
    });
    fireEvent.change(screen.getByLabelText("Invitation mailbox"), {
      target: { value: "mailbox-1" },
    });
    fireEvent.click(screen.getByText("Add access"));
    fireEvent.click(screen.getByText("Send invitation"));

    await waitFor(() => expect(accessApiMock.invitePerson).toHaveBeenCalled());
    expect(accessApiMock.invitePerson.mock.calls[0][0]).toMatchObject({
      email: "new@vayvyx.com",
      fullName: "New Person",
      mailboxAssignments: [{ mailAccountId: "mailbox-1", accessRole: "viewer" }],
    });
    expect(await screen.findByText("Invitation sent.")).toBeTruthy();
  });

  it("displays a neutral message when normal users are rejected", async () => {
    accessApiMock.listPeople.mockRejectedValue(
      new MailApiRequestError(403, "ACCESS_DENIED", "raw policy detail"),
    );

    render(<AccessAdminPage onNavigate={vi.fn()} />);

    expect(await screen.findByText("You do not have permission to manage access.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("raw policy detail");
  });

  it("accepts an invitation, sets the password, completes setup, signs out, and navigates to login", async () => {
    const onNavigate = vi.fn();
    render(<AcceptInvitePage onNavigate={onNavigate} />);

    authCallback?.("SIGNED_IN", {
      user: {
        email: "invite@vayvyx.com",
        user_metadata: { full_name: "Invited Person" },
      },
    });

    expect(await screen.findByText("Invitation for invite@vayvyx.com")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "secure-invite-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "secure-invite-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete account setup" }));

    await waitFor(() =>
      expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({
        password: "secure-invite-password",
        data: { full_name: "Invited Person" },
      }),
    );
    await waitFor(() => expect(accessApiMock.completeInvite).toHaveBeenCalledWith("Invited Person"));
    await waitFor(() => expect(supabaseMock.auth.signOut).toHaveBeenCalled());
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/login"), {
      timeout: 2_000,
    });
    expect(screen.getByText("Your Vayvyx account is ready.")).toBeTruthy();
  });

  it("shows safe invalid invitation messaging without URL tokens", async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    window.history.pushState(
      {},
      "",
      "/accept-invite#error=access_denied&access_token=secret",
    );

    render(<AcceptInvitePage onNavigate={vi.fn()} />);

    expect(await screen.findByText("This invitation link is invalid or has expired.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("access_token");
    expect(document.body.textContent).not.toContain("secret");
  });

});

function createLicenseQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: null,
      error: null,
    })),
  };

  return query;
}
