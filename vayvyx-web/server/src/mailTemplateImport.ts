import { randomUUID } from "node:crypto";
import path from "node:path";
import { unzipSync } from "fflate";
import { HttpError } from "./httpError.js";
import type { TemplateImportPackage } from "./mailTemplateTypes.js";

const maxArchiveBytes = 10 * 1024 * 1024;
const maxArchiveFiles = 50;
const maxAssetBytes = 2 * 1024 * 1024;
const maxAssets = 20;

const executableExtensions = new Set([
  ".app",
  ".bat",
  ".bin",
  ".cmd",
  ".com",
  ".dll",
  ".dmg",
  ".exe",
  ".jar",
  ".js",
  ".msi",
  ".ps1",
  ".scr",
  ".sh",
  ".vbs",
]);

const assetTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

export function importHtmlTemplatePackage(file: {
  originalname: string;
  buffer: Buffer;
}): TemplateImportPackage {
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension !== ".html" && extension !== ".htm") {
    throw new HttpError(400, "UNSUPPORTED_FILE_TYPE", "Only HTML files may be imported here.");
  }

  return {
    html: file.buffer.toString("utf8"),
    plainText: null,
    assets: [],
  };
}

export function importZipTemplatePackage(file: {
  originalname: string;
  buffer: Buffer;
}): TemplateImportPackage {
  if (path.extname(file.originalname).toLowerCase() !== ".zip") {
    throw new HttpError(400, "UNSUPPORTED_FILE_TYPE", "Only ZIP template packages may be imported here.");
  }

  if (file.buffer.byteLength > maxArchiveBytes) {
    throw new HttpError(413, "ARCHIVE_TOO_LARGE", "Template package is too large.");
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(file.buffer));
  } catch (error) {
    throw new HttpError(400, "MALFORMED_ARCHIVE", "Template package could not be read.", error);
  }

  const names = Object.keys(entries).filter((name) => !name.endsWith("/"));
  if (names.length > maxArchiveFiles) {
    throw new HttpError(413, "ARCHIVE_TOO_LARGE", "Template package contains too many files.");
  }

  for (const name of names) {
    assertSafeArchivePath(name);
    const extension = path.posix.extname(name).toLowerCase();
    if (executableExtensions.has(extension)) {
      throw new HttpError(400, "UNSUPPORTED_FILE_TYPE", "Executable files are not allowed in template packages.");
    }
    if (extension === ".svg") {
      throw new HttpError(400, "UNSUPPORTED_ASSET", "SVG template assets are not supported in this phase.");
    }
  }

  const htmlName = detectPrimaryHtml(names);
  const html = Buffer.from(entries[htmlName]).toString("utf8");
  const txtName = detectPlainTextCounterpart(names, htmlName);
  const plainText = txtName ? Buffer.from(entries[txtName]).toString("utf8") : null;
  const sourceSet = new Set(collectImageSources(html).map(normalizeAssetReference));
  const assets = names
    .filter((name) => sourceSet.has(normalizeAssetReference(name)))
    .map((name) => buildAsset(name, Buffer.from(entries[name])));

  if (assets.length > maxAssets) {
    throw new HttpError(413, "ARCHIVE_TOO_LARGE", "Template package contains too many image assets.");
  }

  return {
    html,
    plainText,
    assets,
  };
}

export function collectImageSources(html: string) {
  const sources = new Set<string>();
  const pattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const source = match[1] ?? match[2] ?? match[3] ?? "";
    if (source.trim()) sources.add(source.trim());
  }

  return [...sources];
}

export function normalizeAssetReference(value: string) {
  return decodeURIComponent(value.split("#")[0].split("?")[0])
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
}

export function sanitizeTemplateFilename(value: string) {
  const base = path.posix.basename(value).replace(/[^\w .@-]/g, "_").trim();
  return base || "template-asset";
}

export function detectAssetContentType(filename: string, content: Buffer) {
  const extension = path.posix.extname(filename).toLowerCase();
  const expected = assetTypes.get(extension);
  if (!expected) {
    throw new HttpError(400, "UNSUPPORTED_ASSET", "Template asset type is not supported.");
  }

  if (content.byteLength > maxAssetBytes) {
    throw new HttpError(413, "ASSET_TOO_LARGE", "Template asset is too large.");
  }

  if (!hasExpectedMagic(expected, content)) {
    throw new HttpError(400, "UNSUPPORTED_ASSET", "Template asset content is invalid.");
  }

  return expected;
}

function detectPrimaryHtml(names: string[]) {
  const htmlFiles = names.filter((name) => [".html", ".htm"].includes(path.posix.extname(name).toLowerCase()));
  if (htmlFiles.length === 0) {
    throw new HttpError(400, "MISSING_PRIMARY_HTML", "Template package must contain a primary HTML file.");
  }

  return (
    htmlFiles.find((name) => path.posix.basename(name).toLowerCase() === "index.html") ??
    htmlFiles.sort((a, b) => a.localeCompare(b))[0]
  );
}

function detectPlainTextCounterpart(names: string[], htmlName: string) {
  const htmlBase = htmlName.replace(/\.(html|htm)$/i, "");
  return names.find((name) => name === `${htmlBase}.txt`) ?? names.find((name) => path.posix.basename(name).toLowerCase() === "plain.txt") ?? null;
}

function buildAsset(originalPath: string, content: Buffer) {
  const filename = sanitizeTemplateFilename(originalPath);
  const contentType = detectAssetContentType(originalPath, content);
  return {
    originalPath: normalizeAssetReference(originalPath),
    filename,
    contentType,
    content,
    cid: `${randomUUID()}@vayvyx-template`,
  };
}

function assertSafeArchivePath(name: string) {
  if (name.includes("\\") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    throw new HttpError(400, "UNSAFE_ARCHIVE_PATH", "Template package contains an unsafe path.");
  }

  const normalized = path.posix.normalize(name);
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    throw new HttpError(400, "UNSAFE_ARCHIVE_PATH", "Template package contains path traversal.");
  }
}

function hasExpectedMagic(contentType: string, content: Buffer) {
  if (contentType === "image/png") {
    return content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === "image/jpeg") {
    return content[0] === 0xff && content[1] === 0xd8;
  }
  if (contentType === "image/gif") {
    return content.subarray(0, 3).toString("ascii") === "GIF";
  }
  if (contentType === "image/webp") {
    return content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
  }

  return false;
}
