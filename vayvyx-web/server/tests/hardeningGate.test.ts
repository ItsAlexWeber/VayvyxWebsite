import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

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
});
