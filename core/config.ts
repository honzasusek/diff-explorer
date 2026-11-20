// The mod's options: what the manifest's userConfig declares and the person
// sets in /config. The engine hands register() the stored values with the
// defaults filled in; readConfig turns them into a Config, taking the default
// for a value that cannot be used, so no hook ever sees a bad one.
//
// `readConfig({ baseRef: " develop ", foldLines: -1, inlineRows: 12 })` gives
// `{ baseRef: "develop", foldLines: 1500, inlineRows: 12 }`: the negative
// threshold falls back to the default.

export interface Config {
  /** The ref the working tree and a branch are measured from when /explore
   * names none; null tries origin/HEAD, then main, then master. A pull
   * request is measured from its own base branch whatever this says. */
  baseRef: string | null;
  /** Changed lines from which a file starts folded in the pane; 0 folds every file. */
  foldLines: number;
  /** Body rows the pane asks for while inline above the prompt; null leaves
   * it to the layout, a third of the screen. The dock ignores it. */
  inlineRows: number | null;
}

export const DEFAULT_CONFIG: Config = { baseRef: null, foldLines: 1500, inlineRows: null };

/** A whole number at or above zero, from a number or a numeric string; null otherwise. */
function wholeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** A ref git would read as a ref: not blank, not an option. */
function refOrNull(value: unknown): string | null {
  const ref = typeof value === "string" ? value.trim() : "";
  return ref === "" || ref.startsWith("-") ? null : ref;
}

export function readConfig(raw: Readonly<Record<string, unknown>>): Config {
  const inlineRows = wholeNumber(raw["inlineRows"]);
  return {
    baseRef: refOrNull(raw["baseRef"]),
    foldLines: wholeNumber(raw["foldLines"]) ?? DEFAULT_CONFIG.foldLines,
    inlineRows: inlineRows === null || inlineRows === 0 ? null : inlineRows,
  };
}
