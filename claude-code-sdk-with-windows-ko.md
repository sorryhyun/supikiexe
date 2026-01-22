# Claude Code CLI를 활용한 Windows 애플리케이션 개발 가이드 (Rust)

본 가이드는 순수 Rust 백엔드를 사용하여 Claude Code CLI와 통합되는 네이티브 Windows 데스크톱 애플리케이션을 구축하는 방법을 설명합니다. 최종 사용자에게는 Node.js 런타임이 필요하지 않습니다.

## 왜 Rust인가?

- **런타임 의존성 없음** - 단일 실행 파일, Node.js/Python 불필요
- **작은 바이너리 크기** - MCP 서버가 내장된 자체 완결형 앱
- **네이티브 성능** - 빠른 시작, 낮은 메모리 사용량
- **크로스 플랫폼** - 하나의 코드베이스로 Windows, macOS, Linux 빌드 가능

## 개요

Anthropic API를 직접 사용하는 대신(API 키 관리 필요), **Claude Code CLI**를 AI 백엔드로 활용할 수 있습니다. 이 접근 방식의 장점:

- 사용자의 기존 Claude Code 인증을 사용 (API 키 불필요)
- 실시간 응답을 위한 스트리밍 JSON 출력 지원
- MCP(Model Context Protocol)를 통한 Claude 기능 확장 지원

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                    사용자앱.exe (Tauri)                            │
├─────────────────────────────────────────────────────────────────┤
│  프론트엔드 (React/Vue/Svelte)                                    │
│  └── UI, 상태 관리, 이벤트 처리                                    │
├─────────────────────────────────────────────────────────────────┤
│  Rust 백엔드                                                      │
│  ├── `claude` CLI 프로세스 스폰                                    │
│  ├── stdout에서 스트리밍 JSON 파싱                                 │
│  └── 프론트엔드로 이벤트 발송                                       │
└──────────────────────┬──────────────────────────────────────────┘
                       │ 프로세스 스폰
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  claude (사용자가 설치한 Claude Code CLI)                          │
│  --print --output-format stream-json --verbose                   │
│  --mcp-config mcp-config.json                                    │
└──────────────────────┬──────────────────────────────────────────┘
                       │ stdio (MCP 프로토콜)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  사용자앱.exe --mcp (동일 바이너리, MCP 서버 모드)                   │
│  └── 애플리케이션용 커스텀 도구                                     │
└─────────────────────────────────────────────────────────────────┘
```

**핵심 아이디어**: 별도의 MCP 서버 바이너리를 배포하는 대신, Tauri 앱이 시작 시 `--mcp` 플래그를 감지하여 자체적으로 MCP 서버 역할을 수행합니다. 이를 통해 추가 실행 파일이 필요 없습니다.

## 사전 요구사항

- [Claude Code CLI](https://claude.ai/download) 설치 및 인증 완료
- Rust 툴체인 (`rustup`)
- Windows SDK (코드 서명용)

## Claude Code CLI 실행하기

### 기본 명령어

```bash
claude --print --output-format stream-json --verbose "프롬프트 입력"
```

### MCP 서버 및 세션 재개 기능과 함께

```bash
claude --print \
  --output-format stream-json \
  --verbose \
  --mcp-config "mcp-config.json 경로" \
  --allowedTools "mcp__your-server__*" \
  --system-prompt "커스텀 시스템 프롬프트" \
  --resume <세션-ID> \
  "사용자 프롬프트"
```

### 스트리밍 JSON 이벤트

CLI는 개행으로 구분된 JSON 이벤트를 출력합니다:

```jsonc
// 세션 초기화
{"type": "system", "session_id": "abc123", ...}

// 어시스턴트 텍스트 응답
{"type": "assistant", "message": {"content": [{"type": "text", "text": "안녕하세요!"}]}}

