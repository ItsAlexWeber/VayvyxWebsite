import { simpleParser, type ParsedMail } from "mailparser";
import { randomUUID } from "node:crypto";
import type { Transporter } from "nodemailer";
import type { MailAccountPrivate } from "./types.js";
import type {
  MailAttachmentMetadata,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  SendMessageRequest,
  SendMessageResult,
} from "./mailApiTypes.js";
import { sanitizeEmailHtml, stripHtmlToPreview } from "./mailSanitizer.js";
import { sanitizeAttachmentFilename } from "./filename.js";
import { HttpError, isHttpError } from "./httpError.js";

export type MessageListInput = {
  folder: string;
  limit: number;
  cursor?: number;
  search?: string;
  unreadOnly: boolean;
  flaggedOnly: boolean;
  sortDirection: "asc" | "desc";
};

export interface MailProvider {
  listFolders(account: MailAccountPrivate): Promise<MailFolder[]>;
  listMessages(
    account: MailAccountPrivate,
    input: MessageListInput
  ): Promise<{ messages: MailMessageSummary[]; nextCursor: number | null }>;
  getMessage(
    account: MailAccountPrivate,
    folder: string,
    uid: number
  ): Promise<MailMessageDetail>;
  getAttachment(
    account: MailAccountPrivate,
    folder: string,
    uid: number,
    attachmentId: string
  ): Promise<{
    filename: string;
    contentType: string;
    size: number | null;
    content: NodeJS.ReadableStream | Buffer;
  }>;
  setRead(
    account: MailAccountPrivate,
    folder: string,
    uid: number,
    read: boolean
  ): Promise<{ uid: number; read: boolean }>;
  setFlagged(
    account: MailAccountPrivate,
    folder: string,
    uid: number,
    flagged: boolean
  ): Promise<{ uid: number; flagged: boolean }>;
  moveMessage(
    account: MailAccountPrivate,
    sourceFolder: string,
    uid: number,
    destinationFolder: string
  ): Promise<{ uid: number; sourceFolder: string; destinationFolder: string }>;
  sendMessage(
    account: MailAccountPrivate,
    input: SendMessageRequest,
    attachments: Express.Multer.File[]
  ): Promise<SendMessageResult>;
}

export class ImapSmtpMailProvider implements MailProvider {
  constructor(
    private readonly deps: {
      withImapClient<T>(
        account: MailAccountPrivate,
        operation: (client: unknown) => Promise<T>
      ): Promise<T>;
      createSmtpTransport(account: MailAccountPrivate): Promise<Transporter>;
    }
  ) {}

  async listFolders(account: MailAccountPrivate): Promise<MailFolder[]> {
    return this.deps.withImapClient(account, async (client) => {
      const mailboxClient = client as {
        list: () => Promise<Record<string, unknown>[]>;
        status: (path: string, options: Record<string, boolean>) => Promise<Record<string, number>>;
      };
      const folders: MailFolder[] = [];

      try {
        const mailboxes = await mailboxClient.list();

        for (const box of mailboxes) {
          const path = String(box.path ?? "");
          const status = path
            ? await mailboxClient.status(path, { messages: true, unseen: true }).catch(() => null)
            : null;
          folders.push({
            path,
            displayName: String(box.name ?? path),
            delimiter: String(box.delimiter ?? "/"),
            specialUse: normalizeSpecialUse(box.specialUse),
            originalSpecialUse: typeof box.specialUse === "string" ? box.specialUse : null,
            totalCount: status?.messages ?? null,
            unreadCount: status?.unseen ?? null,
            selectable: !Array.isArray(box.flags) || !box.flags.includes("\\Noselect"),
            subscribed: typeof box.subscribed === "boolean" ? box.subscribed : null,
          });
        }
      } catch (error) {
        throw new HttpError(
          502,
          "MAILBOX_UNAVAILABLE",
          "Mailbox folders are temporarily unavailable.",
          error
        );
      }

      return folders;
    });
  }

