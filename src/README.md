# Frontend (React / TypeScript)

## Key Files

- `App.tsx` - Main component orchestrating physics, mascot state, and user interactions (drag, click, double-click)
- `Clawd.tsx` - SVG-based mascot component with CSS animations for different states
- `useMascotState.ts` - State machine managing mascot states: idle, walking, talking, jumping, falling
- `usePhysics.ts` - Physics engine handling gravity, collisions, walking, and window positioning via Tauri APIs
- `emotions.ts` - Emotion types (neutral, happy, sad, excited, thinking, confused, surprised)
- `styles.css` - CSS animations for mascot states (idle bobbing, walking, jumping, falling, talking)

## Chat Components

- `ChatWindow.tsx` - Chat UI container
- `ChatInput.tsx` - Message input component
- `SpeechBubble.tsx` - Message display bubble
- `useChatHistory.ts` - Chat message state management

## Key Behaviors

- **Physics**: Window moves via Tauri's `setPosition` API with gravity, floor/wall collisions, and bounce effects
- **Auto-walk**: Randomly triggers walking behavior every 3-10 seconds
- **Interactions**: Single-click toggles chat; double-click toggles physics; drag repositions window
- **Direction**: Mascot faces left/right via CSS `scaleX(-1)` transform
- **Emotions**: Separate from physical states; Claude sets via `set_emotion` tool, frontend receives via Tauri events
