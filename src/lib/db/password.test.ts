import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the correct password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("produces a salted hash (different output each time, never plaintext)", () => {
    const a = hashPassword("hunter2hunter2");
    const b = hashPassword("hunter2hunter2");
    expect(a).not.toBe(b); // unique salt per hash
    expect(a).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(a).not.toContain("hunter2");
  });

  it("rejects malformed stored values without throwing", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "bcrypt$abc$def")).toBe(false);
  });
});
