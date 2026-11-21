// Builds the extension into dist/. Usage: node build.mjs [--watch]
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";

// For local dev only: pre-fill the API key from ../.env.local into the (gitignored) dist build.
// The key is never in source; anyone else pastes their own key in the popup.
let devKey = process.env.GEMINI_API_KEY ?? "";
if (!devKey && existsSync("../.env.local")) {
  devKey = readFileSync("../.env.local", "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim() ?? "";
}

mkdirSync("dist", { recursive: true });
const copyStatic = () => {
  for (const f of ["manifest.json", "popup.html", "preview.html"]) cpSync(`src/${f}`, `dist/${f}`);
};

const options = {
  entryPoints: ["src/background.ts", "src/content.ts", "src/popup.ts", "src/preview.ts"],
  bundle: true,
  outdir: "dist",
  format: "iife", // content scripts can't be ES modules
  target: "chrome120",
  minify: !process.argv.includes("--watch"),
  sourcemap: process.argv.includes("--watch") ? "inline" : false,
  define: { __DEV_API_KEY__: JSON.stringify(devKey) },
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
