import * as esbuild from "esbuild";
import * as fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

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
});
