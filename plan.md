# Frontend Refactoring Plan

## Completed Phases

| Phase | Status | Lines Saved |
|-------|--------|-------------|
| 1. CSS Variables | Done | N/A (maintainability) |
| 2. MascotApp | Done | ~450 lines |
| 3. Modal Hook | Done | ~80 lines |
| 4. Utility Hooks | Done | ~100 lines |
| 5. Window Manager | Done | ~40 lines |
| 6. Shared Modal CSS | Done | ~60 lines |
| 7. Modal.tsx Component | Done | ~90 lines |
| 8. Rename useClawdEvents | Done | N/A (maintainability) |
| 9. QuestionModal hook | Done | ~15 lines |
| 10. Chat Window Cleanup | Done | ~30 lines |

### Files Created
- `src/styles/variables.css` - CSS design tokens
- `src/components/MascotApp.tsx` - Generic mascot app component
- `src/components/Modal.tsx` - Reusable modal wrapper component
- `src/hooks/useModalWindow.ts` - Modal behavior hook
- `src/hooks/useTimeout.ts` - Timeout management hook
- `src/hooks/useTauriEvent.ts` - Tauri event subscription hook
- `src/hooks/useMascotEvents.ts` - Mascot event handlers (renamed from useClawdEvents)
- `src/utils/id.ts` - ID generation utility
- `src/utils/windowManager.ts` - Window creation utility

### Files Removed
- `src/hooks/useChatHistory.ts` - Thin wrapper removed
- `src/hooks/useClawdEvents.ts` - Renamed to useMascotEvents.ts

---

## All Phases Complete

All planned refactoring phases have been completed. The codebase now has:
- Centralized CSS design tokens
- Reusable modal components and hooks
- Consistent window behavior patterns
- Cleaner hook separation
