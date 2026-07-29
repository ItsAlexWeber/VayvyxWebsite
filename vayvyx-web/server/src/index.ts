import { loadConfig } from "./config.js";
import { createSupabaseClients } from "./supabaseClients.js";
import { createApp } from "./app.js";

const config = loadConfig();
const clients = createSupabaseClients(config);
const { app, connectionManager } = createApp({
  clients,
  connectionManagerOptions: {
    maxActiveConnections: config.mailMaxActiveConnections,
    idleMs: config.mailConnectionIdleMs,
    testTimeoutMs: config.mailConnectionTestTimeoutMs,
  },
});

const server = app.listen(config.port, config.host, () => {
  console.log(
    `Vayvyx Mail backend listening on ${config.host}:${config.port}`
  );
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down Vayvyx Mail backend.`);
  server.close(async () => {
    await connectionManager.closeAll();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
