# moru — 마일스톤 완료 상태 (2026-09-08)

스펙: `docs/superpowers/specs/2026-09-08-text-editor-design.md`. 모든 마일스톤의 플랜은 `docs/superpowers/plans/`, 보고서는 이 디렉터리.

| 마일스톤 | 내용 | 상태 | 보고서 |
|---|---|---|---|
| M0 | 스택 게이트: Electron+CM6 IME(CDP) · 성능 베이스라인 | 완료 | `m0-gate.md` |
| M1a/b/c | 파일 백엔드(바이트 왕복·CP949·EOL·원자적 쓰기) · 편집 셸(pane/tab/키맵/팔레트/메뉴) · 설정·테마·복구 | 완료 | `m1a-…`, `m1b-…`, `m1c-…` |
| M2a/b | 터미널 탭(node-pty, 흐름 제어, 링크, 한글) · watcher/사이드바/다중 창 | 완료 | `m2a-terminal.md`, `m2b-…` |
| M3a/b/c | 세션·hot exit·멀티커서 · 버퍼 find/replace · Goto Anything | 완료 | `m3a-…`, `m3b-…`, `m3c-goto-anything.md` |
| M4 | 전역 검색/치환 + 전역 undo | 완료 | `m4-global-search.md` |
| M5 | 마크다운 편집 · 프리뷰 · 내보내기 | 완료 | `m5-markdown.md` |
| M6 | 인덴트 감지 · 저장 정규화 · 사용자 테마 · 성능 예산 · 패키징 · 체크리스트 | 완료 | `m6-transition.md` |

## 최종 검증

- 로컬(macOS arm64): `pnpm check` = typecheck 0 에러 · 유닛 266/266 · E2E 80/80.
- CI(GitHub Actions, push마다 macOS + Windows): **양 OS 그린** (`c6f9376`, run 34222481908). Windows는 첫 실행 15개 실패 → `:` 파일명(dirty store)·watcher 경로 키·설정 핫리로드 폴링·CRLF 픽스처·플랫폼 키·결과 순서 의존 테스트를 고쳐 그린. GPU 없는 러너에서 타이핑 지연은 기록만 하고 단언하지 않음(`m6-transition.md`).
- 성능 예산 5개 전부 통과(수치는 `m6-transition.md`).

## 사용자 몫

1. `docs/superpowers/checklists/release-manual.md` 수행 — 특히 실제 IME 매트릭스(macOS 2벌식/구름, Windows MS IME)와 Claude Code 10분 세션.
2. 태그 `v0.1.0` push → `release.yml`이 dmg/zip(mac)·nsis/zip(win) 아티팩트 생성. 로컬은 `pnpm package:dir`.
3. 브랜치 전략 결정 — 마일스톤 동안은 main 직접 커밋(사용자 지시). 이후는 PR 기반 권장.
4. 1주 ST3 미사용 후 제거.

## 부록 A. 스펙 밖 욕망 (기록만, 스펙 부록 A와 합칠 것)

- 패키지 크기(324 MB) — renderer 전용 의존성 node_modules 제외.
- 사용자 테마 파싱 오류 토스트 UI.
- 프리뷰 내보내기 KaTeX 적용, mermaid 비목표 유지.
- 검색 결과 트리 2,000행 상한 이후 가상 스크롤.
- Windows용 서명/자동 업데이트 없음(개인용 유지).
