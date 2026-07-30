import type { SupabaseClient, User } from "@supabase/supabase-js";
import { HttpError } from "./httpError.js";
import type {
  AccessType,
  AccountStatus,
  AuthContext,
  MailboxAccessRole,
  PlatformRole,
} from "./types.js";
import type {
  invitePersonSchema,
  peopleListQuerySchema,
  updatePersonSchema,
} from "./accessValidation.js";
import type { z } from "zod";
import type { AuthEmailService } from "./authEmailService.js";

type PeopleListQuery = z.infer<typeof peopleListQuerySchema>;
type InvitePersonInput = z.infer<typeof invitePersonSchema>;
type UpdatePersonInput = z.infer<typeof updatePersonSchema>;

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: PlatformRole;
  access_type: AccessType;
  account_status: AccountStatus;
  setup_completed_at: string | null;
  access_expires_at: string | null;
  invited_by: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
  admin_notes: string | null;
  must_set_password: boolean;
  invitation_sent_at: string | null;
  setup_reminder_sent_at: string | null;
  password_reset_requested_at: string | null;
  last_auth_email_status: string | null;
  created_at: string;
  updated_at: string;
};

type MailAssignmentRow = {
  id: string;
  mail_account_id: string;
  user_id: string;
  access_role: MailboxAccessRole;
  created_at: string;
  updated_at: string;
  mail_accounts?: {
    id: string;
    email_address: string;
    display_name: string;
    is_active: boolean;
  } | null;
};

export type AccessPersonSummary = {
  id: string;
  email: string | null;
  fullName: string | null;
  status: AccessStatus;
  statusLabel: string;
  platformRole: PlatformRole;
  accessType: AccessType;
  invitationStatus: "not_invited" | "invited" | "setup_incomplete" | "complete";
  setupCompletedAt: string | null;
  mustSetPassword: boolean;
  accessExpiresAt: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
  lastInvitationSentAt: string | null;
  lastSetupReminderSentAt: string | null;
  lastPasswordResetRequestedAt: string | null;
  lastDeliveryResult: string | null;
  assignedMailboxes: AccessMailboxAssignment[];
  diagnostics: string[];
  profileMissing: boolean;
  authMissing: boolean;
};

export type AccessPersonDetail = AccessPersonSummary & {
  adminNotes: string | null;
  audit: AccessAuditEvent[];
  emailDeliveries: AccessEmailDelivery[];
};

export type AccessMailboxAssignment = {
  id: string;
  mailAccountId: string;
  displayName: string;
  emailAddress: string;
  accessRole: MailboxAccessRole;
  isActive: boolean;
};

