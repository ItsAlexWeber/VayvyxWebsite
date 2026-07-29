import type { SendMessageRequest } from "../../types/mail.ts";

export type StoredMailComposeAttachment = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
};

export type StoredMailComposeDraft = {
  version: 1;
  accountId: string;
  mode: SendMessageRequest["mode"];
  to: string;
  cc: string;
  bcc: string;
  showCcBcc: boolean;
  subject: string;
  body: string;
  richHtml: string;
  htmlBody: string;
  templateId: string | null;
  templateName: string | null;
  templateSubjectTemplate: string | null;
  templateVariables: Record<string, string>;
  templateVariableNames: string[];
  attachments: StoredMailComposeAttachment[];
  savedAt: string;
};

const draftDbName = "vayvyx-mail-drafts";
const draftDbStore = "attachments";

export function mailComposeDraftStorageKey(accountId: string, mode: SendMessageRequest["mode"]) {
  return `vayvyx-mail-compose-draft:${accountId}:${mode}`;
}

export function readMailComposeDraftMetadata(storageKey: string): StoredMailComposeDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredMailComposeDraft>;
    if (parsed.version !== 1 || typeof parsed.accountId !== "string" || typeof parsed.mode !== "string") {
      return null;
    }
    return parsed as StoredMailComposeDraft;
  } catch {
    return null;
  }
}

export async function saveMailComposeDraft(
  storageKey: string,
  draft: StoredMailComposeDraft,
  attachments: File[]
) {
  window.localStorage.setItem(storageKey, JSON.stringify(draft));
  await writeDraftAttachments(storageKey, attachments);
}

export async function readMailComposeDraftAttachments(storageKey: string) {
  const db = await openDraftDb();
  if (!db) return [];

  return new Promise<File[]>((resolve) => {
    const transaction = db.transaction(draftDbStore, "readonly");
    const request = transaction.objectStore(draftDbStore).get(storageKey);
    request.onsuccess = () => {
      const row = request.result as { attachments?: File[] } | undefined;
      resolve(Array.isArray(row?.attachments) ? row.attachments : []);
    };
    request.onerror = () => resolve([]);
    transaction.oncomplete = () => db.close();
  });
}

export async function clearMailComposeDraft(storageKey: string) {
  window.localStorage.removeItem(storageKey);
  const db = await openDraftDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(draftDbStore, "readwrite");
    transaction.objectStore(draftDbStore).delete(storageKey);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
}

async function writeDraftAttachments(storageKey: string, attachments: File[]) {
  const db = await openDraftDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(draftDbStore, "readwrite");
    transaction.objectStore(draftDbStore).put({ storageKey, attachments }, storageKey);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
}

function openDraftDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(draftDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(draftDbStore)) {
        db.createObjectStore(draftDbStore);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}
