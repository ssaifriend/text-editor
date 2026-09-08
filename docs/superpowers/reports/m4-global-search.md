# M4 전역 검색/치환 보고서

- 실행일: 2026-09-08
- 검증: `pnpm typecheck` 0 에러 · 유닛 234/234 · E2E 72/72 (macOS arm64, Electron 44.2.0, 숨김 창)

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| 공유 매치/치환 시맨틱: 리터럴 이스케이프 · 단어 경계(유니코드) · `$1`/`$<name>`/`$$`/`\n` 확장 · 대소문자 보존 · 줄 단위 치환(UTF-16 오프셋, 제외 인덱스, 0폭 정규식) | unit 8 | PASS |
| `rg --json` 파서: 바이트 → UTF-16 오프셋 변환, 줄 끝 제거, end/summary, 깨진 입력 | unit 3 | PASS |
| rg argv: `-i`/`-F`/`-w`/`-E`/include·exclude glob/`--max-filesize`/`--no-require-git` | unit 2 | PASS |
| 검색 서비스: 스트리밍 배치 · 파일 수 · .gitignore · 정규식 오류 보고 · 10k cap(truncated) · cancel/재실행 · **1만 파일 픽스처 완료** | unit 4 | PASS |
| 닫힌 파일 치환: 지정 줄만 정규식 재실행 · CRLF/CP949 보존 · 제외 매치 · hash 불일치/없는 파일 건너뜀 · watcher 기대 쓰기 등록 · undo(hash 일치 파일만, 최근 5회) | unit 3 | PASS |
| renderer 상태: 경로별 그룹 · dirty 버퍼 결과 우선 · 파일/매치 제외 · 미리보기 · ReplacePlan · 버퍼 절대 오프셋 편집 | unit 3 | PASS |
| Cmd+Shift+F → 결과 트리 스트리밍 · dirty 버퍼 보정(`•`) · 매치 클릭 → 파일 열고 범위 선택 | e2e | PASS |
| Replace All: 열린 버퍼는 트랜잭션(저장 안 함, dirty) · 닫힌 파일은 원자적 쓰기 · 제외 매치 유지 · Undo Replace in Files로 디스크 복원 | e2e | PASS |
| 검색 탭이 세션에 쿼리와 함께 복원 | e2e | PASS |
| M0~M3c 회귀 | e2e 69 | PASS |

## 구현 중 발견한 것

1. rg의 submatch 오프셋은 **바이트** 단위. 한글이 있는 줄에서 UTF-16 오프셋으로 변환해야 CM6 선택과 맞음 (`Buffer.subarray(0, n).toString().length`).
2. rg는 git 저장소 밖에서는 `.gitignore`를 무시함 → `--no-require-git`으로 항상 존중.
3. `-F`(리터럴)에서는 정규식 오류가 나올 수 없고, 정규식 모드의 문법 오류는 exit 2 + stderr로 옴 → `search.done.error`.
4. Solid store 객체는 Proxy라서 IPC(structured clone)로 보낼 수 없음 — `unwrap()` 후 전송. 세션 스냅샷의 `spec`도 동일.
5. "검색 시점 hash"는 rg가 제공하지 않으므로 치환 계획을 만들기 직전 `fs.open`으로 읽어 기준 hash로 삼고 main이 다시 검증한다. 두 읽기 사이의 변경도 `hashMismatch`로 잡힘.

## 결정

- 창당 검색 탭 하나(재사용). 닫으면 실행 중 쿼리 cancel.
- 열린 버퍼(clean/dirty 모두)는 renderer가 CM6 트랜잭션으로 치환하고 저장하지 않음(ST3 동일). 되돌리기는 버퍼 undo.
- 전역 undo는 닫힌 파일에만 적용, 최근 5회, 현재 hash가 치환 직후 hash와 같을 때만.
- 매치 cap 10,000 → `10000+ (truncated)`. 트리 표시는 2,000행까지, 이후 "… N more".
- 배치 50ms, 기본 `--max-filesize 10M`, `search.encoding`(기본 auto)은 `-E`.

## M5로 넘기는 것

마크다운 편집/프리뷰 — `docs/superpowers/plans/2026-09-08-m5-markdown.md`.
