import path from "node:path";
import { spawn } from "node:child_process";

// Module 39 — Technical Quality.
//
// This project's existing `npm run lint` only ever ran a syntax check
// (`node --check`) on .js files — it never covered the /admin CMS's
// .ts/.tsx files at all. That's exactly where a real class of build-
// breaking bugs lived earlier this year: Supabase queries typed as `never`,
// which only surfaced when `next build` failed on Vercel, several rounds in
// a row, before being tracked down.
//
// This is a NEW, separate, opt-in script (`npm run typecheck`) — it does
// NOT change what `npm run lint` does. `typescript` is already a
// devDependency and this repo already ships a working tsconfig.json, so
// running the TypeScript compiler's own check (`tsc --noEmit`, which
// reports errors without producing any output files) costs nothing new to
// install. Running it locally before a push would have caught that entire
// bug class immediately, instead of discovering it only after a failed
// Vercel deployment.
//
// If this surfaces pre-existing warnings on first run, that's expected —
// this is the first time a full type-check has run across the project.
// Nothing about `next build`, `next dev`, or `npm run lint` changes because
// of this file existing.

const root = process.cwd();
const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");

const child = spawn(bin, ["--noEmit"], { stdio: "inherit", cwd: root });
child.on("error", (error) => {
  console.error("Could not run tsc — have you run `npm install`?", error.message);
  process.exitCode = 1;
});
child.on("close", (code) => {
  if (code === 0) console.log("TypeScript type check passed (tsc --noEmit).");
  process.exitCode = code ?? 1;
});
