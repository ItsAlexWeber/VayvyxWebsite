import { z } from "zod";
import {
  accessTypes,
  accountStatuses,
  mailboxAccessRoles,
  platformRoles,
} from "./types.js";

const nullableTrimmed = z
  .preprocess(
    (value) => (typeof value === "string" ? value.trim() || null : value),
    z.string().max(2_000).nullable().optional()
  )
  .transform((value) => value ?? null);

const nullableDate = z
  .preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().datetime({ offset: true }).nullable().optional()
  )
  .transform((value) => value ?? null);

export const accessUserParamSchema = z.object({
  userId: z.string().uuid(),
});

export const accessMailboxParamSchema = accessUserParamSchema.extend({
  mailAccountId: z.string().uuid(),
});

export const peopleListQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  status: z
    .enum([
      "all",
      "invited",
      "setup_incomplete",
      "active",
      "disabled",
      "expired",
      "auth_issue",
      "profile_missing",
      "auth_missing",
    ])
    .optional()
    .default("all"),
  platformRole: z.enum(["all", ...platformRoles]).optional().default("all"),
  accessType: z.enum(["all", ...accessTypes]).optional().default("all"),
});

export const invitePersonSchema = z.object({
  email: z.string().trim().email().max(320).toLowerCase(),
  fullName: z.string().trim().min(1).max(160),
  platformRole: z.enum(platformRoles).default("user"),
  accessType: z.enum(accessTypes).default("beta"),
  accessExpiresAt: nullableDate,
  mailboxAssignments: z
    .array(
      z.object({
        mailAccountId: z.string().uuid(),
        accessRole: z.enum(mailboxAccessRoles),
      })
    )
    .default([]),
  adminNotes: nullableTrimmed,
});

export const completeInviteSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
});

export const updatePersonSchema = z
  .object({
    fullName: z.string().trim().min(1).max(160).optional(),
    platformRole: z.enum(platformRoles).optional(),
    accessType: z.enum(accessTypes).optional(),
    accountStatus: z.enum(accountStatuses).optional(),
    accessExpiresAt: nullableDate.optional(),
    adminNotes: nullableTrimmed.optional(),
    confirmAdminDemotion: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.platformRole !== undefined ||
      value.accessType !== undefined ||
      value.accountStatus !== undefined ||
      value.accessExpiresAt !== undefined ||
      value.adminNotes !== undefined,
    { message: "At least one field is required." }
  );

export const disablePersonSchema = z.object({
  confirmDisable: z.literal(true),
});

export const mailboxAssignmentSchema = z.object({
  mailAccountId: z.string().uuid(),
  accessRole: z.enum(mailboxAccessRoles),
});

export const updateMailboxAssignmentSchema = z.object({
  accessRole: z.enum(mailboxAccessRoles),
});
