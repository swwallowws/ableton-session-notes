// Decides which notes the pad shows when a Set opens, from what the Set carries
// (decoded data clips, see codec.ts) and this computer's backup of that Set (see
// backups.ts). The Set is the source of truth; the backup only speaks up when it
// holds something the Set doesn't. Pure: no SDK, no file system.
import { type Bundle, type Damaged, revCounter } from "./codec.js";

export type Notice =
  | { kind: "newer"; text: string; restore: Bundle }
  | { kind: "damaged"; text: string; restore: Bundle | null }
  | { kind: "choose"; text: string; options: Bundle[] };

export type Decision = {
  notes: Record<string, string>;
  id: string | null; // null until the Set's first save of notes mints one
  base: string; // the rev the pad's edits start from ("" when none)
  current?: string;
  notice: Notice | null;
  adopt: Bundle | null; // the Set's bundle, when the backup should learn it
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

// "14:32" today, "3 Oct 09:05" otherwise, in local time.
export function timeLabel(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "an earlier session";
  const hm = `${two(t.getHours())}:${two(t.getMinutes())}`;
  const sameDay =
    t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate();
  return sameDay ? hm : `${t.getDate()} ${MONTHS[t.getMonth()]} ${hm}`;
}

// Whether `to` was edited (directly or through later edits) from `from`.
export function descends(history: Bundle[], from: string, to: string): boolean {
  const byRev = new Map(history.map((h) => [h.rev, h]));
  let cur = byRev.get(to);
  for (let guard = 0; cur && guard < 10000; guard++) {
    if (cur.parent === from) return true;
    cur = byRev.get(cur.parent);
  }
  return false;
}

// Two Sets sharing an id (a Save As copy) have diverged when the backup already
// holds another edit of the same parent. `exclude` holds this session's own
// writes that never reached the Set, so a retry isn't taken for a fork.
export function isFork(history: Bundle[], parent: string, writing: string, exclude: Set<string>): boolean {
  return history.some((h) => h.parent === parent && h.rev !== writing && !exclude.has(h.rev));
}

const newestFirst = (a: Bundle, b: Bundle) => b.saved.localeCompare(a.saved);

const use = (b: Bundle, notice: Notice | null, adopt: Bundle | null): Decision => ({
  notes: b.notes,
  id: b.id,
  base: b.rev,
  ...(b.current !== undefined ? { current: b.current } : {}),
  notice,
  adopt,
});

export function reconcile(input: {
  bundles: Bundle[];
  damaged: Damaged[];
  history: (id: string) => Bundle[]; // newest first
  kept: Record<string, string>; // id -> backup rev the user chose not to restore
}): Decision {
  const { bundles, damaged, history, kept } = input;

  // Keep the highest revision per id (two copies of one id: take the later edit).
  const byId = new Map<string, Bundle>();
  for (const b of bundles) {
    const seen = byId.get(b.id);
    if (!seen || revCounter(b.rev) > revCounter(seen.rev)) byId.set(b.id, b);
  }
  const found = [...byId.values()].sort(newestFirst);

  if (found.length > 1)
    return use(found[0]!, { kind: "choose", text: "This set holds notes from two sets. Which belong here?", options: found }, null);

  if (found.length === 1) {
    const b = found[0]!;
    const h = history(b.id);
    const head = h[0];
    if (!head) return use(b, null, b);
    if (head.rev === b.rev) return use(b, null, null);
    if (!h.some((x) => x.rev === b.rev)) return use(b, null, b);
    if (descends(h, b.rev, head.rev) && kept[b.id] !== head.rev)
      return use(
        b,
        { kind: "newer", text: `Newer notes from ${timeLabel(head.saved)} weren't saved into the set.`, restore: head },
        null,
      );
    return use(b, null, null);
  }

  if (damaged.length) {
    const d = damaged.find((x) => x.id) ?? damaged[0]!;
    const head = d.id ? (history(d.id)[0] ?? null) : null;
    const text = head
      ? `This set's notes are damaged. The last backup is from ${timeLabel(head.saved)}.`
      : "This set's notes are damaged and there is no backup.";
    return { notes: {}, id: d.id, base: "", notice: { kind: "damaged", text, restore: head }, adopt: null };
  }

  return { notes: {}, id: null, base: "", notice: null, adopt: null };
}