  async listMessages(account: MailAccountPrivate, input: MessageListInput) {
    return this.deps.withImapClient(account, async (client) => {
      const imap = client as {
        mailbox?: { exists?: number };
        getMailboxLock: (
          path: string,
          options?: { readOnly?: boolean }
        ) => Promise<{ release: () => void }>;
        search: (query: Record<string, unknown>, options?: { uid?: boolean }) => Promise<number[] | false>;
        fetchAll: (
          range: string | number[],
          query: Record<string, unknown>,
          options?: { uid?: boolean }
        ) => Promise<Record<string, unknown>[]>;
      };
      const lock = await imap.getMailboxLock(input.folder, { readOnly: true });
      const correlationId = randomUUID();
      let exists = 0;
      let requestMode: "sequence-range" | "filtered-search" =
        "sequence-range";
      let sequenceRange: string | null = null;
      let searchCount: number | null = null;
      let requestedCount = 0;
      let fetchedCount = 0;
      const normalizedSearch = input.search?.trim() ?? "";
      const parsedUnreadOnly = input.unreadOnly === true;
      const parsedFlaggedOnly = input.flaggedOnly === true;

      try {
        exists = Number(imap.mailbox?.exists) || 0;
        const hasActiveFilters =
          normalizedSearch.length > 0 ||
          parsedUnreadOnly === true ||
          parsedFlaggedOnly === true;
        const defaultRequest = !hasActiveFilters;
        let fetchedMessages: Record<string, unknown>[] = [];

        if (defaultRequest) {
          const endSequence = exists;
          const startSequence = Math.max(1, endSequence - input.limit + 1);
          sequenceRange = exists > 0 ? `${startSequence}:${endSequence}` : null;
          requestedCount = sequenceRange
            ? endSequence - startSequence + 1
            : 0;
          fetchedMessages =
            sequenceRange === null
              ? []
              : await imap.fetchAll(sequenceRange, fetchQuery());
        } else {
          requestMode = "filtered-search";
          const criteria = buildSearchCriteria({
            normalizedSearch,
            unreadOnly: parsedUnreadOnly,
            flaggedOnly: parsedFlaggedOnly,
          });
          const searchResult = await imap.search(criteria, { uid: true });
          const matchingUids = Array.isArray(searchResult) ? searchResult : [];
          searchCount = matchingUids.length;
          const orderedUids = [...matchingUids].sort((a, b) =>
            input.sortDirection === "asc" ? a - b : b - a
          );
          const pageUids = paginateUids(orderedUids, input);
          requestedCount = pageUids.length;
          fetchedMessages =
            pageUids.length === 0
              ? []
              : await imap.fetchAll(pageUids, fetchQuery(), { uid: true });
        }

        fetchedCount = fetchedMessages.length;

        if (
          defaultRequest &&
          exists > 0 &&
          fetchedMessages.length === 0
        ) {
          throw new HttpError(
            502,
            "MAIL_FETCH_FAILED",
            "Mailbox messages could not be fetched."
          );
        }

        const messages = fetchedMessages.map((item) =>
          toSummary(account.id, input.folder, item)
        );
        messages.sort((a, b) =>
          input.sortDirection === "asc" ? a.uid - b.uid : b.uid - a.uid
        );

        logMessageListDiagnostic({
          correlationId,
          mailAccountId: account.id,
          folderPath: input.folder,
          exists,
          requestMode,
          sequenceRange,
          searchCount,
          requestedCount,
          fetchedCount,
          parsedUnreadOnly,
          parsedFlaggedOnly,
          normalizedSearchLength: normalizedSearch.length,
        });

        return {
          messages,
          nextCursor:
            messages.length === input.limit
              ? messages[messages.length - 1]?.uid ?? null
              : null,
        };
      } catch (error) {
        logMessageListDiagnostic({
          correlationId,
          mailAccountId: account.id,
          folderPath: input.folder,
          exists,
          requestMode,
          sequenceRange,
          searchCount,
          requestedCount,
          fetchedCount,
          parsedUnreadOnly,
          parsedFlaggedOnly,
          normalizedSearchLength: normalizedSearch.length,
        });

        if (isHttpError(error)) {
          throw error;
        }

        throw new HttpError(
          502,
          "MAILBOX_UNAVAILABLE",
          "Mailbox messages are temporarily unavailable.",
          error
        );
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(account: MailAccountPrivate, folder: string, uid: number) {
    return this.deps.withImapClient(account, async (client) => {
      const imap = client as {
        mailboxOpen: (path: string) => Promise<unknown>;
        fetchOne: (uid: number, options: Record<string, unknown>, settings: Record<string, unknown>) => Promise<Record<string, unknown> | false>;
      };
      await imap.mailboxOpen(folder);
      const item = await imap.fetchOne(uid, { source: true, uid: true, flags: true, envelope: true, bodyStructure: true }, { uid: true });
      if (!item) throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message was not found.");
      const source = item.source as Buffer | string | undefined;
      const parsed = source ? await simpleParser(source) : null;
      return toDetail(account.id, folder, item, parsed);
    });
  }

  async getAttachment(
    account: MailAccountPrivate,
    folder: string,
    uid: number,
    attachmentId: string
  ) {
    const message = await this.getMessage(account, folder, uid);
    const attachment = message.attachments.find((item) => item.id === attachmentId);
    if (!attachment) {
      throw new HttpError(404, "MESSAGE_NOT_FOUND", "Attachment was not found.");
    }

    return this.deps.withImapClient(account, async (client) => {
      const imap = client as {
        mailboxOpen: (path: string) => Promise<unknown>;
        download: (uid: number, part: string, options: Record<string, unknown>) => Promise<{ content: NodeJS.ReadableStream; meta?: { contentType?: string } }>;
      };
      await imap.mailboxOpen(folder);
      const downloaded = await imap.download(uid, attachmentId, { uid: true });
      return {
        filename: sanitizeAttachmentFilename(attachment.filename),
        contentType: attachment.contentType || downloaded.meta?.contentType || "application/octet-stream",
        size: attachment.size,
        content: downloaded.content,
      };
    });
  }

  async setRead(account: MailAccountPrivate, folder: string, uid: number, read: boolean) {
    return this.deps.withImapClient(account, async (client) => {
      const imap = client as {
        mailboxOpen: (path: string) => Promise<unknown>;
        messageFlagsAdd: (uid: number, flags: string[], options: Record<string, unknown>) => Promise<unknown>;
        messageFlagsRemove: (uid: number, flags: string[], options: Record<string, unknown>) => Promise<unknown>;
      };
      await imap.mailboxOpen(folder);
      if (read) await imap.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      else await imap.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
      return { uid, read };
    });
  }

  async setFlagged(account: MailAccountPrivate, folder: string, uid: number, flagged: boolean) {
    return this.deps.withImapClient(account, async (client) => {
      const imap = client as {
        mailboxOpen: (path: string) => Promise<unknown>;
        messageFlagsAdd: (uid: number, flags: string[], options: Record<string, unknown>) => Promise<unknown>;
        messageFlagsRemove: (uid: number, flags: string[], options: Record<string, unknown>) => Promise<unknown>;
      };
      await imap.mailboxOpen(folder);
      if (flagged) await imap.messageFlagsAdd(uid, ["\\Flagged"], { uid: true });
      else await imap.messageFlagsRemove(uid, ["\\Flagged"], { uid: true });
      return { uid, flagged };
    });
  }

  async moveMessage(
    account: MailAccountPrivate,
    sourceFolder: string,
    uid: number,
    destinationFolder: string
  ) {
    return this.deps.withImapClient(account, async (client) => {
      const imap = client as {
        mailboxOpen: (path: string) => Promise<unknown>;
        messageMove: (uid: number, destination: string, options: Record<string, unknown>) => Promise<unknown>;
      };
      await imap.mailboxOpen(sourceFolder);
      await imap.messageMove(uid, destinationFolder, { uid: true });
      return { uid, sourceFolder, destinationFolder };
    });
  }

  async sendMessage(
    account: MailAccountPrivate,
    input: SendMessageRequest,
    attachments: Express.Multer.File[]
  ): Promise<SendMessageResult> {
    const transporter = await this.deps.createSmtpTransport(account);
    const fromAddress = account.from_name
      ? `"${account.from_name.replace(/"/g, "")}" <${account.email_address}>`
      : account.email_address;
    const sent = await transporter.sendMail({
      from: fromAddress,
      replyTo: account.reply_to_address ?? undefined,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.textBody,
      html: input.sanitizedHtmlBody,
      inReplyTo: input.inReplyTo,
      references: input.references,
      attachments: [
        ...attachments.map((file) => ({
          filename: sanitizeAttachmentFilename(file.originalname),
          path: file.path,
          contentType: file.mimetype,
        })),
        ...(input.inlineTemplateAssets ?? []).map((asset) => ({
          filename: sanitizeAttachmentFilename(asset.filename),
          content: Buffer.from(asset.contentBase64, "base64"),
          contentType: asset.contentType,
          cid: asset.cid,
          contentDisposition: "inline" as const,
        })),
      ],
    });

    return {
      status: "sent",
      messageId: typeof sent.messageId === "string" ? sent.messageId : null,
    };
  }
}

export function normalizeSpecialUse(value: unknown): MailFolder["specialUse"] {
  const lower = String(value ?? "").toLowerCase();
  if (lower.includes("sent")) return "sent";
  if (lower.includes("draft")) return "drafts";
  if (lower.includes("archive")) return "archive";
  if (lower.includes("trash")) return "trash";
  if (lower.includes("junk") || lower.includes("spam")) return "junk";
  if (lower.includes("inbox")) return "inbox";
  return "custom";
}

function buildSearchCriteria(input: {
  normalizedSearch: string;
  unreadOnly: boolean;
  flaggedOnly: boolean;
}) {
  const query: Record<string, unknown> = {};
  if (input.unreadOnly) query.seen = false;
  if (input.flaggedOnly) query.flagged = true;
  if (input.normalizedSearch.length > 0) {
    query.or = [
      { subject: input.normalizedSearch },
      { body: input.normalizedSearch },
    ];
  }

  return query;
}

function fetchQuery() {
  return {
    uid: true,
    envelope: true,
    flags: true,
    internalDate: true,
    size: true,
    bodyStructure: true,
  };
}

function paginateUids(uids: number[], input: MessageListInput) {
  const afterCursor = input.cursor
    ? uids.filter((uid) =>
        input.sortDirection === "asc" ? uid > input.cursor! : uid < input.cursor!
      )
    : uids;
  return afterCursor.slice(0, input.limit);
}

function logMessageListDiagnostic(input: {
  correlationId: string;
  mailAccountId: string;
  folderPath: string;
  exists: number;
  requestMode: "sequence-range" | "filtered-search";
  sequenceRange: string | null;
  searchCount: number | null;
  requestedCount: number;
  fetchedCount: number;
  parsedUnreadOnly: boolean;
  parsedFlaggedOnly: boolean;
  normalizedSearchLength: number;
}) {
  console.info("Vayvyx Mail message listing", {
    correlationId: input.correlationId,
    mailAccountId: input.mailAccountId,
    folderPath: input.folderPath,
    exists: input.exists,
    requestMode: input.requestMode,
    ...(input.sequenceRange ? { sequenceRange: input.sequenceRange } : {}),
    searchCount: input.searchCount,
    requestedCount: input.requestedCount,
    fetchedCount: input.fetchedCount,
    parsedUnreadOnly: input.parsedUnreadOnly,
    parsedFlaggedOnly: input.parsedFlaggedOnly,
    normalizedSearchLength: input.normalizedSearchLength,
  });
}

function toSummary(mailAccountId: string, folder: string, item: Record<string, unknown>): MailMessageSummary {
  const envelope = (item.envelope ?? {}) as Record<string, unknown>;
  const flags = flagList(item.flags);
  const from = firstAddress(envelope.from);
  const to = addressList(envelope.to);
  const source = typeof item.source === "string" ? item.source : Buffer.isBuffer(item.source) ? item.source.toString("utf8") : "";

  return {
    mailAccountId,
    folder,
    uid: Number(item.uid),
    messageId: typeof envelope.messageId === "string" ? envelope.messageId : null,
    subject: typeof envelope.subject === "string" ? envelope.subject : "",
    senderName: from?.name ?? null,
    senderAddress: from?.address ?? null,
    recipients: to,
    receivedAt: dateString(item.internalDate) ?? dateString(envelope.date),
    sentAt: dateString(envelope.date),
    unread: !flags.includes("\\Seen"),
    flagged: flags.includes("\\Flagged"),
    hasAttachments: JSON.stringify(item.bodyStructure ?? {}).toLowerCase().includes("attachment"),
    attachmentCount: null,
    preview: stripHtmlToPreview(source),
    inReplyTo: typeof envelope.inReplyTo === "string" ? envelope.inReplyTo : null,
    references: Array.isArray(envelope.references) ? envelope.references.map(String) : [],
  };
}

function flagList(value: unknown) {
  if (value instanceof Set) return [...value].map(String);
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function toDetail(
  mailAccountId: string,
  folder: string,
  item: Record<string, unknown>,
  parsed: ParsedMail | null
): MailMessageDetail {
  const summary = toSummary(mailAccountId, folder, item);
  const sanitized = parsed?.html ? sanitizeEmailHtml(String(parsed.html)) : { html: null, hasRemoteImages: false };

  return {
    ...summary,
    htmlBody: sanitized.html,
    textBody: parsed?.text ?? "",
    from: parsed?.from ? addressList(parsed.from.value) : [],
    replyTo: parsed?.replyTo ? addressList(parsed.replyTo.value) : [],
    to: parsed?.to ? addressList(Array.isArray(parsed.to) ? parsed.to.flatMap((item) => item.value) : parsed.to.value) : [],
    cc: parsed?.cc ? addressList(Array.isArray(parsed.cc) ? parsed.cc.flatMap((item) => item.value) : parsed.cc.value) : [],
    hasRemoteImages: sanitized.hasRemoteImages,
    attachments: (parsed?.attachments ?? []).map((attachment, index): MailAttachmentMetadata => ({
      id: attachment.cid ?? attachment.contentId ?? String(index + 1),
      filename: sanitizeAttachmentFilename(attachment.filename),
      contentType: attachment.contentType || "application/octet-stream",
      size: attachment.size ?? null,
      disposition: attachment.contentDisposition === "inline" ? "inline" : "attachment",
    })),
  };
}

function addressList(value: unknown): { name: string | null; address: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item as Record<string, unknown>;
      const address = typeof record.address === "string" ? record.address : "";
      if (!address) return null;
      return {
        name: typeof record.name === "string" && record.name ? record.name : null,
        address,
      };
    })
    .filter((item): item is { name: string | null; address: string } => Boolean(item));
}

function firstAddress(value: unknown) {
  return addressList(value)[0] ?? null;
}

function dateString(value: unknown) {
  return value instanceof Date ? value.toISOString() : null;
}
