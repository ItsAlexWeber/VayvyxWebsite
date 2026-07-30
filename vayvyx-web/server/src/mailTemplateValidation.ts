import { z } from "zod";
import { mailTemplateScopes } from "./mailTemplateTypes.js";

const nullableTrimmed = z
  .preprocess((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return value;
  }, z.string().max(1000).nullable());

const nullableSubject = z
  .preprocess((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return value;
  }, z.string().max(500).nullable())
  .refine((value) => !value || !/[\r\n]/.test(value), "Header injection is not allowed.");

const templateVariableMap = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), z.string().max(2000))
  .default({});

export const templateIdParamSchema = z.object({
  templateId: z.string().uuid(),
});

export const templateAssetParamSchema = templateIdParamSchema.extend({
  assetId: z.string().uuid(),
});

export const templateListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  scope: z.enum(mailTemplateScopes).optional(),
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: nullableTrimmed,
  subjectTemplate: nullableSubject,
  htmlContent: z.string().min(1).max(500_000),
  plainTextContent: z.string().max(500_000).nullable().optional(),
  scope: z.enum(mailTemplateScopes).default("personal"),
  defaultMailAccountId: z.string().uuid().nullable().optional(),
  previewMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const updateTemplateSchema = createTemplateSchema
  .partial()
  .extend({
    description: nullableTrimmed.optional(),
    subjectTemplate: nullableSubject.optional(),
    defaultMailAccountId: z.string().uuid().nullable().optional(),
  });

export const duplicateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  scope: z.enum(["personal", "company"]).optional(),
  defaultMailAccountId: z.string().uuid().nullable().optional(),
});

export const renderTemplateSchema = z.object({
  variables: templateVariableMap,
});

export const validateTemplateVariablesSchema = z.object({
  subjectTemplate: z.string().max(500).nullable().optional(),
  htmlContent: z.string().min(1).max(500_000),
  plainTextContent: z.string().max(500_000).nullable().optional(),
  variables: templateVariableMap,
  allowUnresolved: z.boolean().default(false),
});

export const sendTemplateTestSchema = z.object({
  mailAccountId: z.string().uuid(),
  to: z.string().trim().email().max(320).toLowerCase(),
  variables: templateVariableMap,
});

export const sendAuthTemplateTestSchema = z.object({
  to: z.string().trim().email().max(320).toLowerCase(),
});

export const importTemplateFieldsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: nullableTrimmed,
  subjectTemplate: nullableSubject,
  scope: z.enum(["personal", "company"]).default("personal"),
  defaultMailAccountId: z.string().uuid().nullable().optional(),
  htmlContent: z.string().min(1).max(500_000).optional(),
  plainTextContent: z.string().max(500_000).nullable().optional(),
});
