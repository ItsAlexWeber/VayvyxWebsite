import { describe, expect, it } from "vitest";
import {
  messageListQuerySchema,
  optionalQueryBoolean,
  unifiedQuerySchema,
} from "../src/mailValidation.js";

describe("mail query validation", () => {
  it("parses explicit false query booleans as false", () => {
    const parsed = messageListQuerySchema.parse({
      folder: "INBOX",
      unreadOnly: "false",
      flaggedOnly: "false",
    });

    expect(parsed.unreadOnly).toBe(false);
    expect(parsed.flaggedOnly).toBe(false);
  });

  it("parses true query booleans as true", () => {
    const parsed = messageListQuerySchema.parse({
      folder: "INBOX",
      unreadOnly: "true",
      flaggedOnly: true,
    });

    expect(parsed.unreadOnly).toBe(true);
    expect(parsed.flaggedOnly).toBe(true);
  });

  it("defaults absent mail query booleans to false", () => {
    expect(messageListQuerySchema.parse({}).unreadOnly).toBe(false);
    expect(messageListQuerySchema.parse({}).flaggedOnly).toBe(false);
    expect(unifiedQuerySchema.parse({}).unreadOnly).toBe(false);
    expect(unifiedQuerySchema.parse({}).flaggedOnly).toBe(false);
  });

  it.each(["yes", "random", ["false"], { value: "false" }])(
    "rejects invalid boolean query value %#",
    (value) => {
      expect(() => optionalQueryBoolean.parse(value)).toThrow();
    }
  );
});
