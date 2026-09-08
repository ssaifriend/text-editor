# 개인용 텍스트 에디터 설계 문서

- 작성일: 2026-09-08
- 상태: 초안 (사용자 리뷰 대기)
- 앱 이름: 미정. 스펙에 영향 없음. 패키징(M6) 전에 결정.

## 0. 한 줄 요약

Sublime Text 3의 편집 경험을 계승하고, 그 옆에 Claude Code / Codex 같은 에이전트 TUI를 띄울 수 있는 터미널 탭을 가진, 가벼운 크로스플랫폼(macOS + Windows) 개인용 에디터. Electron + CodeMirror 6 + TypeScript로 만들고, 텍스트 엔진은 직접 만들지 않는다.

## 1. 목표와 비목표

### 1.1 목표 / 정체성

- **데일리 드라이버.** 학습용이나 장난감이 아니다. 완성 후 ST3를 지우고 이걸로 매일 일한다.
- **정체성: "ST3 + 에이전트 터미널".** 한 창에서 편집하고, 같은 창의 터미널 탭에서 Claude Code / Codex를 돌린다. VSCode의 에이전트 확장처럼 깊은 통합(L2)을 하지 않고, 에이전트 본연의 TUI를 그대로 띄운다. 이것이 ST3에서 옮겨오는 이유이자 VSCode를 쓰지 않는 이유다.
- 만드는 이유는 경제성이 아니다. ST4 라이센스($99)는 이 프로젝트의 첫 주말 비용보다 싸다. 이유는 "내 손에 맞는 도구"와 그것을 만드는 재미다.

### 1.2 우선순위 (사용자 지정 순서)

1. **한글 지원** — IME 조합, 인코딩(CP949/EUC-KR), 문자 폭, NFC/NFD.
2. **주요 언어 하이라이팅.**
3. **반드시 가벼움** — §1.5의 수치로 정의.
4. **강력한 find/replace** — 버퍼 내 + 프로젝트 전역, 정규식, 미리보기 후 일괄 치환, 한 번에 undo.
5. **마크다운** — 편집 보조와 프리뷰.

우선순위 충돌 시 앞 번호가 이긴다. 예: 하이라이팅 데코레이션(2)이 한글 조합(1)을 깨면 데코레이션을 양보한다.

### 1.3 제약

- macOS와 Windows 둘 다 지원. Linux는 비목표(부록 A).
- 기존 에디터를 fork하거나 채택하지 않는다. 텍스트 편집 **컴포넌트**(CodeMirror 6)를 라이브러리로 쓰는 것은 허용.
- 상시 다루는 파일은 수만 줄 규모의 소스와 마크다운. 수백 MB 로그는 비목표.
- 텍스트 엔진(버퍼 자료구조, 커서/선택 모델, undo, IME 처리)은 직접 만들지 않는다. 검증된 엔진 위에 껍데기와 UX를 만든다.
- 개인 사용. 배포·업데이트 인프라는 최소.

### 1.4 데일리 드라이버 필수 조건 (사용자 목록에 추가한 것)

- 원자적 저장. 저장 중 크래시로 원본이 사라지지 않는다.
- 외부 변경 감지. 에이전트나 git이 파일을 바꾸면 알고, 내 편집을 덮어쓰지 않는다.
- Hot exit / 세션 복원. 저장 안 한 버퍼가 재시작 후 그대로 있다. undo 히스토리도 복원.
- 멀티커서. 편집 연산이 처음부터 다중 범위 배치.
- 인코딩·EOL 왕복. 파일을 열고 저장했을 때 내용을 바꾸지 않았다면 바이트가 동일하다.

### 1.5 성능 목표

| 지표 | 목표 | 참고 (ST3 실측) |
|---|---|---|
| 콜드 스타트 → 첫 페인트 | < 1.0 s | ~0.3 s |
| RSS (파일 10개 열고, 터미널 없이) | < 300 MB | 150~300 MB |
| 키 입력 → 화면 반영 p95 (5k줄, 하이라이팅 ON) | < 16 ms | 1 프레임 |
| Goto Anything 응답 (5만 경로) | < 30 ms | — |
| 5만 줄 파일 열기 | < 500 ms | — |

에이전트 프로세스(Claude Code 등)의 RAM은 이 예산에 포함하지 않는다. 그것은 외부 터미널에서 돌려도 똑같이 드는 비용이다.

### 1.6 비목표 (안 만드는 것)

LSP · 자동완성 · 디버거 · 플러그인 API · git GUI · 협업/원격 편집 · 자체 AI 채팅 UI · Claude Code IDE 통합 프로토콜(L2) · mermaid · 미니맵.

이 목록은 "가벼움"과 "완주"를 지키는 장치다. 개인용이므로 확장은 플러그인이 아니라 소스 수정으로 한다.

## 2. 스택 결정과 근거

### 2.1 선택

| 층 | 선택 | 근거 |
|---|---|---|
| 호스트 | **Electron** | 번들된 Chromium 하나 → 양 OS에서 동일 엔진·동일 버전. 1순위(한글 IME)를 한 번만 검증하고, 회귀 시 Chromium 버전을 고정해 버틸 수 있다. Rust 없이 TS로 완주 가능. |
| 에디터 코어 | **CodeMirror 6** | rope 유사 텍스트, 다중 범위 선택(멀티커서), undo, 뷰포트 가상화, IME 조합 처리를 내장. 모듈형이라 가볍고 스타일링 자유도가 높다. |
| 하이라이팅 | **Lezer** (`@codemirror/lang-*`) + `@codemirror/legacy-modes` | CM6 네이티브 증분 파서. 인덴트·폴딩·심볼 추출까지 구문 트리 기반. 롱테일 언어는 legacy-modes로 커버. |
| 셸 UI | **Solid.js** | 세밀 반응성. 상태바 커서 위치처럼 고빈도 갱신에 VDOM 비용이 없다. 번들 작음. 에디터 본체는 CM6가 DOM을 직접 관리하므로 프레임워크는 껍데기만 담당. |
| 전역 검색 | **ripgrep** (`@vscode/ripgrep`) | 플랫폼별 바이너리 번들. `--json` 스트림. |
| 퍼지 매칭 | **`fzf`** (npm, fzf v2 알고리즘 포트) | main worker thread에서 실행. |
| 인코딩 | **`chardet` + `iconv-lite`** | CP949 휴리스틱 보강(§5.1). |
| 파일 감시 | **`@parcel/watcher`** | 네이티브, 재귀 감시. |
| 마크다운 | **`markdown-it`** + **`DOMPurify`** + **`morphdom`** | GFM 플러그인 생태계. sanitize 필수. 패치 렌더로 스크롤 유지. |
| 터미널 | **`node-pty`** + **`xterm.js`** (webgl · fit · unicode11 · web-links · search addon) | VSCode 터미널과 동일 스택. |
| diff | **`@codemirror/merge`** | 외부 변경 무음 리로드의 ChangeSet 계산과 나란히 diff 뷰. |
| 스키마 | **zod** | IPC 양단 검증, 설정 파일 검증. |
| 언어·스타일 | **TypeScript strict**, 함수형, **ts-belt** | 사용자 기존 스택. IPC 결과는 `Result`. |
| 빌드·패키징 | **electron-vite**, **pnpm**, **electron-builder** (mac dmg / win nsis) | |
| 테스트 | **Vitest**, **fast-check**, **Playwright for Electron** (CDP 포함) | §7. |
| 로깅 | **electron-log** | |
| 기타 | `shell-env`, `string-width`, `Intl.Segmenter` | 각각 §5.5, §5.4, §5.1. |

