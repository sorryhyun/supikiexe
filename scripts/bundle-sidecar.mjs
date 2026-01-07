#!/usr/bin/env node
/**
 * Bundle the sidecar into a standalone executable
 *
 * 1. Uses esbuild to bundle all JS into a single file
 * 2. Uses pkg to compile into standalone exe with Node.js runtime
 */

import { build } from "esbuild";
import { exec } from "child_process";
import { promisify } from "util";
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

async function bundle() {
  console.log("Bundling sidecar...");

  const outDir = join(rootDir, "sidecar-dist");
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // Step 1: Bundle with esbuild
  console.log("Step 1: Bundling with esbuild...");
  await build({
    entryPoints: [join(rootDir, "sidecar/agent-sidecar.mjs")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs", // pkg works better with CommonJS
    outfile: join(outDir, "agent-sidecar.cjs"),
    // Don't bundle native modules
    external: [],
    minify: false, // Keep readable for debugging
    sourcemap: false,
  });
  console.log("  Created: sidecar-dist/agent-sidecar.cjs");

  // Copy prompt files alongside the bundle
  copyFileSync(
    join(rootDir, "sidecar/prompt.txt"),
    join(outDir, "prompt.txt")
  );
  console.log("  Copied: prompt.txt");

  // Copy dev prompt if it exists
  const devPromptPath = join(rootDir, "sidecar/dev-prompt.txt");
  if (existsSync(devPromptPath)) {
    copyFileSync(devPromptPath, join(outDir, "dev-prompt.txt"));
    console.log("  Copied: dev-prompt.txt");
  }

  // Copy supiki prompt if it exists
  const supikiPromptPath = join(rootDir, "sidecar/supiki_prompt.txt");
  if (existsSync(supikiPromptPath)) {
    copyFileSync(supikiPromptPath, join(outDir, "supiki_prompt.txt"));
    console.log("  Copied: supiki_prompt.txt");
  }

  // Step 2: Compile with pkg
  console.log("\nStep 2: Compiling with pkg...");

  // Build assets list (prompt files)
  const assets = [join(outDir, "prompt.txt")];
  if (existsSync(join(outDir, "dev-prompt.txt"))) {
    assets.push(join(outDir, "dev-prompt.txt"));
  }
  if (existsSync(join(outDir, "supiki_prompt.txt"))) {
    assets.push(join(outDir, "supiki_prompt.txt"));
  }
  const assetsArg = assets.map(a => `"${a}"`).join(",");

  const pkgCmd = `npx @yao-pkg/pkg "${join(outDir, "agent-sidecar.cjs")}" --target node20-win-x64 --output "${join(outDir, "agent-sidecar.exe")}" --assets ${assetsArg}`;

  try {
    const { stdout, stderr } = await execAsync(pkgCmd, { cwd: rootDir });
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.error("pkg compilation failed:", error.message);
    throw error;
  }

  // Step 3: Build dev executable (with CLAWD_DEV_MODE=1 baked in)
  console.log("\nStep 3: Building dev executable...");

  // Create dev entry point that sets dev mode
  const devEntry = `process.env.CLAWD_DEV_MODE = '1';\nrequire('./agent-sidecar.cjs');`;
  writeFileSync(join(outDir, "agent-sidecar-dev.cjs"), devEntry);
  console.log("  Created: agent-sidecar-dev.cjs");

  const devPkgCmd = `npx @yao-pkg/pkg "${join(outDir, "agent-sidecar-dev.cjs")}" --target node20-win-x64 --output "${join(outDir, "agent-sidecar-dev.exe")}" --assets ${assetsArg}`;

  try {
    const { stdout, stderr } = await execAsync(devPkgCmd, { cwd: rootDir });
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.error("Dev exe compilation failed:", error.message);
    throw error;
  }

  console.log("\nSidecar bundled successfully!");
  console.log(`  Output: ${join(outDir, "agent-sidecar.exe")} (mascot mode)`);
  console.log(`  Output: ${join(outDir, "agent-sidecar-dev.exe")} (dev mode)`);
  console.log("\nTo use in production build:");
  console.log("  1. Copy sidecar-dist/*.exe to src-tauri/binaries/");
  console.log("  2. Copy sidecar-dist/*.txt to src-tauri/binaries/");
}

bundle().catch((err) => {
  console.error("Bundle failed:", err);
  process.exit(1);
});
