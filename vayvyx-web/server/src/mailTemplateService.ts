import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { hasMailboxRole } from "./auth.js";
import type { AuditLogger } from "./audit.js";
import { HttpError } from "./httpError.js";
import {
  detectAssetContentType,
  importHtmlTemplatePackage,
  importZipTemplatePackage,
  normalizeAssetReference,
  sanitizeTemplateFilename,
} from "./mailTemplateImport.js";
import {
  builtInTemplateVariables,
  detectTemplateVariables,
  renderTemplateContent,
  sanitizeEmailTemplateHtml,
  unresolvedTemplateVariables,
} from "./mailTemplateSanitizer.js";
import { canEditTemplate, canReadTemplate } from "./mailTemplatePermissions.js";
import type {
  MailTemplateAssetRow,
  MailTemplateAssetSummary,
  MailTemplateDetail,
  MailTemplateExport,
  MailTemplateInlineAsset,
  MailTemplateRendered,
  MailTemplateRow,
  MailTemplateScope,
  MailTemplateSummary,
  TemplateImportPackage,
} from "./mailTemplateTypes.js";
import type { AuthContext, MailboxAccessRole } from "./types.js";

type CreateTemplateInput = {
  name: string;
  description: string | null;
  subjectTemplate: string | null;
  htmlContent: string;
  plainTextContent?: string | null;
  scope: MailTemplateScope;
  defaultMailAccountId?: string | null;
  previewMetadata?: Record<string, unknown> | null;
};

type UpdateTemplateInput = Partial<CreateTemplateInput>;

type DuplicateTemplateInput = {
  name?: string;
  scope?: "personal" | "company";
  defaultMailAccountId?: string | null;
};

type TemplateListInput = {
  search?: string;
  scope?: MailTemplateScope;
};

const templateColumns = [
  "id",
  "name",
  "description",
  "subject_template",
  "html_content",
  "plain_text_content",
  "scope",
  "created_by",
  "updated_by",
  "default_mail_account_id",
  "preview_metadata",
  "is_active",
  "created_at",
  "updated_at",
].join(",");

const assetColumns = [
  "id",
  "template_id",
  "filename",
  "content_type",
  "byte_size",
  "cid",
  "content_base64",
  "created_by",
  "created_at",
].join(",");

