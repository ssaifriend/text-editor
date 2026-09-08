# M3b 버퍼 find/replace 보고서

- 실행일: 2026-09-08
- 검증: `pnpm typecheck` 0 에러 · 유닛 193/193 · E2E 65/65 (macOS arm64, Electron 44.2.0, 숨김 창)

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| 대소문자 보존 규칙 · 쿼리 빌더(case/word/regexp) · 카운트 cap · 선택 영역 내 RangeSet 매핑 · 현재 매치 인덱스 | unit 6 | PASS |
| 대소문자 보존 치환 (다음/전부) · 정규식 `$1` 그룹 · 무매치 null | unit 4 | PASS |
| 패널: Cmd+F → 입력 포커스, 즉시 카운트 `5`, 뷰포트 하이라이트 5개, Enter/Shift+Enter `n / m` 순환, 토글 후 재계산, Esc → 에디터 포커스 복귀 | e2e | PASS |
| **Alt+Enter 전부 선택 → 멀티커서 편집** | e2e | PASS |
| Cmd+Alt+F 치환 패널 · 정규식+대소문자 보존 Replace / Replace All | e2e | PASS |
| 선택 영역 내 검색 | e2e | PASS |
| 최근 쿼리 세션 보존 | e2e | PASS |
| M0~M3a 회귀 (IME·키맵·멀티커서 포함) | e2e 60 | PASS |

## 구현 중 발견한 것

1. CM6 검색 하이라이터는 **패널이 열려 있을 때만** 동작. `search({ createPanel })`에 빈 DOM을 주고 `.cm-panels`를 CSS로 숨겨 하이라이팅만 빌려옴. UI는 Solid.
2. `searchKeymap`을 CM6 keymap에서 제거 (우리 키맵이 Cmd+F/G/D 소유). IME 멀티커서 테스트(`Mod+D`)는 우리 바인딩 경로로 여전히 통과.
3. 토글 변경 후 현재 선택이 여전히 매치면 `n / m`이 유지되는 것이 맞음 — 테스트 기대값을 수정.

## 결정

- 정규식 문법 = JS `RegExp` (CM6 그대로). 치환 `$1`, `$<name>`은 CM6 시맨틱.
- 대소문자 보존은 우리 구현 (CM6 미지원). ALL CAPS / Capitalized / lower 세 패턴.
- 카운트 상한 10,000 → `10000+` 표기.

## M3c로 넘기는 것

Goto Anything (Cmd+P 파일 · `:`줄 · `@`심볼 · `#`단어 · 미리보기 탭 · MRU · rg 인덱스 + fzf).
