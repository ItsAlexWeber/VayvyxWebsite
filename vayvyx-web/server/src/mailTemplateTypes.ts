export const mailTemplateScopes = ["personal", "company", "system"] as const;
export type MailTemplateScope = (typeof mailTemplateScopes)[number];

export type MailTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  subject_template: string | null;
  html_content: string;
  plain_text_content: string | null;
  scope: MailTemplateScope;
  created_by: string | null;
  updated_by: string | null;
  default_mail_account_id: string | null;
  preview_metadata: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  system_key: string | null;
  is_delete_protected: boolean;
  default_subject_template: string | null;
  default_html_content: string | null;
  default_plain_text_content: string | null;
};

export type MailTemplateAssetRow = {
  id: string;
  template_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  cid: string;
  content_base64: string;
  created_by: string;
  created_at: string;
};

export type MailTemplateAssetSummary = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  cid: string;
  createdAt: string;
};

export type MailTemplateSummary = {
  id: string;
  name: string;
  description: string | null;
  subjectTemplate: string | null;
  scope: MailTemplateScope;
  defaultMailAccountId: string | null;
  previewMetadata: Record<string, unknown> | null;
  createdBy: string | null;
  updatedAt: string;
  createdAt: string;
  isActive: boolean;
  systemKey: string | null;
  isDeleteProtected: boolean;
};

export type MailTemplateDetail = MailTemplateSummary & {
  htmlContent: string;
  plainTextContent: string | null;
  variables: string[];
  assets: MailTemplateAssetSummary[];
  defaultSubjectTemplate: string | null;
  defaultHtmlContent: string | null;
  defaultPlainTextContent: string | null;
};

export type MailTemplateRendered = {
  subject: string;
  htmlContent: string;
  plainTextContent: string;
  unresolvedVariables: string[];
};

export type MailTemplateInlineAsset = {
  cid: string;
  filename: string;
  contentType: string;
  contentBase64: string;
};

export type MailTemplateExport = {
  filename: string;
  template: MailTemplateDetail;
  assets: Array<MailTemplateAssetSummary & { contentBase64: string }>;
};

export type TemplateImportPackage = {
  html: string;
  plainText: string | null;
  assets: Array<{
    originalPath: string;
    filename: string;
    contentType: string;
    content: Buffer;
    cid: string;
  }>;
};
