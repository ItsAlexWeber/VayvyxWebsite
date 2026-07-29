import { z } from "zod";
import { mailboxAccessRoles } from "./types.js";

const nullableTrimmed = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => (value ? value : null));

export const uuidParamSchema = z.object({
  mailAccountId: z.string().uuid(),
});

export const memberParamSchema = uuidParamSchema.extend({
  userId: z.string().uuid(),
});

export const mailAccountBaseSchema = z.object({
  emailAddress: z.string().trim().email().max(320).toLowerCase(),
  displayName: z.string().trim().min(1).max(160),
  description: nullableTrimmed,
  username: z.string().trim().min(1).max(320),
  imapHost: z.string().trim().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535),
  imapSecure: z.boolean(),
  smtpHost: z.string().trim().min(1).max(255),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  fromName: nullableTrimmed,
  replyToAddress: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  maxAttachmentMb: z.number().int().min(1).max(100).default(25),
  isActive: z.boolean().optional(),
});

export const createMailAccountSchema = mailAccountBaseSchema.extend({
  password: z.string().min(1).max(4096),
  initialMembers: z
    .array(
      z.object({
        userId: z.string().uuid(),
        accessRole: z.enum(mailboxAccessRoles),
      })
    )
    .default([]),
});

export const updateMailAccountSchema = mailAccountBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  });

export const rotateCredentialsSchema = z.object({
  password: z.string().min(1).max(4096),
});

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  accessRole: z.enum(mailboxAccessRoles),
});

export const updateMemberSchema = z.object({
  accessRole: z.enum(mailboxAccessRoles),
});

export const testMessageSchema = z.object({
  to: z.string().trim().email().max(320).optional(),
});

export const userSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
});
