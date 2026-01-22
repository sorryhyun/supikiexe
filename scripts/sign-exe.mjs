import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const artifactsDir = join(rootDir, "artifacts");

// Find signtool.exe in Windows SDK
function findSignTool() {
  const sdkPath = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
  if (!existsSync(sdkPath)) {
    throw new Error("Windows SDK not found");
  }

  const versions = readdirSync(sdkPath)
    .filter((d) => d.startsWith("10."))
    .sort()
    .reverse();

  for (const version of versions) {
    const signtool = join(sdkPath, version, "x64", "signtool.exe");
    if (existsSync(signtool)) {
      return signtool;
    }
  }

  throw new Error("signtool.exe not found in Windows SDK");
}

// Find all exe files in artifacts directory
function findExesToSign() {
  if (!existsSync(artifactsDir)) {
    console.log("Artifacts directory not found");
    return [];
  }

  return readdirSync(artifactsDir)
    .filter((f) => f.endsWith(".exe") && !f.includes("codex"))
    .map((f) => join(artifactsDir, f));
}

const certPath = join(rootDir, "dev-cert.pfx");
const certPassword = "sorrysorry";

if (!existsSync(certPath)) {
  console.log("Warning: tauri-devcert.pfx not found, skipping signing");
  process.exit(0);
}

const filesToSign = findExesToSign();

if (filesToSign.length === 0) {
  console.log("No exe files found to sign");
  process.exit(0);
}

const signtool = findSignTool();
console.log(`Found signtool: ${signtool}`);
console.log(`Found ${filesToSign.length} exe(s) to sign\n`);

// Helper to wait
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sign with retry (handles AV scanner holding file locks)
async function signWithRetry(file, maxRetries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      execSync(
        `"${signtool}" sign /f "${certPath}" /p ${certPassword} /fd sha256 "${file}"`,
        { stdio: "inherit" }
      );
      console.log(`Signed ${file}\n`);
      return;
    } catch (error) {
      if (attempt < maxRetries && error.message.includes("being used by another process")) {
        console.log(`File locked, retrying in ${delayMs}ms... (attempt ${attempt}/${maxRetries})`);
        await sleep(delayMs);
      } else {
        throw error;
      }
    }
  }
}

(async () => {
  for (const file of filesToSign) {
    console.log(`Signing ${file}...`);
    try {
      await signWithRetry(file);
    } catch (error) {
      console.error(`Failed to sign ${file}:`, error.message);
      process.exit(1);
    }
  }
  console.log("Signing complete!");
})();
