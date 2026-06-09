import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
const TEST_FILE_RE = /\.(test|spec)\.(js|mjs|cjs)$/i;

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collectTestFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function runNodeTests(files) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", ...files], {
      stdio: "inherit",
      cwd: ROOT,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const files = await collectTestFiles(ROOT);
  if (!files.length) {
    console.log("No test files found. Add *.test.js or *.spec.js files to run tests.");
    return;
  }

  const exitCode = await runNodeTests(files);
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error("Test script failed:", error);
  process.exitCode = 1;
});
