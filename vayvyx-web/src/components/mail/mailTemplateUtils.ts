export function detectTemplateVariables(value: string) {
  const variables = new Set<string>();
  const pattern = /{{\s*([a-zA-Z][a-zA-Z0-9_]{0,63})\s*}}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    variables.add(match[1]);
  }

  return [...variables].sort((a, b) => a.localeCompare(b));
}

export function textToEmailHtml(value: string) {
  return `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
}

export function htmlToPlainText(value: string) {
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
    return normalizePlainText(container.textContent ?? "");
  }

  return normalizePlainText(
    value
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
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizePlainText(value: string) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
