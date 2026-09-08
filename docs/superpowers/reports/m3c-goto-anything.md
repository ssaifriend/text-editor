# M3c Goto Anything 보고서

- 실행일: 2026-09-08
- 검증: `pnpm typecheck` 0 에러 · 유닛 211/211 · E2E 69/69 (macOS arm64, Electron 44.2.0, 숨김 창)

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| main 인덱스: `rg --files`(gitignore/.git/node_modules 제외, NFC, 20만 cap) · fzf 매처(파일명 우선, 위치 반환) · 5만 경로 쿼리 예산(로컬 90ms / CI 300ms) · 루트 watcher create/delete → 디바운스 재빌드 → `index.changed` push | unit 5 | PASS |
| 쿼리 파싱: `파일` · `@심볼` · `:줄[:열]` · `#단어` · 조합 `파일@심볼` / `파일:줄` | unit 9 | PASS |
| 심볼 추출(Lezer): TS 함수/클래스/메서드/변수/타입/인터페이스/enum · Python · 마크다운 헤딩 · 단어 추출(2글자 한글 포함, 2글자 ASCII 제외) | unit 5 | PASS |
| Cmd+P: 파일 퍼지 → 최상위 항목 자동 미리보기(이탤릭 탭) → Esc로 미리보기 닫고 원래 탭 복귀 → Enter로 확정 | e2e | PASS |
| `wksp@gam`: 최상위 파일 미리보기 후 그 파일 심볼 목록 → Enter 시 확정 + 점프 · `readme:30` → 열고 30행 | e2e | PASS |
| Cmd+R `@` · Ctrl+G `:` · `#` 단어 — 활성 버퍼에서 즉시 점프 | e2e | PASS |
| 빈 쿼리 = MRU 순 (세션 `recentFiles`로 보존) | e2e | PASS |
| M0~M3b 회귀 | e2e 65 | PASS |

## 구현 중 발견한 것

1. **`fzf`는 ESM 전용**. electron-vite가 main 의존성을 externalize하면 `require('fzf')`가 빈 객체 → `index.build`가 "fzf.Fzf is not a constructor"로 조용히 실패. `externalizeDepsPlugin({ exclude: ['fzf'] })`로 main 번들에 포함.
2. `index.query`가 빌드 중에 오면 빈 결과가 났음. 서비스가 진행 중인 build promise를 기억하고 query가 그것을 await하도록 변경. 팔레트는 `index.changed` push에도 재조회.
3. Enter가 30ms 디바운스 + IPC보다 먼저 오면 이전 결과에 대해 실행됨. 팔레트가 미결 파일 조회/미리보기 promise를 추적하고 Enter 시 `settled()`를 기다림.
4. `tsconfig.test.json`이 `src/renderer/src/**/*.ts`를 포함하므로 `.ts`(testHooks)가 `.tsx`(Palette)를 import하면 JSX 설정 없는 프로젝트로 tsx가 끌려가 "children is missing" 류의 오류가 남. `PaletteMode`를 `ui/palette/mode.ts`로 분리.
5. 초기 텍스트(`@`, `:`, `#`)를 `select()`하면 첫 타이핑이 접두어를 덮어씀 → 캐럿을 끝에 둠.
6. 테스트 픽스처의 `Gamma` 오프셋은 48이 맞음(플랜의 47은 계산 오류).

## CI(첫 Windows/macOS 실행)에서 잡은 것

- Windows: `rg --files`가 `\` 구분자 출력 → 인덱스 rel 경로는 posix로 정규화. `join()` 기대값 · perf 예산(CI 300ms) · readonly 감지는 Windows에서도 동작하므로 테스트 기대값 `true`로 통일.
- macOS CI: 저장 충돌 배너가 뒤늦게 온 watcher 이벤트에 `external` 배너로 교체되어 "Reload from Disk" 클릭 실패. 이미 `conflict` 배너가 있으면 종류를 유지하고 diskHash만 갱신.
- Windows 기본 키맵에서 `ctrl+g`(Goto Line)와 `mod+g`(find.next) 충돌 → Windows는 ST 관례대로 `F3`/`Shift+F3`.

## 결정

- 미리보기 탭은 일반 buffer 탭 + `preview: true` 플래그. 세션 스냅샷에서 제외. 새 미리보기가 이전 것을 대체.
- `파일@심볼`은 파일 결과 대신 **미리보기된 파일의 심볼 목록**을 보여준다(ST3 동작).
- MRU 50개, 팔레트 표시 20개. `recentFiles`는 세션 파일에 optional.

## M4로 넘기는 것

전역 검색/치환 — `docs/superpowers/plans/2026-09-08-m4-global-search.md`.