export type AccessAuditEvent = {
  id: string;
  actorUserId: string | null;
  targetUserId: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AccessEmailDelivery = {
  id: string;
  emailType: string;
  status: "sent" | "failed";
  providerMessageId: string | null;
  sentAt: string | null;
  failureCategory: string | null;
  actorUserId: string | null;
  correlationId: string;
  createdAt: string;
};

export type AccessStatus =
  | "invited"
  | "setup_incomplete"
  | "active"
  | "disabled"
  | "expired"
  | "auth_issue"
  | "profile_missing"
  | "auth_missing";

const profileColumns = [
  "id",
  "email",
  "full_name",
  "role",
  "access_type",
  "account_status",
  "setup_completed_at",
  "access_expires_at",
  "invited_by",
  "disabled_at",
  "disabled_by",
  "admin_notes",
  "must_set_password",
  "invitation_sent_at",
  "setup_reminder_sent_at",
  "password_reset_requested_at",
  "last_auth_email_status",
  "created_at",
  "updated_at",
].join(",");

const finalAdminMessage = "Vayvyx must retain at least one active platform administrator.";

export class AccessManagementService {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly authEmailService?: AuthEmailService
  ) {}

  async listPeople(auth: AuthContext, query: PeopleListQuery) {
    this.requireAdmin(auth);
    const directory = await this.loadDirectory();
    const lowerSearch = query.search.toLowerCase();

    return directory.people
      .filter((person) => {
        if (query.status !== "all" && person.status !== query.status) return false;
        if (query.platformRole !== "all" && person.platformRole !== query.platformRole) return false;
        if (query.accessType !== "all" && person.accessType !== query.accessType) return false;
        if (!lowerSearch) return true;

        return (
          person.email?.toLowerCase().includes(lowerSearch) ||
          person.fullName?.toLowerCase().includes(lowerSearch)
        );
      })
      .sort((a, b) => {
        const nameA = a.fullName ?? a.email ?? "";
        const nameB = b.fullName ?? b.email ?? "";
        return nameA.localeCompare(nameB);
      });
  }

  async getPerson(auth: AuthContext, userId: string): Promise<AccessPersonDetail> {
    this.requireAdmin(auth);
    const directory = await this.loadDirectory();
    const person = directory.people.find((item) => item.id === userId);

    if (!person) {
      throw new HttpError(404, "USER_NOT_FOUND", "Person was not found.");
    }

    const profile = directory.profilesById.get(userId) ?? null;

    return {
      ...person,
      adminNotes: profile?.admin_notes ?? null,
      audit: await this.listAuditEvents(auth, userId),
      emailDeliveries: await this.listEmailDeliveries(auth, userId),
    };
  }

  async invitePerson(
    auth: AuthContext,
    input: InvitePersonInput,
    redirectTo: string,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    const emailService = this.requireAuthEmailService();
    const existingUser = await this.findAuthUserByEmail(input.email);

    if (existingUser) {
      const existingPerson = await this.toExistingPerson(auth, existingUser.id);
      if (existingPerson?.status === "active") {
        return { result: "account_already_active" as const, person: existingPerson };
      }

      await this.prepareProfile(existingUser.id, input, auth.userId, "setup_incomplete");
      await this.upsertMailboxAssignments(
        auth,
        existingUser.id,
        input.mailboxAssignments,
        ipAddress
      );
      await this.recordAudit({
        actorUserId: auth.userId,
        targetUserId: existingUser.id,
        action: "profile_updated",
        metadata: { result: "existing_account_needs_access_assignment" },
        ipAddress,
      });

      const link = await emailService.generateInviteActionLink({
        email: input.email,
        fullName: input.fullName,
        redirectTo,
      });
      try {
        await emailService.sendWelcomeInvitation({
          to: input.email,
          targetUserId: existingUser.id,
          actorUserId: auth.userId,
          fullName: input.fullName,
          accessType: input.accessType,
          accessExpiresAt: input.accessExpiresAt,
          actionUrl: link.actionUrl,
          ipAddress,
        });
      } catch (error) {
        await this.admin
          .from("profiles")
          .update({
            account_status: "setup_incomplete",
            must_set_password: true,
            last_auth_email_status: "failed",
          })
          .eq("id", existingUser.id);
        throw new HttpError(502, "AUTH_EMAIL_SEND_FAILED", "Invitation email failed.", error);
      }

      const person = await this.getPerson(auth, existingUser.id);
      return {
        result:
          existingUser.confirmed_at || existingUser.email_confirmed_at
            ? ("existing_account_needs_access_assignment" as const)
            : ("invited" as const),
        person,
      };
    }

    const link = await emailService.generateInviteActionLink({
      email: input.email,
      fullName: input.fullName,
      redirectTo,
    });

    await this.prepareProfile(link.user.id, input, auth.userId, "invited");
    await this.upsertMailboxAssignments(
      auth,
      link.user.id,
      input.mailboxAssignments,
      ipAddress
    );
    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: link.user.id,
      action: "person_invited",
      metadata: {
        platformRole: input.platformRole,
        accessType: input.accessType,
        mailboxAssignmentCount: input.mailboxAssignments.length,
      },
      ipAddress,
    });

    try {
      await emailService.sendWelcomeInvitation({
        to: input.email,
        targetUserId: link.user.id,
        actorUserId: auth.userId,
        fullName: input.fullName,
        accessType: input.accessType,
        accessExpiresAt: input.accessExpiresAt,
        actionUrl: link.actionUrl,
        ipAddress,
      });
    } catch (error) {
      await this.admin
        .from("profiles")
        .update({
          account_status: "setup_incomplete",
          must_set_password: true,
          last_auth_email_status: "failed",
        })
        .eq("id", link.user.id);
      throw new HttpError(502, "AUTH_EMAIL_SEND_FAILED", "Invitation email failed.", error);
    }

    return {
      result: "invited" as const,
      person: await this.getPerson(auth, link.user.id),
    };
  }

  async completeInvite(
    auth: AuthContext,
    fullName: string,
    ipAddress?: string | null
  ) {
    if (
      auth.accountStatus !== "invited" &&
      auth.accountStatus !== "setup_incomplete" &&
      !auth.mustSetPassword
    ) {
      throw new HttpError(400, "INVALID_REQUEST", "Account setup is already complete.");
    }

    const now = new Date().toISOString();
    const email = auth.email?.toLowerCase() ?? null;
    const { error } = await this.admin.from("profiles").upsert(
      {
        id: auth.userId,
        email,
        full_name: fullName,
        account_status: "active",
        setup_completed_at: now,
        must_set_password: false,
      },
      { onConflict: "id" }
    );

    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Account setup could not be completed.");
    }

    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: auth.userId,
      action: "invite_completed",
      metadata: {
        emailConfirmed: Boolean(auth.user.confirmed_at || auth.user.email_confirmed_at),
      },
      ipAddress,
    });

    return { ok: true };
  }

  async updatePerson(
    auth: AuthContext,
    userId: string,
    input: UpdatePersonInput,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    const current = await this.getRequiredProfile(userId);

    if (
      current.role === "admin" &&
      input.platformRole === "user" &&
      input.confirmAdminDemotion !== true
    ) {
      throw new HttpError(400, "CONFIRMATION_REQUIRED", "Admin demotion requires confirmation.");
    }

    if (current.role === "admin" && input.platformRole === "user") {
      await this.assertFinalActiveAdminPreserved(userId);
    }

    const patch: Record<string, unknown> = {};
    if (input.fullName !== undefined) {
      patch.full_name = input.fullName;
      await this.admin.auth.admin.updateUserById(userId, {
        user_metadata: { full_name: input.fullName },
      });
    }
    if (input.platformRole !== undefined) patch.role = input.platformRole;
    if (input.accessType !== undefined) patch.access_type = input.accessType;
    if (input.accountStatus !== undefined) patch.account_status = input.accountStatus;
    if (input.accessExpiresAt !== undefined) patch.access_expires_at = input.accessExpiresAt;
    if (input.adminNotes !== undefined) patch.admin_notes = input.adminNotes;

    const { error } = await this.admin.from("profiles").update(patch).eq("id", userId);
    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Profile could not be updated.");
    }

    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: userId,
      action: "profile_updated",
      metadata: { fields: Object.keys(patch) },
      ipAddress,
    });

    return this.getPerson(auth, userId);
  }

  async sendPasswordReset(
    auth: AuthContext,
    userId: string,
    redirectTo: string,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    const target = await this.getTargetIdentity(userId);
    await this.requireAuthEmailService().sendPasswordReset({
      actorUserId: auth.userId,
      targetUserId: userId,
      email: target.email,
      fullName: target.fullName,
      redirectTo,
      ipAddress,
    });

    return { ok: true };
  }

  async resendInvite(
    auth: AuthContext,
    userId: string,
    redirectTo: string,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    const person = await this.getPerson(auth, userId);
    if (person.status === "active") {
      return { result: "account_already_active" as const, person };
    }

    const target = await this.getTargetIdentity(userId);
    const emailService = this.requireAuthEmailService();
    const link = await emailService.generateInviteActionLink({
      email: target.email,
      fullName: target.fullName ?? target.email,
      redirectTo,
    });
    await emailService.sendSetupReminder({
      to: target.email,
      targetUserId: userId,
      actorUserId: auth.userId,
      fullName: target.fullName,
      accessType: person.accessType,
      accessExpiresAt: person.accessExpiresAt,
      actionUrl: link.actionUrl,
      ipAddress,
    });

    await this.admin
      .from("profiles")
      .update({ account_status: "invited", must_set_password: true })
      .eq("id", userId);

    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: userId,
      action: "invitation_resent",
      metadata: {},
      ipAddress,
    });

    return { result: "invited" as const, person: await this.getPerson(auth, userId) };
  }

  async sendSetupReminder(
    auth: AuthContext,
    userId: string,
    redirectTo: string,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    const person = await this.getPerson(auth, userId);
    if (person.status === "active") {
      throw new HttpError(400, "INVALID_REQUEST", "This account is already active. Send a password reset instead.");
    }

    const target = await this.getTargetIdentity(userId);
    const emailService = this.requireAuthEmailService();
    const link = await emailService.generateInviteActionLink({
      email: target.email,
      fullName: target.fullName ?? target.email,
      redirectTo,
    });

    await emailService.sendSetupReminder({
      to: target.email,
      targetUserId: userId,
      actorUserId: auth.userId,
      fullName: target.fullName,
      accessType: person.accessType,
      accessExpiresAt: person.accessExpiresAt,
      actionUrl: link.actionUrl,
      ipAddress,
    });

    return { ok: true };
  }

  async disablePerson(
    auth: AuthContext,
    userId: string,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    if (auth.userId === userId) {
      throw new HttpError(400, "SELF_DISABLE_BLOCKED", "You cannot disable your own access.");
    }

    const profile = await this.getRequiredProfile(userId);
    if (profile.role === "admin") {
      await this.assertFinalActiveAdminPreserved(userId);
    }

    const now = new Date().toISOString();
    const { error } = await this.admin
      .from("profiles")
      .update({
        account_status: "disabled",
        disabled_at: now,
        disabled_by: auth.userId,
      })
      .eq("id", userId);

    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Account access could not be disabled.");
    }

    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: userId,
      action: "access_disabled",
      metadata: {},
      ipAddress,
    });

    return this.getPerson(auth, userId);
  }

  async reactivatePerson(
    auth: AuthContext,
    userId: string,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    const { error } = await this.admin
      .from("profiles")
      .update({
        account_status: "active",
        disabled_at: null,
        disabled_by: null,
      })
      .eq("id", userId);

    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Account access could not be reactivated.");
    }

    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: userId,
      action: "access_reactivated",
      metadata: {},
      ipAddress,
    });

    return this.getPerson(auth, userId);
  }

  async repairProfile(
    auth: AuthContext,
    userId: string,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    const { data, error } = await this.admin.auth.admin.getUserById(userId);
    if (error || !data.user) {
      throw new HttpError(404, "USER_NOT_FOUND", "Auth account was not found.");
    }

    const existing = await this.getProfile(userId);
    if (existing) {
      return this.getPerson(auth, userId);
    }

    const email = data.user.email?.toLowerCase() ?? null;
    const fullName = readFullName(data.user);
    const setupComplete = Boolean(data.user.confirmed_at || data.user.email_confirmed_at);
    const { error: insertError } = await this.admin.from("profiles").insert({
      id: userId,
      email,
      full_name: fullName,
      role: "user",
      access_type: "beta",
      account_status: setupComplete ? "active" : "setup_incomplete",
      setup_completed_at: setupComplete ? new Date().toISOString() : null,
      must_set_password: !setupComplete,
    });

    if (insertError) {
      throw new HttpError(400, "INVALID_REQUEST", "Profile could not be repaired.");
    }

    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: userId,
      action: "profile_repaired",
      metadata: {},
      ipAddress,
    });

    return this.getPerson(auth, userId);
  }

  async listMailboxPicker(auth: AuthContext) {
    this.requireAdmin(auth);
    const { data, error } = await this.admin
      .from("mail_accounts")
      .select("id,email_address,display_name,is_active")
      .order("email_address", { ascending: true });

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to load mailboxes.");
    }

    return (data ?? []).map((account) => ({
      id: account.id,
      emailAddress: account.email_address,
      displayName: account.display_name,
      isActive: account.is_active,
    }));
  }

  async listMailboxAssignments(auth: AuthContext, userId: string) {
    this.requireAdmin(auth);
    return this.loadMailboxAssignments([userId]).then((map) => map.get(userId) ?? []);
  }

  async addMailboxAssignment(
    auth: AuthContext,
    userId: string,
    mailAccountId: string,
    accessRole: MailboxAccessRole,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    const { data: existing } = await this.admin
      .from("mail_account_members")
      .select("id")
      .eq("user_id", userId)
      .eq("mail_account_id", mailAccountId)
      .maybeSingle();

    if (existing) {
      throw new HttpError(409, "DUPLICATE_MEMBERSHIP", "Mailbox access already exists.");
    }

    const { error } = await this.admin.from("mail_account_members").insert({
      user_id: userId,
      mail_account_id: mailAccountId,
      access_role: accessRole,
      created_by: auth.userId,
    });

    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Mailbox access could not be added.");
    }

    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: userId,
      action: "mailbox_access_added",
      metadata: { mailAccountId, accessRole },
      ipAddress,
    });

    return this.listMailboxAssignments(auth, userId);
  }

  async updateMailboxAssignment(
    auth: AuthContext,
    userId: string,
    mailAccountId: string,
    accessRole: MailboxAccessRole,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    await this.assertFinalMailboxOwnerPreserved(userId, mailAccountId, accessRole);
    const { error } = await this.admin
      .from("mail_account_members")
      .update({ access_role: accessRole })
      .eq("user_id", userId)
      .eq("mail_account_id", mailAccountId);

    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Mailbox access could not be updated.");
    }

    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: userId,
      action: "mailbox_access_updated",
      metadata: { mailAccountId, accessRole },
      ipAddress,
    });

    return this.listMailboxAssignments(auth, userId);
  }

  async removeMailboxAssignment(
    auth: AuthContext,
    userId: string,
    mailAccountId: string,
    ipAddress?: string | null
  ) {
    this.requireAdmin(auth);
    await this.assertFinalMailboxOwnerPreserved(userId, mailAccountId, null);
    const { error } = await this.admin
      .from("mail_account_members")
      .delete()
      .eq("user_id", userId)
      .eq("mail_account_id", mailAccountId);

    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Mailbox access could not be removed.");
    }

    await this.recordAudit({
      actorUserId: auth.userId,
      targetUserId: userId,
      action: "mailbox_access_removed",
      metadata: { mailAccountId },
      ipAddress,
    });

    return this.listMailboxAssignments(auth, userId);
  }

  async listAuditEvents(auth: AuthContext, userId: string): Promise<AccessAuditEvent[]> {
    this.requireAdmin(auth);
    const { data, error } = await this.admin
      .from("access_audit_log")
      .select("id,actor_user_id,target_user_id,action,metadata,created_at")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to load access history.");
    }

    return (data ?? []).map((event) => ({
      id: event.id,
      actorUserId: event.actor_user_id,
      targetUserId: event.target_user_id,
      action: event.action,
      metadata: sanitizeMetadata(event.metadata),
      createdAt: event.created_at,
    }));
  }

  async listEmailDeliveries(auth: AuthContext, userId: string): Promise<AccessEmailDelivery[]> {
    this.requireAdmin(auth);
    const { data, error } = await this.admin
      .from("auth_email_delivery_log")
      .select("id,email_type,status,provider_message_id,sent_at,failure_category,actor_user_id,correlation_id,created_at")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) {
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      emailType: row.email_type,
      status: row.status === "sent" ? "sent" : "failed",
      providerMessageId: row.provider_message_id,
      sentAt: row.sent_at,
      failureCategory: row.failure_category,
      actorUserId: row.actor_user_id,
      correlationId: row.correlation_id,
      createdAt: row.created_at,
    }));
  }

  private requireAdmin(auth: AuthContext) {
    if (auth.platformRole !== "admin") {
      throw new HttpError(403, "ACCESS_DENIED", "Platform administrator access is required.");
    }
  }

  private requireAuthEmailService() {
    if (!this.authEmailService) {
      throw new HttpError(500, "INTERNAL_ERROR", "Authentication email delivery is not configured.");
    }

    return this.authEmailService;
  }

  private async toExistingPerson(auth: AuthContext, userId: string) {
    try {
      return await this.getPerson(auth, userId);
    } catch {
      return null;
    }
  }

  private async loadDirectory() {
    const users = await this.listAuthUsers();
    const { data: profileRows, error } = await this.admin
      .from("profiles")
      .select(profileColumns);

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to load profiles.");
    }

    const profiles = (profileRows ?? []) as unknown as ProfileRow[];
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const userIds = Array.from(
      new Set([...users.map((user) => user.id), ...profiles.map((profile) => profile.id)])
    );
    const assignmentsByUser = await this.loadMailboxAssignments(userIds);
    const usersById = new Map(users.map((user) => [user.id, user]));

    return {
      profilesById,
      usersById,
      people: userIds.map((userId) =>
        this.toPersonSummary(
          usersById.get(userId) ?? null,
          profilesById.get(userId) ?? null,
          assignmentsByUser.get(userId) ?? []
        )
      ),
    };
  }

  private async listAuthUsers() {
    const users: User[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await this.admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });

      if (error) {
        throw new HttpError(500, "INTERNAL_ERROR", "Unable to load Auth users.");
      }

      users.push(...data.users);
      if (data.users.length < 1000) break;
    }

    return users;
  }

  private async findAuthUserByEmail(email: string) {
    const lower = email.toLowerCase();
    const users = await this.listAuthUsers();
    return users.find((user) => user.email?.toLowerCase() === lower) ?? null;
  }

  private async getProfile(userId: string) {
    const { data, error } = await this.admin
      .from("profiles")
      .select(profileColumns)
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to load profile.");
    }

    return (data as unknown as ProfileRow | null) ?? null;
  }

  private async getRequiredProfile(userId: string) {
    const profile = await this.getProfile(userId);
    if (!profile) {
      throw new HttpError(404, "PROFILE_NOT_FOUND", "Profile was not found.");
    }
    return profile;
  }

  private async getTargetIdentity(userId: string) {
    const { data } = await this.admin.auth.admin.getUserById(userId);
    const profile = await this.getProfile(userId);
    const email = data.user?.email?.toLowerCase() ?? profile?.email?.toLowerCase() ?? null;
    if (!email) {
      throw new HttpError(400, "EMAIL_UNAVAILABLE", "This account does not have an email address.");
    }

    return {
      email,
      fullName: profile?.full_name ?? (data.user ? readFullName(data.user) : null),
    };
  }

  private async prepareProfile(
    userId: string,
    input: InvitePersonInput,
    invitedBy: string,
    status: AccountStatus
  ) {
    const { error } = await this.admin.from("profiles").upsert(
      {
        id: userId,
        email: input.email,
        full_name: input.fullName,
        role: input.platformRole,
        access_type: input.accessType,
        account_status: status,
        setup_completed_at: null,
        must_set_password: true,
        access_expires_at: input.accessExpiresAt,
        invited_by: invitedBy,
        admin_notes: input.adminNotes,
      },
      { onConflict: "id" }
    );

    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Profile could not be prepared.");
    }
  }

  private async upsertMailboxAssignments(
    auth: AuthContext,
    userId: string,
    assignments: Array<{ mailAccountId: string; accessRole: MailboxAccessRole }>,
    ipAddress?: string | null
  ) {
    if (assignments.length === 0) return;
    const rows = assignments.map((assignment) => ({
      user_id: userId,
      mail_account_id: assignment.mailAccountId,
      access_role: assignment.accessRole,
      created_by: auth.userId,
    }));

    const { error } = await this.admin
      .from("mail_account_members")
      .upsert(rows, { onConflict: "mail_account_id,user_id", ignoreDuplicates: true });

    if (error) {
      throw new HttpError(400, "INVALID_REQUEST", "Mailbox access could not be assigned.");
    }

    for (const assignment of assignments) {
      await this.recordAudit({
        actorUserId: auth.userId,
        targetUserId: userId,
        action: "mailbox_access_added",
        metadata: {
          mailAccountId: assignment.mailAccountId,
          accessRole: assignment.accessRole,
        },
        ipAddress,
      });
    }
  }

  private async loadMailboxAssignments(userIds: string[]) {
    const result = new Map<string, AccessMailboxAssignment[]>();
    if (userIds.length === 0) return result;

    const { data, error } = await this.admin
      .from("mail_account_members")
      .select(
        "id,mail_account_id,user_id,access_role,created_at,updated_at,mail_accounts(id,email_address,display_name,is_active)"
      )
      .in("user_id", userIds);

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to load mailbox assignments.");
    }

    for (const row of (data ?? []) as unknown as MailAssignmentRow[]) {
      const account = row.mail_accounts;
      if (!account) continue;
      const assignment = {
        id: row.id,
        mailAccountId: row.mail_account_id,
        displayName: account.display_name,
        emailAddress: account.email_address,
        accessRole: row.access_role,
        isActive: account.is_active,
      };
      result.set(row.user_id, [...(result.get(row.user_id) ?? []), assignment]);
    }

    return result;
  }

  private toPersonSummary(
    user: User | null,
    profile: ProfileRow | null,
    assignedMailboxes: AccessMailboxAssignment[]
  ): AccessPersonSummary {
    const diagnostics: string[] = [];
    if (!user) diagnostics.push("Auth account missing");
    if (!profile) diagnostics.push("Profile missing");
    if (profile?.invitation_sent_at) diagnostics.push("Invitation sent");
    if (user && !user.email_confirmed_at && !user.confirmed_at) diagnostics.push("Email not confirmed");
    if (user && (user.email_confirmed_at || user.confirmed_at)) diagnostics.push("Email confirmed");
    if (profile?.must_set_password) diagnostics.push("Password not created");
    if (profile?.setup_completed_at) diagnostics.push("Setup complete");
    if (user?.banned_until && Date.parse(user.banned_until) > Date.now()) {
      diagnostics.push("Authentication issue");
    }
    if (assignedMailboxes.length > 0) diagnostics.push("Mailbox access assigned");

    const status = deriveStatus(user, profile);
    const email = user?.email?.toLowerCase() ?? profile?.email ?? null;
    const fullName = profile?.full_name ?? (user ? readFullName(user) : null);
    const invitationStatus = deriveInvitationStatus(user, profile);

    return {
      id: user?.id ?? profile?.id ?? "",
      email,
      fullName,
      status,
      statusLabel: statusLabel(status),
      platformRole: profile?.role ?? "user",
      accessType: profile?.access_type ?? "none",
      invitationStatus,
      setupCompletedAt: profile?.setup_completed_at ?? null,
      mustSetPassword: profile?.must_set_password ?? false,
      accessExpiresAt: profile?.access_expires_at ?? null,
      lastSignInAt: user?.last_sign_in_at ?? null,
      createdAt: user?.created_at ?? profile?.created_at ?? null,
      lastInvitationSentAt: profile?.invitation_sent_at ?? null,
      lastSetupReminderSentAt: profile?.setup_reminder_sent_at ?? null,
      lastPasswordResetRequestedAt: profile?.password_reset_requested_at ?? null,
      lastDeliveryResult: profile?.last_auth_email_status ?? null,
      assignedMailboxes,
      diagnostics,
      profileMissing: Boolean(user && !profile),
      authMissing: Boolean(profile && !user),
    };
  }

  private async assertFinalActiveAdminPreserved(targetUserId: string) {
    const { data, error } = await this.admin
      .from("profiles")
      .select("id,role,account_status,access_expires_at")
      .eq("role", "admin");

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to verify platform administrators.");
    }

    const activeAdmins = (data ?? []).filter((profile) => {
      if (profile.account_status !== "active") return false;
      if (profile.access_expires_at && Date.parse(profile.access_expires_at) <= Date.now()) {
        return false;
      }
      return true;
    });

    if (activeAdmins.length <= 1 && activeAdmins[0]?.id === targetUserId) {
      throw new HttpError(400, "FINAL_ADMIN_REQUIRED", finalAdminMessage);
    }
  }

  private async assertFinalMailboxOwnerPreserved(
    userId: string,
    mailAccountId: string,
    nextRole: MailboxAccessRole | null
  ) {
    const { data: account, error: accountError } = await this.admin
      .from("mail_accounts")
      .select("is_active")
      .eq("id", mailAccountId)
      .maybeSingle();

    if (accountError) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to verify mailbox.");
    }

    if (!account?.is_active) return;

    const { data, error } = await this.admin
      .from("mail_account_members")
      .select("user_id,access_role")
      .eq("mail_account_id", mailAccountId)
      .eq("access_role", "owner");

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to verify mailbox owners.");
    }

    const owners = data ?? [];
    if (owners.length === 1 && owners[0]?.user_id === userId && nextRole !== "owner") {
      throw new HttpError(400, "FINAL_MAILBOX_OWNER_REQUIRED", "An active mailbox must retain at least one owner.");
    }
  }

  private async recordAudit(input: {
    actorUserId: string;
    targetUserId: string;
    action: string;
    metadata: Record<string, unknown>;
    ipAddress?: string | null;
  }) {
    const { error } = await this.admin.from("access_audit_log").insert({
      actor_user_id: input.actorUserId,
      target_user_id: input.targetUserId,
      action: input.action,
      metadata: sanitizeMetadata(input.metadata),
      ip_address: input.ipAddress ?? null,
    });

    if (error) {
      console.error("Unable to write access audit event", {
        action: input.action,
        targetUserId: input.targetUserId,
      });
    }
  }
}

