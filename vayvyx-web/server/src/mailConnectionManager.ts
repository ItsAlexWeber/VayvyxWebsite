import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import pLimit from "p-limit";
import type { MailAccountPrivate } from "./types.js";
import type { MailCredentialService } from "./credentialCrypto.js";

type ManagedConnection = {
  client: ImapFlow;
  lastUsedAt: number;
};

export type MailConnectionManagerOptions = {
  maxActiveConnections: number;
  idleMs: number;
  testTimeoutMs: number;
};

export class MailConnectionManager {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly limit: ReturnType<typeof pLimit>;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly credentialService: MailCredentialService,
    private readonly options: MailConnectionManagerOptions
  ) {
    this.limit = pLimit(options.maxActiveConnections);
    this.idleTimer = setInterval(() => {
      void this.closeIdleConnections();
    }, Math.max(10_000, Math.floor(options.idleMs / 2)));
    this.idleTimer.unref();
  }

  async testImap(account: MailAccountPrivate) {
    return this.limit(async () => {
      const password = this.credentialService.decryptMailboxCredential(
        account.id,
        account
      );
      const client = new ImapFlow({
        host: account.imap_host,
        port: account.imap_port,
        secure: account.imap_secure,
        auth: {
          user: account.username,
          pass: password,
        },
        logger: false,
      });

      await withTimeout(client.connect(), this.options.testTimeoutMs);
      await client.logout();

      return { ok: true };
    });
  }

  async testSmtp(account: MailAccountPrivate) {
    return this.limit(async () => {
      const transporter = await this.createSmtpTransport(account);

      await withTimeout(transporter.verify(), this.options.testTimeoutMs);
      transporter.close();

      return { ok: true };
    });
  }

  async withImapClient<T>(
    account: MailAccountPrivate,
    operation: (client: ImapFlow) => Promise<T>
  ): Promise<T> {
    return this.withMailboxLock(account.id, async () =>
      this.limit(async () => {
        const client = await this.getOrCreateImapClient(account);

        try {
          const result = await withTimeout(
            operation(client),
            this.options.testTimeoutMs
          );
          const managed = this.connections.get(account.id);
          if (managed) {
            managed.lastUsedAt = Date.now();
          }
          return result;
        } catch (error) {
          await this.closeMailbox(account.id);
          throw error;
        }
      })
    );
  }

  async createSmtpTransport(
    account: MailAccountPrivate
  ): Promise<Transporter> {
    const password = this.credentialService.decryptMailboxCredential(
      account.id,
      account
    );
    try {
      return nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_secure,
        auth: {
          user: account.username,
          pass: password,
        },
      });
    } finally {
      void password;
    }
  }

  async closeMailbox(mailAccountId: string) {
    const managed = this.connections.get(mailAccountId);
    this.connections.delete(mailAccountId);

    if (managed) {
      await managed.client.logout().catch(() => undefined);
    }
  }

  async closeAll() {
    const closing = [...this.connections.keys()].map((mailAccountId) =>
      this.closeMailbox(mailAccountId)
    );
    await Promise.allSettled(closing);

    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async closeIdleConnections() {
    const now = Date.now();
    const stale = [...this.connections.entries()]
      .filter(([, managed]) => now - managed.lastUsedAt > this.options.idleMs)
      .map(([mailAccountId]) => mailAccountId);

    await Promise.allSettled(
      stale.map((mailAccountId) => this.closeMailbox(mailAccountId))
    );
  }

  private async getOrCreateImapClient(account: MailAccountPrivate) {
    const existing = this.connections.get(account.id);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.client;
    }

    const password = this.credentialService.decryptMailboxCredential(
      account.id,
      account
    );
    const client = new ImapFlow({
      host: account.imap_host,
      port: account.imap_port,
      secure: account.imap_secure,
      auth: {
        user: account.username,
        pass: password,
      },
      logger: false,
    });

    await withTimeout(client.connect(), this.options.testTimeoutMs);
    this.connections.set(account.id, {
      client,
      lastUsedAt: Date.now(),
    });

    return client;
  }

  private async withMailboxLock<T>(
    mailAccountId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.locks.get(mailAccountId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current);
    this.locks.set(mailAccountId, chained);

    try {
      await previous.catch(() => undefined);
      return await operation();
    } finally {
      release();
      if (this.locks.get(mailAccountId) === chained) {
        this.locks.delete(mailAccountId);
      }
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Mail connection test timed out."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
