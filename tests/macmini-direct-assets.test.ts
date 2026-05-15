import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("macmini-direct sync assets", () => {
  it("keeps source state modules while excluding root runtime state", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts/macmini-direct.mjs"), "utf8");

    expect(script).toContain('"/state/"');
    expect(script).toContain('"/logs/"');
    expect(script).not.toContain('"state",');
    expect(script).not.toContain('"logs",');
  });

  it("uses password authentication directly when a Mac mini password is provided", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts/macmini-direct.mjs"), "utf8");

    expect(script).toContain('"PreferredAuthentications=password"');
    expect(script).toContain('"PubkeyAuthentication=no"');
    expect(script).toContain("effectiveSshOptions");
  });
});
