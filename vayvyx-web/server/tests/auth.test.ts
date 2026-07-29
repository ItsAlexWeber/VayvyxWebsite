import { describe, expect, it } from "vitest";
import { getPlatformRole, hasMailboxRole, requireAuthenticated } from "../src/auth.js";
import type { AppSupabaseClients } from "../src/types.js";

describe("authorization helpers", () => {
  it("enforces mailbox role hierarchy", () => {
    expect(hasMailboxRole("viewer", "viewer")).toBe(true);
    expect(hasMailboxRole("sender", "viewer")).toBe(true);
    expect(hasMailboxRole("manager", "sender")).toBe(true);
    expect(hasMailboxRole("owner", "manager")).toBe(true);
    expect(hasMailboxRole("viewer", "sender")).toBe(false);
    expect(hasMailboxRole("sender", "manager")).toBe(false);
  });

  it("loads platform role through the server admin client", async () => {
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { role: "admin" }, error: null }),
          }),
        }),
      }),
    };

    await expect(getPlatformRole(admin as never, "user-id")).resolves.toBe(
      "admin"
    );
  });

  it("keeps bearer-token validation separate from the admin client", async () => {
    const calls: string[] = [];
    const clients: AppSupabaseClients = {
      admin: {
        from: () => {
          calls.push("admin.from");
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { role: "user" },
                  error: null,
                }),
              }),
            }),
          };
        },
      } as never,
      createUserClient: (token: string) => {
        calls.push(`user.client:${token}`);
        return {
          auth: {
            getUser: async (providedToken: string) => {
              calls.push(`user.getUser:${providedToken}`);
              return {
                data: {
                  user: {
                    id: "00000000-0000-4000-8000-000000000001",
                    email: "person@vayvyx.com",
                  },
                },
                error: null,
              };
            },
          },
        } as never;
      },
    };

    const middleware = requireAuthenticated(clients);
    const request = {
      header: (name: string) =>
        name.toLowerCase() === "authorization" ? "Bearer user-token" : null,
    };

    await new Promise<void>((resolve, reject) => {
      middleware(request as never, {} as never, (error?: unknown) => {
        if (error) reject(error);
        else resolve();
      });
    });

    expect(calls).toEqual([
      "user.client:user-token",
      "user.getUser:user-token",
      "admin.from",
    ]);
  });
});
