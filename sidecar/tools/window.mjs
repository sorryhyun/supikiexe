import { tool } from "@anthropic-ai/claude-agent-sdk";
import { exec } from "child_process";
import { promisify } from "util";
import { platform } from "os";

const execAsync = promisify(exec);

/**
 * Encode PowerShell script as Base64 for -EncodedCommand
 * PowerShell expects UTF-16LE encoding
 */
function encodePowerShellCommand(script) {
  const buffer = Buffer.from(script, "utf16le");
  return buffer.toString("base64");
}

/**
 * Get information about the currently focused window
 */
export const getActiveWindowTool = tool(
  "get_active_window",
  "Get information about the currently focused/active window on the user's desktop. Returns the window title and process name. Use this to understand what the user is currently working on.",
  {},
  async () => {
    if (platform() !== "win32") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Active window detection only supported on Windows",
            }),
          },
        ],
      };
    }

    try {
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
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
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
$processId = 0
[void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
$rect = New-Object Win32+RECT
[void][Win32]::GetWindowRect($hwnd, [ref]$rect)
@{
  title = $sb.ToString()
  processName = if ($process) { $process.ProcessName } else { "Unknown" }
  processId = $processId
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

      return {
        content: [{ type: "text", text: stdout.trim() }],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Failed to get active window",
              details: e.message,
            }),
          },
        ],
      };
    }
  }
);
