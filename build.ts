import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

// The pad draws from the shared design system, the same copy the web demo uses
// (demo/vendor/design, synced from ~/Playground/design). The pad opens as a
// data: URL and can't <link> anything, so tokens.css is inlined into
// interface.html and its fonts embedded as base64 (otherwise the relative
// url("fonts/...") paths would 404).
const design = path.join(here, "demo", "vendor", "design");
const tokensPlugin: esbuild.Plugin = {
  name: "html-with-tokens",
  setup(b) {
    b.onLoad({ filter: /interface\.html$/ }, async (args) => {
      const html = await fs.promises.readFile(args.path, "utf8");
      const tokens = (await fs.promises.readFile(path.join(design, "tokens.css"), "utf8")).replace(
        /url\("fonts\/([^"]+\.woff2)"\)/g,
        (_, f) => `url("data:font/woff2;base64,${fs.readFileSync(path.join(design, "fonts", f)).toString("base64")}")`,
      );
      if (/url\("fonts\//.test(tokens)) throw new Error("tokens.css has a font url that wasn't inlined");
      if (!html.includes("/*__TOKENS__*/")) throw new Error("interface.html has no /*__TOKENS__*/ slot");
      return { contents: html.replace("/*__TOKENS__*/", () => tokens), loader: "text" };
    });
  },
};

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  // Strip the [session-notes] debug logging from release builds; dev builds keep
  // it for diagnosing detection and the resize/persist paths.
  drop: production ? ["console", "debugger"] : [],
  loader: { ".html": "text" },
  plugins: [tokensPlugin],
});