export class MailTemplateService {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly audit: AuditLogger
  ) {}

  async listTemplates(auth: AuthContext, input: TemplateListInput): Promise<MailTemplateSummary[]> {
    const { data, error } = await this.admin
      .from("mail_templates")
      .select(templateColumns)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to load templates.");
    }

    const normalizedSearch = input.search?.trim().toLowerCase() ?? "";
    const rows = await this.filterReadable(auth, (data ?? []) as unknown as MailTemplateRow[]);

    return rows
      .filter((row) => !input.scope || row.scope === input.scope)
      .filter((row) => {
        if (!normalizedSearch) return true;
        return [row.name, row.description ?? "", row.subject_template ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .map(toTemplateSummary);
  }

  async getTemplate(auth: AuthContext, templateId: string): Promise<MailTemplateDetail> {
    const row = await this.getTemplateRow(templateId);
    await this.requireRead(auth, row);
    const assets = await this.listAssetRows(templateId);
    return toTemplateDetail(row, assets);
  }

  async createTemplate(
    auth: AuthContext,
    input: CreateTemplateInput,
    ipAddress?: string | null
  ): Promise<MailTemplateDetail> {
    await this.requireCreateScope(auth, input.scope, input.defaultMailAccountId ?? null);
    const sanitized = sanitizeCanonicalTemplate(input.htmlContent, new Map());
    const { data, error } = await this.admin
      .from("mail_templates")
      .insert({
        name: input.name,
        description: input.description,
        subject_template: input.subjectTemplate,
        html_content: sanitized.html,
        plain_text_content: input.plainTextContent ?? null,
        scope: input.scope,
        created_by: auth.userId,
        updated_by: auth.userId,
        default_mail_account_id: input.defaultMailAccountId ?? null,
        preview_metadata: input.previewMetadata ?? null,
        is_active: true,
      })
      .select(templateColumns)
      .single();

    if (error || !data) {
      throw new HttpError(500, "INTERNAL_ERROR", "Template could not be created.");
    }

    const row = data as unknown as MailTemplateRow;
    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: row.default_mail_account_id,
      action: "template_created",
      targetType: "mail_template",
      targetIdentifier: row.id,
      metadata: { scope: row.scope },
      ipAddress,
    });

    return toTemplateDetail(row, []);
  }

  async updateTemplate(
    auth: AuthContext,
    templateId: string,
    input: UpdateTemplateInput,
    ipAddress?: string | null
  ): Promise<MailTemplateDetail> {
    const existing = await this.getTemplateRow(templateId);
    await this.requireEdit(auth, existing);

    const nextScope = input.scope ?? existing.scope;
    const nextAccountId =
      input.defaultMailAccountId !== undefined
        ? input.defaultMailAccountId
        : existing.default_mail_account_id;
    await this.requireCreateScope(auth, nextScope, nextAccountId ?? null);

    const patch: Record<string, unknown> = {
      updated_by: auth.userId,
    };

    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.subjectTemplate !== undefined) patch.subject_template = input.subjectTemplate;
    if (input.htmlContent !== undefined) {
      const assets = await this.listAssetRows(templateId);
      const assetMap = new Map(assets.map((asset) => [`cid:${asset.cid}`, asset.cid]));
      patch.html_content = sanitizeCanonicalTemplate(input.htmlContent, assetMap).html;
    }
    if (input.plainTextContent !== undefined) patch.plain_text_content = input.plainTextContent;
    if (input.scope !== undefined) patch.scope = input.scope;
    if (input.defaultMailAccountId !== undefined) patch.default_mail_account_id = input.defaultMailAccountId;
    if (input.previewMetadata !== undefined) patch.preview_metadata = input.previewMetadata;

    const { data, error } = await this.admin
      .from("mail_templates")
      .update(patch)
      .eq("id", templateId)
      .select(templateColumns)
      .single();

    if (error || !data) {
      throw new HttpError(500, "INTERNAL_ERROR", "Template could not be updated.");
    }

    const row = data as unknown as MailTemplateRow;
    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: row.default_mail_account_id,
      action: "template_updated",
      targetType: "mail_template",
      targetIdentifier: row.id,
      metadata: { scope: row.scope },
      ipAddress,
    });

    return this.getTemplate(auth, templateId);
  }

  async duplicateTemplate(
    auth: AuthContext,
    templateId: string,
    input: DuplicateTemplateInput,
    ipAddress?: string | null
  ): Promise<MailTemplateDetail> {
    const source = await this.getTemplateRow(templateId);
    await this.requireRead(auth, source);

    const nextScope = input.scope ?? (source.scope === "system" ? "personal" : source.scope);
    const nextAccountId =
      input.defaultMailAccountId !== undefined
        ? input.defaultMailAccountId
        : nextScope === "company"
          ? source.default_mail_account_id
          : null;
    await this.requireCreateScope(auth, nextScope, nextAccountId);

    const { data, error } = await this.admin
      .from("mail_templates")
      .insert({
        name: input.name ?? `${source.name} copy`,
        description: source.description,
        subject_template: source.subject_template,
        html_content: source.html_content,
        plain_text_content: source.plain_text_content,
        scope: nextScope,
        created_by: auth.userId,
        updated_by: auth.userId,
        default_mail_account_id: nextAccountId,
        preview_metadata: source.preview_metadata,
        is_active: true,
      })
      .select(templateColumns)
      .single();

    if (error || !data) {
      throw new HttpError(500, "INTERNAL_ERROR", "Template could not be duplicated.");
    }

    const row = data as unknown as MailTemplateRow;
    const sourceAssets = await this.listAssetRows(source.id);
    if (sourceAssets.length > 0) {
      const { error: assetError } = await this.admin.from("mail_template_assets").insert(
        sourceAssets.map((asset) => ({
          template_id: row.id,
          filename: asset.filename,
          content_type: asset.content_type,
          byte_size: asset.byte_size,
          cid: asset.cid,
          content_base64: asset.content_base64,
          created_by: auth.userId,
        }))
      );

      if (assetError) {
        throw new HttpError(500, "INTERNAL_ERROR", "Template assets could not be duplicated.");
      }
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: row.default_mail_account_id,
      action: "template_duplicated",
      targetType: "mail_template",
      targetIdentifier: row.id,
      metadata: { sourceTemplateId: source.id, scope: row.scope },
      ipAddress,
    });

    return this.getTemplate(auth, row.id);
  }

  async deactivateTemplate(auth: AuthContext, templateId: string, ipAddress?: string | null) {
    const row = await this.getTemplateRow(templateId);
    await this.requireEdit(auth, row);

    const { error } = await this.admin
      .from("mail_templates")
      .update({ is_active: false, updated_by: auth.userId })
      .eq("id", templateId);

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Template could not be deleted.");
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: row.default_mail_account_id,
      action: "template_deleted",
      targetType: "mail_template",
      targetIdentifier: row.id,
      metadata: { scope: row.scope },
      ipAddress,
    });

    return { ok: true };
  }

  async importTemplate(
    auth: AuthContext,
    input: Omit<CreateTemplateInput, "htmlContent"> & { htmlContent?: string },
    file: Express.Multer.File | undefined,
    ipAddress?: string | null
  ): Promise<MailTemplateDetail> {
    await this.requireCreateScope(auth, input.scope, input.defaultMailAccountId ?? null);
    const templatePackage = loadImportPackage(input, file);
    const assetMap = new Map(
      templatePackage.assets.map((asset) => [normalizeAssetReference(asset.originalPath), asset.cid])
    );
    const sanitized = sanitizeCanonicalTemplate(templatePackage.html, assetMap);
    const created = await this.createTemplate(
      auth,
      {
        ...input,
        htmlContent: sanitized.html,
        plainTextContent: input.plainTextContent ?? templatePackage.plainText,
      },
      ipAddress
    );

    if (templatePackage.assets.length > 0) {
      const { error } = await this.admin.from("mail_template_assets").insert(
        templatePackage.assets.map((asset) => ({
          template_id: created.id,
          filename: asset.filename,
          content_type: asset.contentType,
          byte_size: asset.content.byteLength,
          cid: asset.cid,
          content_base64: asset.content.toString("base64"),
          created_by: auth.userId,
        }))
      );

      if (error) {
        throw new HttpError(500, "INTERNAL_ERROR", "Template assets could not be stored.");
      }
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: created.defaultMailAccountId,
      action: "template_imported",
      targetType: "mail_template",
      targetIdentifier: created.id,
      metadata: { scope: created.scope, assetCount: templatePackage.assets.length },
      ipAddress,
    });

    return this.getTemplate(auth, created.id);
  }

  async exportTemplate(
    auth: AuthContext,
    templateId: string,
    ipAddress?: string | null
  ): Promise<MailTemplateExport> {
    const detail = await this.getTemplate(auth, templateId);
    const assets = await this.listAssetRows(templateId);

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: detail.defaultMailAccountId,
      action: "template_exported",
      targetType: "mail_template",
      targetIdentifier: detail.id,
      metadata: { scope: detail.scope, assetCount: assets.length },
      ipAddress,
    });

    return {
      filename: `${detail.name.replace(/[^\w.-]+/g, "_") || "mail-template"}.json`,
      template: detail,
      assets: assets.map((asset) => ({
        ...toAssetSummary(asset),
        contentBase64: asset.content_base64,
      })),
    };
  }

  async uploadAsset(
    auth: AuthContext,
    templateId: string,
    file: Express.Multer.File,
    ipAddress?: string | null
  ): Promise<MailTemplateAssetSummary> {
    const row = await this.getTemplateRow(templateId);
    await this.requireEdit(auth, row);
    const filename = sanitizeTemplateFilename(file.originalname);
    const content = file.buffer;
    const contentType = detectAssetContentType(filename, content);
    const cid = `${randomUUID()}@vayvyx-template`;

    const { data, error } = await this.admin
      .from("mail_template_assets")
      .insert({
        template_id: templateId,
        filename,
        content_type: contentType,
        byte_size: content.byteLength,
        cid,
        content_base64: content.toString("base64"),
        created_by: auth.userId,
      })
      .select(assetColumns)
      .single();

    if (error || !data) {
      throw new HttpError(500, "INTERNAL_ERROR", "Template asset could not be uploaded.");
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: row.default_mail_account_id,
      action: "template_updated",
      targetType: "mail_template_asset",
      targetIdentifier: String((data as { id?: string }).id ?? templateId),
      metadata: { assetAction: "uploaded", contentType, byteSize: content.byteLength },
      ipAddress,
    });

    return toAssetSummary(data as unknown as MailTemplateAssetRow);
  }

  async removeAsset(
    auth: AuthContext,
    templateId: string,
    assetId: string,
    ipAddress?: string | null
  ) {
    const row = await this.getTemplateRow(templateId);
    await this.requireEdit(auth, row);
    const { error } = await this.admin
      .from("mail_template_assets")
      .delete()
      .eq("id", assetId)
      .eq("template_id", templateId);

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Template asset could not be removed.");
    }

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: row.default_mail_account_id,
      action: "template_updated",
      targetType: "mail_template_asset",
      targetIdentifier: assetId,
      metadata: { assetAction: "removed" },
      ipAddress,
    });

    return { ok: true };
  }

  async renderTemplate(
    auth: AuthContext,
    templateId: string,
    variables: Record<string, string>,
    options: { allowUnresolved?: boolean } = {}
  ): Promise<MailTemplateRendered> {
    const detail = await this.getTemplate(auth, templateId);
    return renderStoredTemplate(detail, variables, options.allowUnresolved === true);
  }

  async renderTemplateForSend(
    auth: AuthContext,
    templateId: string,
    variables: Record<string, string>,
    ipAddress?: string | null
  ): Promise<MailTemplateRendered & { inlineAssets: MailTemplateInlineAsset[]; defaultMailAccountId: string | null }> {
    const detail = await this.getTemplate(auth, templateId);
    const rendered = renderStoredTemplate(detail, variables, false);
    const assetRows = await this.listAssetRows(templateId);

    await this.audit.record({
      actorUserId: auth.userId,
      mailAccountId: detail.defaultMailAccountId,
      action: "template_used",
      targetType: "mail_template",
      targetIdentifier: detail.id,
      metadata: { scope: detail.scope, assetCount: assetRows.length },
      ipAddress,
    });

    return {
      ...rendered,
      defaultMailAccountId: detail.defaultMailAccountId,
      inlineAssets: assetRows.map((asset) => ({
        cid: asset.cid,
        filename: asset.filename,
        contentType: asset.content_type,
        contentBase64: asset.content_base64,
      })),
    };
  }

  validateVariables(
    subjectTemplate: string | null | undefined,
    htmlContent: string,
    plainTextContent: string | null | undefined,
    variables: Record<string, string>,
    allowUnresolved: boolean
  ) {
    const merged = { ...builtInTemplateVariables(), ...variables };
    const unresolved = unresolvedTemplateVariables(
      [subjectTemplate, htmlContent, plainTextContent],
      merged
    );

    if (unresolved.length > 0 && !allowUnresolved) {
      throw new HttpError(400, "UNRESOLVED_VARIABLES", "Template variables are missing.");
    }

    return {
      variables: detectTemplateVariables([subjectTemplate ?? "", htmlContent, plainTextContent ?? ""].join("\n")),
      unresolvedVariables: unresolved,
    };
  }

  private async getTemplateRow(templateId: string) {
    const { data, error } = await this.admin
      .from("mail_templates")
      .select(templateColumns)
      .eq("id", templateId)
      .maybeSingle();

    if (error || !data) {
      throw new HttpError(404, "TEMPLATE_NOT_FOUND", "Template was not found.");
    }

    return data as unknown as MailTemplateRow;
  }

  private async listAssetRows(templateId: string) {
    const { data, error } = await this.admin
      .from("mail_template_assets")
      .select(assetColumns)
      .eq("template_id", templateId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Template assets could not be loaded.");
    }

    return (data ?? []) as unknown as MailTemplateAssetRow[];
  }

  private async filterReadable(auth: AuthContext, rows: MailTemplateRow[]) {
    const readable: MailTemplateRow[] = [];
    for (const row of rows) {
      if (await this.canRead(auth, row)) readable.push(row);
    }
    return readable;
  }

  private async requireRead(auth: AuthContext, row: MailTemplateRow) {
    if (!(await this.canRead(auth, row))) {
      throw new HttpError(404, "TEMPLATE_NOT_FOUND", "Template was not found.");
    }
  }

  private async requireEdit(auth: AuthContext, row: MailTemplateRow) {
    const mailboxRole = row.default_mail_account_id
      ? await this.getMailboxRole(auth, row.default_mail_account_id)
      : null;

    if (!canEditTemplate({ userId: auth.userId, platformRole: auth.platformRole, mailboxRole }, row)) {
      if (row.scope === "system") {
        throw new HttpError(403, "ACCESS_DENIED", "System templates are read-only. Duplicate first.");
      }
      throw new HttpError(403, "ACCESS_DENIED", "Template access is denied.");
    }
  }

  private async requireCreateScope(
    auth: AuthContext,
    scope: MailTemplateScope,
    mailAccountId: string | null
  ) {
    if (scope === "system") {
      throw new HttpError(403, "UNAUTHORIZED_SCOPE", "System templates cannot be written from the browser.");
    }

    if (scope === "personal") {
      if (mailAccountId) {
        await this.requireMailboxVisibility(auth, mailAccountId);
      }
      return;
    }

    if (!mailAccountId) {
      if (auth.platformRole === "admin") return;
      throw new HttpError(403, "UNAUTHORIZED_SCOPE", "Company templates must be tied to a managed mailbox.");
    }

    if (auth.platformRole === "admin") return;

    if (!(await this.hasMailboxRole(auth, mailAccountId, "manager"))) {
      throw new HttpError(403, "UNAUTHORIZED_SCOPE", "Mailbox manager access is required for company templates.");
    }
  }

  private async requireMailboxVisibility(auth: AuthContext, mailAccountId: string) {
    if (auth.platformRole === "admin") return;
    if (!(await this.hasMailboxRole(auth, mailAccountId, "viewer"))) {
      throw new HttpError(403, "ACCESS_DENIED", "Mailbox access is denied.");
    }
  }

  private async canRead(auth: AuthContext, row: MailTemplateRow) {
    const mailboxRole = row.default_mail_account_id
      ? await this.getMailboxRole(auth, row.default_mail_account_id)
      : null;
    return canReadTemplate({ userId: auth.userId, platformRole: auth.platformRole, mailboxRole }, row);
  }

  private async hasMailboxRole(
    auth: AuthContext,
    mailAccountId: string,
    requiredRole: MailboxAccessRole
  ) {
    if (auth.platformRole === "admin") return true;

    const { data, error } = await this.admin
      .from("mail_account_members")
      .select("access_role")
      .eq("mail_account_id", mailAccountId)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to verify mailbox access.");
    }

    return Boolean(data && hasMailboxRole(data.access_role, requiredRole));
  }

  private async getMailboxRole(auth: AuthContext, mailAccountId: string) {
    if (auth.platformRole === "admin") return "admin" as const;

    const { data, error } = await this.admin
      .from("mail_account_members")
      .select("access_role")
      .eq("mail_account_id", mailAccountId)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "INTERNAL_ERROR", "Unable to verify mailbox access.");
    }

    return data?.access_role ?? null;
  }
}

