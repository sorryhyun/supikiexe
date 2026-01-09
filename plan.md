# Component Directory Reorganization Plan

Reorganize `src/components/` into subdirectories for better organization.

## Final Structure

```
src/components/
├── windows/              # Separate Tauri window entry points
│   ├── ChatWindow.tsx
│   ├── ChatHistoryListWindow.tsx
│   ├── ContextMenuWindow.tsx
│   └── SettingsWindow.tsx
├── modals/               # Modal/dialog components
│   ├── Modal.tsx
│   ├── CwdModal.tsx
│   └── QuestionModal.tsx
├── mascot/               # Mascot-related components
│   ├── Clawd.tsx
│   ├── Supiki.tsx
│   └── SpeechBubble.tsx
├── chat/                 # Chat-related components
│   └── ChatInput.tsx
├── App.tsx               # App entry points (stay at root)
├── SupikiApp.tsx
└── MascotApp.tsx
```

## Tasks

| # | Task | Status |
|---|------|--------|
| 1 | Create subdirectories (`windows/`, `modals/`, `mascot/`, `chat/`) | Done |
| 2 | Move window components to `windows/` | Done |
| 3 | Move modal components to `modals/` | Done |
| 4 | Move mascot components to `mascot/` | Done |
| 5 | Move chat components to `chat/` | Done |
| 6 | Update all import paths | Done |
| 7 | Verify build passes | Done |

## All Tasks Complete

The component directory has been reorganized with clear subdirectories:
- **windows/**: Tauri window entry points (ChatWindow, SettingsWindow, etc.)
- **modals/**: Overlay dialog components (Modal, CwdModal, QuestionModal)
- **mascot/**: Mascot rendering components (Clawd, Supiki, SpeechBubble)
- **chat/**: Chat-related components (ChatInput)