### 2.2 탈락한 대안과 이유

| 대안 | 탈락 이유 |
|---|---|
| Tauri (시스템 웹뷰) | macOS는 WebKit, Windows는 WebView2(Chromium)로 **엔진이 둘**. 1순위 기능을 두 엔진에서 각각 검증해야 하고, OS가 웹뷰를 자동 업데이트하면 앱이 사용자 모르게 깨진다. Chromium 149+ Windows에서 CM6 기반 에디터의 CJK 입력이 깨진 사례가 실제 있다. Windows에서는 RAM 이점도 거의 없다(WebView2도 Chromium 프로세스). |
| Monaco | 숨은 textarea 방식이라 IME 강건성은 구조적으로 유리하나, 스타일링 자유도가 낮고 자체 렌더 레이어가 무겁다. 사용자가 CM6를 선택. **M0 게이트 실패 시의 사전 합의 폴백.** |
| Rust GPU 네이티브 (egui/iced/floem/GPUI) | IME를 `winit` 위에서 직접 구현해야 한다. 전업 팀인 Zed조차 한글 IME 이슈가 여러 개 열려 있다(Linux 자모 분리, Windows 한/영 키, macOS NFD). 1인 프로젝트에서 1순위를 이 방식으로 둘 수 없다. |
| macOS 네이티브 Swift (STTextView + Neon + tree-sitter) | 1순위·3순위에 가장 정직한 답이었으나 Windows 제약으로 탈락. |
| Neovim을 엔진으로 + 자작 GUI | 텍스트 엔진은 최강이지만 모달 모델. 사용자는 비모달 ST 스타일을 원한다. |
| Scintilla (Qt/wx, C++) | 한글·가벼움 최강급이나 C++이며 스타일링 자유도가 낮다. |
| Avalonia + AvaloniaEdit (C#) | macOS 한글 IME 품질 미검증. |
| 기존 에디터 채택/fork (CudaText, Lite XL, Lapce) | 사용자 제약. |
| Rust 코어 + 얇은 웹뷰 렌더러 (xi 아키텍처) | 조합 상태를 프로세스 경계 너머로 동기화해야 한다. xi 프론트엔드들이 죽은 지점. |
| 직접 구현 (원글 저자 방식) | 1순위를 가장 위험한 방식으로 구현하는 것. 저자도 "외형 90%, 기능 1%"에서 멈췄다. |

### 2.3 알려진 리스크와 완화

| 리스크 | 완화 |
|---|---|
| **CM6 × decoration × 한글 조합.** 조합 중 주변 DOM이 바뀌면 조합이 중단된다. `highlightWhitespace()`가 preedit를 삼킨 사례, `decoration.mark` 안의 다중 `decoration.replace`가 조합 텍스트를 선택 상태로 남긴 사례가 보고됨. | (a) 모든 커스텀 decoration 플러그인은 `view.composing`이 참이면 갱신을 보류한다. (b) 인라인 `decoration.replace`를 쓰지 않는다. 필요하면 라인 단위 widget만. (c) `highlightWhitespace`는 기본 OFF, M0 실측 후 결정. (d) Electron 버전 = Chromium 버전 고정. 업그레이드는 IME 회귀 테스트(§7) 통과 후에만. (e) **M0를 Go/No-go 게이트로 둔다.** |
| Electron의 가벼움 한계 | 확장 호스트·LSP·원격·노트북을 만들지 않는다. VSCode의 무게는 대부분 그것들이다. §1.5 예산을 CI에서 실패하는 테스트로 강제. |
| `node-pty` 네이티브 모듈 빌드 | Electron 버전 고정 + prebuild + electron-builder 리빌드. M0에서 양 OS spawn을 미리 증명해 리스크를 조기 소각. |
| xterm.js 한글 조합 | 별도 IME 표면. M2에서 CDP + 실제 IME로 검증. 실패해도 스택은 바뀌지 않는다(터미널만 영향). |
| Windows rename 실패(파일 잠김) | 재시도 후 실패 시 tmp 보존 + 에러(§4.4). |

## 3. 아키텍처

### 3.1 프로세스 모델

```
┌─ main (Node) ────────────────────────────────────────┐
│  fs        원자적 저장, 인코딩 감지/변환, EOL           │
│  watcher   외부 변경 감지, 자기 쓰기 억제               │
│  search    ripgrep 실행, 결과 스트리밍, 치환 pre-image  │
│  index     프로젝트 파일 목록 + 퍼지 매칭 (worker)       │
│  session   세션 스냅샷, dirty store                    │
│  pty       셸 프로세스, 흐름 제어                        │
│  shell     창, 네이티브 메뉴, 다이얼로그, app-file://    │
└───────────────────┬──────────────────────────────────┘
                    │ typed IPC (contextBridge), 응답은 Result<T, E>
┌─ preload ─────────┴──────────────────────────────────┐
│  main API를 renderer에 화이트리스트로만 노출             │
└───────────────────┬──────────────────────────────────┘
┌─ renderer (sandbox, contextIsolation, no node) ──────┐
│  editor    CM6 인스턴스, 확장 조립, 버퍼 레지스트리       │
│  ui        pane/탭, 사이드바, 팔레트, find 패널, 상태바  │
│  terminal  xterm.js                                   │
│  markdown  파서 → sanitize → 프리뷰 탭                  │
│  keymap/config/commands                               │
└──────────────────────────────────────────────────────┘
```

창은 여러 개일 수 있다(§4.6). 창마다 renderer 하나. main은 창 목록과 창별 상태를 소유한다.

### 3.2 원칙

- **renderer는 디스크를 모른다.** 파일은 main이 준 `{ path, text, encoding, eol, ... }`이고 저장은 main에 위임한다.
- **IPC 응답은 전부 `Result<T, E>`.** throw가 경계를 넘지 않는다. renderer는 ts-belt `R.*`로 처리한다.
- **텍스트 상태의 단일 소유자는 renderer의 CM6 `EditorState`.** main은 파일 메타(경로·mtime·해시·인코딩·EOL·readonly)만 가진다. 이중 소유를 금지해 동기화 버그를 원천 차단한다.
- **커맨드 레지스트리가 허브.** 키맵·팔레트·메뉴·컨텍스트 메뉴는 커맨드 id만 참조한다. 기능 추가 = 커맨드 등록.
- **IPC 채널 정의 파일이 main↔renderer의 유일한 계약.** 채널마다 zod 스키마. 양단 검증.

### 3.3 보안

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- 엄격한 CSP. 원격 스크립트 없음.
- 마크다운 프리뷰의 HTML은 DOMPurify를 반드시 거친다. 허용 태그/속성 화이트리스트, `data-line` 허용, 이벤트 핸들러·script 제거.
- 로컬 이미지는 `app-file://` 커스텀 프로토콜. main 핸들러는 **현재 projectRoot 하위**만 서빙하고 경로 탈출(`..`, symlink 밖)을 차단한다.
- 원격 이미지는 설정 `preview.allowRemoteImages`(기본 false)가 참일 때만 `https:`를 허용.
- 터미널에 자동으로 붙여넣는 텍스트(경로 전송 등)는 셸 메타문자를 인용 처리한다.

### 3.4 모듈 경계

각 모듈은 "하는 일 / 의존"으로 설명 가능해야 하고, 내부를 읽지 않고도 쓸 수 있어야 한다.

**main/**

| 모듈 | 하는 일 | 의존 |
|---|---|---|
| `fs/read` | 바이트 읽기 → 인코딩 감지 → 디코드 → EOL 감지 → 내부 LF 정규화 → hash/stat | node fs, chardet, iconv-lite |
| `fs/write` | 무손실 인코딩 검증 → tmp 쓰기 → fsync → mode 복사 → rename. 원래 인코딩·BOM·EOL 보존 | node fs, iconv-lite |
| `watcher` | 경로 구독/해지, 디바운스, 자기 쓰기 억제, `changed/deleted` push. 실패 시 폴링 강등 | @parcel/watcher |
| `search` | rg 실행·kill, JSON 스트림 배치, 치환 적용(hash 검증), pre-image 보관과 전역 undo | @vscode/ripgrep, fs/write |
| `index` | `rg --files`로 목록, 루트 watcher로 증분 갱신, worker thread에서 fzf 매칭 | @vscode/ripgrep, fzf, worker_threads |
| `session` | 스냅샷 직렬화·복원, dirty store 디바운스 쓰기, 손상 파일 격리 | fs/write |
| `pty` | 로그인 셸 env 해석, spawn/resize/write/kill, 흐름 제어 | node-pty, shell-env |
| `shell` | 창 생명주기, 네이티브 메뉴(커맨드 id 참조), 파일 다이얼로그, `app-file://` 핸들러, 크래시 처리 | electron |
| `ipc` | 채널 정의 + zod 스키마 + 핸들러 등록 래퍼(예외 → `unexpected`) | zod |
| `log` | 파일 로그 로테이션, renderer 로그 수신 | electron-log |

**renderer/**

| 모듈 | 하는 일 | 의존 |
|---|---|---|
| `editor/buffer` | 버퍼 레지스트리 `id → { path, meta, state, savedDoc, dirty }`. 열기/저장/리로드 흐름의 renderer 쪽 | CM6 state, ipc client |
| `editor/extensions` | 언어·하이라이팅·멀티커서·검색·인덴트·괄호·history 등 CM6 확장 조립. `Compartment`로 설정 핫스왑 | CM6 패키지들 |
| `editor/lang` | 확장자/파일명 → Lezer 언어, 없으면 legacy-modes, 없으면 plain | @codemirror/lang-*, legacy-modes |
| `editor/commands` | 자작 편집 커맨드(줄 분할, 커서 추가, 건너뛰기, 마크다운 커맨드 등). `EditorState`만으로 테스트 가능 | CM6 |
| `ui/layout` | pane 트리, 탭 그룹, 분할/병합, 드래그, 일시 미리보기 탭 | Solid |
| `ui/sidebar` | 파일 트리, 컨텍스트 메뉴(새 파일/이름 변경/삭제), 드래그 소스 | Solid, ipc |
| `ui/palette` | Goto Anything + 커맨드 팔레트 오버레이. 모드 접두어 파싱 | Solid, ipc |
| `ui/find` | 버퍼 내 find/replace 패널 | Solid, @codemirror/search |
| `ui/search` | 전역 검색 결과 탭(트리, 미리보기, 체크 제외) | Solid, ipc |
| `ui/statusbar` | 인코딩·EOL·줄:열(grapheme)·언어·인덴트 표시와 클릭 메뉴 | Solid |
| `ui/notify` | 배너·토스트·모달 | Solid |
| `terminal` | xterm.js 인스턴스, addon, 테마, 예약 키, 경로 링크, ack 기반 흐름 제어 | xterm.js, ipc |
| `markdown` | markdown-it 파이프라인, sanitize, morphdom 패치, 스크롤 동기화 | markdown-it, DOMPurify, morphdom |
| `keymap` | `keymap.json` 파싱, 플랫폼 변환(`mod`), 코드, `when` 평가, 충돌 검출, CM6 keymap 컴파일 | commands |
| `config` | 설정 로드(JSONC), zod 검증, 언어별 오버라이드 병합, 핫리로드 → Compartment 재구성 | zod, ipc |
| `commands` | 커맨드 레지스트리 `{ id, title, when?, run }`. 동적 커맨드(Set Syntax 등) 생성 | — |
| `theme` | 테마 JSON → CSS 변수 + CM6 `HighlightStyle` + xterm 팔레트 | — |

### 3.5 pane 모델

```
Window = { bounds, projectRoot, sidebar, layout: PaneTree, activePane }
PaneTree = Pane | Split { direction: 'row' | 'col', ratio, children: PaneTree[] }
Pane = { id, tabs: Tab[], activeTab, previewTab? }
Tab  = buffer(bufferId) | preview(bufferId) | terminal(ptyId) | search(queryId)
```

- pane은 탭 그룹이다. 어떤 종류의 탭이든 어떤 pane에나 들어간다. 탭 스트립 하나로 전부 처리한다.
- `previewTab`은 Goto Anything의 일시 미리보기용 슬롯. Enter나 편집으로 확정되면 일반 탭이 되고, 다음 미리보기가 대체한다.
- 마크다운 프리뷰는 특정 버퍼에 바인딩된 탭이다. 분할 뷰 = 왼쪽 pane에 buffer, 오른쪽 pane에 preview.
- 터미널 탭은 세션에 cwd만 저장한다(§4.6).

### 3.6 커맨드 레지스트리와 `when` 컨텍스트

- 커맨드: `{ id: 'selection.addNextOccurrence', title, when?: 'editorFocus', run(ctx, args) }`.
- 컨텍스트 키: `editorFocus`, `terminalFocus`, `previewFocus`, `panelFocus(find|search)`, `hasSelection`, `hasMultipleSelections`, `languageId == 'markdown'` 등. `when`은 이 키들의 단순 불리언 식.
- 키맵 바인딩은 `{ keys, command, when?, args? }`. 같은 키에 여러 바인딩이 있으면 `when`으로 해소, 남은 충돌은 "Keymap: Show Conflicts" 커맨드가 보고한다.
- 터미널 포커스 중에는 예약 키(§5.5)만 앱이 가로채고 나머지는 터미널로 보낸다.

### 3.7 도구

- 빌드: electron-vite + Vite. main/preload/renderer 각각 번들.
- 패키지: pnpm. TS strict. ESLint + Prettier(프로젝트 표준 설정).
- 테스트: Vitest(단위, CM6 state 테스트), fast-check, Playwright for Electron(E2E, CDP).
- CI: GitHub Actions `macos-latest` + `windows-latest`. PR마다 단위+E2E. 태그에서 electron-builder 패키징.
- Electron 버전은 `package.json`에 정확히 고정(`^` 없이).

## 4. 데이터 흐름

### 4.1 소유권

| 데이터 | 소유자 |
|---|---|
| 문서 텍스트, 선택, undo 히스토리, dirty, pane 레이아웃 | renderer |
| 파일 메타(path, mtime, hash, encoding, bom, eol, readonly), watcher 구독, "예상 쓰기" 목록, 세션 파일, dirty store, PTY 프로세스, 검색 pre-image | main |

### 4.2 열기

```
renderer  fs.open(path)
main      바이트 읽기
          바이너리 가드: 첫 8KB에 NUL → OpenError.binary
          크기 가드: 20MB 초과 → 열되 largeFile 플래그 (renderer는 하이라이팅 OFF + 경고)
          인코딩: BOM → chardet → CP949 휴리스틱(§5.1) → 실패 시 utf8, confidence 기록
          디코드 (iconv-lite)
          EOL: CRLF/LF/CR 개수 → 다수결. 둘 이상 섞였으면 mixedEol
          내부 표현 LF로 정규화. 원래 EOL은 메타
          hash(디코드 전 바이트), stat(mtime, mode, readonly)
          watcher 구독
          ← Ok { path, text, encoding, bom, eol, mixedEol, confidence, hash, mtime, readonly, largeFile }
renderer  확장자 → 언어 → EditorState 생성 (history, 언어별 설정 적용)
          버퍼 등록 { id, path, meta, state, savedDoc: state.doc, dirty: false }
          이미 열린 경로면 해당 탭 포커스, 아니면 활성 pane에 탭 추가
```

- 경로 표시·탭 제목·인덱스·퍼지 매칭은 NFC 정규화, fs 호출은 원본 경로.
- 인덴트 감지(tab/space, 폭)를 열 때 수행해 버퍼별 설정으로 둔다. 상태바에 표시.

### 4.3 편집과 dirty store

- 모든 편집은 CM6 트랜잭션. `updateListener`에서 `dirty = !state.doc.eq(savedDoc)`. undo로 저장 시점에 돌아오면 dirty가 자동 해제된다.
- **dirty store**: 마지막 변경 후 1초 디바운스, 최대 5초마다 `userData/dirty/<windowId>/<bufferId>.json`에 `{ path | untitledId, text, selection }`을 원자적으로 쓴다. dirty 버퍼만. 저장이나 닫기 시 삭제. **크래시 시 손실은 최대 1초.**
- 붙여넣기·치환은 별도 undo 그룹, 연속 타이핑은 CM6 기본 그룹핑(`newGroupDelay`).

### 4.4 저장

```
renderer  fs.save({ bufferId, path, text, encoding, bom, eol, expectedHash, mode?: 'normal' | 'overwrite' })
main      ① 충돌 검사 (mode == 'normal'일 때): 현재 파일 hash ≠ expectedHash → Err Conflict { diskHash }
          ② 인코딩: LF → 원래 EOL (mixedEol이면 다수결 EOL로 통일), iconv-lite 인코드, BOM 복원
             무손실 검증: 인코드 → 디코드 → 원문 비교. 불일치 → Err EncodingLossy { positions }
          ③ 원자적 쓰기:
             realpath 해석 (symlink면 대상에 쓴다. 링크가 일반 파일로 바뀌는 것 방지)
             같은 디렉토리에 .<name>.<rand>.tmp 쓰기 → fsync
             원본 mode 복사
             rename으로 덮어쓰기
             Windows에서 EPERM/EBUSY → 50ms × 3 재시도 → 실패 시 tmp 보존 + Err Io
          ④ watcher에 예상 쓰기 등록 { path, mtime, hash } → 다음 일치 이벤트 무시
          ← Ok { mtime, hash }
renderer  savedDoc = state.doc, meta 갱신, dirty = false, dirty store 삭제
```

- `Conflict` → 배너(§4.5). "덮어쓰기"를 고르면 `mode: 'overwrite'`로 재요청.
- `EncodingLossy` → "UTF-8로 저장할까요?" 프롬프트. 수락 시 encoding을 utf8로 바꿔 재요청.
- 후행 공백 제거 / 마지막 줄바꿈 보장은 설정. **저장 직전 트랜잭션으로 적용**해 보이고 undo 된다.
- 자동 저장: 기본 OFF. `files.autoSave: 'off' | 'afterDelay'`.
- Save As: 새 경로로 저장 후 watcher 재구독, 언어 재감지, 탭 제목 갱신.

### 4.5 외부 변경

```
main      watcher 이벤트 → 경로별 100ms 디바운스 (에이전트는 한 파일을 여러 번 쓴다)
          stat + hash
          예상 쓰기와 일치 → 버림
          아니면 fs.changed { path, hash, mtime } 또는 fs.deleted { path } push
renderer  버퍼가 clean:
            무음 리로드. 새 텍스트를 fetch → @codemirror/merge diff → ChangeSet → 단일 트랜잭션
            커서·스크롤은 변경 매핑으로 유지. annotation: external. undo 가능
          버퍼가 dirty:
            비모달 배너 "디스크에서 변경됨   [디스크 버전 로드] [내 것 유지] [diff]"
            편집은 계속 가능
            diff = @codemirror/merge 나란히 뷰를 새 탭으로
            디스크 버전 로드 = 위 무음 리로드와 동일 (내 편집은 undo로 복구 가능)
            내 것 유지 = expectedHash를 diskHash로 갱신. 다음 저장은 그대로 진행
          deleted:
            배너 "디스크에서 삭제됨". 버퍼 유지. 저장하면 재생성
```

에이전트가 열려 있는 clean 파일을 고치면 커서는 그대로, 내용만 바뀐다. dirty 파일을 고치면 배너가 뜬다. 어느 경우에도 데이터를 잃지 않는다.

### 4.6 세션 / Hot exit

**스냅샷 스키마**

```
Session   = { version, cleanExit, windows: WindowSnap[] }
WindowSnap= { bounds, projectRoot, sidebar: { expanded: string[] }, layout: PaneTreeSnap, activePane }
PaneSnap  = { tabs: TabSnap[], activeTab }
TabSnap   = buffer { path | untitledId, encoding, bom, eol, hash, selection, scrollTop, history? }
          | preview { bufferRef }
          | terminal { cwd }
          | search { query }
history   = state.toJSON({ history: historyField }) 결과. 깊이 cap (설정, 기본 200 이벤트)
dirty 텍스트는 dirty store에 별도 (크기 때문)
```

**저장 시점**: 종료 시(창 닫기 전 블로킹) · dirty store 틱마다 레이아웃·메타(가벼움) · 창 이동/리사이즈(디바운스 500ms).
**위치**: `userData/session.json`. 원자적 쓰기.

**복원 규칙**

| 저장 당시 | 현재 디스크 | 처리 |
|---|---|---|
| clean | hash 일치 | 디스크 로드 + history 복원 |
| clean | 바뀜 | 디스크 로드, history 폐기(옛 문서 기준이라 무효) |
| dirty | 그대로 | dirty store 텍스트 복원 + history |
| dirty | 바뀜 | dirty 텍스트 복원 + 충돌 배너 |
| 어느 쪽 | 파일 없음 | 탭은 열고 "삭제됨" 배너, dirty면 텍스트 복원 |
| untitled | — | dirty store에서 복원 |
| terminal | — | cwd만 복원, 프로세스 재시작 |

- `cleanExit == false`(크래시)여도 같은 경로. dirty store가 진실.
- Hot exit: 종료 시 "저장할까요?"를 묻지 않는다. `files.hotExit`(기본 true). false면 dirty 버퍼가 있을 때 모달 확인.
- 다중 창: 창 = 프로젝트 루트 1개. 세션은 `windows[]`. 창을 닫으면 그 창 스냅샷은 세션에서 제거된다.

### 4.7 IPC 채널 (요약)

```
fs.open(path)                          → Result<OpenedFile, OpenError>
fs.save(SaveRequest)                   → Result<SavedMeta, SaveError>   SaveError = Conflict | EncodingLossy | ReadOnly | Io
fs.reinterpret(path, encoding)         → Result<OpenedFile, OpenError>
fs.watch(path) / fs.unwatch(path)      → Result<void, Io>
fs.changed / fs.deleted                ← push
fs.tree(dir) / fs.create / fs.rename / fs.delete  → Result<…, Io>    (사이드바)
dirty.write(bufferId, payload) / dirty.clear(bufferId)
session.save(partial) / session.load() → Result<Session | null, Io>
index.query(text, limit)               → Result<Match[], never>        (worker)
search.run(query) / search.cancel(id)  ; search.batch ← push ; search.done ← push
search.replace(plan)                   → Result<ReplaceReport, Io>
search.undoLast()                      → Result<ReplaceReport, Io>
pty.spawn(opts) / pty.write / pty.resize / pty.kill / pty.ack(bytes)
pty.data / pty.exit                    ← push
log.write(level, msg, meta)
```

모든 채널은 zod 요청/응답 스키마를 가진다. 핸들러 래퍼가 예외를 `Err { kind: 'unexpected', message }`로 바꾸고 로그한다.

## 5. 기능 상세

### 5.1 한글

**IME (CM6)**

- CM6가 조합을 처리한다. 우리 규칙: 모든 커스텀 decoration 플러그인은 `view.composing` 중 갱신을 보류하고, 인라인 `decoration.replace`를 쓰지 않는다.
- 멀티커서 + 조합: 조합은 주 커서에서 진행되고 `compositionend`에 나머지 커서로 복제된다. M0에서 실측한다. 깨지면 조합 시작 시 다중 선택을 주 커서로 축소하고 종료 후 복원하는 폴백을 적용한다.
- M0 검증 매트릭스: macOS 2벌식 · Windows MS IME · 구름 입력기. 각각 조합 중 ESC / Enter / 화살표 / 붙여넣기 / Cmd+Z / Cmd+D / 하이라이팅 ON `.ts` 문자열 안 / 마크다운 안.

**폭·커서·열**

- 렌더링 폭은 브라우저가 DOM을 실측하므로 2칸 문자 문제가 없다.
- 상태바 열 번호는 **grapheme 개수**(`Intl.Segmenter`). UTF-16 코드 유닛이 아니다.
- 커서 이동은 CM6 `findClusterBreak` 기반으로 grapheme 단위. NFD 자소 분리 텍스트도 한 글자로 움직인다.
- 단어 경계: CM6 기본 카테고리(`\p{Alphabetic}`)가 한글을 포함하므로 어절 단위로 점프하고 Cmd+D는 어절을 잡는다.
- 줄바꿈: CSS의 UAX#14 처리를 그대로 쓴다. 설정 `editor.wordBreak: 'normal' | 'keep-all'`.
- 폰트: `editor.font.family`는 리스트. 글리프별 폴백은 브라우저가 한다. 기본 `"D2Coding", "Sarasa Mono K", ui-monospace, monospace`. 한글 폰트의 폭이 정확히 라틴 폭의 2배가 아니면 정렬이 어긋난다는 점을 문서와 설정 설명에 명시한다.

**인코딩**

- 감지 순서: BOM → chardet → **CP949 휴리스틱** → utf8 폴백. 휴리스틱: 고비트 바이트가 있고 UTF-8 디코드가 실패하며 CP949로 디코드한 결과에서 완성형 한글 음절 비율이 임계(기본 30%) 이상이면 CP949. chardet가 CP949/EUC-KR을 다른 인코딩으로 오판하는 경우를 보정한다.
- 확신이 낮으면 상태바에 `UTF-8?`처럼 물음표를 붙인다. 자동으로 CP949를 고르는 것은 휴리스틱 확신이 높을 때만.
- 상태바 인코딩·EOL 클릭 → 재해석 메뉴(UTF-8, UTF-8 BOM, CP949, UTF-16LE, UTF-16BE, Shift_JIS, GB18030, Latin-1) + "이 인코딩으로 저장" + EOL 변경.
- **파일 내용은 절대 자동 정규화하지 않는다.** NFC/NFD 변환은 명시적 커맨드만.
- 파일명: macOS는 NFD를 돌려준다. 표시·탭·인덱스·퍼지 매칭은 NFC로 정규화하고 fs 호출은 원본을 쓴다.
- 알려진 한계: 검색에서 NFC 쿼리와 NFD 본문은 매칭되지 않는다(ST3도 동일). 정규화 커맨드로 대응. 부록 A.

**터미널·프리뷰**

- xterm.js `unicode11` addon 필수. 없으면 한글이 1칸으로 취급된다.
- 프리뷰는 `lang="ko"`와 `word-break: keep-all`.

### 5.2 Find / Replace

**버퍼 내** — `@codemirror/search`의 `SearchQuery`/커서/치환 로직을 쓰고 패널 UI는 Solid로 만든다(`search({ createPanel })`).

- 하단 패널, ST3 배치. 토글: 정규식 · 대소문자 · 단어 단위 · 선택 영역 내 · 순환 · 대소문자 보존.
- 즉시 검색. 매치 카운트 `3 / 27`. 뷰포트 안 매치 전체 하이라이트, 현재 매치는 구분색. 1MB 초과 문서는 50ms 디바운스.
- `Enter` 다음 · `Shift+Enter` 이전 · **`Alt+Enter` 모든 매치 선택 → 멀티커서**.
- 정규식은 JS `RegExp` + `u` 플래그. lookbehind·역참조·명명 그룹을 지원한다. 치환 문자열은 `$1`, `$<name>`, `\n`, `\t`. 컴파일 에러는 인라인 빨간 표시, 검색 중단.
- 선택 영역 내: 시작 시 선택 범위를 RangeSet으로 보관하고 변경에 매핑한다. 결과는 그 범위로 필터.
- 대소문자 보존: 매치가 전부 대문자/전부 소문자/첫 글자 대문자 패턴이면 치환 텍스트에 같은 패턴을 적용.
- 최근 쿼리 20개를 세션에 보존.

**멀티커서 커맨드**

| 동작 | 기본 키(mac) | 구현 |
|---|---|---|
| 다음 항목 추가 | Cmd+D | `selectNextOccurrence` (내장) |
| 모든 항목 선택 | Ctrl+Cmd+G | `selectSelectionMatches` (내장) |
| 선택을 줄로 분할 | Cmd+Shift+L | 자작: 각 범위 안 각 줄 끝에 커서 |
| 위/아래 커서 추가 | Ctrl+Shift+↑/↓ | 자작 |
| 항목 건너뛰기 | Cmd+K, Cmd+D | 자작: 마지막 추가 범위 제거 후 다음 항목 |
| 선택 되돌리기 | Cmd+U | `undoSelection` (내장) |
| 사각 선택 | Alt+드래그 | `rectangularSelection` + `crosshairCursor` (내장) |
| 단일 커서로 | Esc | 내장 |

**프로젝트 전역**

- 결과는 `search` 종류 탭. 다른 탭처럼 분할·이동 가능.
- 흐름: renderer가 `{ pattern, regex, case, word, include, exclude, roots }`를 보냄 → main이 `rg --json`을 해당 플래그로 실행(gitignore 존중, `--max-filesize` 설정) → 50ms 배치로 매치 push → 트리(파일 → 매치, 줄 미리보기) 점진 렌더 + 카운트. 새 쿼리는 이전 프로세스를 kill.
- **dirty 버퍼 보정**: rg는 디스크만 읽는다. 열린 dirty 버퍼는 renderer가 같은 쿼리를 버퍼 텍스트에 재실행해 그 파일의 결과를 교체한다. 보이는 것과 결과가 일치한다.
- 매치 클릭 → 버퍼를 열고 범위 선택. 미리보기 탭 방식으로 훑기 가능.
- **치환**: replace 필드에 입력하면 각 매치가 `old → new`로 미리보기된다(renderer에서 같은 정규식으로 계산). 매치/파일 단위 체크 해제로 제외. "전부 치환":
  - 닫힌 파일: main이 읽기 → **검색 시점 hash 검증**(다르면 건너뛰고 보고) → 매치 줄에 정규식을 재실행해 치환(저장된 오프셋을 믿지 않음) → 원자적 쓰기. 파일별 pre-image(원본 바이트)를 보관.
  - 열린 버퍼(clean/dirty 모두): renderer가 CM6 트랜잭션으로 적용하고 **저장하지 않는다**(ST3와 동일). 버퍼의 undo로 되돌린다.
  - **전역 undo**: "Undo Replace in Files" 커맨드. main이 최근 5회 작업의 pre-image를 보관하고, 현재 hash가 치환 직후 hash와 같은 파일만 복원한다. 결과 보고.
- 한계: rg는 CP949를 읽지 못한다. 설정 `search.encoding`이 지정되면 `-E`로 전달. 기본은 auto(UTF-8, UTF-16 BOM).

### 5.3 Goto Anything / 커맨드 팔레트

- `Cmd+P` 오버레이. ST3 문법: `파일` · `@심볼` · `:줄` · `:줄:열` · `#텍스트` · 조합 `파일@심볼`, `파일:줄`.
- 인덱스: main이 projectRoot에서 `rg --files`(gitignore 존중, `.git` 제외)로 목록을 만든다. 표시 경로는 NFC. 루트 watcher로 증분 갱신. 20만 파일 초과 시 경고하고 인덱스를 잘라 낸다.
- 매칭: fzf 알고리즘, main worker thread. 상위 50 + 매치 위치(하이라이트용). 응답 예산 < 30ms.
- 랭킹: 빈 쿼리는 MRU 순. 열린 탭 가중. 파일명 매치가 경로 매치보다 우선.
- **일시 미리보기 탭**: 화살표로 항목을 훑으면 파일이 `previewTab`에 열린다. Enter 또는 편집으로 확정. 그 외에는 다음 항목이 대체.
- `@심볼`: Lezer 구문 트리를 순회한다. 언어별 정의 노드 이름 맵(예: TS `FunctionDeclaration`, `ClassDeclaration`, `VariableDefinition`, `MethodDeclaration`; 마크다운은 헤딩). 맵이 없는 언어는 빈 결과.
- `#텍스트`: 현재 버퍼의 단어 단위 퍼지 검색.
- **커맨드 팔레트 `Cmd+Shift+P`**: 같은 오버레이. 레지스트리를 `when`으로 필터, 제목 퍼지 매칭, 바인딩된 키 표시. "Set Syntax: X", "Reinterpret as: X", "EOL: X", "Indent: X"는 동적 생성 커맨드.

### 5.4 마크다운

**편집** — `@codemirror/lang-markdown` + GFM 확장.

- 내장: 리스트/인용 자동 이어쓰기(`insertNewlineContinueMarkup`), 마크업 역삭제(`deleteMarkupBackward`).
- 자작 커맨드: 체크박스 토글 · 굵게/기울임/코드 감싸기 토글(Cmd+B / Cmd+I / Cmd+`) · **URL 붙여넣기 시 선택이 있으면 `[선택](url)`로 감싸기**(설정으로 끔) · 표 정렬(`string-width`로 한글 2칸 계산) · 헤딩 레벨 ±1 · 순서 리스트 재번호.
- 헤딩 기반 폴딩(Lezer foldService).
- `.md`는 워드랩 기본 ON(언어별 설정).

**프리뷰** — `preview` 종류 탭, 특정 버퍼에 바인딩.

```
소스 → markdown-it (GFM: 표·취소선·체크박스, 플러그인: 각주·헤딩 anchor·data-line 주입)
     → DOMPurify (script/handler 제거, data-line 허용, img src는 app-file:// 또는 허용 시 https:)
     → morphdom 패치 (스크롤 유지, 리플로우 최소)
```

- 문서 변경 후 150ms 디바운스, 전체 재렌더. 1만 줄 마크다운도 50ms 이내.
- 로컬 이미지 `./img.png` → 버퍼 경로 기준으로 해석 → `app-file://` URL로 재작성. main은 projectRoot 하위만 서빙.
- 외부 이미지: `preview.allowRemoteImages` 기본 false. false면 플레이스홀더.
- **스크롤 동기화 양방향**: 에디터 상단 가시 줄 ↔ 가장 가까운 `[data-line]`. 한쪽이 스크롤 중이면 가드 플래그로 반대편 이벤트를 무시.
- 테마는 앱 테마 연동. `lang="ko"`, `keep-all`.
- KaTeX: `markdown.katex` 플래그(기본 off). mermaid는 비목표.
- 내보내기: HTML 복사 · HTML 파일 · PDF(`webContents.printToPDF`).
- `Cmd+Shift+V`: 활성 마크다운 버퍼의 프리뷰를 오른쪽 분할에 토글.

### 5.5 터미널

**main `pty`**

- 셸: macOS는 `$SHELL`; Windows는 `pwsh` → `powershell` → `cmd` 순으로 탐색. 설정 `terminal.shell`로 오버라이드.
- env: 앱 시작 시 로그인 셸 env를 1회 해석(`shell-env`)하여 macOS GUI 앱의 PATH 문제를 해결한다(`claude`, `codex`가 찾힌다). 추가로 `TERM=xterm-256color`, `COLORTERM=truecolor`, `LANG`/`LC_ALL`은 UTF-8 로케일 보장.
- cwd: projectRoot. 설정 `terminal.cwd: 'project' | 'activeFile'`.
- Windows: ConPTY, UTF-8.
- **흐름 제어**: renderer가 소비한 바이트를 `pty.ack`로 보고. 미확인 바이트가 임계(기본 1MB)를 넘으면 pty를 pause, 내려오면 resume. 5초 이상 정체면 강제 resume. Claude Code의 잦은 리드로우로 UI가 밀리는 것을 막는다.
- 종료: 자식 프로세스가 살아있는 탭을 닫으면 모달 확인. 셸이 종료되면 탭에 `[exited code]`와 재시작 버튼.

**renderer `terminal`**

- xterm.js + `webgl`(컨텍스트 손실 시 canvas 폴백) · `fit` · `unicode11` · `web-links` · `search`(터미널 안 Cmd+F).
- 테마·폰트는 에디터와 공유, `terminal.font.*`로 오버라이드.
- 키: `terminalFocus`일 때 예약 키 외 전부 터미널로. 기본 예약: `Cmd+P`, `Cmd+Shift+P`, `Cmd+1~9`, `Cmd+\`(분할), `Cmd+N`, `Cmd+Shift+V`. 설정 `terminal.reservedKeys`. `Cmd+W`는 프로세스가 살아있으면 확인.
- 복사/붙여넣기: macOS `Cmd+C`는 선택이 있으면 복사, 없으면 `^C` 전송. Windows는 `Ctrl+Shift+C/V`, `Ctrl+C`는 선택이 있으면 복사.
- 한글: preedit 표시는 xterm의 조합 헬퍼가 하고, 확정 텍스트만 pty로 보낸다. TUI 앱은 완성된 한글을 받는다.
- **파일 경로 링크**: `path/to/file.ts:12:3` 패턴을 커스텀 링크 제공자로 인식 → 클릭 시 버퍼를 열고 줄·열로 이동. 상대 경로는 터미널 cwd 기준.

**에디터 → 터미널**

- 커맨드: 선택 텍스트 전송 · 활성 파일 경로 전송 · **`@경로` 전송**(Claude Code 파일 참조 문법) · 사이드바에서 터미널로 드래그 → 경로. 전송하는 경로는 셸 인용 처리.

### 5.6 설정·키맵·테마

- 설정 파일: `userData/settings.json`(JSONC, 주석 허용). zod 스키마 검증. 잘못된 파일은 마지막 정상 설정을 유지하고 토스트로 경로·오류를 알린다. watcher로 핫리로드 → CM6 `Compartment` 재구성.
- 언어별 오버라이드: `"[markdown]": { "editor.wordWrap": true }` 형식.
- 주요 키: `editor.font.*`, `editor.tabSize`, `editor.insertSpaces`, `editor.detectIndent`, `editor.wordWrap`, `editor.wordBreak`, `editor.rulers`, `editor.highlightWhitespace`, `files.autoSave`, `files.hotExit`, `files.trimTrailingWhitespace`, `files.insertFinalNewline`, `files.defaultEncoding`, `search.encoding`, `preview.*`, `terminal.*`, `theme`.
- 키맵: `userData/keymap.json` 배열 `{ keys, command, when?, args? }`. 기본 키맵은 앱에 번들(ST3 기본, 플랫폼별)되고 사용자 파일이 덧씌운다. `mod`는 macOS `cmd`, Windows `ctrl`. 코드(`cmd+k cmd+d`) 지원. "Keymap: Show Conflicts" 커맨드.
- 테마: JSON 토큰 맵 → CSS 변수 + CM6 `HighlightStyle` + xterm 팔레트. 번들: ST3 Mariana 계열 다크 1개, 라이트 1개. 사용자 테마 파일 추가 가능.
- 인덴트 감지: 열 때 tab/space와 폭을 감지해 버퍼별로 적용. 상태바 표시·클릭 변경.

## 6. 에러 처리

### 6.1 원칙

- IPC 경계는 `Result<T, E>`만 넘는다. `E`는 `kind` 태그 유니온. 핸들러 래퍼가 예외를 `{ kind: 'unexpected', message }`로 바꾸고 로그한다.
- renderer는 `R.match`로 분기하고, 에러는 세 가지 표면 중 하나로만 드러낸다.

| 표면 | 용도 | 예 |
|---|---|---|
| 배너 (에디터 상단, 비모달) | 파일 단위 상태 | Conflict · Deleted · EncodingLossy · ReadOnly · 인코딩 확신 낮음 |
| 토스트 (상태바 위, 자동 소멸) | 일시적·시스템 | watcher 실패 · rg 없음 · pty spawn 실패 · 설정 파싱 오류 · 세션 파일 손상 |
| 모달 | 파괴적 확인만 | 살아있는 프로세스가 있는 터미널 탭 닫기 · hotExit OFF일 때 dirty 종료 |

- 그 외 모달은 없다. 조용히 삼키는 에러도 없다. 전부 로그.

### 6.2 구체 상황

| 상황 | 처리 |
|---|---|
| main 크래시 | `uncaughtException` → 로그 → `cleanExit=false` 유지 → 다이얼로그 + 재시작 옵션. dirty store가 복원 원천 |
| renderer 크래시 (`render-process-gone`) | main이 창을 리로드 → 세션 + dirty store 복원. 손실 ≤ 1초 |
| watcher 실패 (Windows 버퍼 오버플로 등) | 열린 버퍼만 2초 폴링으로 강등. 토스트 1회 |
| 저장 Io (디스크 풀, EACCES, rename 실패) | 에러 + tmp 보존 + "다른 이름으로 저장" 제안 |
| 인코딩 확신 낮음 | 상태바 `UTF-8?`. CP949 자동 선택은 휴리스틱 확신이 높을 때만 |
| 세션 파일 손상 | `session.corrupt.<timestamp>.json`으로 백업, 새 세션 시작, 토스트. dirty store 파일은 개별 파싱, 손상분만 건너뛰고 보존 |
| 초장문 줄 (> 10k chars) | 해당 줄 하이라이팅 생략 |
| 20MB 초과 파일 | 하이라이팅 OFF로 열고 경고 |
| pty ENOENT | 토스트 "셸을 찾을 수 없음" + 설정 열기 링크 |
| rg 없음/실패 | 토스트, 전역 검색·인덱스 비활성 |
| 흐름 제어 정체 | 5초 타임아웃 후 강제 resume |
| 설정/키맵 파싱 오류 | 마지막 정상 상태 유지, 토스트에 파일·줄 |
| `app-file://` 경로 탈출 시도 | 403, 로그 |

### 6.3 로깅

- main: `userData/logs/main.log`, 로테이션(5MB × 3). renderer 로그는 `log.write` IPC로 전달.
- 레벨 설정 `log.level`. 커맨드 "Open Log Folder".

## 7. 테스트 전략

| 층 | 도구 | 대상 |
|---|---|---|
| 단위 | Vitest + fast-check | 인코딩 감지·CP949 휴리스틱(픽스처: UTF-8, BOM, CP949, UTF-16LE/BE, 혼합 EOL, 바이너리) · EOL 정규화/복원 왕복 · 원자적 쓰기(임시 디렉토리, rename 실패 주입, symlink, mode 보존) · 자기 쓰기 억제 상태 기계 · fzf 랭킹 · 세션 직렬화/복원 왕복(history 포함, 손상 파일) · 검색 dirty 병합 · 치환 hash 검증과 전역 undo · 대소문자 보존 치환 · 마크다운 파이프라인 스냅샷(sanitize 포함) · 경로 링크 정규식 · 키맵 파서/`when`/충돌 · 설정 스키마와 언어별 병합 · 한글 포함 표 정렬. 속성 테스트: 인코드→디코드 항등, EOL 왕복 항등, grapheme 열 단조 |
| CM6 확장 | Vitest, `EditorState`만 (DOM 없음) | 자작 커맨드 전부: 줄 분할, 커서 추가, 건너뛰기, 체크박스 토글, 링크 감싸기, 헤딩 ±, 표 정렬. 문서와 선택을 단언 |
| E2E | Playwright for Electron, 임시 userData + 픽스처 프로젝트 | 열기/편집/저장의 **바이트 왕복** · 외부 변경 clean(커서 유지)/dirty(배너) · 충돌 저장 · **hot exit: SIGKILL → 재실행 → dirty 텍스트·레이아웃 복원** · Goto Anything 파일/줄/심볼 · 전역 검색·치환·undo · 터미널 spawn과 echo · 경로 링크 클릭 · 프리뷰 렌더와 스크롤 동기화 · 다중 창 세션 |
| IME 자동화 | Playwright `CDPSession`: `Input.imeSetComposition`, `Input.insertText` | `ㅎ → 하 → 한` 조합을 단계별로 보내며 문서를 단언. 조건: 하이라이팅 ON `.ts` 문자열 안, 마크다운 안, 멀티커서, 조합 취소, 조합 중 붙여넣기. **에디터와 터미널 둘 다.** CDP 조합은 실제 IME와 동일하지 않으므로 회귀 가드로 쓰고, 실제 IME는 수동 체크리스트로 게이트한다 |
| 성능 예산 | E2E, 실패하는 테스트 | §1.5의 다섯 지표. 측정: 시작은 `app ready` → renderer 첫 CM6 페인트 마크; RSS는 main + 모든 renderer `getProcessMemoryInfo`; 타이핑 지연은 CDP 키 이벤트 → `requestAnimationFrame` 타이밍 p95; 5만 경로 합성 인덱스. CI 여유 ×2 |
| 수동 릴리스 체크리스트 | 사람 | 실제 IME 매트릭스(macOS 2벌식, Windows MS IME, 구름) · 권장 폰트 정렬 · Claude Code 10분 세션(파일 수정 포함) · 실제 레거시 CP949 파일 왕복 |

- CI: GitHub Actions `macos-latest` + `windows-latest`. 단위와 E2E는 PR마다. 패키징은 태그.
- TDD: 순수 모듈과 CM6 커맨드는 테스트 먼저. E2E는 마일스톤 수용 기준으로 추가한다.

## 8. 마일스톤

| M | 기간 | 이름 | 내용 | 수용 기준 |
|---|---|---|---|---|
| M0 | 1주 | 게이트 | 스켈레톤(electron-vite + Solid + CM6, 파일 하나 열고 저장) · IME 실측 매트릭스 · CDP IME 하네스 증명 · node-pty 양 OS spawn 증명 · 기준 RSS/시작 시간 측정 | **Go/No-go: 양 OS에서 하이라이팅 ON 상태로 한글 조합이 유실·중복·중단 없이 된다.** 실패 시 Monaco 스파이크 2일(사전 합의 폴백) 후 재결정 |
| M1 | 3~4주 | 메모장 대체 | §4.2~4.4 열기/저장 전체 · 탭 · 에디터 분할 · 핵심 언어(TS/JS/JSON/MD/Python/Rust/Go/HTML/CSS/YAML/Shell/SQL) + legacy 폴백 · ST3 기본 키맵 · 커맨드 레지스트리 + 팔레트 · 상태바 · 다크/라이트 테마 · 설정 로드 + 핫리로드 · dirty store + 크래시 복원(단일 창) · 괄호 매칭/자동 닫기/인덴트/주석 토글(CM6 내장) · 로깅 | 픽스처 바이트 왕복 E2E 통과. 이 레포의 파일을 이 에디터로 편집한다 |
| M2 | 3~4주 | 한큐 | 터미널 탭(pty, xterm, 흐름 제어, 예약 키, 경로 링크, 전송, `@경로`) · watcher + 외부 변경 흐름(무음 리로드/배너/diff) · pane 모델 완성(모든 탭 종류) · 사이드바 트리(기본) · 다중 창 기본 | Claude Code를 안에서 실행하고 열린 파일을 수정시켜도 데이터 손실 없음. 에이전트 세션은 이 에디터로 시작 |
| M3 | 3~4주 | ST3 절반 | 세션/hot exit 완성(history, 다중 창) · Goto Anything 전부(파일/줄/심볼/텍스트/미리보기 탭/MRU) · 멀티커서 커맨드 세트 · 버퍼 find/replace 패널 완성 | SIGKILL 복원 E2E 통과. 이 레포에서 Cmd+P 응답 < 30ms |
| M4 | 3~4주 | 검색 | 전역 검색(rg 스트림, 트리, dirty 병합) · 전역 치환(미리보기, hash 검증, 열린 버퍼 트랜잭션, 전역 undo) · `search.encoding` | 치환 + undo E2E. 1만 파일 픽스처 |
| M5 | 3~4주 | 마크다운 | 편집 커맨드 · 프리뷰 파이프라인 · `app-file://` · 스크롤 동기화 · 내보내기 · KaTeX 플래그 | 프리뷰 스냅샷 테스트. 한글 포함 표 정렬 |
| M6 | 2~4주 | 전환 | 키맵 커스터마이징 + 충돌 보고 · 테마 2~3개 · 성능 예산 통과 · 인덴트 감지 · 후행 공백/마지막 줄바꿈 · 양 OS 패키징 · 실제 IME 체크리스트 · **ST3 제거** | 예산 전부 그린. 1주간 ST3를 열지 않음 |

- 합계 약 22주 명목. 파트타임 지연을 감안하면 6~8개월. M2 종료(약 2개월)부터 ST3와 병행하며 실사용한다.
- 각 마일스톤은 별도 구현 계획(writing-plans)으로 분해한다. M0 계획이 다음 문서다.

## 부록 A. 이후 욕망 (스펙 밖, 기록만)

- Claude Code IDE 통합 프로토콜(L2): 선택 영역 컨텍스트, 인에디터 diff. 비공식 프로토콜이라 깨질 위험.
- mermaid 렌더링(2MB+ 번들).
- git gutter(main에서 `git diff` → gutter 데코레이션. 저렴).
- 미니맵.
- 스니펫(CM6 `snippet()`이 있어 저렴).
- Linux 빌드(Electron이라 거의 공짜, 미검증).
- 자동 업데이터.
- 검색의 NFC/NFD 정규화 매칭.
- 원격 이미지 기본 허용.
- 프리뷰 "활성 버퍼 따라가기" 모드.

## 부록 B. 결정 기록 요약

| 날짜 | 결정 | 이유 |
|---|---|---|
| 2026-09-08 | 목표 = 데일리 드라이버 | 사용자 선택 |
| 2026-09-08 | 텍스트 엔진 직접 구현 안 함 | 원글 저자가 멈춘 지점. 1순위(한글 IME)를 직접 구현하는 것은 목표와 충돌 |
| 2026-09-08 | Windows 지원 → macOS 네이티브 탈락 | 사용자 제약 |
| 2026-09-08 | fork/채택 배제 | 사용자 제약 |
| 2026-09-08 | Tauri → Electron | 시스템 웹뷰는 엔진이 둘이고 OS 업데이트에 IME가 인질. 번들 Chromium은 버전 고정 가능 |
| 2026-09-08 | CM6 (Monaco는 M0 폴백) | 스타일링 자유도. 사용자 선택 |
| 2026-09-08 | Solid.js | 셸 UI 고빈도 갱신에 VDOM 비용 없음 |
| 2026-09-08 | 터미널 탭을 비목표에서 M2로 | 정체성이 "ST3 + 에이전트 터미널"로 바뀜. VSCode 확장의 L2 방식이 아니라 TUI 그대로 |
| 2026-09-08 | pane = 탭 그룹, 탭 = 아무 종류 | 에디터 분할·프리뷰·터미널·검색 결과가 모두 같은 레이아웃 시스템을 쓴다 |