function loadImportPackage(
  input: Omit<CreateTemplateInput, "htmlContent"> & { htmlContent?: string },
  file: Express.Multer.File | undefined
): TemplateImportPackage {
  if (input.htmlContent) {
    return {
      html: input.htmlContent,
      plainText: input.plainTextContent ?? null,
      assets: [],
    };
  }

  if (!file) {
    throw new HttpError(400, "INVALID_REQUEST", "Provide HTML content or a template file.");
  }

  const extension = file.originalname.toLowerCase().split(".").pop();
  if (extension === "zip") return importZipTemplatePackage(file);
  if (extension === "html" || extension === "htm") return importHtmlTemplatePackage(file);

  throw new HttpError(400, "UNSUPPORTED_FILE_TYPE", "Template import file type is not supported.");
}

function sanitizeCanonicalTemplate(htmlContent: string, assetMap: Map<string, string>) {
  const expandedAssetMap = new Map<string, string>();
  for (const [source, cid] of assetMap.entries()) {
    expandedAssetMap.set(normalizeAssetReference(source), cid);
    expandedAssetMap.set(source, cid);
  }

  return sanitizeEmailTemplateHtml(htmlContent, {
    assetCidBySource: expandedAssetMap,
    allowCidImages: true,
  });
}

function renderStoredTemplate(
  detail: MailTemplateDetail,
  variables: Record<string, string>,
  allowUnresolved: boolean
) {
  const merged = { ...builtInTemplateVariables(), ...variables };
  const unresolvedVariables = unresolvedTemplateVariables(
    [detail.subjectTemplate, detail.htmlContent, detail.plainTextContent],
    merged
  );

  if (unresolvedVariables.length > 0 && !allowUnresolved) {
    throw new HttpError(400, "UNRESOLVED_VARIABLES", "Template variables are missing.");
  }

  return {
    subject: renderTemplateContent(detail.subjectTemplate ?? "", merged, { html: false }),
    htmlContent: renderTemplateContent(detail.htmlContent, merged, { html: true }),
    plainTextContent: renderTemplateContent(detail.plainTextContent ?? "", merged, { html: false }),
    unresolvedVariables,
  };
}

function toTemplateSummary(row: MailTemplateRow): MailTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    subjectTemplate: row.subject_template,
    scope: row.scope,
    defaultMailAccountId: row.default_mail_account_id,
    previewMetadata: row.preview_metadata,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    isActive: row.is_active,
  };
}

function toTemplateDetail(
  row: MailTemplateRow,
  assets: MailTemplateAssetRow[]
): MailTemplateDetail {
  const summary = toTemplateSummary(row);
  return {
    ...summary,
    htmlContent: row.html_content,
    plainTextContent: row.plain_text_content,
    variables: detectTemplateVariables(
      [row.subject_template ?? "", row.html_content, row.plain_text_content ?? ""].join("\n")
    ),
    assets: assets.map(toAssetSummary),
  };
}

function toAssetSummary(row: MailTemplateAssetRow): MailTemplateAssetSummary {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    cid: row.cid,
    createdAt: row.created_at,
  };
}
