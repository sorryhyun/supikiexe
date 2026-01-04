import { tool } from "@anthropic-ai/claude-agent-sdk";
import { hostname, platform, userInfo } from "os";

/**
 * Get basic system information
 */
export const getSystemInfoTool = tool(
  "get_system_info",
  "Get basic system information including hostname, platform, and current user. Use this when you need to know about the user's system environment.",
  {},
  async () => {
    const user = userInfo();
    const sysInfo = {
      hostname: hostname(),
      platform: platform(),
      username: user.username,
      homeDir: user.homedir,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(sysInfo, null, 2) }],
    };
  }
);