// 도구 사용
{"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "tool_name", ...}]}}

// 최종 결과
{"type": "result", "session_id": "abc123", ...}
```

## Rust 구현

### Cargo.toml

```toml
[package]
name = "your-app"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### Claude Runner

```rust
use std::process::Stdio;
use tokio::process::Command;
use tokio::io::{BufReader, AsyncBufReadExt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClaudeEvent {
    #[serde(rename = "system")]
    System { session_id: String },
    #[serde(rename = "assistant")]
    Assistant { message: AssistantMessage },
    #[serde(rename = "result")]
    Result { session_id: String },
}

#[derive(Debug, Deserialize)]
struct AssistantMessage {
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse { id: String, name: String },
}

pub struct ClaudeRunner {
    session_id: Option<String>,
    mcp_config_path: Option<String>,
}

impl ClaudeRunner {
    pub fn new() -> Self {
        Self {
            session_id: None,
            mcp_config_path: None,
        }
    }

    pub fn with_mcp_config(mut self, path: String) -> Self {
        self.mcp_config_path = Some(path);
        self
    }

    pub async fn send_message<F>(
        &mut self,
        prompt: &str,
        mut on_event: F,
    ) -> Result<(), Box<dyn std::error::Error>>
    where
        F: FnMut(ClaudeEvent),
    {
        let mut args = vec![
            "--print".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
        ];

        // MCP 설정이 지정된 경우 추가
        if let Some(ref config_path) = self.mcp_config_path {
            args.push("--mcp-config".to_string());
            args.push(config_path.clone());
        }

        // 기존 세션이 있으면 재개
        if let Some(ref session_id) = self.session_id {
            args.push("--resume".to_string());
            args.push(session_id.clone());
        }

        args.push(prompt.to_string());

        let mut child = Command::new("claude")
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;

        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        while let Some(line) = lines.next_line().await? {
            if let Ok(event) = serde_json::from_str::<ClaudeEvent>(&line) {
                // 향후 재개를 위해 session_id 저장
                match &event {
                    ClaudeEvent::System { session_id } |
                    ClaudeEvent::Result { session_id } => {
                        self.session_id = Some(session_id.clone());
                    }
                    _ => {}
                }
                on_event(event);
            }
        }

        child.wait().await?;
        Ok(())
    }
}
```

### Tauri 통합

```rust
use tauri::{AppHandle, Manager};

#[tauri::command]
async fn send_message(
    app: AppHandle,
    prompt: String,
) -> Result<(), String> {
    let mut runner = ClaudeRunner::new()
        .with_mcp_config("mcp-config.json 경로".to_string());

    runner
        .send_message(&prompt, |event| {
            // 프론트엔드로 이벤트 발송
            let _ = app.emit_all("claude-event", &event);
        })
        .await
        .map_err(|e| e.to_string())
}
```

### 프론트엔드 이벤트 처리 (TypeScript)

```typescript
import { listen } from "@tauri-apps/api/event";

interface ClaudeEvent {
  type: "system" | "assistant" | "result";
  session_id?: string;
  message?: {
    content: Array<{ type: string; text?: string }>;
  };
}

listen<ClaudeEvent>("claude-event", (event) => {
  const data = event.payload;

  if (data.type === "assistant" && data.message) {
    for (const block of data.message.content) {
      if (block.type === "text") {
        console.log("Claude:", block.text);
      }
    }
  }
});
```

## Rust로 MCP 서버 만들기 (셀프 호스팅 패턴)

MCP(Model Context Protocol)를 통해 Claude의 기능을 커스텀 도구로 확장할 수 있습니다. 별도의 MCP 서버 바이너리를 만드는 대신, `--mcp` 플래그를 감지하여 메인 애플리케이션이 자체적으로 MCP 서버 역할을 할 수 있습니다.

### 왜 셀프 호스팅인가?

- **단일 실행 파일** - 배포할 추가 바이너리 없음
- **코드 공유** - 앱과 MCP 서버 간 타입과 로직 재사용
- **간편한 배포** - 서명, 번들, 업데이트할 파일이 하나
- **직접 IPC** - MCP 서버가 실행 중인 앱과 IPC로 통신 가능

### Cargo.toml (Tauri 앱에 추가)

```toml
[dependencies]
# ... 기존 의존성 ...

# MCP 서버 지원
rmcp = { version = "0.3", features = ["server", "macros", "transport-io"] }
schemars = "0.8"

# 스크린샷/이미지 지원 (선택사항)
xcap = "0.4"                    # 크로스플랫폼 화면 캡처
base64 = "0.22"                 # Base64 인코딩
image = { version = "0.25", default-features = false, features = ["png", "webp"] }
```

### --mcp 플래그 감지 진입점

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mcp_server;

#[tokio::main]
async fn main() {
    // Tauri 초기화 전에 --mcp 플래그 확인
    if std::env::args().any(|arg| arg == "--mcp") {
        // MCP 서버로 실행 (stdio 모드)
        if let Err(e) = mcp_server::run_mcp_server().await {
            eprintln!("MCP 서버 오류: {}", e);
            std::process::exit(1);
        }
        return;
    }

    // 일반 Tauri 앱 초기화
    your_app_lib::run();
}
```

### MCP 서버 구현

```rust
// src-tauri/src/mcp_server.rs
use std::io::Cursor;
use anyhow::Result;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::ImageFormat;
use rmcp::{
    handler::server::{router::tool::ToolRouter, tool::Parameters},
    model::*,
    schemars, tool, tool_handler, tool_router, ServerHandler, ServiceExt,
};
use xcap::Monitor;

// 도구 입력 스키마 정의
#[derive(serde::Deserialize, schemars::JsonSchema)]
struct SetEmotionRequest {
    /// 표시할 감정 (happy, sad, excited, thinking)
    emotion: String,
    /// 지속 시간 (밀리초, 기본값: 5000)
    #[serde(default)]
    duration_ms: Option<u32>,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct MoveToRequest {
    /// 목표 위치: "left", "right", "center", 또는 x 좌표
    target: String,
}

#[derive(serde::Deserialize, schemars::JsonSchema)]
struct CaptureScreenshotRequest {
    /// 찾고자 하는 내용에 대한 설명 (선택사항)
    #[serde(default)]
    description: Option<String>,
}

// 도구 라우터가 있는 MCP 서버
pub struct MascotService {
    tool_router: ToolRouter<MascotService>,
}

#[tool_router]
impl MascotService {
    fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }

    // 텍스트를 반환하는 도구 (간단한 경우)
    #[tool(description = "마스코트의 감정 표현을 설정합니다")]
    async fn set_emotion(&self, Parameters(req): Parameters<SetEmotionRequest>) -> String {
        let duration = req.duration_ms.unwrap_or(5000);
        format!("감정이 '{}'(으)로 {}ms 동안 설정되었습니다", req.emotion, duration)
    }

    #[tool(description = "마스코트를 화면의 특정 위치로 이동시킵니다")]
    async fn move_to(&self, Parameters(req): Parameters<MoveToRequest>) -> String {
        format!("{}(으)로 이동 중", req.target)
    }

    // 이미지 콘텐츠를 반환하는 도구 (고급 경우)
    #[tool(description = "사용자 화면의 스크린샷을 캡처합니다")]
    async fn capture_screenshot(
        &self,
        Parameters(req): Parameters<CaptureScreenshotRequest>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let desc = req.description.unwrap_or_else(|| "일반 화면".to_string());

        let make_error = |msg: String| {
            rmcp::ErrorData::new(
                rmcp::model::ErrorCode::INTERNAL_ERROR,
                msg,
                None::<serde_json::Value>,
            )
        };

        // 주 모니터 가져오기
        let monitors = Monitor::all()
            .map_err(|e| make_error(format!("모니터를 가져오는데 실패: {}", e)))?;
        let monitor = monitors.into_iter().next()
            .ok_or_else(|| make_error("모니터를 찾을 수 없습니다".to_string()))?;

        // 화면 캡처
        let image = monitor.capture_image()
            .map_err(|e| make_error(format!("캡처 실패: {}", e)))?;

        // 너무 크면 리사이즈 (MCP는 ~1MB 제한)
        let (w, h) = (image.width(), image.height());
        let max_dim = 1920u32;
        let resized = if w > max_dim || h > max_dim {
            let scale = max_dim as f32 / w.max(h) as f32;
            image::imageops::resize(
                &image,
                (w as f32 * scale) as u32,
                (h as f32 * scale) as u32,
                image::imageops::FilterType::Triangle,
            )
        } else {
            image::imageops::resize(&image, w, h, image::imageops::FilterType::Triangle)
        };

        // WebP로 인코딩 (PNG보다 작음)
        let mut webp_data = Cursor::new(Vec::new());
        resized.write_to(&mut webp_data, ImageFormat::WebP)
            .map_err(|e| make_error(format!("인코딩 실패: {}", e)))?;

        // Base64 인코딩 후 이미지 콘텐츠로 반환
        let base64_data = BASE64.encode(webp_data.into_inner());

        Ok(CallToolResult::success(vec![
            Content::text(format!("스크린샷 캡처됨 (찾는 내용: {})", desc)),
            Content::image(base64_data, "image/webp"),
        ]))
    }
}

#[tool_handler]
impl ServerHandler for MascotService {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

pub async fn run_mcp_server() -> Result<()> {
    let transport = (tokio::io::stdin(), tokio::io::stdout());
    let service = MascotService::new().serve(transport).await?;
    service.waiting().await?;
    Ok(())
}
```

### 도구 반환 타입

MCP 도구는 다양한 타입을 반환할 수 있습니다:

| 반환 타입 | 사용 사례 | 예시 |
|----------|----------|------|
| `String` | 간단한 텍스트 응답 | `set_emotion`, `move_to` |
| `Result<CallToolResult, rmcp::ErrorData>` | 이미지/다중 콘텐츠 | `capture_screenshot` |

이미지 콘텐츠의 경우, `CallToolResult::success(vec![...])` 내에서 `Content::image(base64_data, mime_type)`를 사용합니다.

**참고:** MCP는 도구 결과에 ~1MB 제한이 있습니다. 큰 이미지는 인코딩 전에 항상 리사이즈하세요.

### MCP 설정 파일

`--mcp` 플래그와 함께 자신의 실행 파일을 가리키도록 MCP 설정을 구성합니다:

```json
{
  "mcpServers": {
    "mascot": {
      "command": "사용자앱.exe 경로",
      "args": ["--mcp"]
    }
  }
}
```

### 런타임에 MCP 설정 생성

앱이 자신의 경로를 알고 있으므로, MCP 설정을 동적으로 생성합니다:

```rust
use std::path::PathBuf;

fn generate_mcp_config(app_exe_path: &PathBuf) -> serde_json::Value {
    serde_json::json!({
        "mcpServers": {
            "mascot": {
                "command": app_exe_path.to_string_lossy(),
                "args": ["--mcp"]
            }
        }
    })
}

// Tauri 설정에서
let exe_path = std::env::current_exe().expect("실행 파일 경로를 가져오는데 실패");
let config = generate_mcp_config(&exe_path);
let config_path = app_data_dir.join("mcp-config.json");
std::fs::write(&config_path, serde_json::to_string_pretty(&config)?)?;
```

### 추가 번들링 불필요

MCP 서버가 메인 실행 파일에 내장되어 있으므로, 별도의 바이너리를 번들할 필요가 없습니다. 단일 `.exe`가 두 가지를 모두 처리합니다:
- GUI 모드 (기본): `사용자앱.exe`
- MCP 서버 모드: `사용자앱.exe --mcp`

## Windows 코드 서명

Windows SmartScreen은 서명되지 않은 실행 파일에 대해 경고를 표시합니다.

### 개발용 인증서

```powershell
# 인증서 생성
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=개발용 인증서" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(5)

# .pfx로 내보내기
$password = ConvertTo-SecureString -String "devpass" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath ".\dev-cert.pfx" -Password $password
```

### 서명 스크립트 (Rust)

순수 Rust 빌드 파이프라인을 위한 서명 유틸리티:

```rust
// scripts/sign.rs
use std::process::Command;
use std::path::Path;
use std::fs;

fn find_signtool() -> Option<String> {
    let sdk_path = r"C:\Program Files (x86)\Windows Kits\10\bin";

    let mut versions: Vec<_> = fs::read_dir(sdk_path)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.starts_with("10."))
        .collect();

    versions.sort();
    versions.reverse();

    for version in versions {
        let signtool = format!(r"{}\{}\x64\signtool.exe", sdk_path, version);
        if Path::new(&signtool).exists() {
            return Some(signtool);
        }
    }
    None
}

fn main() {
    let signtool = find_signtool().expect("signtool.exe를 찾을 수 없습니다");
    let cert_path = "dev-cert.pfx";
    let password = "devpass";

    let artifacts = fs::read_dir("artifacts")
        .expect("artifacts 디렉토리를 찾을 수 없습니다")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "exe"));

    for entry in artifacts {
        let path = entry.path();
        println!("{:?} 서명 중...", path);

        Command::new(&signtool)
            .args([
                "sign",
                "/f", cert_path,
                "/p", password,
                "/fd", "sha256",
                path.to_str().unwrap(),
            ])
            .status()
            .expect("서명 실패");
    }

    println!("서명 완료!");
}
```

### Cargo로 빌드하기

```toml
# Cargo.toml
[[bin]]
name = "sign"
path = "scripts/sign.rs"
```

```bash
# 빌드 (단일 실행 파일이 GUI와 MCP 모드 모두 처리)
cargo build --release -p your-app

