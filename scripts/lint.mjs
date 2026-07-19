import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const ignored = new Set(["node_modules", ".next", ".git"]);
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) await collect(path.join(directory, entry.name));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path.join(directory, entry.name));
    }
  }
}

function check(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], { stdio: "inherit" });
    child.on("close", (code) => resolve(code === 0));
  });
}

await collect(root);
let passed = true;

for (const file of files) {
  if (!(await check(file))) passed = false;
}

if (!passed) process.exitCode = 1;
else console.log(`Syntax check passed for ${files.length} JavaScript files.`);
