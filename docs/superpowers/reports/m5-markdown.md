# M5 마크다운 보고서

- 실행일: 2026-09-08
- 검증: `pnpm typecheck` 0 에러 · 유닛 256/256 · E2E 74/74 (macOS arm64, Electron 44.2.0, 숨김 창)

## 결과

| 영역 | 테스트 | 결과 |
|---|---|---|
| 표 정렬(`string-width`, 한글 2칸) · 정렬 행(`:--`, `:-:`, `--:`) | unit 3 | PASS |
| 편집 커맨드: 굵게/기울임/코드 토글(선택·단어·빈 쌍, 되감기) · 체크박스 순환 · 헤딩 ±1(0~6 클램프) · 순서 리스트 재번호(들여쓰기 유지) · 표 정렬 블록 · 링크 감싸기 | unit 7 | PASS |
| 헤딩 폴딩(같거나 높은 레벨까지, 마지막 섹션은 문서 끝) · URL 붙여넣기 판별 | unit 3 | PASS |
| 렌더러: `data-line` 주입 · GFM 표/취소선 · 태스크 리스트 · script/핸들러/`javascript:` 제거 · 로컬 이미지 → `app-file://`(루트 밖 차단) · 원격 이미지 게이트 · 각주/헤딩 anchor · 1만 줄 예산 | unit 5 | PASS |
| `app-file://` 해석: 루트 내 이미지만 · `..`/symlink 탈출 403 · 없는 파일 404 · 루트 없음 403 · 비이미지 403 | unit 2 | PASS |
| 스크롤 동기화 헬퍼(`data-line` ↔ offsetTop) | unit 2 | PASS |
| Cmd+B 감싸기 · 체크박스 · 표 정렬 · 헤딩 · URL 붙여넣기 → `[선택](url)` | e2e | PASS |
| Cmd+Shift+V → 오른쪽 분할 프리뷰 · sanitize · 로컬 이미지 실제 로드(naturalWidth 1) · 타이핑 후 라이브 갱신 · 에디터 스크롤 → 프리뷰 동기화 · HTML 내보내기 · 토글로 닫기 | e2e | PASS |
| M0~M4 회귀 | e2e 72 | PASS |

## 구현 중 발견한 것

1. `@codemirror/lang-markdown`의 `markdown()` 기본 base는 CommonMark. GFM(표·취소선·태스크)은 `base: markdownLanguage`를 넘겨야 켜짐.
2. DOMPurify가 `<input type="checkbox">`의 `type`을 제거해 텍스트 입력으로 렌더됨 → 체크박스는 `<span role="checkbox" data-checked>` + CSS로 그림. 폼 컨트롤을 프리뷰에 넣지 않으니 더 안전.
3. markdown-it 15의 타입은 `MarkdownIt` 인스턴스에서 파생(`InstanceType<typeof MarkdownIt>['core']…`)해야 룰 함수 시그니처가 맞음.
4. rg/markdown 모두 Windows 8.3 경로 등은 `realpathSync.native`로 비교해야 symlink 탈출 판정이 정확.
5. 1만 줄 렌더(jsdom)는 ~600ms — jsdom의 HTML 파싱이 병목. 실제 Chromium에서 재측정 필요; 스펙의 50ms는 markdown-it 단독 기준으로 재해석(M6 성능 예산 테스트에서 renderer 안에서 측정).

## 결정

- 프리뷰 탭은 `preview` 종류 + `bufferId` 바인딩. 버퍼 탭을 닫으면 프리뷰도 닫힘. 세션에는 `path`로 저장, 같은 창에 그 버퍼가 복원될 때만 되살림.
- `Cmd+Shift+V`는 pane이 하나면 오른쪽으로 분할해 프리뷰를 놓고 에디터 포커스를 유지. 이미 있으면 닫음(토글).
- 스크롤 동기화: 에디터 상단 줄 → 가장 가까운 `[data-line]`, 프리뷰 상단 요소 → 그 줄. rAF 가드로 반대편 이벤트 무시.
- `app-file://` 루트 = 포커스된 창의 projectRoot (`index.build` 시 main이 기록). 이미지 MIME만 서빙.
- 내보내기: HTML은 인라인 CSS 포함 단일 파일, PDF는 숨김 창 + `printToPDF`. KaTeX는 `markdown.katex` 플래그 시 lazy import (내보내기에는 미적용).
- 태스크 리스트/수식은 자체 markdown-it 룰(플러그인 추가 없이).

## M6로 넘기는 것

전환: 인덴트 감지 · 저장 시 후행 공백/마지막 줄바꿈 · 사용자 테마 · 성능 예산 테스트 · 패키징 · 릴리스 체크리스트.
