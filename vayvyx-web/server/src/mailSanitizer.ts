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
      span: [
        "data-vayvyx-remote-image",
        "data-vayvyx-remote-src",
        "data-vayvyx-alt",
      ],
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
        const remoteSrc = safeRemoteImageSrc(attribs.src);
        if (remoteSrc) {
          hasRemoteImages = true;
          const altText = meaningfulImageText(attribs.alt ?? attribs.title);

          return {
            tagName: "span",
            text: altText,
            attribs: {
              "data-vayvyx-remote-image": "true",
              "data-vayvyx-remote-src": remoteSrc,
              ...(altText ? { "data-vayvyx-alt": altText } : {}),
            },
          };
        }

        return {
          tagName: "span",
          attribs: {},
          text: "",
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

function safeRemoteImageSrc(src: string | undefined) {
  if (!src) return null;

  try {
    const parsed = new URL(src);
    if (["http:", "https:"].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch {
    return null;
  }

  return null;
}

function meaningfulImageText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim().slice(0, 240) ?? "";
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
