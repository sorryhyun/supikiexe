/**
 * Generate a unique ID with optional prefix.
 * Format: [prefix-]timestamp-random
 */
export function generateId(prefix = ""): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 9);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}
