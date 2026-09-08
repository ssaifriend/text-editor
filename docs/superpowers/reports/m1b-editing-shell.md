# M1b 편집 셸 보고서

- 실행일: 2026-09-08
- 커밋: `24bfffc`
- 검증: `pnpm typecheck` 0 에러 · 유닛 145/145 · E2E 29/29 (macOS arm64, Electron 44.2.0, 숨김 창)

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| 언어 레지스트리 (14 언어 + legacy shell, 확장자·파일명 맵) | unit 24 | PASS |
| 버퍼 모델 (dirty · markSaved · withLanguage 선택 유지) | unit 5 | PASS |
| pane 트리 (split 동방향 형제 삽입/타방향 중첩 · close 병합 · move · resize · sibling) | unit 14 | PASS |
| when 평가기 (우선순위 · 문자열 비교 · 오류 시 false) · 커맨드 레지스트리 · 에디터 커맨드 표 | unit 10 | PASS |
| 키 파싱 · `event.code` 해석 · 코드 · 충돌 검출 · ST3 기본 키맵 mac/win 무충돌 | unit 16 | PASS |
| 탭: 시작 경로 → 탭, 전환 시 텍스트·dirty·undo 유지, 닫기, Ctrl+Tab, file.new | e2e 3 | PASS |
| 분할: 오른쪽/아래, 새 pane 활성·빈 상태, 파일이 활성 pane에 열림, 단일화, pane 닫기 | e2e 2 | PASS |
| 키맵: Cmd+/ · Cmd+Shift+D · Ctrl+Shift+K · Cmd+L; 포커스 없을 때 무동작 | e2e 2 | PASS |
| 팔레트: Cmd+Shift+P · 퍼지("spl rgt") · Enter 실행 · Esc 후 에디터 포커스 복귀 · 에디터 전용 커맨드 노출 | e2e 3 | PASS |
| 닫기 확인: save / dontSave / cancel | e2e 3 | PASS |
| 메뉴 항목 → `command.run` push → 렌더러 실행 | e2e 1 | PASS |
| M0/M1a 회귀 (IME 5 · 왕복 5 · file · log · perf · pty · smoke) | e2e 15 | PASS |

## 구현 중 발견한 것

1. **Solid store의 병합 시맨틱** — `setState('tree', newSplit)`은 기존 객체에 필드를 병합(mergeStoreNode)한다. leaf 객체가 split로 변이되며 `children[0]`이 자기 자신을 가리켜 무한 재귀. pane 트리는 store 밖 일반 값으로 두고 버전 시그널로 반응성만 제공하도록 변경. 순수 함수가 프록시를 받지 않게 된 부수 효과도 있음.
2. **숨김 창에서 CM6 `focusChanged` 불안정** — `document.hasFocus()`에 의존. `editorFocus` 컨텍스트는 DOM `focusin/focusout`으로 추적.
3. CM6는 Enter를 별도 undo 그룹으로 취급 (ST3와 동일). 테스트 기대값 수정.
4. `deleteLine` 후 커서는 다음 줄 시작. 테스트가 잘못 가정.

## 결정

- 메뉴 accelerator는 `registerAccelerator: false` — 표시만 하고 키는 렌더러 키맵이 처리 (이중 실행 방지).
- 팔레트는 열릴 때 `registry.available()`을 스냅샷 → 에디터 전용 커맨드가 목록에 남고, 실행은 팔레트 닫고 에디터 포커스 복귀 후 `setTimeout`으로.
- `setWhitespace` 테스트 훅은 M1b에서 no-op (설정 연동은 M1c). `[info]` IME 테스트는 문서 단언만 하므로 유효.

## M1c로 넘기는 것

상태바 클릭 메뉴(재해석 · EOL · 인덴트 · Set Syntax) · 배너(충돌/lossy/readonly) · 테마 다크/라이트 · 설정 → Compartment(tabSize · wordWrap · lineNumbers · highlightWhitespace · font) + 핫리로드 구독 · dirty store 디바운스 쓰기 + 시작 시 복원 · 사용자 `keymap.json` 오버레이 + 충돌 보고 커맨드 · 탭 드래그 · Cmd+W로 마지막 탭 닫을 때 빈 pane 처리.
