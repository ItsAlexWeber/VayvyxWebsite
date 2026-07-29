export function sanitizeAttachmentFilename(input: string | null | undefined) {
  const fallback = "attachment";
  const value = input?.trim() || fallback;
  const sanitized = value
    .split("")
    .map((char) => (isUnsafeFilenameChar(char) ? "_" : char))
    .join("")
    .replace(/\.+/g, ".")
    .replace(/^\.+/, "")
    .slice(0, 160)
    .trim();

  return sanitized || fallback;
}

function isUnsafeFilenameChar(char: string) {
  return '\\/:*?"<>|'.includes(char) || char.charCodeAt(0) < 32;
}
