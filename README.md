# Session Notes

<img width="640" height="588" alt="session notes" src="https://github.com/user-attachments/assets/1068d4ae-3de4-4fac-97a9-e15717459854" />

A minimal Markdown notepad for **Ableton Live 12**, built on the [Live Extensions SDK](https://ableton.com). Jot lyrics, ideas, and to-dos without leaving Live — with clean, native-feeling typography and a render-by-default Markdown view.

> Requires Ableton Live 12 with the Extensions feature (SDK `1.0.0-beta.0`).

## Features

- **Markdown, rendered by default.** Write in Markdown; a single tap or `⌘E` toggles between **View** and **Edit**. Headings, bullet/numbered lists, bold/italic, blockquotes, links, and clickable GFM task lists (`- [ ]` / `- [x]`).
- **Two kinds of notes:**
  - **Notebooks** — global notes that live with the extension (create, rename, and switch between as many as you like).
  - **Per-project notes** — a `Session Notes.md` written into the current Ableton project folder, so your notes **travel with the Set** when you move, share, or back it up.
- **Autosave on close.** Close the pad (**Done**, `⌘S`, or `Esc`) and it saves; **Revert** discards edits made since you opened it.
- **Remembers your place.** Reopens whatever note you had open last.
- **Show file location** and a built-in **Markdown cheatsheet** (the `?` button).

## Install

1. Download the latest `Session-Notes-<version>.ablx` from the [Releases](../../releases) page.
2. In Live: **Settings → Extensions**, then drag the `.ablx` file onto the page.
3. Right-click a track, clip slot, or scene → **Session Notes…**

## Usage notes

- Open it from the right-click menu on an **audio/MIDI track, clip slot, or scene**. (The SDK has no global menu, so it attaches to the objects you can reach almost anywhere.)
- **Per-project detection** relies on an audio sample being present in the Set — that's the only signal the SDK exposes for locating the project folder. A brand-new or pure-MIDI Set with no audio yet will fall back to your global notebooks until it can detect the project.

## Develop

```bash
npm install
npm start        # build + run in Live's Extension Host (Developer Mode must be ON)
npm run build    # dev bundle
npm run package  # production bundle → Session-Notes-<version>.ablx
```

Node ≥ 22.11 is required (the SDK's minimum). Source lives in `src/extension.ts` (host logic) and `src/interface.html` (the webview UI).

## License

MIT © Bengisu ([@somaluden](https://github.com/somaluden))