# 서명
cargo run --bin sign
```

### 프로덕션 코드 서명 옵션

| 옵션 | 비용 | 비고 |
|------|------|------|
| Azure Trusted Signing | 월 ~$10 | Microsoft 클라우드 서명 서비스 |
| SignPath.io | 무료 (OSS) | 오픈소스 프로젝트 무료 |
| 전통적 CA | 연 $200-500 | DigiCert, Sectigo, Comodo |

### .gitignore

```gitignore
# 코드 서명 인증서
*.pfx
*.p12

# 빌드 출력물
target/
artifacts/
```

## 프로젝트 구조

```
your-app/
├── src/                      # 프론트엔드 (Tauri 사용 시)
├── src-tauri/                # Tauri Rust 백엔드
│   ├── src/
│   │   ├── main.rs           # --mcp 감지가 있는 진입점
│   │   ├── lib.rs
│   │   ├── claude_runner.rs  # Claude CLI 통합
│   │   └── mcp_server.rs     # MCP 서버 (동일 바이너리)
│   └── Cargo.toml
├── scripts/
│   └── sign.rs               # 서명 유틸리티
├── artifacts/                # 빌드 출력물 (gitignore 대상)
├── dev-cert.pfx              # 개발용 인증서 (gitignore 대상)
└── Cargo.toml                # 워크스페이스 루트
```

참고: 별도의 MCP 서버 크레이트가 필요 없습니다 - 메인 실행 파일에 내장됩니다.

## 팁과 모범 사례

### 1. 세션 관리

대화 연속성을 위해 `session_id`를 저장하세요:

```rust
// 각 대화 후 저장
self.session_id = Some(result.session_id);

