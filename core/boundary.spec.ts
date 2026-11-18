// The core rule (ADR-0004, ADR-0006): core/ imports only its own files, so it
// runs under the mod loader, under Node and behind a web layer alike. Core
// tests are *.spec.ts (node --test); *.test.ts files are the mod's, run by
// `claude plugin test`, which picks up every *.test.ts under the folder.
// core/testing/ holds test support and is outside the rule too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "testing" && dir === root ? [] : sources(full);
    return full.endsWith(".ts") && !full.endsWith(".spec.ts") ? [full] : [];
  });
}

const SPECIFIER_RE = /^\s*(?:import|export)\b(?:[^'"\n]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;

function specifiers(file: string): string[] {
  return Array.from(readFileSync(file, "utf8").matchAll(SPECIFIER_RE), (m) => m[1] ?? "");
}

test("core imports only files inside core", () => {
  const offenders: string[] = [];
  for (const file of sources(root)) {
    for (const spec of specifiers(file)) {
      const isRelative = spec.startsWith("./") || spec.startsWith("../");
      const staysInside = isRelative && !relative(root, resolve(dirname(file), spec)).startsWith("..");
      if (!staysInside) offenders.push(`${relative(root, file)}: ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});
