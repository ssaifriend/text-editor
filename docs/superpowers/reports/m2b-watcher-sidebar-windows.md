# M2b watcher · 사이드바 · 다중 창 보고서

- 실행일: 2026-09-08
- 검증: `pnpm typecheck` 0 에러 · 유닛 175/175 · E2E 56/56 (macOS arm64, Electron 44.2.0, 숨김 창)
- 커밋: 1Password SSH 서명 오류 지속으로 보류 (M1c부터 누적). 작업 트리에 스테이징됨.

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| 예상 쓰기 레지스트리 (hash 일치 1회 소비, TTL) · 경로별 코얼레서 | unit 3 | PASS |
| watch IPC 계약 | unit 1 | PASS |
| **clean 버퍼 외부 수정 → diff 기반 무음 리로드**, 커서 유지, undo 가능 | e2e | PASS |
| dirty 버퍼 외부 수정 → 배너: Compare(MergeView 탭) · Keep Mine → 저장 덮어쓰기 → 이후 clean 리로드 | e2e | PASS |
| 삭제 → 배너 → Save로 재생성 | e2e | PASS |
| 자기 저장은 리로드/배너 없음 | e2e | PASS |
| 디렉토리 목록 (dir 우선, 대소문자 무시 정렬, .git/node_modules 제외) | unit 2 | PASS |
| 사이드바: 루트 표시 · 확장 · 파일 열기 · 토글 | e2e | PASS |
| 새 파일 · 이름 변경(열린 버퍼 경로 재지정) · 삭제(휴지통) | e2e | PASS |
| 터미널 cwd = 프로젝트 루트 | e2e | PASS |
| `window.new` → 두 번째 창, 터미널 격리, windowId 분리, 창 닫힘 | e2e | PASS |
| M0·M1·M2a 회귀 | e2e 44 | PASS |

## 구현 중 발견한 것

1. **macOS 임시 디렉토리 심링크** — `/var/folders/...`로 감시를 걸면 FSEvents는 `/private/var/...`로 보고한다. 감시 경로를 `realpath`로 정규화하고 원 경로로 되돌려 push. 실제 프로젝트 경로에서도 심링크가 있으면 같은 문제가 났을 것.
2. 외부 리로드 트랜잭션에 `externalChangeAnnotation`을 달아 updateListener가 dirty로 착각하지 않게 함. 리로드 뒤 `markSaved`로 hash 갱신.
3. `Tab`에 `diff` 종류 추가. `kind` 분기 6곳 모두 갱신 — M2a 보고서의 예측대로 패턴이 잡혀 있어 빠르게 끝남.
4. 다중 창에서 버퍼 id가 창마다 `b1..`부터 시작 → dirty store 항목 충돌. 항목 id를 `windowId:bufferId`로.
5. Playwright `toHaveText`는 셰브런 문자를 포함한 전체 텍스트를 비교 → `.tree-name`으로 좁힘.

## 결정

- 리로드 diff는 `@codemirror/merge`의 `diff()`. 문서가 수만 줄이어도 충분히 빠름(테스트 수준). 성능 예산은 M6에서 실측.
- 사이드바 삭제는 `shell.trashItem` (복구 가능). 이름 변경은 대상 존재 시 거부.
- 다중 창 세션(레이아웃 복원)은 M3. M2b는 창 생성·격리·정리까지.

## 수동 확인 대기

- **Claude Code를 터미널 탭에서 돌려 열린 파일을 수정시키기** (스펙 §8 M2 수용 기준). 자동 테스트는 외부 프로세스의 파일 쓰기로 대체 검증했음.

## M3로 넘기는 것

세션/hot exit 완성(레이아웃·history·다중 창) · Goto Anything(파일/줄/심볼/텍스트/미리보기 탭/MRU) · 멀티커서 자작 커맨드(줄 분할·커서 추가·건너뛰기) · 버퍼 find/replace 패널.
