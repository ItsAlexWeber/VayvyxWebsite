import sanitizeHtml from "sanitize-html";

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
  /<\s*(script|form|iframe|object|embed|input|button|meta|base|svg|link)\b|on[a-z]+\s*=|javascript:|expression\s*\(/i;

export function sanitizeEmailTemplateHtml(
  input: string,
  options: TemplateSanitizeOptions = {}
): TemplateSanitizeResult {
  const assetCidBySource = options.assetCidBySource ?? new Map<string, string>();
  const unsafeBeforeSanitize = blockedPattern.test(input);
  let removedImage = false;

  const html = sanitizeHtml(input, {
    allowedTags: [
      "a",
      "abbr",
      "b",
      "blockquote",
      "br",
      "center",
      "code",
      "div",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "i",
      "img",
      "li",
      "ol",
      "p",
      "pre",
      "span",
      "strong",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "style", "title"],
      img: ["src", "alt", "width", "height", "style"],
      table: ["width", "height", "cellpadding", "cellspacing", "border", "role", "align", "style"],
      tbody: ["style"],
      thead: ["style"],
      tfoot: ["style"],
      tr: ["align", "valign", "style"],
      td: ["colspan", "rowspan", "width", "height", "align", "valign", "style"],
      th: ["colspan", "rowspan", "width", "height", "align", "valign", "style"],
      div: ["align", "style"],
      span: ["style"],
      p: ["align", "style"],
      h1: ["align", "style"],
      h2: ["align", "style"],
      h3: ["align", "style"],
      h4: ["align", "style"],
      h5: ["align", "style"],
      h6: ["align", "style"],
      blockquote: ["style"],
      pre: ["style"],
      ul: ["style"],
      ol: ["style"],
      li: ["style"],
      center: ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "cid"],
    allowedSchemesByTag: {
      img: ["cid"],
    },
    allowedStyles: {
      "*": {
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgb\([0-9,\s.]+\)$/i, /^rgba\([0-9,\s.]+\)$/i, /^[a-z]+$/i],
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([0-9,\s.]+\)$/i, /^rgba\([0-9,\s.]+\)$/i, /^[a-z]+$/i],
        "font-family": [/^[a-zA-Z0-9\s,"'-]+$/],
        "font-size": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        "font-weight": [/^(normal|bold|bolder|lighter|[1-9]00)$/],
        "line-height": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)?$/],
        "text-align": [/^(left|right|center|justify)$/],
        "text-decoration": [/^(none|underline)$/],
        "border": [/^[#a-zA-Z0-9\s.,()%/-]+$/],
        "border-top": [/^[#a-zA-Z0-9\s.,()%/-]+$/],
        "border-right": [/^[#a-zA-Z0-9\s.,()%/-]+$/],
        "border-bottom": [/^[#a-zA-Z0-9\s.,()%/-]+$/],
        "border-left": [/^[#a-zA-Z0-9\s.,()%/-]+$/],
        "border-radius": [/^\d{1,3}(\.\d{1,2})?(px|%)$/],
        "border-collapse": [/^collapse$/],
        margin: [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)?( \d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)?){0,3}$/],
        "margin-top": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        "margin-right": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        "margin-bottom": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        "margin-left": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        padding: [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)?( \d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)?){0,3}$/],
        "padding-top": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        "padding-right": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        "padding-bottom": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        "padding-left": [/^\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        width: [/^\d{1,4}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        height: [/^\d{1,4}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        "max-width": [/^\d{1,4}(\.\d{1,2})?(px|pt|em|rem|%)$/],
        display: [/^(block|inline|inline-block|table|table-row|table-cell)$/],
      },
    },
    disallowedTagsMode: "discard",
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...copySafeAttributes(attribs, ["style", "title"]),
          href: safeTemplateHref(attribs.href),
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      img: (_tagName, attribs) => {
        const source = attribs.src ?? "";
        const cid = resolveImageCid(source, assetCidBySource, options);
        if (!cid) {
          removedImage = true;
          return {
            tagName: "span",
            text: meaningfulImageText(attribs.alt ?? attribs.title),
            attribs: copySafeAttributes(attribs, ["style"]),
          };
        }

        return {
          tagName: "img",
          attribs: {
            ...copySafeAttributes(attribs, ["alt", "width", "height", "style"]),
            src: cid.startsWith("cid:") ? cid : `cid:${cid}`,
          },
        };
      },
    },
    exclusiveFilter(frame) {
      return [
        "script",
        "iframe",
        "object",
        "embed",
        "form",
        "input",
        "button",
        "meta",
        "base",
        "svg",
        "link",
      ].includes(frame.tag);
    },
  });

  return {
    html,
    variables: detectTemplateVariables([
      html,
    ].join("\n")),
    unsafeContentRemoved: unsafeBeforeSanitize || removedImage || html !== input,
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
  return value.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]{0,63})\s*}}/g, (_token, key: string) => {
    const replacement = variables[key] ?? "";
    return options.html ? escapeHtml(replacement) : replacement;
  });
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

function safeTemplateHref(href: string | undefined) {
  if (!href) return "#";

  try {
    const parsed = new URL(href, "https://vayvyx.invalid");
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      return href;
    }
  } catch {
    return "#";
  }

  return "#";
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

function copySafeAttributes(
  attribs: Record<string, string>,
  names: string[]
) {
  return Object.fromEntries(
    names
      .map((name) => [name, attribs[name]] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );
}

function meaningfulImageText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim().slice(0, 240) ?? "";
}
