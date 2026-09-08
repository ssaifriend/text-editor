# M2a 터미널 보고서

- 실행일: 2026-09-08
- 검증: `pnpm typecheck` 0 에러 · 유닛 167/167 · E2E 48/48 (macOS arm64, Electron 44.2.0, 숨김 창)
- 커밋: 1Password SSH 서명 오류 지속으로 보류 (M1c부터 누적). 작업 트리에 스테이징됨.

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| 흐름 제어 상태기계 (1MB pause / 256KB resume, 음수 방지) | unit 2 | PASS |
| 로그인 셸 env 해석 (`$SHELL -ilc 'env -0'`, TERM/COLORTERM/LANG 강제, 실패 폴백, Windows 우회) | unit 3 | PASS |
| pty IPC 계약 (spawn/write/resize/kill/isAlive/ack, data/exit push) | unit 1 | PASS |
| 경로 링크 파서 (상대·절대·Windows, :line:col, URL 제외) | unit 3 | PASS |
| `terminal.new` → 셸 탭, echo 출력, 탭 전환 후 버퍼 유지 | e2e | PASS |
| 예약 키만 앱으로 (Cmd+/는 셸로, Cmd+Shift+P는 팔레트) | e2e | PASS |
| 선택 영역 전송 · `@경로` 전송 (터미널 없으면 자동 생성) | e2e | PASS |
| 셸 종료 오버레이 `[exited 3]` + Restart | e2e | PASS |
| 살아있는 터미널 닫기 확인 | e2e | PASS |
| **터미널 안 한글 조합** (CDP `ㅎ→한` → `cat` 에코) | e2e [info] | PASS |
| M0·M1 회귀 | e2e 42 | PASS |

## 구현 중 발견한 것

1. xterm.js 캔버스가 종료 오버레이를 덮음 → 오버레이 `z-index`. Playwright 클릭 타임아웃으로 드러남.
2. URL 안의 경로(`https://example.com/x.ts`)가 파일 링크로 오탐 → 공백 단위 토큰에 `://`가 있으면 제외.
3. `Tab` 유니온 도입으로 `bufferId`를 가정한 코드가 EditorHost·Banner·StatusBar·TabStrip·testHooks·workspace(`tabForPath`, `viewShowing`, `bufferInPane`)에 흩어져 있었음. 전부 `kind` 분기로 정리. M2b의 preview/search 탭은 같은 패턴을 따르면 됨.
4. xterm `open()`은 1회만 가능 → 레지스트리가 DOM 요소를 보유하고 `TerminalHost`가 `replaceChildren`으로 재부착. 탭 이동에도 버퍼 유지.

## 결정

- 흐름 제어는 node-pty의 실험 기능 대신 자체 ack 기반 (renderer `term.write` 콜백 → `pty.ack`), 5초 정체 시 강제 resume.
- 터미널 포커스 중 허용 커맨드: `palette.*`, `tab.*`, `view.*`, `terminal.*`, `file.new`. 나머지 키는 전부 셸로.
- 터미널 cwd: 활성 버퍼 디렉토리, 없으면 홈. 프로젝트 루트는 M2b 사이드바와 함께.
- 터미널 탭은 세션에 저장하지 않음 (M3에서 cwd만 복원).

## 수동 확인 대기

- Claude Code / Codex를 터미널 탭에서 10분 실사용 (스펙 M2 수용 기준의 사람 확인 부분).
- macOS 실제 IME로 터미널 한글 입력.

## M2b로 넘기는 것

watcher + 외부 변경(diff 기반 무음 리로드 · dirty 배너 · 삭제) · 사이드바 파일 트리 · 프로젝트 루트 · 다중 창 기본 · `preview`/`search` 탭 종류 자리.