function deriveStatus(user: User | null, profile: ProfileRow | null): AccessStatus {
  if (!user) return "auth_missing";
  if (!profile) return "profile_missing";
  if (user.banned_until && Date.parse(user.banned_until) > Date.now()) return "auth_issue";
  if (profile.account_status === "disabled") return "disabled";
  if (
    profile.access_expires_at &&
    Date.parse(profile.access_expires_at) <= Date.now()
  ) {
    return "expired";
  }
  if (profile.account_status === "invited") return "invited";
  if (profile.account_status === "setup_incomplete") return "setup_incomplete";
  if (profile.must_set_password || !profile.setup_completed_at) return "setup_incomplete";
  if (!user.email_confirmed_at && !user.confirmed_at) return "setup_incomplete";
  return "active";
}

function deriveInvitationStatus(
  user: User | null,
  profile: ProfileRow | null
): AccessPersonSummary["invitationStatus"] {
  if (profile?.setup_completed_at) return "complete";
  if (profile?.account_status === "invited" || user?.invited_at) return "invited";
  if (profile?.account_status === "setup_incomplete") return "setup_incomplete";
  return "not_invited";
}

function statusLabel(status: AccessStatus) {
  const labels: Record<AccessStatus, string> = {
    invited: "Invited",
    setup_incomplete: "Setup incomplete",
    active: "Active",
    disabled: "Disabled",
    expired: "Access expired",
    auth_issue: "Authentication issue",
    profile_missing: "Profile missing",
    auth_missing: "Auth account missing",
  };
  return labels[status];
}

function readFullName(user: User) {
  const value = user.user_metadata?.full_name ?? user.user_metadata?.display_name;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const blocked = new Set([
    "password",
    "token",
    "access_token",
    "refresh_token",
    "action_link",
    "recovery_link",
    "invitation_link",
    "hashed_token",
    "email_otp",
    "verification_type",
    "redirect_to",
  ]);
  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (blocked.has(key.toLowerCase())) continue;
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      result[key] = item;
    }
  }

  return result;
}
