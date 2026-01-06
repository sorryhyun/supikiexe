import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { platform } from "os";

const execAsync = promisify(exec);

/**
 * Encode PowerShell script as Base64 for -EncodedCommand
 */
function encodePowerShellCommand(script) {
  const buffer = Buffer.from(script, "utf16le");
  return buffer.toString("base64");
}

/**
 * Get active window position info
 */
async function getActiveWindowPosition() {
  if (platform() !== "win32") {
    throw new Error("Only supported on Windows");
  }

  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
"@
$hwnd = [Win32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][Win32]::GetWindowText($hwnd, $sb, 256)
$rect = New-Object Win32+RECT
[void][Win32]::GetWindowRect($hwnd, [ref]$rect)
@{
  title = $sb.ToString()
  x = $rect.Left
  y = $rect.Top
  width = $rect.Right - $rect.Left
  height = $rect.Bottom - $rect.Top
} | ConvertTo-Json
`;

  const encoded = encodePowerShellCommand(psScript);
  const { stdout } = await execAsync(
    `powershell -EncodedCommand ${encoded}`,
    { timeout: 5000 }
  );

  return JSON.parse(stdout.trim());
}

/**
 * Make Clawd investigate/walk to the active window
 * @param {Function} emit - Function to emit events to Rust
 */
export function createInvestigateWindowTool(emit) {
  return tool(
    "investigate_window",
    "Make Clawd walk toward the currently active window and look at it curiously. Use this when you want to show interest in what the user is working on.",
    {},
    async () => {
      if (platform() !== "win32") {
        return {
          content: [{ type: "text", text: "Window investigation only supported on Windows" }],
        };
      }

      try {
        const windowInfo = await getActiveWindowPosition();

        // Calculate target X position (center bottom of the window)
        const targetX = windowInfo.x + Math.floor(windowInfo.width / 2) - 80; // 80 = half of Clawd's window width

        // Emit walk-to-window event
        emit({
          type: "walk_to_window",
          targetX,
          windowTitle: windowInfo.title,
        });

        return {
          content: [{
            type: "text",
            text: `Walking to investigate "${windowInfo.title}" at position x=${targetX}`
          }],
        };
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `Failed to investigate window: ${e.message}`
          }],
        };
      }
    }
  );
}
