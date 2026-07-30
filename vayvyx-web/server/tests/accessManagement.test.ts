import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requireActiveAccount } from "../src/auth.js";
import { createAccessAdminRoutes } from "../src/accessRoutes.js";
import { AccessManagementService } from "../src/accessManagementService.js";
import { isHttpError } from "../src/httpError.js";
import type { AuthContext, MailboxAccessRole, PlatformRole } from "../src/types.js";

const adminAuth = auth("admin-user", "admin");
const userAuth = auth("normal-user", "user");

describe("access management", () => {
  it("requires platform-admin authorization on access routes", async () => {
    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
      request.auth = userAuth as never;
      next();
    });
    app.use(createAccessAdminRoutes(createService(createFakeAdmin())));
    app.use(errorHandler);

    await request(app).get("/api/access/people").expect(403);
  });

  it("lists users with safe diagnostics and no technical identifiers as display fields", async () => {
    const fake = createFakeAdmin({
      users: [
        authUser("admin-user", "admin@vayvyx.com", {
          full_name: "Avery Admin",
          email_confirmed_at: "2026-07-01T00:00:00.000Z",
        }),
        authUser("josh-user", "josh@vayvyx.com"),
      ],
      profiles: [
        profile("admin-user", "admin@vayvyx.com", "Avery Admin", "admin"),
      ],
    });
    const service = createService(fake);

    const people = await service.listPeople(adminAuth, {
      search: "josh",
      status: "all",
      platformRole: "all",
      accessType: "all",
    });

    expect(people).toHaveLength(1);
    expect(people[0]?.email).toBe("josh@vayvyx.com");
    expect(people[0]?.profileMissing).toBe(true);
    expect(people[0]?.diagnostics).toContain("Profile missing");
    expect(JSON.stringify(people)).not.toContain("access_token");
  });

  it("creates an invitation, prepares a profile, avoids duplicate memberships, and audits safely", async () => {
    const fake = createFakeAdmin({
      accounts: [mailAccount("mailbox-1")],
    });
    const service = createService(fake);

    const result = await service.invitePerson(
      adminAuth,
      {
        email: "new@vayvyx.com",
        fullName: "New Person",
        platformRole: "user",
        accessType: "beta",
        accessExpiresAt: null,
        adminNotes: "field team",
        mailboxAssignments: [
          { mailAccountId: "mailbox-1", accessRole: "viewer" },
          { mailAccountId: "mailbox-1", accessRole: "viewer" },
        ],
      },
      "https://vayvyx.com/accept-invite",
    );

    expect(result.result).toBe("invited");
    expect(fake.generatedLinks[0]).toMatchObject({
      type: "invite",
      email: "new@vayvyx.com",
      redirectTo: "https://vayvyx.com/accept-invite",
    });
    expect(fake.authEmails[0]).toMatchObject({
      type: "welcome",
      to: "new@vayvyx.com",
    });
    expect(fake.admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(fake.profiles.find((item) => item.email === "new@vayvyx.com")?.account_status).toBe("invited");
    expect(fake.members).toHaveLength(1);
    expect(fake.audit.map((event) => event.action)).toContain("person_invited");
    expect(JSON.stringify(fake.audit)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("action_link");
  });

  it("handles duplicate invitation requests with a sanitized pending result", async () => {
    const fake = createFakeAdmin({
      users: [authUser("pending-user", "pending@vayvyx.com", { invited_at: "2026-07-01T00:00:00.000Z" })],
      profiles: [
        {
          ...profile("pending-user", "pending@vayvyx.com", "Pending Person", "user"),
          account_status: "invited",
          setup_completed_at: null,
        },
      ],
    });
    const service = createService(fake);

    const result = await service.invitePerson(
      adminAuth,
      {
        email: "pending@vayvyx.com",
        fullName: "Pending Person",
        platformRole: "user",
        accessType: "beta",
        accessExpiresAt: null,
        adminNotes: null,
        mailboxAssignments: [],
      },
      "https://vayvyx.com/accept-invite",
    );

    expect(result.result).toBe("invited");
    expect(fake.generatedLinks).toHaveLength(1);
    expect(fake.profiles.filter((item) => item.email === "pending@vayvyx.com")).toHaveLength(1);
  });

  it("completes invitation setup without exposing tokens", async () => {
    const fake = createFakeAdmin({
      profiles: [
        {
          ...profile("invite-user", "invite@vayvyx.com", "Invited", "user"),
          account_status: "invited",
          setup_completed_at: null,
        },
      ],
    });
    const service = createService(fake);

    await service.completeInvite(
      {
        ...auth("invite-user", "user"),
        email: "invite@vayvyx.com",
        accountStatus: "invited",
        mustSetPassword: true,
        setupCompletedAt: null,
      },
      "Invited Person",
    );

    const updated = fake.profiles.find((item) => item.id === "invite-user");
    expect(updated?.account_status).toBe("active");
    expect(updated?.full_name).toBe("Invited Person");
    expect(JSON.stringify(fake.audit)).not.toContain("refresh_token");
  });

  it("sends a password reset email from the trusted server", async () => {
    const fake = createFakeAdmin({
      users: [authUser("target-user", "target@vayvyx.com")],
      profiles: [profile("target-user", "target@vayvyx.com", "Target", "user")],
    });
    const service = createService(fake);

    await service.sendPasswordReset(
      adminAuth,
      "target-user",
      "https://vayvyx.com/reset-password",
    );

    expect(fake.generatedLinks).toEqual([
      {
        type: "recovery",
        email: "target@vayvyx.com",
        redirectTo: "https://vayvyx.com/reset-password",
      },
    ]);
    expect(fake.authEmails).toContainEqual(
      expect.objectContaining({ type: "password_reset", to: "target@vayvyx.com" }),
    );
    expect(fake.admin.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("updates roles, access type, and expiration with confirmation for admin demotion", async () => {
    const fake = createFakeAdmin({
      profiles: [
        profile("admin-user", "admin@vayvyx.com", "Avery Admin", "admin"),
        profile("second-admin", "second@vayvyx.com", "Second Admin", "admin"),
      ],
      users: [
        authUser("admin-user", "admin@vayvyx.com", { email_confirmed_at: "2026-07-01T00:00:00.000Z" }),
        authUser("second-admin", "second@vayvyx.com", { email_confirmed_at: "2026-07-01T00:00:00.000Z" }),
      ],
    });
    const service = createService(fake);

    await expect(
      service.updatePerson(adminAuth, "second-admin", { platformRole: "user" })
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });

    const updated = await service.updatePerson(adminAuth, "second-admin", {
      platformRole: "user",
      confirmAdminDemotion: true,
      accessType: "licensed",
      accessExpiresAt: "2026-12-31T23:59:59.000Z",
    });

    expect(updated.platformRole).toBe("user");
    expect(updated.accessType).toBe("licensed");
    expect(updated.accessExpiresAt).toBe("2026-12-31T23:59:59.000Z");
  });

  it("prevents final-admin removal and self-disable, then disables and reactivates users", async () => {
    const fake = createFakeAdmin({
      users: [
        authUser("admin-user", "admin@vayvyx.com", { email_confirmed_at: "2026-07-01T00:00:00.000Z" }),
        authUser("target-user", "target@vayvyx.com", { email_confirmed_at: "2026-07-01T00:00:00.000Z" }),
      ],
      profiles: [
        profile("admin-user", "admin@vayvyx.com", "Avery Admin", "admin"),
        profile("target-user", "target@vayvyx.com", "Target", "user"),
      ],
    });
    const service = createService(fake);

    await expect(
      service.updatePerson(adminAuth, "admin-user", {
        platformRole: "user",
        confirmAdminDemotion: true,
      }),
    ).rejects.toMatchObject({ code: "FINAL_ADMIN_REQUIRED" });
    await expect(service.disablePerson(adminAuth, "admin-user")).rejects.toMatchObject({
      code: "SELF_DISABLE_BLOCKED",
    });

    const disabled = await service.disablePerson(adminAuth, "target-user");
    expect(disabled.status).toBe("disabled");

    const active = await service.reactivatePerson(adminAuth, "target-user");
    expect(active.status).toBe("active");
  });

  it("repairs a missing profile from safe Auth identity data", async () => {
    const fake = createFakeAdmin({
      users: [
        authUser("josh-user", "josh@vayvyx.com", {
          user_metadata: { full_name: "Josh Builder" },
          email_confirmed_at: "2026-07-01T00:00:00.000Z",
        }),
      ],
    });
    const service = createService(fake);

    const repaired = await service.repairProfile(adminAuth, "josh-user");

    expect(repaired.profileMissing).toBe(false);
    expect(repaired.fullName).toBe("Josh Builder");
    expect(fake.profiles[0]).not.toHaveProperty("password");
  });

  it("manages mailbox assignment and protects the final owner of an active mailbox", async () => {
    const fake = createFakeAdmin({
      users: [authUser("target-user", "target@vayvyx.com")],
      profiles: [profile("target-user", "target@vayvyx.com", "Target", "user")],
      accounts: [mailAccount("mailbox-1")],
      members: [member("mailbox-1", "target-user", "owner")],
    });
    const service = createService(fake);

    await expect(
      service.addMailboxAssignment(adminAuth, "target-user", "mailbox-1", "viewer"),
    ).rejects.toMatchObject({ code: "DUPLICATE_MEMBERSHIP" });
    await expect(
      service.updateMailboxAssignment(adminAuth, "target-user", "mailbox-1", "viewer"),
    ).rejects.toMatchObject({ code: "FINAL_MAILBOX_OWNER_REQUIRED" });
    await expect(
      service.removeMailboxAssignment(adminAuth, "target-user", "mailbox-1"),
    ).rejects.toMatchObject({ code: "FINAL_MAILBOX_OWNER_REQUIRED" });
  });

  it("rejects disabled and expired users before protected API access", async () => {
    for (const context of [
      { ...userAuth, accountStatus: "disabled" as const },
      { ...userAuth, accessExpiresAt: "2020-01-01T00:00:00.000Z" },
    ]) {
      await new Promise<void>((resolve) => {
        requireActiveAccount(
          { auth: context } as never,
          {} as never,
          (error?: unknown) => {
            expect(error).toBeTruthy();
            resolve();
          },
        );
      });
    }
  });
});

function auth(userId: string, platformRole: PlatformRole): AuthContext {
  return {
    user: { id: userId } as never,
    userId,
    email: `${userId}@vayvyx.com`,
    platformRole,
    accessType: "beta",
    accountStatus: "active",
    setupCompletedAt: "2026-07-01T00:00:00.000Z",
    mustSetPassword: false,
    accessExpiresAt: null,
  };
}

function authUser(
  id: string,
  email: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    email,
    user_metadata: {},
    app_metadata: {},
    created_at: "2026-07-01T00:00:00.000Z",
    ...extra,
  };
}

function profile(
  id: string,
  email: string,
  fullName: string,
  role: PlatformRole,
) {
  return {
    id,
    email,
    full_name: fullName,
    role,
    access_type: "beta",
    account_status: "active",
    setup_completed_at: "2026-07-01T00:00:00.000Z",
    access_expires_at: null,
    invited_by: null,
    disabled_at: null,
    disabled_by: null,
    admin_notes: null,
    must_set_password: false,
    invitation_sent_at: null,
    setup_reminder_sent_at: null,
    password_reset_requested_at: null,
    last_auth_email_status: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

function mailAccount(id: string) {
  return {
    id,
    email_address: `${id}@vayvyx.com`,
    display_name: id,
    is_active: true,
  };
}

function member(
  mailAccountId: string,
  userId: string,
  accessRole: MailboxAccessRole,
) {
  return {
    id: `${mailAccountId}-${userId}`,
    mail_account_id: mailAccountId,
    user_id: userId,
    access_role: accessRole,
    created_by: "admin-user",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

function createFakeAdmin(seed: Partial<{
  users: ReturnType<typeof authUser>[];
  profiles: ReturnType<typeof profile>[];
  accounts: ReturnType<typeof mailAccount>[];
  members: ReturnType<typeof member>[];
}> = {}) {
  const fake = {
    users: [...(seed.users ?? [])],
    profiles: [...(seed.profiles ?? [])],
    accounts: [...(seed.accounts ?? [])],
    members: [...(seed.members ?? [])],
    audit: [] as Array<Record<string, unknown>>,
    delivery: [] as Array<Record<string, unknown>>,
    invites: [] as Array<{ email: string; redirectTo?: string }>,
    resets: [] as Array<{ email: string; redirectTo?: string }>,
    generatedLinks: [] as Array<{ type: "invite" | "recovery"; email: string; redirectTo?: string }>,
    authEmails: [] as Array<{ type: string; to: string; actionUrl?: string | null }>,
    admin: null as never,
    authEmailService: null as never,
  };

  fake.admin = {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users: fake.users }, error: null })),
        generateLink: vi.fn(async (input: {
          type: "invite" | "recovery";
          email: string;
          options?: { redirectTo?: string; data?: Record<string, unknown> };
        }) => {
          let user = fake.users.find((item) => item.email === input.email);
          if (!user && input.type === "invite") {
            user = authUser(`user-${fake.users.length + 1}`, input.email, {
              invited_at: "2026-07-01T00:00:00.000Z",
            });
            fake.users.push(user);
          }
          if (!user) {
            return { data: null, error: new Error("missing") };
          }
          fake.generatedLinks.push({
            type: input.type,
            email: input.email,
            redirectTo: input.options?.redirectTo,
          });
          return {
            data: {
              user,
              properties: {
                action_link: `https://project.supabase.co/auth/v1/verify?type=${input.type}&token_hash=secret&redirect_to=${encodeURIComponent(input.options?.redirectTo ?? "")}`,
              },
            },
            error: null,
          };
        }),
        inviteUserByEmail: vi.fn(async (email: string, options: { redirectTo?: string }) => {
          const existing = fake.users.find((user) => user.email === email);
          if (existing) {
            return { data: { user: null }, error: new Error("already registered") };
          }
          const user = authUser(`user-${fake.users.length + 1}`, email, {
            invited_at: "2026-07-01T00:00:00.000Z",
          });
          fake.users.push(user);
          fake.invites.push({ email, redirectTo: options.redirectTo });
          return { data: { user }, error: null };
        }),
        getUserById: vi.fn(async (userId: string) => ({
          data: { user: fake.users.find((user) => user.id === userId) ?? null },
          error: fake.users.some((user) => user.id === userId) ? null : new Error("missing"),
        })),
        updateUserById: vi.fn(async () => ({ data: { user: {} }, error: null })),
      },
      resetPasswordForEmail: vi.fn(async (email: string, options: { redirectTo?: string }) => {
        fake.resets.push({ email, redirectTo: options.redirectTo });
        return { data: {}, error: null };
      }),
      resend: vi.fn(async () => ({ data: {}, error: null })),
    },
    from(table: string) {
      return new FakeQuery(fake, table);
    },
  } as never;

  fake.authEmailService = {
    generateInviteActionLink: vi.fn(async (input: {
      email: string;
      fullName: string;
      redirectTo: string;
    }) => {
      const generated = await fake.admin.auth.admin.generateLink({
        type: "invite",
        email: input.email,
        options: {
          redirectTo: input.redirectTo,
          data: { full_name: input.fullName },
        },
      });
      return {
        user: generated.data.user,
        actionUrl: generated.data.properties.action_link,
      };
    }),
    sendWelcomeInvitation: vi.fn(async (input: { to: string; actionUrl?: string | null }) => {
      fake.authEmails.push({ type: "welcome", to: input.to, actionUrl: input.actionUrl });
      return { ok: true, messageId: "message-welcome" };
    }),
    sendSetupReminder: vi.fn(async (input: { to: string; actionUrl?: string | null }) => {
      fake.authEmails.push({ type: "setup_reminder", to: input.to, actionUrl: input.actionUrl });
      return { ok: true, messageId: "message-reminder" };
    }),
    sendPasswordReset: vi.fn(async (input: { email: string; redirectTo: string }) => {
      await fake.admin.auth.admin.generateLink({
        type: "recovery",
        email: input.email,
        options: { redirectTo: input.redirectTo },
      });
      fake.authEmails.push({ type: "password_reset", to: input.email });
      return { ok: true, messageId: "message-reset" };
    }),
  } as never;

  return fake;
}

