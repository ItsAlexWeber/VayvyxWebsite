import { describe, expect, it } from "vitest";
import { SupabaseVaultMailCredentialVault } from "../src/vault.js";

describe("Supabase Vault adapter", () => {
  it("creates secrets through the locked-down database wrapper", async () => {
    const calls: unknown[] = [];
    const vault = new SupabaseVaultMailCredentialVault({
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return {
          data: "00000000-0000-4000-8000-000000000099",
          error: null,
        };
      },
    } as never);

    const secretId = await vault.createMailboxSecret({
      emailAddress: "support@vayvyx.com",
      password: "mailbox password",
    });

    expect(secretId).toBe("00000000-0000-4000-8000-000000000099");
    expect(calls).toMatchObject([
      {
        fn: "mail_vault_create_secret",
        args: {
          p_secret: "mailbox password",
          p_description: "Vayvyx Mail credential for support@vayvyx.com",
        },
      },
    ]);
  });

  it("retrieves decrypted credentials only by server-side secret id", async () => {
    const vault = new SupabaseVaultMailCredentialVault({
      rpc: async (fn: string, args: unknown) => {
        expect(fn).toBe("mail_vault_read_secret");
        expect(args).toEqual({
          p_secret_id: "00000000-0000-4000-8000-000000000099",
        });
        return { data: "mailbox password", error: null };
      },
    } as never);

    await expect(
      vault.readMailboxSecret("00000000-0000-4000-8000-000000000099")
    ).resolves.toBe("mailbox password");
  });
});
