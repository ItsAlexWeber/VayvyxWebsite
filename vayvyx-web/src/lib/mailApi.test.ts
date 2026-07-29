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
