import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { platform, tmpdir } from "os";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const execAsync = promisify(exec);

/**
 * Capture a screenshot of the user's screen
 * @param {Function} log - Logging function
 */
export function createScreenshotTool(log) {
  return tool(
    "capture_screenshot",
    "Capture a screenshot of the user's screen. Returns the screenshot as a base64-encoded PNG image. Use this when the user asks you to see their screen, look at something they're working on, or when you need visual context about what they're doing.",
    {
      monitor: z.number().optional().default(0).describe(
        "Which monitor to capture (0 = primary, 1 = secondary, etc.). Default is primary monitor."
      ),
    },
    async ({ monitor }) => {
      if (platform() !== 'win32') {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Screenshot capture only supported on Windows" }) }],
        };
      }

      const tempFile = join(tmpdir(), `clawd_screenshot_${Date.now()}.png`);

      try {
        // PowerShell script to capture screen
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          $screens = [System.Windows.Forms.Screen]::AllScreens
          $monitorIndex = ${monitor}
          if ($monitorIndex -ge $screens.Length) { $monitorIndex = 0 }
          $screen = $screens[$monitorIndex]
          $bounds = $screen.Bounds
          $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
          $bitmap.Save('${tempFile.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
          $graphics.Dispose()
          $bitmap.Dispose()
          Write-Output "OK"
        `;

        await execAsync(
          `powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
          { timeout: 10000 }
        );

        // Read the screenshot file as base64
        if (!existsSync(tempFile)) {
          throw new Error("Screenshot file was not created");
        }

        const imageData = readFileSync(tempFile);
        const base64 = imageData.toString('base64');

        // Clean up temp file
        try { unlinkSync(tempFile); } catch (e) { /* ignore */ }

        log(`Screenshot captured: ${imageData.length} bytes`);

        return {
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: base64,
              },
            },
            { type: "text", text: "Screenshot captured successfully." },
          ],
        };
      } catch (e) {
        // Clean up temp file on error
        try { unlinkSync(tempFile); } catch (e2) { /* ignore */ }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: "Failed to capture screenshot", details: e.message })
          }],
        };
      }
    }
  );
}
