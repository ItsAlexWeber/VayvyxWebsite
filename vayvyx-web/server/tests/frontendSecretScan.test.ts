import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("frontend access-management source", () => {
  it("does not import server secrets or admin SDKs into browser code", () => {
    const root = process.cwd();
    const files = [
      "src/lib/accessApi.ts",
      "src/pages/accessAdminPage.tsx",
      "src/pages/acceptInvitePage.tsx",
    ];
    const source = files
      .map((file) => readFileSync(join(root, file), "utf8"))
      .join("\n");

    expect(source).not.toContain("SUPABASE_SECRET");
    expect(source).not.toContain("SERVICE_ROLE");
    expect(source).not.toContain("service_role");
    expect(source).not.toContain("password_hash");
    expect(source).not.toContain("auth.admin");
  });
});
