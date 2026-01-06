/**
 * Application constants - centralized magic numbers and configuration values
 */

// Window dimensions (logical pixels)
export const WINDOW_WIDTH = 160;
export const WINDOW_HEIGHT = 140;
export const CHAT_WIDTH = 280;
export const CHAT_HEIGHT = 280;
export const CONTEXT_MENU_WIDTH = 80;
export const CONTEXT_MENU_HEIGHT = 60;
export const HISTORY_LIST_WIDTH = 280;
export const HISTORY_LIST_HEIGHT = 350;

// Chat window positioning relative to Clawd
export const DEFAULT_CHAT_OFFSET = {
  x: WINDOW_WIDTH - 5,
  y: -CHAT_HEIGHT + WINDOW_HEIGHT - 20,
};

// Auto-walk behavior timing (ms)
export const AUTO_WALK_MIN_DELAY = 15000;
export const AUTO_WALK_MAX_DELAY = 45000; // MIN + 30000 random
export const WALK_DURATION = 1500;
export const AUTO_WALK_CHANCE = 0.3; // 30% chance to walk

// Drag detection
export const DRAG_THRESHOLD = 5;

// System
export const TASKBAR_HEIGHT = 48;
export const SCREEN_BOUNDS_UPDATE_INTERVAL = 60; // frames

// State timing (ms)
export const EMOTION_RESET_DURATION = 5000;
export const TALK_DURATION = 2000;

// Physics defaults
export const DEFAULT_PHYSICS_CONFIG = {
  gravity: 0.5,
  friction: 0.95,
  bounceFactor: 0.6,
  walkSpeed: 2,
  jumpForce: -12,
};

// Velocity thresholds
export const MIN_BOUNCE_VELOCITY = 5;
export const MIN_VELOCITY_THRESHOLD = 0.1;
