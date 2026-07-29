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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
