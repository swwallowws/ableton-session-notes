// The two moments that touch a Set's notes, with Live passed in so they can be
// tested headlessly: opening (decode the data clips, reconcile with the backup,
// learn what the backup didn't know, keep damaged clips aside) and saving (back
// up first, write into the Set, read it back, split off a diverged Save As copy).
import { dumpDamaged, history, writeSnapshot } from "./backups.js";
import { type Bundle, decodeNames, encodeBundle, newId, nextRev } from "./codec.js";
import { type Decision, isFork, reconcile } from "./reconcile.js";

export type SessionDeps = {
  root: () => string; // the extension's storage dir
  readNames: () => string[]; // every data clip name in the open Set
  writeNames: (names: string[]) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

const POLLS = 50; // x 100 ms

export function openSet(deps: SessionDeps, kept: Record<string, string>): Decision {
  const root = deps.root();
  const { bundles, damaged } = decodeNames(deps.readNames());
  if (damaged.length) {
    try {
      dumpDamaged(root, damaged.flatMap((d) => d.names));
    } catch {
      /* the notice still tells the user; the clips stay untouched in the Set */
    }
  }
  const decision = reconcile({ bundles, damaged, history: (id) => history(root, id), kept });
  if (decision.adopt) {
    try {
      writeSnapshot(root, decision.adopt);
    } catch {
      /* an unsafe id from a hand-edited Set: show the notes, don't back them up */
    }
  }
  return decision;
}

export async function saveSetNotes(
  deps: SessionDeps,
  args: {
    id: string | null; // null: this Set has never saved notes
    base: string; // the rev the edits started from
    notes: Record<string, string>;
    current?: string;
    failed: Set<string>; // this session's revs that never reached the Set
  },
): Promise<{ ok: boolean; id: string; rev: string }> {
  const root = deps.root();
  let id = args.id ?? newId();
  const rev = nextRev(args.base);
  let forkedFrom: string | undefined;
  if (args.id && isFork(history(root, args.id), args.base, rev, args.failed)) {
    forkedFrom = args.id;
    id = newId();
  }
  const bundle: Bundle = {
    v: 1,
    id,
    rev,
    parent: args.base,
    saved: deps.now().toISOString(),
    ...(args.current !== undefined ? { current: args.current } : {}),
    ...(forkedFrom ? { forkedFrom } : {}),
    notes: args.notes,
  };

  // Backup first: it's always allowed, so the notes are safe whatever the Set does.
  try {
    writeSnapshot(root, bundle);
  } catch {
    /* keep going: the Set write matters more */
  }

  // A busy Set can take a moment to apply the names, so the read-back waits up to
  // 5 s before calling the write failed.
  const landed = () => decodeNames(deps.readNames()).bundles.some((b) => b.id === id && b.rev === rev);
  try {
    await deps.writeNames(encodeBundle(bundle));
    for (let i = 0; i <= POLLS; i++) {
      if (landed()) return { ok: true, id, rev };
      if (i < POLLS) await deps.sleep(100);
    }
  } catch {
    /* reported below */
  }
  args.failed.add(rev);
  return { ok: false, id, rev };
}
