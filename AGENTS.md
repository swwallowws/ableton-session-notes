# Session Notes

A Markdown notepad inside Ableton Live 12, with notes kept in the set and global ones beside it.
The README explains it; this file is for working on it.

## Working here

1. Do what was asked, the simplest way that meets it. Side work is a proposal that says what it costs.
2. Run the checks below for every path you changed. Report the numbers.
3. A commit's subject names what changed and the trap if there was one. Its body says why, what ran
   and what wasn't tested.
4. When something breaks and nobody saw it, add a rule here in the same commit as the fix.
5. The user pushes main, releases the extension and posts about it.

## Map

- `src/extension.ts`: the extension, wiring the modules below to the Ableton SDK
- `src/interface.html`: the window
- `src/codec.ts`, `src/reconcile.ts`: notes to clip names and back; what the pad shows (both pure)
- `src/setdata.ts`: the notes' data lane in the set, through the SDK
- `src/backups.ts`: snapshots, restore, damaged dumps (inside the storage folder only)
- `src/notes.ts`, `src/session.ts`, `src/timeline.ts`: global notes, the session, lyrics on the arrangement
- `demo/`: the guided web demo (`demo/try/`), built to `demo-dist/`
- `docs/superpowers/`: the sandbox storage design and plan

## Rules

**The extension host is not plain Node.** There is no global `URL`: import it from `node:url`. An
uncaught throw anywhere, a request handler included, exits the whole host, so callbacks are
wrapped. Since Ableton Live 12.4.15 the file system is open only inside the extension's storage and
temp folders, which is why notes live in the set and backups in the storage folder. The host logs
to `~/Library/Preferences/Ableton/Live <version>/ExtensionHost.txt`, outside the working folders:
ask the user to `tail` it. Check: `npm test`; manual in Live.

**This window sets the look for Ableton extensions.** Small type like Ableton's own (mostly 11 to
13px) and 24px controls. Ready Set's window follows it. The design system's 15 and 14px
scale is for the web demo, not here. Check: manual in Live.

**Pushing main is the deploy.** CI builds the demo from the commit, publishes it to GitHub Pages and
checks it answers. A change to the window needs the demo and the showcase's pictures redone too.
Check: CI on the push.

## Checks

| Changed | Run |
|---|---|
| `src/**`, `test/**` | `npm test` (CI runs the same files) |
| `demo/**` | `npm run demo:build` |

<!-- probe, never merged -->