// 나중에 재개
args.push("--resume".to_string());
args.push(session_id);
```

### 2. 에러 처리

Claude Code가 설치되지 않은 경우 처리:

```rust
match Command::new("claude").spawn() {
    Ok(child) => { /* 계속 진행 */ }
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
        return Err("Claude Code CLI를 찾을 수 없습니다. https://claude.ai/download 에서 설치해주세요".into());
    }
    Err(e) => return Err(e.into()),
}
```

### 3. 비동기 스트리밍

UI로의 깔끔한 비동기 스트리밍을 위해 채널 사용:

```rust
use tokio::sync::mpsc;

let (tx, mut rx) = mpsc::channel(100);

// 리더 태스크 스폰
tokio::spawn(async move {
    while let Some(line) = lines.next_line().await.unwrap() {
        if let Ok(event) = serde_json::from_str(&line) {
            tx.send(event).await.unwrap();
        }
    }
});

// 메인 태스크에서 소비
while let Some(event) = rx.recv().await {
    app.emit_all("claude-event", &event)?;
}
```

### 4. 바이너리 크기 최적화

```toml
# Cargo.toml
[profile.release]
opt-level = "z"     # 크기 최적화
lto = true          # 링크 타임 최적화
codegen-units = 1   # 단일 코드젠 유닛
strip = true        # 심볼 제거
```

## 사례 연구: Claude Mascot

Claude Mascot은 이 셀프 호스팅 아키텍처를 실제로 보여주는 예시입니다:

- **단일 실행 파일**: 하나의 `.exe`가 Tauri GUI와 MCP 서버 모두로 실행됨
- **GUI 모드** (기본): Claude CLI 스폰, 윈도우 관리, 시스템 트레이
- **MCP 모드** (`--mcp` 플래그): stdio를 통해 마스코트 제어 도구 제공
- **프론트엔드**: 마스코트 렌더링 및 채팅 UI를 위한 React

Claude + MCP로 구현된 기능:
- 마스코트와 자연스러운 대화
- `set_emotion` 도구를 통한 감정 표현
- `move_to` 도구를 통한 화면 이동
- **스크린샷 캡처** - `capture_screenshot` 도구로 Claude가 화면을 볼 수 있음

스크린샷 기능은 다음을 사용합니다:
- 크로스플랫폼 화면 캡처를 위한 `xcap` 크레이트
- 더 작은 파일 크기를 위한 WebP 인코딩 (PNG보다 ~60% 작음)
- MCP의 1MB 제한 내로 유지하기 위한 자동 리사이징
- Claude가 실제로 화면을 "볼" 수 있도록 `Content::image`로 이미지 반환

셀프 호스팅의 장점:
- 배포할 별도의 MCP 서버 바이너리 없음
- 코드 서명하고 번들할 파일이 하나
- GUI와 MCP 서버 간 타입 공유

API 키 없이 모든 것이 동작합니다 - 사용자의 Claude Code 인증을 사용합니다.

## 추가 참고사항: Codex CLI 통합

Claude Code CLI의 대안으로 [OpenAI Codex CLI](https://github.com/openai/codex)와도 통합할 수 있습니다. OpenAI 모델을 사용하여 유사한 기능을 제공합니다.

### Codex CLI 명령어

```bash
codex exec --json --full-auto --skip-git-repo-check "프롬프트 입력"
```

주요 플래그:
- `exec` - 프롬프트 실행 모드
- `--json` - 스트리밍 JSON 이벤트 출력
- `--full-auto` - 사용자 확인 없이 자동 실행 모드
- `--skip-git-repo-check` - Git 저장소 검증 건너뛰기 (데스크톱 앱에서 중요)

### 세션 재개

```bash
codex exec resume <thread-id> --json --full-auto --skip-git-repo-check "후속 프롬프트"
```

### Codex 스트리밍 JSON 이벤트

Codex는 Claude Code와 다른 이벤트 타입을 출력합니다:

```jsonc
// 스레드 초기화
{"type": "thread.started", "thread_id": "abc123"}

