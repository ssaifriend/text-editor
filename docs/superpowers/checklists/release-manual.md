# 릴리스 수동 체크리스트

자동화가 못 보는 것만 사람이 본다. 각 항목은 패키지된 앱(`pnpm package:dir` → `dist/<os>/moru`)으로 수행한다. 결과는 표에 O/X와 현상을 적고 `docs/superpowers/reports/final-status.md`에 링크한다.

## 1. 실제 IME 매트릭스

| OS | 입력기 | 에디터 8항목 | 터미널 | 확인자 | 날짜 |
|---|---|---|---|---|---|
| macOS | 시스템 2벌식 | | | | |
| macOS | 구름 입력기 | | | | |
| Windows | Microsoft 한국어 IME | | | | |
| Windows | 날개셋 또는 구름 | | | | |

에디터 8항목은 `docs/superpowers/checklists/m0-ime-manual.md`와 동일. 터미널 항목: 터미널 탭에서 `echo 한글 테스트`를 조합 입력 → 셸 에코가 정확하고 백스페이스가 글자 단위로 지워진다.

## 2. 폰트

- 설정 `editor.fontFamily` 기본값(D2Coding → Sarasa Mono K → 시스템 모노)에서 한글·라틴 혼합 줄의 커서 위치와 선택 하이라이트가 어긋나지 않는다.
- 상태바 `Col`이 한글 뒤에서 글자 단위로 증가한다.

## 3. Claude Code 10분 세션

1. 프로젝트 폴더를 열고 터미널 탭(`Cmd/Ctrl+Shift+T` 또는 View › New Terminal)에서 `claude`를 실행한다.
2. 에이전트에게 열려 있는 파일을 수정하게 한다 → clean 버퍼는 커서를 유지하며 조용히 리로드, dirty 버퍼는 배너(Compare / Load Disk Version / Keep Mine)가 뜬다.
3. 에이전트가 새 파일을 만든다 → 사이드바와 Goto Anything 인덱스에 나타난다.
4. `@경로` 전송(Send Path to Terminal)과 선택 영역 전송이 셸 인용 처리된 채로 들어간다.
5. 10분 동안 렉·깜빡임·포커스 이탈이 없다.

## 4. 레거시 CP949 파일 왕복

- 실제 CP949 파일을 열면 상태바가 `CP949`를 보이고 한글이 깨지지 않는다. 한 줄 수정 후 저장 → `iconv -f cp949` 로 원본과 diff가 그 줄만 다르다.
- UTF-8로 재해석(Reinterpret as) 후 되돌리기.

## 5. 성능 체감

- `pnpm test:e2e tests/e2e/perf.spec.ts` 결과(`test-results/perf-*.json`)를 패키지 앱에서도 한 번 재현: 콜드 스타트 1초 이내, 5만 줄 파일 열기 즉시.

## 6. ST3 제거 게이트

- 1주간 ST3를 열지 않고 moru만 사용한다. 막힌 것은 `docs/superpowers/reports/final-status.md`의 "부록 A 욕망" 아래에 적는다.
- 1주 후 모든 항목이 O이면 ST3를 삭제한다.
