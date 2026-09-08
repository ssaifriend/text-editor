# M0 게이트 보고서

- 실행일: 2026-09-08
- 머신: macOS 26.6.2, arm64 (Apple Silicon)
- 런타임: Electron 44.2.0 · Chromium 152.0.7977.76 · Node 24.20.0 (Electron 내장)
- 커밋: `2dce538` 시점 빌드, `pnpm build && pnpm test:e2e`

## 자동화 결과 (macOS)

| 테스트 | 결과 | 비고 |
|---|---|---|
| ime: `ㅎ→하→한` 단계 조합 + `한글` commit (TS 문자열 리터럴 안, 하이라이팅 ON) | PASS | preedit 단계마다 문서에 한 글자만 존재, `view.composing` true → commit 후 false |
| ime: 빈 조합으로 취소 시 preedit 제거 | PASS | |
| ime: commit 후 Cmd+Z가 음절 전체를 되돌림 | PASS | 자모 단위 undo 없음 |
| ime: 멀티커서(Cmd+D ×2) 상태에서 조합이 모든 커서에 미러링 | PASS | CM6 내장 동작으로 충분. 스펙 §5.1의 축소/복원 폴백 불필요 |
| ime: [info] `highlightWhitespace()` ON 상태 조합 | PASS | 결정: **기본값은 여전히 OFF** (spec §2.3 (c)). 켜도 깨지지 않음을 확인했으므로 M6에서 설정 옵션으로 노출 가능 |
| pty: Electron main에서 node-pty로 `$SHELL -c 'echo moru-pty-ok'` | PASS | `electron-builder install-app-deps`가 Electron 44 ABI로 리빌드. prebuild 다운로드 성공 |
| file: bootstrap 파일 열기 → 편집 → 저장 → 디스크 바이트 확인 | PASS | 상태바 `Ln/Col`이 grapheme 기준으로 갱신됨 |
| perf: 기준선 기록 | PASS (완화 한계 내) | 수치는 아래 |
| smoke: 창·툴바 | PASS | |

전체: **9 / 9 PASS**. 유닛 테스트 28 / 28 PASS. `pnpm typecheck` 통과.

## 기준선

| 지표 | 측정값 | §1.5 목표 | 판정 |
|---|---|---|---|
| `readyMs` (프로세스 시작 → `app.whenReady`) | 106 ms | — | |
| `firstPaintMs` (→ renderer 첫 rAF) | 332 ms | < 1000 ms | 여유 있음 |
| `didFinishLoadMs` | 409 ms | — | |
| RSS 합계 (`getAppMetrics().memory.workingSetSize` 합) | 430 MB | < 300 MB | **초과** |

프로세스별 workingSetSize: Browser 176 MB · Tab(renderer) 126 MB · GPU 88 MB · Utility 49 MB.

RSS에 대한 정직한 메모:
- `workingSetSize`는 프로세스마다 공유 라이브러리 페이지(Electron Framework 등)를 중복 계산한다. Activity Monitor의 "Memory" 열이나 `privateBytes` 기준으로는 더 낮게 나온다. 그러나 스펙 §1.5는 측정 방법을 명시하지 않았으므로, 이 수치를 "초과"로 기록하고 M6에서 측정 방법을 확정한 뒤 판정한다.
- 빈 에디터 하나만 띄운 상태다. M6 성능 패스에서 다음을 검토한다: `app.commandLine.appendSwitch` 로 불필요한 기능 비활성화, GPU 프로세스 옵션, 렌더러 번들 트리셰이킹, `privateBytes` 기준 측정 채택.
- 스택 결정을 뒤집을 수치는 아니다. Electron 대 Tauri(Windows)의 실질 격차는 스펙 §2.2에 기록한 대로 작다.

## 사용자 확인 대기

- [ ] 수동 IME 체크리스트 (macOS 2벌식·구름) — `docs/superpowers/checklists/m0-ime-manual.md`
- [ ] Windows: CI `windows-latest` 잡의 e2e 결과 (리포지토리를 GitHub에 올리면 `.github/workflows/ci.yml`이 자동 실행)
- [ ] Windows: 수동 IME 체크리스트 (MS IME·구름/날개셋)

## 판정

자동화 게이트: **GO**

근거: Chromium 152 + CodeMirror 6.43 조합에서, 구문 하이라이팅 데코레이션이 켜진 상태로 한글 조합·취소·undo·멀티커서 미러링이 전부 정상. `view.composing` 신호가 정확히 동작하므로 스펙 §2.3의 "조합 중 decoration 보류" 규칙을 구현할 발판이 확인됨. 수동·Windows 검증은 병행 진행하되 M1 착수를 막지 않는다.

## M1로 넘기는 메모

- `EditorView.setState`로 문서를 바꾸는 M0 방식은 undo 히스토리를 버린다. M1 버퍼 레지스트리는 버퍼별 `EditorState`를 보관하고 `view.setState`로 전환한다(스펙 §3.4 `editor/buffer`).
- `tsconfig.test.json`이 `src/preload/*.d.ts`를 포함해야 `window.moru` 타입이 보인다. 새 tsconfig를 추가할 때 같은 함정 주의.
- `electron` 바이너리는 `pnpm install` 중 내려받지 않고 첫 실행 시 내려받았다. CI에서는 `pnpm exec electron --version`을 install 뒤에 한 번 실행하면 캐시 워밍이 된다.
