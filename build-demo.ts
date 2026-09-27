// Builds the web demo (demo/) into demo-dist/, a static folder that can be
// hosted anywhere and framed by the showcase site (?embed=1&theme=paper|night).
// `--serve` rebuilds on change and serves it locally.

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const out = "demo-dist";
const serve = process.argv.includes("--serve");

const STATIC = ["index.html", "demo.css", "try/index.html", "try/try.css"];
const copyStatic = () => {
  for (const f of STATIC) {
    fs.mkdirSync(path.join(out, path.dirname(f)), { recursive: true });
    fs.copyFileSync(`demo/${f}`, `${out}/${f}`);
  }
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
copyStatic();
fs.cpSync("demo/vendor", `${out}/vendor`, { recursive: true });

const options: esbuild.BuildOptions = {
  entryPoints: ["demo/demo.ts", "demo/try/try.ts"],
  outdir: out,
  outbase: "demo",
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
  // esbuild only watches the scripts; re-copy the pages and styles on save
  // too. Watch the folder, not the files: editors save by replacing the
  // file, which silently ends a watch on the file itself. Recursive so
  // changes under demo/try/ are picked up too.
  fs.watch("demo", { recursive: true }, (_event, name) => {
    if (name && STATIC.includes(name.split(path.sep).join("/"))) copyStatic();
  });
  const { port } = await ctx.serve({ servedir: out, port: 4190 });
  console.log(`demo at http://localhost:${port}/`);
} else {
  await esbuild.build(options);
}
