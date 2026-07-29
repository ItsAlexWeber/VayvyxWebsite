import sanitizeHtml from "sanitize-html";

export type SanitizedEmailHtml = {
  html: string;
  hasRemoteImages: boolean;
};

export function sanitizeEmailHtml(input: string): SanitizedEmailHtml {
  let hasRemoteImages = false;

  const html = sanitizeHtml(input, {
    allowedTags: [
      "a",
      "abbr",
      "b",
      "blockquote",
      "br",
      "code",
      "div",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "hr",
      "i",
      "li",
      "ol",
      "p",
      "pre",
      "span",
      "strong",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: [],
    },
    disallowedTagsMode: "discard",
    allowedStyles: {},
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          href: safeHref(attribs.href),
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      img: (_tagName, attribs) => {
        if (attribs.src?.startsWith("http://") || attribs.src?.startsWith("https://")) {
          hasRemoteImages = true;
        }

        return {
          tagName: "span",
          text: "[remote image blocked]",
          attribs: {},
        };
      },
    },
    exclusiveFilter(frame) {
      const tag = frame.tag;
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
      ].includes(tag);
    },
  });

  return { html, hasRemoteImages };
}

function safeHref(href: string | undefined) {
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

export function stripHtmlToPreview(value: string, maxLength = 180) {
  const text = sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/\s+/g, " ")
    .trim();

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}
