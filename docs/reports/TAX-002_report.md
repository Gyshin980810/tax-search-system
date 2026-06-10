# TAX-002 구현 리포트 — Hooks 자동화로 검증 우회 차단

> 최초 완료일: 2026-05-12
> 최종 갱신: 2026-05-12 (Hook matcher 문법 오류 수정)
> Phase: 1 / Step 2

---

## 파일 변경 목록

| 파일 | 작업 | 비고 |
|---|---|---|
| `scripts/check-pii.js` | 신규 생성 | 최초 구현 시 |
| `scripts/run-verifier.js` | 신규 생성 | 최초 구현 시 |
| `scripts/check-time-reference.js` | **신규 생성 (2026-05-12 갱신)** | UserPromptSubmit Hook 전용 패턴 검사 스크립트 |
| `.claude/settings.json` | `hooks` 섹션 추가 → matcher 문법 교정 | 기존 `agents` 섹션 보존 |

---

## scripts/check-pii.js 동작

- **입력**: `CLAUDE_TOOL_INPUT` 환경변수 (JSON 문자열)
- **PII 패턴**: 주민등록번호 `/\d{6}-[1-4]\d{6}/`, 사업자등록번호 `/\d{3}-\d{2}-\d{5}/`
- **감지 시**: `process.stderr.write` + `process.exit(1)`
- **정상 시**: `process.exit(0)`
- **로깅**: `console.log` 미사용 (사이드이펙트 최소화)

## scripts/run-verifier.js 동작

- **입력**: stdin으로 검증 대상 답변 JSON
- **`--check-v5` 모드**: Stop Hook 전용 — 면책 고지 존재 여부만 검증
- **전체 모드**: law-verifier 에이전트 호출 트리거 신호 생성
- **Node.js 내장 모듈만 사용**: `crypto` (외부 의존성 없음)

## scripts/check-time-reference.js 동작 (신규)

- **입력**: stdin으로 사용자 프롬프트 JSON 또는 환경변수 `CLAUDE_USER_PROMPT`
- **패턴 정의** (TAX-002 §4 참조):
  - `/예전/`
  - `/이전\s*법/`
  - `/옛날/`
  - `/전에는/`
  - `/바뀌기\s*전/`
- **감지 시**: `[시점 확인 필요]` stderr 메시지 + `process.exit(1)`
- **정상 시**: `process.exit(0)`
- **오류 시**: 사용자 입력을 막지 않기 위해 `process.exit(0)` (Fail-open 정책)

---

## Hooks 구성 (현재 — 2026-05-12 교정 후)

| Hook 이벤트 | 매처 | 동작 | CLAUDE.md 매핑 |
|---|---|---|---|
| PreToolUse | `"WebFetch"` | `check-pii.js` 실행 — PII 감지 시 외부 API 차단 | §7 개인정보 |
| PostToolUse | `"Task"` | `run-verifier.js` 실행 — law-verifier 호출 트리거 | §6.4 V1~V6 |
| UserPromptSubmit | (매처 없음 — 모든 프롬프트 대상) | `check-time-reference.js` 실행 — 모호 표현 감지 시 차단 | §6.2 시점 라벨 |
| Stop | (매처 없음) | `run-verifier.js --check-v5` — 면책 고지 자동 검증 | §6.4 V5 |

---

## 수정 이력 (2026-05-12 Hook matcher 문법 교정)

### 발견된 오류

원래 구성된 hook들이 다음과 같이 동작 불능 상태였습니다:

| Hook | 잘못된 매처 | 증상 |
|---|---|---|
| PreToolUse | `"tool == \"WebFetch\""` | 매처가 도구명으로 인식되지 않아 트리거 자체가 안 됨 |
| PostToolUse | `"tool == \"GenerateAnswer\""` | 같은 문제 + `GenerateAnswer`는 실제 도구가 아님 |
| UserPromptSubmit | `"input matches \"예전\|이전 법\|...\""` | 매처가 도구명 패턴으로 처리되어 **모든 입력**이 매칭되고, 매처 안의 패턴 매칭 시도가 무력화됨 → `exit 1`로 모든 사용자 입력이 차단됨 |
| Stop | `"*"` | 비표준 와일드카드 |

### 근본 원인