function createService(fake: ReturnType<typeof createFakeAdmin>) {
  return new AccessManagementService(fake.admin, fake.authEmailService);
}

class FakeQuery {
  private filters: Array<{ key: string; value: unknown; kind: "eq" | "in" }> = [];
  private operation: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: unknown;
  private maxRows: number | null = null;

  constructor(private readonly fake: ReturnType<typeof createFakeAdmin>, private readonly table: string) {}

  select() {
    this.operation = "select";
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, value, kind: "eq" });
    return this;
  }

  in(key: string, value: unknown[]) {
    this.filters.push({ key, value, kind: "in" });
    return this;
  }

  order() {
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  insert(payload: unknown) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  upsert(payload: unknown) {
    this.operation = "upsert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  async maybeSingle() {
    const result = await this.execute();
    return { data: result.data[0] ?? null, error: result.error };
  }

  then(resolve: (value: { data: unknown[]; error: null }) => void) {
    this.execute().then(resolve);
  }

  private async execute(): Promise<{ data: unknown[]; error: null }> {
    const rows = this.rows();
    if (this.operation === "insert") {
      const payloadRows = Array.isArray(this.payload) ? this.payload : [this.payload];
      rows.push(...payloadRows.filter(Boolean));
      return { data: payloadRows, error: null };
    }

    if (this.operation === "upsert") {
      const payloadRows = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const row of payloadRows.filter(Boolean) as Array<Record<string, unknown>>) {
        const existing = rows.find((item) =>
          this.table === "mail_account_members"
            ? item.mail_account_id === row.mail_account_id && item.user_id === row.user_id
            : item.id === row.id,
        );
        if (existing) Object.assign(existing, row);
        else rows.push(row);
      }
      return { data: payloadRows, error: null };
    }

    const matched = this.applyFilters(rows);
    if (this.operation === "update") {
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched, error: null };
    }

    if (this.operation === "delete") {
      for (const row of matched) {
        const index = rows.indexOf(row);
        if (index >= 0) rows.splice(index, 1);
      }
      return { data: matched, error: null };
    }

    const selected = matched.map((row) =>
      this.table === "mail_account_members"
        ? {
            ...row,
            mail_accounts: this.fake.accounts.find(
              (account) => account.id === row.mail_account_id,
            ),
          }
        : row,
    );
    return { data: this.maxRows ? selected.slice(0, this.maxRows) : selected, error: null };
  }

  private rows(): Array<Record<string, unknown>> {
    if (this.table === "profiles") return this.fake.profiles as Array<Record<string, unknown>>;
    if (this.table === "mail_accounts") return this.fake.accounts as Array<Record<string, unknown>>;
    if (this.table === "mail_account_members") return this.fake.members as Array<Record<string, unknown>>;
    if (this.table === "access_audit_log") return this.fake.audit;
    if (this.table === "auth_email_delivery_log") return this.fake.delivery;
    return [];
  }

  private applyFilters(rows: Array<Record<string, unknown>>) {
    return rows.filter((row) =>
      this.filters.every((filter) => {
        if (filter.kind === "eq") return row[filter.key] === filter.value;
        return Array.isArray(filter.value) && filter.value.includes(row[filter.key]);
      }),
    );
  }
}

function errorHandler(
  error: unknown,
  _request: express.Request,
  response: express.Response,
  _next: express.NextFunction,
) {
  void _next;
  if (error instanceof ZodError) {
    response.status(400).json({ error: { code: "INVALID_REQUEST" } });
    return;
  }
  if (isHttpError(error)) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  response.status(500).json({ error: { code: "INTERNAL_ERROR" } });
}
