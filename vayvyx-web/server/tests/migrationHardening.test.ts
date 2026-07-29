import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/202607280001_mail_foundation.sql"),
  "utf8"
);

describe("mail migration hardening", () => {
  it("stores mailbox credentials only as encrypted fields", () => {
    expect(migration).toContain("credential_ciphertext text not null");
    expect(migration).toContain("credential_iv text not null");
    expect(migration).toContain("credential_auth_tag text not null");
    expect(migration).toContain("credential_key_version integer not null default 1");
    expect(migration).not.toContain("credential_secret_id");
  });

  it("does not grant encrypted credential columns to browser roles", () => {
    const grantSelect =
      migration.match(
        /grant select \(([\s\S]*?)\) on public\.mail_accounts\s+to authenticated;/i
      )?.[1] ?? "";

    expect(grantSelect).not.toContain("credential_ciphertext");
    expect(grantSelect).not.toContain("credential_iv");
    expect(grantSelect).not.toContain("credential_auth_tag");
    expect(grantSelect).not.toContain("credential_key_version");
  });

  it("removes hosted-project-blocked secret extension and wrappers", () => {
    const blockedTerms = [
      ["supabase", "vault"].join("_"),
      ["schema", "vault"].join(" "),
      ["mail", "vault", ""].join("_"),
    ];

    for (const term of blockedTerms) {
      expect(migration.toLowerCase()).not.toContain(term);
    }
  });
});
