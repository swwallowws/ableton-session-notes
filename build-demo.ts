// Builds the web demo (demo/) into demo-dist/, a static folder that can be
// hosted anywhere and framed by the showcase site (?embed=1&theme=paper|night).
// `--serve` rebuilds on change and serves it locally.

import * as esbuild from "esbuild";
import * as fs from "node:fs";

const out = "demo-dist";
const serve = process.argv.includes("--serve");

const STATIC = ["index.html", "demo.css"];
const copyStatic = () => {
  for (const f of STATIC) fs.copyFileSync(`demo/${f}`, `${out}/${f}`);
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
copyStatic();
fs.cpSync("demo/vendor", `${out}/vendor`, { recursive: true });

const options: esbuild.BuildOptions = {
  entryPoints: ["demo/demo.ts"],
  outfile: `${out}/demo.js`,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: !serve,
  sourcemap: serve,
  logLevel: "info",
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // esbuild only watches the script; re-copy the page and styles on save too.
  // Watch the folder, not the files: editors save by replacing the file, which
  // silently ends a watch on the file itself.
  fs.watch("demo", (_event, name) => {
    if (name && STATIC.includes(name)) copyStatic();
  });
  const { port } = await ctx.serve({ servedir: out, port: 4190 });
  console.log(`demo at http://localhost:${port}/`);
} else {
  await esbuild.build(options);
}
