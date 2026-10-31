export type DiffSegment = { type: "equal" | "insert" | "delete"; text: string };

/** Splits into words and the whitespace between them, so joining the tokens gives back the input. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/**
 * Word-level diff via longest common subsequence. Whitespace is diffed like a word, so the segments
 * of one side always join back to that side's text exactly.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);

  // Trim the shared prefix and suffix first; most edits touch a small part of the text.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const rows = midA.length + 1;
  const cols = midB.length + 1;
  const lcs = new Uint16Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i * cols + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * cols + j + 1]! + 1
          : Math.max(lcs[(i + 1) * cols + j]!, lcs[i * cols + j + 1]!);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment["type"], text: string) => {
    const last = segments.at(-1);
    if (last?.type === type) last.text += text;
    else segments.push({ type, text });
  };

  if (start > 0) push("equal", a.slice(0, start).join(""));
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      push("equal", midA[i]!);
      i++;
      j++;
    } else if (lcs[(i + 1) * cols + j]! >= lcs[i * cols + j + 1]!) {
      push("delete", midA[i++]!);
    } else {
      push("insert", midB[j++]!);
    }
  }
  while (i < midA.length) push("delete", midA[i++]!);
  while (j < midB.length) push("insert", midB[j++]!);
  if (endA < a.length) push("equal", a.slice(endA).join(""));

  return segments;
}

/** The segments to show on one side of a side-by-side diff. */
export function sideOf(segments: DiffSegment[], side: "before" | "after"): DiffSegment[] {
  const hidden = side === "before" ? "insert" : "delete";
  return segments.filter((segment) => segment.type !== hidden);
}

/** Counts of changed words (whitespace ignored). */
export function changeStats(segments: DiffSegment[]): { added: number; removed: number } {
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
  return segments.reduce(
    (stats, segment) => ({
      added: stats.added + (segment.type === "insert" ? words(segment.text) : 0),
      removed: stats.removed + (segment.type === "delete" ? words(segment.text) : 0),
    }),
    { added: 0, removed: 0 },
  );
}
