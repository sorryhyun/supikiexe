# Supiki

Tauri v2 + React + TypeScript로 만든 데스크톱 마스코트 앱입니다. Supiki가 화면 위를 돌아다닙니다.

## 기능

- 투명하고 항상 위에 표시되는 윈도우
- 드래그로 캐릭터 이동 가능
- 시스템 트레이 지원
- Claude AI와 대화 가능
- 감정 표현 및 화면 이동

## 설치 방법 (사용자)

### 사전 요구사항

- [Claude Code](https://claude.ai/download) 설치 및 로그인

### 실행

1. [Releases](https://github.com/anthropics/supiki/releases)에서 최신 버전 다운로드
2. `Supiki.exe` 실행

## 개발 환경 설정

### 사전 요구사항

- [Node.js](https://nodejs.org/) (v18 이상)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri 필수 구성요소](https://v2.tauri.app/start/prerequisites/)
  - Windows: Microsoft Visual Studio C++ Build Tools
- [Claude Code CLI](https://claude.ai/download) 설치 및 로그인

Note: `ANTHROPIC_API_KEY`가 필요 없습니다 - Claude Code CLI가 자체 인증을 처리합니다.

### 의존성 설치

```bash
npm install
```

### 개발 모드

```bash
npm run dev
```

개발 서버가 시작되고 Tauri 앱이 실행됩니다.

### 프로덕션 빌드

```bash
npm run build
```

빌드된 앱은 `src-tauri/target/release` 폴더에 생성됩니다.

### 테스트

```bash
make test            # 모든 테스트 실행 (TypeScript + Rust + MCP)
make test-ts         # TypeScript 테스트만 실행
make test-rust       # Rust 테스트만 실행
make test-mcp        # MCP 서버 테스트만 실행
npm run test:watch   # TypeScript 테스트 watch 모드
```

### 기타 명령어

```bash
npm run vite:build   # 프론트엔드만 빌드
npm run bundle:mcp   # MCP 서버 빌드
npm run icons        # 아이콘 재생성
```

## 사용 방법

- **클릭**: Supiki를 클릭하면 채팅창이 열립니다
- **채팅창 닫기**: Supiki를 다시 클릭하거나 채팅창 바깥을 클릭
- **더블클릭**: 물리 엔진 on/off 전환
- **드래그**: Supiki를 드래그해서 원하는 위치로 이동

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                       Supiki.exe (Tauri)                         │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React)        │  Backend (Rust)                       │
│  - 마스코트 UI           │  - Claude CLI 실행                    │
│  - 채팅 인터페이스       │  - 스트리밍 JSON 파싱                 │
│  - 물리 엔진             │  - 프론트엔드 이벤트 전송             │
└──────────────────────────┴──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  claude CLI (Claude Code)                                        │
│  └── MCP 프로토콜로 mascot-mcp.exe와 통신                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  mascot-mcp.exe (Rust MCP 서버)                                  │
│  └── set_emotion, move_to, capture_screenshot 도구 제공          │
└─────────────────────────────────────────────────────────────────┘
```

## 기술 스택

- Tauri v2 (Rust backend)
- React + TypeScript (frontend)
- Vite (build tool)
- Claude Code CLI (AI backend)
- rmcp (Rust MCP SDK)
- tauri-specta (type-safe IPC bindings)

## 디렉토리 구조

| 디렉토리 | 설명 |
|----------|------|
| `src/` | React 프론트엔드 - UI, 물리 엔진, 상태 머신 |
| `src-tauri/` | Rust 백엔드 - Tauri 앱, 시스템 트레이, Claude CLI 러너 |
| `mascot-mcp/` | Rust MCP 서버 - 마스코트 제어 도구 |
