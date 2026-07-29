import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202607280001_mail_foundation.sql"),
  "utf8"
);

describe("mail migration hardening", () => {
  it("keeps Vault RPC wrappers security-definer with fixed search paths", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, vault");
  });

  it("does not grant Vault wrapper execution to browser roles", () => {
    expect(migration).toContain(
      "revoke all on function public.mail_vault_read_secret(uuid) from public"
    );
    expect(migration).toContain(
      "grant execute on function public.mail_vault_read_secret(uuid) to service_role"
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.mail_vault_read_secret\(uuid\) to authenticated/i
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.mail_vault_read_secret\(uuid\) to anon/i
    );
  });

  it("limits Vault reads and rotations to mail account credential ids", () => {
    expect(migration).toContain("from public.mail_accounts");
    expect(migration).toContain("where credential_secret_id = p_secret_id::text");
  });
});
