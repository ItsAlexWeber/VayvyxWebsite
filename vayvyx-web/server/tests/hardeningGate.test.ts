import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ipKeyGenerator } from "express-rate-limit";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { mailRateLimitKey } from "../src/rateLimitKey.js";

describe("hardening gate", () => {
  it("uses port 4174 and loopback binding by default", () => {
    const config = loadConfig({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "public-key",
      SUPABASE_SECRET_KEY: "server-key",
    });

    expect(config.port).toBe(4174);
    expect(config.host).toBe("127.0.0.1");
  });

  it("serves minimal mail health without authentication", async () => {
    const { app, connectionManager } = createApp({
      clients: {
        admin: {} as never,
        createUserClient: () => ({}) as never,
      },
      vault: {} as never,
      connectionManagerOptions: {
        maxActiveConnections: 1,
        idleMs: 60_000,
        testTimeoutMs: 1_000,
      },
    });

    await request(app).get("/api/mail/health").expect(200, { status: "ok" });
    await connectionManager.closeAll();
  });

  it("app creation emits no ERR_ERL_KEY_GEN_IPV6 warning", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { app, connectionManager } = createApp({
      clients: {
        admin: {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { role: "user" },
                  error: null,
                }),
              }),
            }),
          }),
        } as never,
        createUserClient: () =>
          ({
            auth: {
              getUser: async () => ({
                data: {
                  user: {
                    id: "00000000-0000-4000-8000-000000000001",
                    email: "person@example.com",
                  },
                },
                error: null,
              }),
            },
          }) as never,
      },
      vault: {} as never,
      connectionManagerOptions: {
        maxActiveConnections: 1,
        idleMs: 60_000,
        testTimeoutMs: 1_000,
      },
    });

    await request(app)
      .get("/api/mail/not-found")
      .set("Authorization", "Bearer test-token")
      .expect(404);

    const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .join(" ");
    expect(logged).not.toContain("ERR_ERL_KEY_GEN_IPV6");
    await connectionManager.closeAll();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("uses authenticated user id for authenticated rate-limit keys", () => {
    const key = mailRateLimitKey({
      auth: { userId: "user-123" },
      ip: "2001:db8::1",
    } as never);

    expect(key).toBe("user-123");
  });

  it("uses ipKeyGenerator for IPv4 fallback", () => {
    const ip = "192.0.2.44";

    expect(mailRateLimitKey({ ip } as never)).toBe(ipKeyGenerator(ip));
  });

  it("uses normalized IPv6 grouping for IP fallback", () => {
    const ip = "2001:db8:abcd:1234:5678:90ab:cdef:1234";

    expect(mailRateLimitKey({ ip } as never)).toBe(ipKeyGenerator(ip));
    expect(mailRateLimitKey({ ip } as never)).not.toBe(ip);
  });
});
