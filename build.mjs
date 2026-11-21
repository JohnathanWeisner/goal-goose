// Builds the extension into dist/. Usage: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// For local dev only: pre-fill the API key from ../.env.local into the (gitignored) dist build.
// The key is never in source; anyone else pastes their own key in the popup.
const release = process.argv.includes("--release"); // store build: no dev key, no dev bridge
let devKey = process.env.GEMINI_API_KEY ?? "";
if (!release && !devKey && existsSync("../.env.local")) {
  devKey = readFileSync("../.env.local", "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim() ?? "";
}

mkdirSync("dist", { recursive: true });
if (release) devKey = "";
const copyStatic = () => {
  writeFileSync("dist/build-id.txt", String(Date.now())); // dev auto-reload watches this
  for (const f of ["popup.html", "preview.html", "eaten.html"]) cpSync(`src/${f}`, `dist/${f}`);
  const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  if (!release) manifest.externally_connectable = { matches: ["http://127.0.0.1/*"] }; // dev test bridge only
  writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
};

const options = {
  entryPoints: ["src/background.ts", "src/content.ts", "src/popup.ts", "src/preview.ts", "src/eaten.ts"],
  bundle: true,
  outdir: "dist",
  format: "iife", // content scripts can't be ES modules
  target: "chrome120",
  minify: !process.argv.includes("--watch"),
  sourcemap: process.argv.includes("--watch") ? "inline" : false,
  define: { __DEV_API_KEY__: JSON.stringify(devKey), __DEV__: JSON.stringify(!release) },
  logLevel: "info",
  plugins: [{ name: "static", setup: (b) => b.onEnd(copyStatic) }],
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching… reload the extension in chrome://extensions after changes");
} else {
  await esbuild.build(options);
}
