// A jump of the pane's window drawn as a short glide instead of a teleport.
// A terminal scrolls by whole rows, so a glide is a few offsets the window
// steps through, close together at the end (ease-out), the last one the
// target. A jump longer than three windows would glide through hunks the
// pane has not drawn, so it lands one window short at once and glides the
// rest.
//
// With 20 body rows, `glide(0, 20, 20)` is `[10, 16, 19, 20]`, and
// `glide(0, 1000, 20)` is `[980, 990, 996, 999, 1000]`.

/** Steps of a glide, at most this many after the first jump. */
const MAX_STEPS = 6;

export function glide(from: number, to: number, bodyRows: number): number[] {
  const distance = to - from;
  if (Math.abs(distance) <= 2) return [to];
  const sign = Math.sign(distance);
  const window = Math.max(1, bodyRows);
  const start = Math.abs(distance) > 3 * window ? to - sign * window : from;
  const span = to - start;
  const steps = Math.max(3, Math.min(MAX_STEPS, Math.round(Math.abs(span) / 4)));
  const offsets: number[] = start === from ? [] : [start];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = 1 - (1 - t) ** 3;
    const at = Math.round(start + span * eased);
    if (at !== (offsets[offsets.length - 1] ?? from)) offsets.push(at);
  }
  if (offsets[offsets.length - 1] !== to) offsets.push(to);
  return offsets;
}
