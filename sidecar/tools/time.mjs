import { tool } from "@anthropic-ai/claude-agent-sdk";

/**
 * Get current date and time
 */
export const getCurrentTimeTool = tool(
  "get_current_time",
  "Get the current date and time. Use this when the user asks about the current time, date, day of the week, or when you need to be aware of the current moment.",
  {},
  async () => {
    const now = new Date();
    const options = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    };

    const timeInfo = {
      iso: now.toISOString(),
      formatted: now.toLocaleString('en-US', options),
      date: now.toLocaleDateString('en-US'),
      time: now.toLocaleTimeString('en-US'),
      timestamp: now.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
      hour: now.getHours(),
      minute: now.getMinutes(),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(timeInfo, null, 2) }],
    };
  }
);