// 턴 라이프사이클
{"type": "turn.started", "turn_id": "xyz789"}
{"type": "turn.completed", "turn_id": "xyz789"}

// 콘텐츠 아이템
{"type": "item.started", "item": {"type": "message", "content": [...]}}
{"type": "item.completed", "item": {"type": "message", "content": [...]}}

// 도구 호출
{"type": "item.started", "item": {"type": "tool_call", "name": "tool_name", "arguments": {...}}}

// MCP 도구 호출
{"type": "item.completed", "item": {"type": "mcp_tool_call", "server": "mascot", "tool": "set_emotion", ...}}

// 오류
{"type": "turn.failed", "error": "문제가 발생했습니다"}
{"type": "error", "message": "오류 상세"}
```

### Rust 이벤트 타입

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum CodexStreamEvent {
    #[serde(rename = "thread.started")]
    ThreadStarted { thread_id: Option<String> },

    #[serde(rename = "turn.started")]
    TurnStarted { turn_id: Option<String> },

    #[serde(rename = "turn.completed")]
    TurnCompleted { turn_id: Option<String> },

    #[serde(rename = "turn.failed")]
    TurnFailed { error: Option<String> },

    #[serde(rename = "item.started")]
    ItemStarted { item: Option<CodexItem> },

    #[serde(rename = "item.completed")]
    ItemCompleted { item: Option<CodexItem> },

    #[serde(rename = "error")]
    Error { message: Option<String> },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum CodexItem {
    #[serde(rename = "message")]
    Message { content: Vec<CodexContent> },

    #[serde(rename = "tool_call")]
    ToolCall { name: Option<String>, arguments: Option<serde_json::Value> },

    #[serde(rename = "mcp_tool_call")]
    McpToolCall {
        server: Option<String>,
        tool: Option<String>,
        arguments: Option<serde_json::Value>,
        result: Option<serde_json::Value>,
    },
}
```

