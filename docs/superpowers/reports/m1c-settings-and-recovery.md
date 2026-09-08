# M1c 설정·테마·상태바·배너·복원 보고서

- 실행일: 2026-09-08
- 검증: `pnpm typecheck` 0 에러 · 유닛 157/157 · E2E 42/42 (macOS arm64, Electron 44.2.0, 숨김 창)
- 커밋: 1Password SSH 서명 에이전트 오류(`failed to fill whole buffer`)로 M1c 커밋이 보류됨. 작업 트리에 전부 스테이징되어 있으며 서명이 복구되면 태스크 단위로 커밋한다.

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| 설정 → Compartment 재구성 (tabSize · indentUnit · wordWrap · lineNumbers · highlightWhitespace · 폰트 CSS 변수), 핫리로드, 언어별 오버라이드, undo 보존 | unit 2 + e2e 2 | PASS |
| 테마 moru-dark / moru-light (CSS 변수 + CM6 theme + HighlightStyle), 설정으로 전환 | e2e 1 | PASS |
| 저장 포맷 스냅샷: EOL/인코딩/BOM 변경이 dirty로 잡힘, 저장 시 반영 | unit 1 + e2e 1 | PASS |
| 상태바 메뉴: 인코딩 재해석 · 인코딩으로 저장 · EOL · Set Syntax · 인덴트(버퍼별) | e2e 4 | PASS |
| dirty 버퍼에서 재해석 거부 | e2e 1 | PASS |
| 배너: 충돌(Overwrite/Reload) · lossy(Save as UTF-8) · readonly | e2e 2 | PASS |
| dirty store 디바운스(1s/5s cap) · clean 시 정리 · flush | unit 5 | PASS |
| **SIGKILL 후 복원**: 편집 중 파일 + untitled 한글 텍스트, 시작 경로 중복 방지 | e2e 2 | PASS |
| 사용자 keymap.json 오버레이 + 핫리로드 + 충돌 보고 | unit 3 + e2e 2 | PASS |
| M0·M1a·M1b 회귀 | e2e 27 | PASS |

## 구현 중 발견한 것

1. **Solid store 병합 시맨틱 (두 번째)** — `setState('buffers', id, obj)`도 기존 객체에 병합하므로 객체 동일성이 유지되고, 변경된 필드만 알림이 간다. 상태바가 store 객체를 읽은 뒤 비반응 버퍼로 내려가 포맷을 읽어 갱신이 안 됐다. 규칙: **UI는 store의 스칼라 필드만 읽는다.** `BufferMeta`에 encoding/bom/eol/tabSize/insertSpaces를 투영.
2. **CM6 단일값 facet은 첫 값 우선** (`EditorState.tabSize`, `indentUnit`). 버퍼별 인덴트 오버라이드 compartment는 설정 compartment **앞**에 두어야 이긴다.
3. 이 CM6 버전은 `cm-light/cm-dark` 클래스를 붙이지 않음(생성 클래스명 사용). 테마 테스트는 배경색으로 단언.
4. Playwright `getByTestId`는 필터 옵션을 받지 않음 → `.filter({ hasText })`.
5. 사용자 바인딩이 기본 키를 덮어쓰는 것은 충돌이 아니다. 충돌 보고는 사용자 파일 내부 중복만 대상으로 한다.

## 결정

- 재해석은 dirty 버퍼에서 거부 (편집 폐기 방지). 상태 텍스트로 안내.
- 배너 "Reload from Disk"는 M1c에서는 문서 전체 교체(undo 히스토리 소실). M2 watcher 도입 시 `@codemirror/merge` diff 기반 무음 리로드로 교체 예정.
- 복원된 dirty 버퍼는 새 id로 다시 dirty store에 기록되고 옛 항목은 삭제. 복원 → 시작 경로 순서로 중복 탭 방지.
- 시작 시 열린 탭이 하나도 없을 때만 untitled 생성 (복원된 탭이 있으면 생성 안 함).

## M1 수용 기준 판정

- 픽스처 바이트 왕복 E2E: **통과** (M1a).
- "이 레포를 이걸로 편집한다": 편집·저장·탭·분할·키맵·팔레트·설정·테마·복원까지 갖춤. `pnpm dev` 또는 빌드 후 `electron out/main/index.js <파일>`로 사용 가능. 사이드바(M2)와 찾기(M3/M4)가 없어 아직 ST3 병행이 필요하지만, M1 정의("메모장 대체")는 충족.

## M2로 넘기는 것

터미널 탭(pty · xterm · 흐름 제어 · 예약 키 · 경로 링크 · 전송) · watcher + 외부 변경(무음 리로드 diff / 배너 / 삭제) · pane 모델의 나머지 탭 종류 · 사이드바 파일 트리 · 다중 창 기본. M1c에서 남긴 소소한 것: 탭 드래그, 마지막 탭 닫힌 빈 pane의 안내 문구, `highlightWhitespace` 토글 커맨드.
