import { createClient } from "@supabase/supabase-js";
import type { AppSupabaseClients } from "./types.js";
import type { ServerConfig } from "./config.js";

export function createSupabaseClients(config: ServerConfig): AppSupabaseClients {
  const admin = createClient(
    config.supabaseUrl,
    config.supabaseServerSecretKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  return {
    admin,
    createUserClient(accessToken: string) {
      return createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      });
    },
  };
}
