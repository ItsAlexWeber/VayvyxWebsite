import dotenv from "dotenv";
import { z } from "zod";
import { parseCredentialMasterKey } from "./credentialCrypto.js";

const envFile = process.env.VAYVYX_MAIL_ENV_FILE ?? "/etc/vayvyx-mail.env";
dotenv.config({ path: envFile, override: false });

const envSchema = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().int().positive().default(4174),
    HOST: z.string().default("127.0.0.1"),
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    MAIL_CREDENTIAL_MASTER_KEY: z.string().optional(),
    MAIL_MAX_ACTIVE_CONNECTIONS: z.coerce.number().int().positive().default(8),
    MAIL_CONNECTION_IDLE_MS: z.coerce.number().int().positive().default(120_000),
    MAIL_CONNECTION_TEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15_000),
  })
  .superRefine((value, context) => {
    if (!value.SUPABASE_PUBLISHABLE_KEY && !value.SUPABASE_ANON_KEY) {
      context.addIssue({
        code: "custom",
        path: ["SUPABASE_PUBLISHABLE_KEY"],
        message: "SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY is required.",
      });
    }

    if (!value.SUPABASE_SECRET_KEY && !value.SUPABASE_SERVICE_ROLE_KEY) {
      context.addIssue({
        code: "custom",
        path: ["SUPABASE_SECRET_KEY"],
        message: "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required.",
      });
    }
  });

export type ServerConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env = process.env) {
  const parsed = envSchema.parse(env);
  const serverSecretKey =
    parsed.SUPABASE_SECRET_KEY ?? parsed.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey =
    parsed.SUPABASE_PUBLISHABLE_KEY ?? parsed.SUPABASE_ANON_KEY;
  const mailCredentialMasterKey = parseCredentialMasterKey(
    parsed.MAIL_CREDENTIAL_MASTER_KEY
  );

  if (!serverSecretKey || !publishableKey) {
    throw new Error("Supabase server and publishable keys are required.");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    supabaseUrl: parsed.SUPABASE_URL,
    supabasePublishableKey: publishableKey,
    supabaseServerSecretKey: serverSecretKey,
    mailCredentialMasterKey,
    mailMaxActiveConnections: parsed.MAIL_MAX_ACTIVE_CONNECTIONS,
    mailConnectionIdleMs: parsed.MAIL_CONNECTION_IDLE_MS,
    mailConnectionTestTimeoutMs: parsed.MAIL_CONNECTION_TEST_TIMEOUT_MS,
  };
}