**Claude Code의 hook matcher는 도구명 패턴만 지원합니다.** `"tool == "..."` 같은 조건식이나 `"input matches ..."` 같은 정규식 매칭은 지원하지 않습니다. 사용자 입력 텍스트에 대한 패턴 매칭은 hook 외부의 별도 스크립트에서 수행해야 합니다.

### 적용한 수정

1. **PreToolUse 매처**: `"tool == \"WebFetch\""` → `"WebFetch"` (도구명 단순화)
2. **PostToolUse 매처**: `"tool == \"GenerateAnswer\""` → `"Task"` (law-verifier 에이전트는 `Task` 도구로 호출됨)
3. **UserPromptSubmit**: 매처 필드 제거 + 패턴 매칭 로직을 `scripts/check-time-reference.js`로 이동
4. **Stop**: 비표준 `"*"` 매처 제거

---

## 검증 결과

### 최초 구현 (2026-05-12)

| 테스트 케이스 | 입력 | 기대 결과 | 실제 결과 |
|---|---|---|---|
| 주민번호 감지 | `880101-1234567` | exit 1 + 차단 메시지 | ✅ PASS |
| 사업자번호 감지 | `123-45-67890` | exit 1 + 차단 메시지 | ✅ PASS |
| 정상 쿼리 통과 | `부가가치세율 계산` | exit 0 | ✅ PASS |
| V5 면책 고지 존재 | `[면책 고지] ...` 포함 | PASS + exit 0 | ✅ PASS |
| V5 면책 고지 누락 | `[면책 고지]` 없음 | FAIL + exit 1 | ✅ PASS |

### Matcher 교정 후 (2026-05-12 갱신)

| 테스트 케이스 | 명령어 | 기대 | 실제 |
|---|---|---|---|
| 시점 검사 — 정상 | `echo '{"prompt":"부가가치세율은 어떻게 되나요?"}' \| node scripts/check-time-reference.js` | exit 0 | ✅ PASS |
| 시점 검사 — 모호 패턴 | `echo '{"prompt":"예전 법으로 계산하면"}' \| node scripts/check-time-reference.js` | exit 1 + `[시점 확인 필요]` | ✅ PASS |
| PII 검사 — 주민번호 | `CLAUDE_TOOL_INPUT='880101-1234567 납세자' node scripts/check-pii.js` | exit 1 + `[PII 차단]` | ✅ PASS |
| PII 검사 — 정상 | `CLAUDE_TOOL_INPUT='부가가치세율' node scripts/check-pii.js` | exit 0 | ✅ PASS |

---

## 검증 체크리스트

- [x] `node scripts/check-pii.js` 주민번호 입력 → exit code 1
- [x] `node scripts/check-pii.js` 일반 검색어 → exit code 0
- [x] `node scripts/check-time-reference.js` 모호 표현 입력 → exit code 1
- [x] `node scripts/check-time-reference.js` 정상 입력 → exit code 0
- [x] `.claude/settings.json`에 `hooks` 키 존재 + `agents` 키 보존
- [x] `scripts/` 파일에 `console.log` 대신 `process.stderr.write` 사용
- [x] Hook matcher 문법이 Claude Code 사양과 일치 (도구명 패턴 또는 매처 생략)

---

## 잠재 위험

### Hook 한계 (재확인)

- **Hook은 Claude Code CLI 환경에서만 동작합니다.** Vercel 배포 환경(웹앱)에서 회계사가 직접 접속해 사용할 때는 적용되지 않습니다.
- 운영 환경 보호는 **별도의 애플리케이션 레벨 미들웨어**가 필요합니다 (TAX-003 또는 신규 티켓에서 다룰 예정).

### Hook 매처 부수효과

- **PostToolUse `Task` 매처**는 law-verifier 에이전트뿐 아니라 **모든 서브에이전트 호출**에 트리거됩니다. 현재는 `run-verifier.js`가 트리거 신호만 출력하므로 무해하지만, 향후 V1~V6 실제 검증 로직을 결합할 때는 호출된 에이전트가 law-verifier인지 stdin 페이로드로 필터링해야 합니다.

### Fail-open 정책

- `check-time-reference.js`는 스크립트 자체 오류 시 사용자 입력을 막지 않고 `exit 0` 처리합니다. 보안 관점에서 fail-close보다 사용성을 우선했으며, 실제 검증은 §6.4 law-verifier(V1~V6)에서 다시 한 번 수행됩니다.
