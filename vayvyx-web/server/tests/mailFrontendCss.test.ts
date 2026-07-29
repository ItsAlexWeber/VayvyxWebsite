import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mailCss = readFileSync(join(process.cwd(), "src/styles/mailPage.css"), "utf8");

describe("mail frontend layout CSS", () => {
  it("defines responsive mail workspace layout guards", () => {
    expect(mailCss).toContain('grid-template-areas: "rail sidebar list"');
    expect(mailCss).toContain('grid-template-areas: "rail sidebar list viewer"');
    expect(mailCss).toContain("56px clamp(220px, 17vw, 250px)");
    expect(mailCss).toContain("minmax(340px, 420px)");
    expect(mailCss).toContain(".mail-navigation-rail");
    expect(mailCss).toContain(".mail-page.nav-collapsed");
    expect(mailCss).toContain('grid-template-areas: "rail list"');
    expect(mailCss).toContain("grid-template-columns: 56px minmax(340px, 1fr)");
    expect(mailCss).toContain(".mail-page:not(.nav-collapsed) .mail-rail-compose");
    expect(mailCss).toContain(".mail-toolbar-compose");
    expect(mailCss).toContain(".mail-page.nav-collapsed .mail-shell-sidebar.mobile-active");
    expect(mailCss).toContain("transition: grid-template-columns 160ms ease");
    expect(mailCss).toContain("overflow: hidden");
    expect(mailCss).toContain("overflow-x: hidden");
    expect(mailCss).toContain("scrollbar-width: thin");
    expect(mailCss).toContain(".mail-html-body-frame");
    expect(mailCss).toContain(".mail-template-picker");
    expect(mailCss).toContain("width: min(100%, 60rem)");
    expect(mailCss).toContain("max-height: min(85svh, 54rem)");
    expect(mailCss).toContain(".mail-compose-body-workspace");
    expect(mailCss).toContain("overflow-y: auto");
    expect(mailCss).toContain(".mail-rich-editor-toolbar");
    expect(mailCss).toContain(".mail-compose-template-preview");
    expect(mailCss).toContain("width: min(100%, 680px)");
    expect(mailCss).toContain(".mail-template-field-warning");
    expect(mailCss).toContain(".mail-file-input");
    expect(mailCss).toContain("min-width: 0");
    expect(mailCss).toContain("@media (max-width: 760px)");
    expect(mailCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
