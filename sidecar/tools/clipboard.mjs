import { tool } from "@anthropic-ai/claude-agent-sdk";
import { exec } from "child_process";
import { promisify } from "util";
import { platform, tmpdir } from "os";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const execAsync = promisify(exec);

/**
 * Read the contents of the user's clipboard
 * @param {Function} log - Logging function
 */
export function createClipboardTool(log) {
  return tool(
    "read_clipboard",
    "Read the contents of the user's clipboard. Can read both text and images. Use this when the user asks you to look at what they've copied, or when they mention copying something.",
    {},
    async () => {
      if (platform() !== 'win32') {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Clipboard reading only supported on Windows" }) }],
        };
      }

      const tempFile = join(tmpdir(), `clawd_clipboard_${Date.now()}.png`);
      const results = [];

      try {
        // First check for image in clipboard
        const imageCheckScript = `
          Add-Type -AssemblyName System.Windows.Forms
          $img = [System.Windows.Forms.Clipboard]::GetImage()
          if ($img -ne $null) {
            $img.Save('${tempFile.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
            $img.Dispose()
            Write-Output "IMAGE"
          } else {
            Write-Output "NO_IMAGE"
          }
        `;

        const { stdout: imageResult } = await execAsync(
          `powershell -Command "${imageCheckScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
          { timeout: 5000 }
        );

        if (imageResult.trim() === "IMAGE" && existsSync(tempFile)) {
          const imageData = readFileSync(tempFile);
          const base64 = imageData.toString('base64');
          try { unlinkSync(tempFile); } catch (e) { /* ignore */ }

          log(`Clipboard image read: ${imageData.length} bytes`);
          results.push({
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: base64,
            },
          });
          results.push({ type: "text", text: "Clipboard contains an image." });
        }

        // Also check for text
        const textScript = `
          Add-Type -AssemblyName System.Windows.Forms
          $text = [System.Windows.Forms.Clipboard]::GetText()
          if ($text) { Write-Output $text } else { Write-Output "" }
        `;

        const { stdout: textResult } = await execAsync(
          `powershell -Command "${textScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
          { timeout: 5000 }
        );

        const clipboardText = textResult.trim();
        if (clipboardText) {
          log(`Clipboard text read: ${clipboardText.length} chars`);
          results.push({
            type: "text",
            text: `Clipboard text:\n${clipboardText}`,
          });
        }

        if (results.length === 0) {
          results.push({ type: "text", text: "Clipboard is empty or contains unsupported data format." });
        }

        return { content: results };
      } catch (e) {
        // Clean up temp file on error
        try { unlinkSync(tempFile); } catch (e2) { /* ignore */ }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: "Failed to read clipboard", details: e.message })
          }],
        };
      }
    }
  );
}
