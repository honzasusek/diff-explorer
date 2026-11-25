// Syntax colours for TypeScript, JavaScript and JSON lines, worked out by the mod itself. The
// desktop app colours code only inside its own code cards, which carry no line
// numbers, so the desktop pane draws plain text and colours it from here.
//
// A line becomes pieces, each a stretch of text and what kind it is:
//
//   highlightLine("const n = 4 // four", "code")
//   gives pieces  [keyword "const"] [" n = "] [number "4"] [" "] [comment "// four"]
//   and the state "code" for the next line.
//
// The state carries a block comment or a template string over to the next
// line. It is rough on purpose: no regex literals and no JSX text, so a quote
// in either starts a string that ends with the line. JSON goes through the
// same rules, which already cover its strings, numbers, true, false and null;
// only a key, a string followed by a colon, is told apart:
//
//   highlightLine('  "port": 8080,', "code", "json")
//   gives pieces  ["  "] [property '"port"'] [": "] [number "8080"] [","]

export type TokenKind = "keyword" | "string" | "comment" | "number" | "property";

export interface Piece {
  text: string;
  /** null: drawn in the text's own colour. */
  kind: TokenKind | null;
}

/** What is still open at the end of a line: nothing, a block comment, or a template string. */
export type LineState = "code" | "block" | "template";

/** The languages coloured: TypeScript and JavaScript share one set of rules. */
export type Language = "script" | "json";

/** A file's language by its extension, or null when it is not coloured:
 * `languageOf("src/App.jsx")` is `"script"`, `languageOf("a.py")` is null. */
export function languageOf(path: string): Language | null {
  if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path)) return "script";
  if (/\.(json|jsonc)$/.test(path)) return "json";

  return null;
}

const KEYWORDS = new Set(
  (
    "abstract any as asserts async await bigint boolean break case catch class const continue debugger declare default delete do else enum export " +
    "extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number " +
    "object of override private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof " +
    "undefined unique unknown var void while yield"
  ).split(" "),
);

const NUMBER = /^(?:0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?|\.\d[\d_]*(?:[eE][+-]?\d+)?)/;
const WORD = /^[A-Za-z_$][\w$]*/;

/** The end of a string opened before `from` by `quote`: the index after its
 * closing quote, or the line's length when it runs off the end. A backslash
 * skips the character after it. */
function closeOf(line: string, from: number, quote: string): { end: number; closed: boolean } {
  for (let i = from; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === quote) return { end: i + 1, closed: true };
  }

  return { end: line.length, closed: false };
}

/** One line's pieces and the state the next line starts in; see the top of the file. */
export function highlightLine(line: string, state: LineState, language: Language = "script"): { pieces: Piece[]; state: LineState } {
  const pieces: Piece[] = [];
  const push = (text: string, kind: TokenKind | null) => {
    if (text === "") return;
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.kind === kind) last.text += text;
    else pieces.push({ text, kind });
  };

  let i = 0;
  let next: LineState = "code";
  if (state === "block") {
    const end = line.indexOf("*/");
    if (end === -1) return { pieces: line === "" ? [] : [{ text: line, kind: "comment" }], state: "block" };
    push(line.slice(0, end + 2), "comment");
    i = end + 2;
  } else if (state === "template") {
    const close = closeOf(line, 0, "`");
    push(line.slice(0, close.end), "string");
    if (!close.closed) return { pieces, state: "template" };
    i = close.end;
  }

  let plainFrom = i;
  const flush = (to: number) => push(line.slice(plainFrom, to), null);

  while (i < line.length) {
    const c = line[i]!;
    const rest = line.slice(i);
    if (rest.startsWith("//")) {
      flush(i);
      push(rest, "comment");
      i = line.length;
      plainFrom = i;
    } else if (rest.startsWith("/*")) {
      flush(i);
      const end = line.indexOf("*/", i + 2);
      const to = end === -1 ? line.length : end + 2;
      push(line.slice(i, to), "comment");
      if (end === -1) next = "block";
      i = plainFrom = to;
    } else if (c === '"' || c === "'" || c === "`") {
      flush(i);
      const close = closeOf(line, i + 1, c);
      const isKey = language === "json" && /^\s*:/.test(line.slice(close.end));
      push(line.slice(i, close.end), isKey ? "property" : "string");
      if (c === "`" && !close.closed) next = "template";
      i = plainFrom = close.end;
    } else if (/[A-Za-z_$]/.test(c)) {
      const word = WORD.exec(rest)![0];
      if (KEYWORDS.has(word) && line[i - 1] !== ".") {
        flush(i);
        push(word, "keyword");
        plainFrom = i + word.length;
      }
      i += word.length;
    } else if (/[\d.]/.test(c) && NUMBER.test(rest) && !/[\w$]/.test(line[i - 1] ?? "")) {
      const number = NUMBER.exec(rest)![0];
      flush(i);
      push(number, "number");
      i = plainFrom = i + number.length;
    } else i++;
  }
  flush(line.length);

  return { pieces: joinAcrossSpaces(pieces), state: next };
}

/** Two pieces of one kind with only spaces between become one, so the drawing
 * spends one coloured stretch instead of two: `[keyword "export"] [" "]
 * [keyword "const"]` gives `[keyword "export const"]`. */
function joinAcrossSpaces(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const piece of pieces) {
    const gap = out[out.length - 1];
    const before = out[out.length - 2];
    if (piece.kind !== null && gap?.kind === null && /^\s+$/.test(gap.text) && before?.kind === piece.kind) {
      out.pop();
      before.text += gap.text + piece.text;
    } else out.push({ ...piece });
  }

  return out;
}