### Codex MCP 설정

JSON 설정 파일을 사용하는 Claude Code와 달리, Codex는 `~/.codex/config.toml`에서 MCP 설정을 읽습니다:

```toml
[mcp_servers.mascot]
command = "C:\\path\\to\\your-mcp-server.exe"
args = []
```

Codex 실행 전에 이 설정을 프로그래밍 방식으로 작성합니다:

```rust
fn write_codex_mcp_config(mcp_exe_path: &str) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("홈 디렉토리를 찾을 수 없습니다")?;
    let config_path = home.join(".codex").join("config.toml");

    // 필요시 디렉토리 생성
    std::fs::create_dir_all(config_path.parent().unwrap())
        .map_err(|e| format!(".codex 디렉토리 생성 실패: {}", e))?;

    // TOML용 백슬래시 이스케이프
    let escaped_path = mcp_exe_path.replace('\\', "\\\\");

    let config = format!(
        "[mcp_servers.mascot]\ncommand = \"{}\"\nargs = []\n",
        escaped_path
    );

    std::fs::write(&config_path, config)
        .map_err(|e| format!("설정 파일 작성 실패: {}", e))?;

    Ok(())
}
```

### Codex 모델 설정

`--config` 플래그로 모델 설정을 전달합니다:

```bash
codex exec --json --full-auto \
  --config model="\"gpt-4o\"" \
  --config model_reasoning_effort="\"high\"" \
  "프롬프트"
```

