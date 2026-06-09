import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collectJsFiles(fullPath)));
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (JS_EXTENSIONS.has(ext)) {
      files.push(fullPath);
    }
  }

  return files;
}

function runNodeCheck(filePath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", filePath], {
      stdio: "inherit",
      cwd: ROOT,
    });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function main() {
  const files = await collectJsFiles(ROOT);
  if (!files.length) {
    console.log("No JavaScript files found to lint.");
    return;
  }

  let failed = 0;
  for (const file of files) {
    const ok = await runNodeCheck(file);
    if (!ok) failed += 1;
  }

  const passed = files.length - failed;
  console.log(`Lint check complete: ${passed}/${files.length} files passed syntax validation.`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Lint script failed:", error);
  process.exitCode = 1;
});
