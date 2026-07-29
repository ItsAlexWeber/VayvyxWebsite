import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mailCss = readFileSync(join(process.cwd(), "src/styles/mailPage.css"), "utf8");

describe("mail frontend layout CSS", () => {
  it("defines responsive mail workspace layout guards", () => {
    expect(mailCss).toContain('grid-template-areas: "sidebar list"');
    expect(mailCss).toContain('grid-template-areas: "sidebar list viewer"');
    expect(mailCss).toContain("minmax(360px, 440px)");
    expect(mailCss).toContain("overflow: hidden");
    expect(mailCss).toContain("overflow-x: hidden");
    expect(mailCss).toContain(".mail-html-body-frame");
    expect(mailCss).toContain("min-width: 0");
    expect(mailCss).toContain("@media (max-width: 760px)");
    expect(mailCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
