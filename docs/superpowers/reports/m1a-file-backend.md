# M1a 파일 백엔드 보고서

- 실행일: 2026-09-08
- 커밋: `0fcb0c8`
- 검증: `pnpm typecheck` 0 에러 · 유닛 79/79 · E2E 15/15 (macOS arm64, Electron 44.2.0)

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| EOL 감지/정규화/복원 (+fast-check 속성 테스트) | unit 9 | PASS |
| 인코딩 감지 (BOM · 엄격 UTF-8 · CP949 휴리스틱 · chardet 폴백) | unit 8 | PASS |
| 무손실 인코딩 검증 (코드포인트 위치 보고) | unit 2 | PASS |
| 읽기 파이프라인 (hash · readonly · binary · largeFile · UTF-16) | unit 7 | PASS |
| 원자적 저장 (충돌 · overwrite · lossy · mode · symlink · tmp 정리) | unit 11 | PASS (Windows 전용 2건은 mac에서 skip 아님 — mac에서 실행, win에서 skip) |
| 설정 (JSONC · 스키마 · 언어별 병합 · 핫리로드 서비스) | unit 6 + smoke | PASS |
| dirty store (원자적 쓰기 · 손상 파일 격리) | unit 4 | PASS |
| IPC 계약 (invoke/send/push 허용목록 일치) | unit 8 + 4 | PASS |
| 로그 파일 생성 (`userData/logs/main.log`) | e2e | PASS |
| **바이트 왕복 e2e** — CP949+CRLF · UTF-8 BOM+CR · UTF-16LE BOM | e2e 3 | PASS |
| 편집 후 원 인코딩/EOL 유지 · 충돌 감지 · overwrite | e2e 2 | PASS |
| M0 회귀 (IME 5 · pty · perf · file · smoke) | e2e 9 | PASS |

## 구현 중 발견한 것

1. **chardet가 유효하지 않은 UTF-8을 'UTF-8'로 추측** — 4바이트 `caf\xE9`에서 재현. 그대로 두면 U+FFFD로 디코드 → 저장 시 데이터 손실. 규칙 추가: 디코드 결과에 U+FFFD가 생기는 인코딩은 절대 선택하지 않고 latin1 low로 폴백.
2. **UTF-16 파일이 바이너리로 오탐** — ASCII 코드 유닛(`0x20 0x00`)에 NUL이 있어서. E2E가 잡아냈고 유닛 테스트 추가. BOM 감지를 바이너리 판정보다 먼저 수행.
3. **zod 4 `.default({})`는 내부 기본값을 채우지 않음** (입력이 undefined면 파싱 없이 그대로 반환). 중첩 섹션은 `.prefault({})` 사용.
4. **ts-belt `R.Ok`는 NonNullable 요구** → void 응답은 `z.null()` 대신 `z.literal(true)`.

## 결정

- 알 수 없는 인코딩 → latin1 low. 바이트 보존이 최우선.
- `encodingLossy.positions`는 EOL 복원 후 텍스트의 코드포인트 인덱스. M1b 배너가 LF 문서 오프셋으로 환산할 때 CRLF면 선행 줄바꿈 수만큼 빼야 함.
- 임시 IPC 계약(`z.unknown()`)은 도입 태스크 안에서 곧바로 교체됨. 허용목록 일치 테스트가 누락을 막음.

## M1b로 넘기는 것

버퍼 레지스트리(버퍼별 EditorState, savedDoc 기반 dirty) · pane 트리 + 탭 · 커맨드 레지스트리 + `when` + 키맵(ST3 기본) · 커맨드 팔레트 · 상태바 클릭 메뉴(재해석 · EOL 변경 · 인덴트) · 배너(충돌/lossy/readonly) · 테마(다크/라이트) · 설정 → CM6 Compartment 반영 + 핫리로드 구독 · dirty store 디바운스 쓰기와 시작 시 복원 · 핵심 언어 추가(Python/Rust/Go/HTML/CSS/YAML/SQL/Shell) + legacy 폴백 · 여러 시작 경로를 탭으로 열기.
