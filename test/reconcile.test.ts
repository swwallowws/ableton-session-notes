// Headless tests for src/reconcile.ts: which notes the pad shows when the Set's
// data and the local backup disagree. Run with: npm test
import * as assert from "node:assert/strict";
import type { Bundle, Damaged } from "../src/codec.js";
import { descends, isFork, reconcile, timeLabel } from "../src/reconcile.js";

let passed = 0;
const failures: string[] = [];
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${(e as Error).message.split("\n").join("\n      ")}`);
  }
};

const ID = "7f3k2q9a";
let clock = Date.UTC(2026, 9, 15, 10, 0, 0);
const b = (rev: string, parent: string, notes: Record<string, string> = { a: rev }, id = ID): Bundle => ({
  v: 1,
  id,
  rev,
  parent,
  saved: new Date((clock += 60000)).toISOString(),
  notes,
});
// history() takes newest first.
const hist = (...xs: Bundle[]) => (id: string) => xs.filter((x) => x.id === id).reverse();
const none = () => [];

console.log("reconcile");

test("the Set's data matches the backup head: use it quietly", () => {
  const p = b("1-aaaa", "");
  const d = reconcile({ bundles: [p], damaged: [], history: hist(p), kept: {} });
  assert.deepEqual(d.notes, p.notes);
  assert.equal(d.id, ID);
  assert.equal(d.base, "1-aaaa");
  assert.equal(d.notice, null);
  assert.equal(d.adopt, null);
});

test("no backup yet (another computer): use the Set's data and adopt it", () => {
  const p = b("4-aaaa", "3-zzzz");
  const d = reconcile({ bundles: [p], damaged: [], history: none, kept: {} });
  assert.deepEqual(d.notes, p.notes);
  assert.equal(d.notice, null);
  assert.deepEqual(d.adopt, p);
});

test("the backup has a newer edit of the Set's version: offer to restore it", () => {
  const p = b("1-aaaa", "");
  const h = b("2-bbbb", "1-aaaa", { a: "newer" });
  const d = reconcile({ bundles: [p], damaged: [], history: hist(p, h), kept: {} });
  assert.deepEqual(d.notes, p.notes, "the Set's notes stay on screen until the user picks");
  assert.equal(d.base, "1-aaaa");
  assert.equal(d.notice?.kind, "newer");
  assert.deepEqual(d.notice && "restore" in d.notice ? d.notice.restore : null, h);
  assert.match(d.notice!.text, /^Newer notes from .+ weren't saved into the set\.$/);
});

test("a newer backup two edits ahead still counts as descending", () => {
  const p = b("1-aaaa", "");
  const h1 = b("2-bbbb", "1-aaaa");
  const h2 = b("3-cccc", "2-bbbb");
  const d = reconcile({ bundles: [p], damaged: [], history: hist(p, h1, h2), kept: {} });
  assert.equal(d.notice?.kind, "newer");
});

test("after Keep the Set's, the same newer backup doesn't ask again", () => {
  const p = b("1-aaaa", "");
  const h = b("2-bbbb", "1-aaaa");
  const d = reconcile({ bundles: [p], damaged: [], history: hist(p, h), kept: { [ID]: "2-bbbb" } });
  assert.equal(d.notice, null);
});

test("the Set's data is newer than the backup: use it and adopt it", () => {
  const old = b("1-aaaa", "");
  const p = b("2-bbbb", "1-aaaa");
  const d = reconcile({ bundles: [p], damaged: [], history: hist(old), kept: {} });
  assert.deepEqual(d.notes, p.notes);
  assert.equal(d.notice, null);
  assert.deepEqual(d.adopt, p);
});

test("a newer backup on another branch (a Save As copy) doesn't ask", () => {
  const root = b("1-aaaa", "");
  const mine = b("2-mine", "1-aaaa");
  const theirs = b("2-thrs", "1-aaaa");
  const d = reconcile({ bundles: [mine], damaged: [], history: hist(root, mine, theirs), kept: {} });
  assert.deepEqual(d.notes, mine.notes);
  assert.equal(d.notice, null);
  assert.equal(d.adopt, null);
});

test("damaged data with a backup: offer the latest backup, keep the id", () => {
  const h = b("5-eeee", "4-dddd");
  const dmg: Damaged = { id: ID, reason: "checksum mismatch", names: ["SN1 x"] };
  const d = reconcile({ bundles: [], damaged: [dmg], history: hist(h), kept: {} });
  assert.deepEqual(d.notes, {});
  assert.equal(d.id, ID);
  assert.equal(d.notice?.kind, "damaged");
  assert.deepEqual(d.notice && "restore" in d.notice ? d.notice.restore : undefined, h);
  assert.match(d.notice!.text, /^This set's notes are damaged\. The last backup is from .+\.$/);
});

test("damaged data and no backup: say so, nothing to restore", () => {
  const dmg: Damaged = { id: null, reason: "unreadable header", names: ["SN1 x"] };
  const d = reconcile({ bundles: [], damaged: [dmg], history: none, kept: {} });
  assert.equal(d.id, null);
  assert.equal(d.notice?.kind, "damaged");
  assert.equal(d.notice && "restore" in d.notice ? d.notice.restore : undefined, null);
  assert.equal(d.notice!.text, "This set's notes are damaged and there is no backup.");
});

test("no data in the Set: start empty with no id and no notice", () => {
  const d = reconcile({ bundles: [], damaged: [], history: none, kept: {} });
  assert.deepEqual(d, { notes: {}, id: null, base: "", notice: null, adopt: null });
});

test("two ids in the Set: show the newest and ask which belongs", () => {
  const a = b("3-aaaa", "2-xxxx", { a: "one" }, "aaaaaaaa");
  const c = b("1-cccc", "", { c: "two" }, "cccccccc");
  const d = reconcile({ bundles: [c, a], damaged: [], history: none, kept: {} });
  assert.equal(d.id, "cccccccc", "c was saved last");
  assert.equal(d.notice?.kind, "choose");
  assert.deepEqual(d.notice && "options" in d.notice ? d.notice.options.map((o) => o.id) : [], ["cccccccc", "aaaaaaaa"]);
  assert.equal(d.notice!.text, "This set holds notes from two sets. Which belong here?");
});

test("two copies of one id in the Set: the higher revision wins, no question", () => {
  const p = b("1-aaaa", "");
  const q = b("2-bbbb", "1-aaaa");
  const d = reconcile({ bundles: [p, q], damaged: [], history: none, kept: {} });
  assert.equal(d.base, "2-bbbb");
  assert.equal(d.notice, null);
});

test("current comes from the Set's bundle", () => {
  const p = { ...b("1-aaaa", "", { x: "1", y: "2" }), current: "y" };
  const d = reconcile({ bundles: [p], damaged: [], history: none, kept: {} });
  assert.equal(d.current, "y");
});

test("descends follows parent links", () => {
  const h = [b("1-a", ""), b("2-b", "1-a"), b("3-c", "2-b"), b("2-x", "1-a")].reverse();
  assert.equal(descends(h, "1-a", "3-c"), true);
  assert.equal(descends(h, "2-x", "3-c"), false);
  assert.equal(descends(h, "1-a", "1-a"), false);
});

test("isFork: a sibling with the same parent is a fork", () => {
  const h = [b("2-thrs", "1-aaaa"), b("1-aaaa", "")];
  assert.equal(isFork(h, "1-aaaa", "2-mine", new Set()), true);
});

test("isFork: a sibling from our own failed write is not", () => {
  const h = [b("2-fail", "1-aaaa"), b("1-aaaa", "")];
  assert.equal(isFork(h, "1-aaaa", "2-retr", new Set(["2-fail"])), false);
});

test("isFork: a linear chain is not a fork", () => {
  const h = [b("2-bbbb", "1-aaaa"), b("1-aaaa", "")];
  assert.equal(isFork(h, "2-bbbb", "3-cccc", new Set()), false);
  assert.equal(isFork(h, "2-bbbb", "2-bbbb", new Set()), false);
});

test("timeLabel: time today, date and time otherwise", () => {
  const now = new Date(2026, 9, 15, 18, 0);
  assert.equal(timeLabel(new Date(2026, 9, 15, 14, 32).toISOString(), now), "14:32");
  assert.equal(timeLabel(new Date(2026, 9, 3, 9, 5).toISOString(), now), "3 Oct 09:05");
  assert.equal(timeLabel("junk", now), "an earlier session");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
