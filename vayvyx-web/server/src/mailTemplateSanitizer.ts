import { HttpError } from "./httpError.js";

export type TemplateSanitizeResult = {
  html: string;
  variables: string[];
  unsafeContentRemoved: boolean;
};

export type TemplateSanitizeOptions = {
  assetCidBySource?: Map<string, string>;
  allowCidImages?: boolean;
  allowHostedImages?: boolean;
};

const blockedPattern =
  /<\s*\/?\s*(script|form|iframe|object|embed|input|button|base|svg|link)\b|<[^>]+\son[a-z]+\s*=|javascript:|expression\s*\(|@import\b/i;

export function sanitizeEmailTemplateHtml(
  input: string,
  options: TemplateSanitizeOptions = {}
): TemplateSanitizeResult {
  const assetCidBySource = options.assetCidBySource ?? new Map<string, string>();
  assertTemplateHtmlSafe(input);
  const html = rewriteTemplateImageSources(input, assetCidBySource, options);

  return {
    html,
    variables: detectTemplateVariables(html),
    unsafeContentRemoved: html !== input,
  };
}

export function detectTemplateVariables(value: string) {
  const variables = new Set<string>();
  const pattern = /{{\s*([a-zA-Z][a-zA-Z0-9_]{0,63})\s*}}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    variables.add(match[1]);
  }

  return [...variables].sort((a, b) => a.localeCompare(b));
}

export function renderTemplateContent(
  value: string,
  variables: Record<string, string>,
  options: { html: boolean }
) {
  return value.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]{0,63})\s*}}/g, (token, key: string) => {
    const replacement = variables[key];
    if (replacement === undefined || replacement.trim().length === 0) {
      return token;
    }
    return options.html ? escapeHtml(replacement) : replacement;
  });
}

export function htmlToPlainText(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function unresolvedTemplateVariables(
  templateParts: Array<string | null | undefined>,
  variables: Record<string, string>
) {
  return detectTemplateVariables(templateParts.filter(Boolean).join("\n")).filter((name) => {
    const value = variables[name];
    return value === undefined || value.trim().length === 0;
  });
}

export function builtInTemplateVariables() {
  return {
    company_name: "Vayvyx",
    support_email: "support@vayvyx.com",
    current_year: String(new Date().getFullYear()),
  };
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assertTemplateHtmlSafe(input: string) {
  if (blockedPattern.test(input)) {
    throw new HttpError(400, "UNSAFE_HTML_REMOVED", "Template contains unsafe HTML.");
  }
}

function rewriteTemplateImageSources(
  input: string,
  assetCidBySource: Map<string, string>,
  options: TemplateSanitizeOptions
) {
  return input.replace(/<img\b[^>]*>/gi, (tag) => {
    const parsed = parseAttribute(tag, "src");
    if (!parsed) return tag;

    const cid = resolveImageCid(parsed.value, assetCidBySource, options);
    if (!cid) {
      throw new HttpError(400, "UNSUPPORTED_ASSET", "Template image source is not supported.");
    }

    const nextValue = cid.startsWith("cid:") ? cid : `cid:${cid}`;
    return `${tag.slice(0, parsed.valueStart)}${nextValue}${tag.slice(parsed.valueEnd)}`;
  });
}

function resolveImageCid(
  source: string,
  assetCidBySource: Map<string, string>,
  options: TemplateSanitizeOptions
) {
  const mapped = assetCidBySource.get(normalizeAssetReference(source));
  if (mapped) return mapped;

  if (options.allowCidImages && /^cid:[a-zA-Z0-9._-]+@vayvyx-template$/i.test(source)) {
    return source;
  }

  if (options.allowHostedImages) {
    try {
      const parsed = new URL(source);
      if (["http:", "https:"].includes(parsed.protocol)) return parsed.href;
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeAssetReference(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function parseAttribute(tag: string, name: string) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(tag);
  if (!match || match.index === undefined) return null;
  const fullValue = match[1];
  const value = match[2] ?? match[3] ?? match[4] ?? "";
  const valueOffset = fullValue.startsWith("\"") || fullValue.startsWith("'") ? 1 : 0;
  const valueStart = match.index + match[0].lastIndexOf(fullValue) + valueOffset;
  return {
    value,
    valueStart,
    valueEnd: valueStart + value.length,
  };
}