### 이미지 지원

Codex는 파일 경로를 통한 이미지 입력을 지원합니다 (base64가 아님):

```bash
codex exec --json --full-auto --image "/path/to/image.png" "이 이미지를 설명해주세요"
```

Codex에 전달하기 전에 base64 이미지를 임시 파일로 저장합니다:

```rust
fn save_image_to_temp(base64_data: &str, index: usize) -> Result<PathBuf, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let image_data = STANDARD.decode(base64_data)
        .map_err(|e| format!("디코딩 실패: {}", e))?;

    let temp_path = std::env::temp_dir()
        .join(format!("app-image-{}.png", index));

    std::fs::write(&temp_path, &image_data)
        .map_err(|e| format!("파일 작성 실패: {}", e))?;

    Ok(temp_path)
}
```

### 주요 차이점: Claude Code vs Codex

| 기능 | Claude Code CLI | Codex CLI |
|------|-----------------|-----------|
| 인증 | Claude Code 로그인 | OpenAI API 키 |
| MCP 설정 | `--mcp-config`로 JSON 파일 | `~/.codex/config.toml`의 TOML |
| 세션 재개 | `--resume <session-id>` | `exec resume <thread-id>` |
| 출력 형식 | `--output-format stream-json` | `--json` |
| 자동 모드 | 해당 없음 (항상 인터랙티브) | `--full-auto` |
| Git 검사 | 해당 없음 | `--skip-git-repo-check` |
| 이미지 입력 | 프롬프트에 Base64 | `--image`로 파일 경로 |

### Codex CLI 다운로드

[OpenAI Codex Releases](https://github.com/openai/codex/releases)에서 Windows 실행 파일을 다운로드하세요:
- Windows x64용 `codex-x86_64-pc-windows-msvc.exe`

애플리케이션과 함께 번들하거나 사용자가 별도로 설치하도록 안내하세요.

## 리소스

- [Claude Code CLI](https://claude.ai/download)
- [OpenAI Codex CLI](https://github.com/openai/codex)
- [Tauri v2](https://v2.tauri.app/)
- [rmcp - Rust MCP SDK](https://github.com/modelcontextprotocol/rust-sdk)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## 저자

지승현 (sorryhyun) <standingbehindnv@gmail.com>
