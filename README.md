# Claude Mascot

Tauri v2 + React + TypeScript로 만든 데스크톱 마스코트 앱입니다. Clawd가 화면 위를 돌아다닙니다.

## 기능

- 투명하고 항상 위에 표시되는 윈도우
- 드래그로 캐릭터 이동 가능
- 시스템 트레이 지원
- Claude AI와 대화 가능
- 스크린샷, 클립보드 읽기 등 다양한 도구 지원

## 설치 방법

### 사전 요구사항

- [Node.js](https://nodejs.org/) (v18 이상)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri 필수 구성요소](https://v2.tauri.app/start/prerequisites/)
  - Windows: Microsoft Visual Studio C++ Build Tools
- `ANTHROPIC_API_KEY` 환경 변수 설정 필요

### 의존성 설치

```bash
npm install
```

## 실행 방법

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

### 기타 명령어

```bash
npm run vite:build   # 프론트엔드만 빌드
npm run icons        # 아이콘 재생성
```

## 사용 방법

- **클릭**: Clawd를 클릭하면 채팅창이 열립니다
- **채팅창 닫기**: Clawd를 다시 클릭하거나 채팅창 바깥을 클릭
- **더블클릭**: 물리 엔진 on/off 전환
- **드래그**: Clawd를 드래그해서 원하는 위치로 이동

## 기술 스택

- Tauri v2
- React + TypeScript
- Vite
- Claude Agent SDK
- tauri-specta (type-safe IPC bindings)
