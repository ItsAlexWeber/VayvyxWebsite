/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabaseClient.ts", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "token-1" } },
      })),
      signOut: vi.fn(),
    },
  },
}));

const { mailApi } = await import("./mailApi.ts");

describe("mailApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends bearer auth headers without query tokens", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await mailApi.getAccounts();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/mail/accounts");
    expect((init.headers as Headers).get("Authorization")).toBe(
      "Bearer token-1"
    );
  });

  it("loads safe mail access metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          authenticated: true,
          platformAdmin: true,
          hasMailAccess: false,
          mailboxCount: 0,
        }),
      }))
    );

    await expect(mailApi.getAccess()).resolves.toMatchObject({
      platformAdmin: true,
      hasMailAccess: false,
    });
  });

  it("omits false message filter query parameters", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ messages: [], nextCursor: null }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await mailApi.getMessages("mailbox-1", {
      folder: "INBOX",
      limit: 50,
      search: "   ",
      unreadOnly: false,
      flaggedOnly: false,
      sortDirection: "desc",
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url, "https://vayvyx.test");
    expect(parsed.pathname).toBe("/api/mail/accounts/mailbox-1/messages");
    expect(parsed.searchParams.get("folder")).toBe("INBOX");
    expect(parsed.searchParams.get("limit")).toBe("50");
    expect(parsed.searchParams.get("sortDirection")).toBe("desc");
    expect(parsed.searchParams.has("search")).toBe(false);
    expect(parsed.searchParams.has("unreadOnly")).toBe(false);
    expect(parsed.searchParams.has("flaggedOnly")).toBe(false);
  });

  it("downloads attachments through Blob URLs and revokes them", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: revoke,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-disposition": 'attachment; filename="file.txt"',
        }),
        blob: async () => new Blob(["hello"]),
      }))
    );

    await mailApi.downloadAttachment("mailbox", "INBOX", 1, "part-1");

    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
});
