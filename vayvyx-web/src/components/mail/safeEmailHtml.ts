const emailFrameCss = `
  html, body { margin:0; padding:0; max-width:100%; overflow-wrap:anywhere; word-break:normal; color:#101626; background:#ffffff; font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  body { padding:16px; }
  img { max-width:100% !important; height:auto !important; }
  table { max-width:100% !important; border-collapse:collapse; display:block; overflow-x:auto; }
  td, th { vertical-align:top; }
  pre { white-space:pre-wrap; overflow-wrap:anywhere; }
  a { overflow-wrap:anywhere; color:#1456b8; }
  .email-remote-image-alt { display:inline-block; max-width:100%; color:#596170; font-size:13px; font-style:italic; overflow-wrap:anywhere; }
`;

export function buildEmailSrcDoc(html: string, loadRemoteImages: boolean) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${emailFrameCss}</style></head><body>${prepareEmailHtml(html, loadRemoteImages)}</body></html>`;
}

export function prepareEmailHtml(html: string, loadRemoteImages: boolean) {
  if (typeof document === "undefined") {
    return html.replace(/\[remote image blocked\]/g, "");
  }

  const template = document.createElement("template");
  template.innerHTML = html;

  template.content
    .querySelectorAll("script, iframe, object, embed, form, input, button, meta, base, svg, link")
    .forEach((element) => element.remove());

  template.content.querySelectorAll("a").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    if (!isSafeUrl(href, ["http:", "https:", "mailto:"])) {
      anchor.setAttribute("href", "#");
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });

  template.content.querySelectorAll("[data-vayvyx-remote-image]").forEach((element) => {
    const src = element.getAttribute("data-vayvyx-remote-src") ?? "";
    const alt = (element.getAttribute("data-vayvyx-alt") ?? element.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();

    if (loadRemoteImages && isSafeUrl(src, ["http:", "https:"])) {
      const image = document.createElement("img");
      image.src = src;
      image.alt = alt;
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      element.replaceWith(image);
      return;
    }

    if (alt) {
      const fallback = document.createElement("span");
      fallback.className = "email-remote-image-alt";
      fallback.textContent = alt;
      element.replaceWith(fallback);
      return;
    }

    element.remove();
  });

  template.content.querySelectorAll("img").forEach((image) => {
    if (!loadRemoteImages || !isSafeUrl(image.getAttribute("src") ?? "", ["http:", "https:"])) {
      image.remove();
      return;
    }
    image.setAttribute("loading", "lazy");
    image.setAttribute("referrerpolicy", "no-referrer");
  });

  stripRemoteImagePlaceholderText(template.content);

  return template.innerHTML;
}

function stripRemoteImagePlaceholderText(root: DocumentFragment) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  textNodes.forEach((node) => {
    node.nodeValue = node.nodeValue?.replace(/\[remote image blocked\]/g, "") ?? "";
  });
}

function isSafeUrl(value: string, protocols: string[]) {
  if (!value) return false;

  try {
    const parsed = new URL(value, window.location.origin);
    return protocols.includes(parsed.protocol);
  } catch {
    return false;
  }
}
