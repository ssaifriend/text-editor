# M6 전환 보고서

- 실행일: 2026-09-08
- 검증: `pnpm typecheck` 0 에러 · 유닛 266/266 · E2E 80/80 (macOS arm64, Electron 44.2.0, 숨김 창) · 패키지 앱(`dist/mac-arm64/moru.app`) 스모크: 부팅 · 번들 rg 인덱스 · pty spawn PASS

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| 인덴트 감지: 탭/스페이스 · 2/4/기타 폭(들여쓰기 델타 최빈값) · 빈 줄 무시 · 탭 우세 | unit 5 · e2e | PASS |
| 저장 정규화: 후행 공백 제거 · 마지막 줄바꿈 · 빈 문서 무시 · 저장 후 버퍼=디스크, dirty false | unit 3 · e2e | PASS |
| 사용자 테마 `userData/themes/*.json`: zod 검증(id·hex) · 핫리로드 · 설정 `theme: "mine"` 즉시 적용 | unit 2 · e2e | PASS |
| **성능 예산(§1.5)** | e2e 4 · unit 1 | PASS — 아래 수치 |
| 패키징: `electron-builder.yml`(dmg/zip · nsis/zip, node-pty/ripgrep/watcher asarUnpack) · `pnpm package:dir` · 태그 `v*` 릴리스 워크플로우 | 수동 + 스모크 | PASS |
| M0~M5 회귀 | e2e 74 | PASS |

## 성능 예산 실측 (로컬 macOS arm64, 숨김 창; CI는 ×2 허용)

| 지표 | 목표 | 실측 | 비고 |
|---|---|---|---|
| 콜드 스타트 → 첫 페인트 | < 1000 ms | **~380–560 ms** (전: 1025) | 로그인 셸 env 해석(`resolveShellEnv`)이 창 생성을 막고 있었음 → 첫 pty spawn 때까지 지연 |
| 메모리: main + renderer private (`getProcessMemoryInfo`), 파일 10개, 터미널 없음 | < 300 MB | **154 MB** (main 55 + renderer 99) | workingSet 합은 386 MB — Electron 프레임워크 공유 페이지가 프로세스마다 중복 계산됨. JS 힙은 main 11 MB / renderer 17 MB |
| 키 입력 → 다음 프레임 p95 (5k줄 TS, 하이라이팅 ON) | < 16 ms | **9.7 ms** (max 14.3) | 숨김 창은 `backgroundThrottling`으로 rAF가 지연됨 → `MORU_HIDDEN`일 때 끔 |
| Goto Anything 5만 경로 | < 30 ms | **~15 ms** (전: 33) | fzf `fuzzy: 'v1'`. GitHub Windows 러너는 74 ms(v2: 134) → 이 유닛 테스트만 CI 허용 120 ms |
| 5만 줄 파일 열기 | < 500 ms | **25 ms** | `openFile` 왕복(IPC 읽기 + 상태 생성) |

수치 파일: `test-results/perf-{startup,memory,typing,openLarge}.json`, `test-results/perf-index.json`.

## 구현 중 발견한 것

1. 첫 페인트의 절반 이상이 `execFile(login shell)`이었다. pty 매니저가 env를 promise로 받아 첫 spawn에서 기다린다.
2. `workingSetSize` 합계는 Electron에서 항상 300 MB를 넘는다(프레임워크 공유 메모리 중복). 스펙이 지목한 `getProcessMemoryInfo`의 private 합이 실제 점유를 반영한다 — 예산 판정은 그것으로, workingSet도 함께 기록.
3. 숨김 창에서 rAF 기반 지연 측정은 스로틀링 때문에 한 프레임씩 밀린다(p95 17.5). 테스트 창만 스로틀링 해제 후 9.7 ms.
4. fzf v2(기본)는 5만 경로에서 33 ms, v1은 15 ms. 경로 매칭 품질 차이는 체감되지 않음.
5. electron-builder는 pnpm 10에서 다른 플랫폼의 optional 바이너리(ripgrep/watcher)를 번들하지 않는다 → 타깃 arch는 러너의 네이티브 arch만. x64 mac 빌드는 x64 러너에서.
6. 패키지 앱 크기 324 MB: renderer 전용 의존성(codemirror/solid/xterm…)도 node_modules로 복사됨. 번들에 이미 포함되어 있으므로 제외하면 절반 이하 — 후속 최적화.

## 결정

- `editor.detectIndent` 기본 true. 감지 실패(들여쓴 줄 2개 미만)는 설정값 유지.
- 저장 정규화는 저장 직전에 버퍼 트랜잭션으로 적용(ST3 동일). 커서는 CM6 매핑.
- 사용자 테마는 팔레트 18색만 받는다(번들 테마와 같은 빌더). 파일 오류는 `themes.changed.errors`로 전달(UI 표시는 후속).
- 릴리스는 태그 push → 양 OS 아티팩트 업로드. 코드 서명 없음(개인용).

## 사용자에게 남긴 것

`docs/superpowers/checklists/release-manual.md` — 실제 IME 매트릭스 · 폰트 · Claude Code 10분 세션 · CP949 왕복 · 1주 ST3 미사용 → 제거.
