import { z } from "zod";

export const uidParamSchema = z.object({
  mailAccountId: z.string().uuid(),
  uid: z.coerce.number().int().positive(),
});

export const attachmentParamSchema = uidParamSchema.extend({
  attachmentId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/),
});

const folderSchema = z.string().trim().min(1).max(500);

export const optionalQueryBoolean = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  return value;
}, z.boolean().optional());

export const messageListQuerySchema = z.object({
  folder: folderSchema.default("INBOX"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(200).optional(),
  unreadOnly: optionalQueryBoolean.default(false),
  flaggedOnly: optionalQueryBoolean.default(false),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

export const folderQuerySchema = z.object({
  folder: folderSchema.default("INBOX"),
});

export const readMutationSchema = z.object({
  folder: folderSchema,
  read: z.boolean(),
});

export const flagMutationSchema = z.object({
  folder: folderSchema,
  flagged: z.boolean(),
});

export const moveMutationSchema = z.object({
  sourceFolder: folderSchema,
  destinationFolder: folderSchema,
});

export const unifiedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().max(1000).optional(),
  search: z.string().trim().max(200).optional(),
  unreadOnly: optionalQueryBoolean.default(false),
  flaggedOnly: optionalQueryBoolean.default(false),
});

const recipientSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .refine((value) => !/[\r\n]/.test(value), "Header injection is not allowed.");

export const sendJsonSchema = z.object({
  mode: z.enum(["compose", "reply", "replyAll", "forward"]).default("compose"),
  identityId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  templateVariables: z
    .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), z.string().max(2000))
    .default({}),
  to: z.array(recipientSchema).max(50).default([]),
  cc: z.array(recipientSchema).max(50).default([]),
  bcc: z.array(recipientSchema).max(50).default([]),
  subject: z
    .string()
    .max(500)
    .refine((value) => !/[\r\n]/.test(value), "Header injection is not allowed."),
  textBody: z.string().max(200_000).default(""),
  sanitizedHtmlBody: z.string().max(200_000).optional(),
  originalFolder: folderSchema.optional(),
  originalUid: z.coerce.number().int().positive().optional(),
  inReplyTo: z
    .string()
    .max(1000)
    .optional()
    .refine((value) => !value || !/[\r\n]/.test(value), "Header injection is not allowed."),
  references: z.array(z.string().max(1000)).max(50).default([]),
});
