// Test support only: not part of core's interface and excluded from the
// boundary rule, so it may use Node.
import { readFileSync } from "node:fs";

export const FIXTURES = [
  "modified-two-hunks",
  "no-newline",
  "rename-pure",
  "rename-modified",
  "copy",
  "deleted",
  "empty-added",
  "binary",
  "unicode-path-raw",
  "unicode-path-quoted",
  "all",
] as const;

export type FixtureName = (typeof FIXTURES)[number];

export function fixture(name: FixtureName): string {
  return readFileSync(new URL(`../diff/fixtures/${name}.diff`, import.meta.url), "utf8");
}
