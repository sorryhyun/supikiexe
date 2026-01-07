#!/usr/bin/env node
/**
 * Create dev and supiki executables by copying the main exe
 *
 * After Tauri build, this copies claude-mascot.exe to:
 * - claude_mascot_dev.exe (dev mode detection via exe name)
 * - claude-mascot-supiki.exe (supiki variant)
 *
 * Also copies sidecar files needed for standalone exe usage.
 */

import { copyFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const sidecarDistDir = join(rootDir, "sidecar-dist");

// Find the built exe in target/release or target/debug
const releaseDir = join(rootDir, "src-tauri/target/release");
const debugDir = join(rootDir, "src-tauri/target/debug");

function findAndCopyExe(dir) {
  if (!existsSync(dir)) return false;

  const files = readdirSync(dir);
  const exeFile = files.find(f => f.endsWith(".exe") && !f.includes("_dev") && !f.includes("-supiki") && f.includes("mascot"));

  if (exeFile) {
    const srcPath = join(dir, exeFile);
    const baseName = exeFile.replace(".exe", "");

    // Create dev exe
    const devName = baseName.replace(/-/g, "_") + "_dev.exe";
    const devPath = join(dir, devName);
    console.log(`Copying ${exeFile} -> ${devName}`);
    copyFileSync(srcPath, devPath);
    console.log(`Created: ${devPath}`);

    // Create supiki exe
    const supikiName = baseName + "-supiki.exe";
    const supikiPath = join(dir, supikiName);
    console.log(`Copying ${exeFile} -> ${supikiName}`);
    copyFileSync(srcPath, supikiPath);
    console.log(`Created: ${supikiPath}`);

    return true;
  }
  return false;
}

// Also copy in the bundle directory if it exists
function copyInBundle() {
  const bundleDirs = [
    join(rootDir, "src-tauri/target/release/bundle/nsis"),
    join(rootDir, "src-tauri/target/release/bundle/msi"),
  ];

  for (const dir of bundleDirs) {
    if (existsSync(dir)) {
      findAndCopyExe(dir);
    }
  }
}

// Copy sidecar files to target directory for standalone exe usage
function copySidecarFiles(targetDir) {
  const sidecarFiles = [
    "agent-sidecar.exe",
    "agent-sidecar-dev.exe",
    "prompt.txt",
    "dev-prompt.txt",
    "supiki_prompt.txt",
  ];

  console.log("\nCopying sidecar files for standalone exe usage...");

  for (const file of sidecarFiles) {
    const srcPath = join(sidecarDistDir, file);
    const destPath = join(targetDir, file);

    if (existsSync(srcPath)) {
      copyFileSync(srcPath, destPath);
      console.log(`  Copied: ${file}`);
    } else {
      console.log(`  Skipped (not found): ${file}`);
    }
  }
}

console.log("Creating dev and supiki executables...");

if (findAndCopyExe(releaseDir)) {
  console.log("Executables created in release directory");
  copySidecarFiles(releaseDir);
  copyInBundle();
} else if (findAndCopyExe(debugDir)) {
  console.log("Executables created in debug directory");
  copySidecarFiles(debugDir);
} else {
  console.log("No exe found to copy. Run 'npm run build' first.");
}
