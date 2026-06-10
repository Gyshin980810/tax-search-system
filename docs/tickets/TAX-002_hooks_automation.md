# [TAX-002] Hooks 자동화로 검증 우회 차단

> 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 2
> Phase 1 — 즉시 적용

---

## Metadata

- **Type**: FEAT
- **Severity**: critical
- **Layer**: infra
- **Milestone**: MVP
- **Estimated Size**: M (3~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- V1~V6 검증(CLAUDE.md §6.4)이 수동 호출에 의존 — AI가 의도적·실수로 우회 가능
- 주민번호·사업자번호가 포함된 검색어가 외부 API로 전달될 수 있음 (CLAUDE.md §7 위반)
- 모호한 시점 표현(`예전 법`, `이전 법`)이 그대로 쿼리에 사용되어 시점 오류 발생 가능

### 1.2 기대 동작

- 검색 전 PII 패턴 자동 차단 (PreToolUse)
- 답변 생성 후 V1~V6 자동 실행 (PostToolUse)
- 모호한 시점 표현 감지 시 시점 확인 요청으로 자동 중단 (UserPromptSubmit)
- 응답 종료 시 면책 고지 자동 부착 검증 (Stop)

### 1.3 영향·중요도

- 검증 우회 차단 = CLAUDE.md §6.4 "검증 우회 금지"를 시스템 강제력으로 구현
- 개인정보 보호 = CLAUDE.md §7 자동 집행

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `.claude/settings.json` (신규 또는 수정 — Hook 설정)
- `scripts/check-pii.js` (신규 생성 — PII 패턴 검사)
- `scripts/run-verifier.js` (신규 생성 — V1~V6 실행 트리거)

### 2.2 Hook 구조 참고

```json
{
  "PreToolUse": [
    {
      "matcher": "조건식",
      "hooks": [{"type": "command", "command": "스크립트"}]
    }
  ],
  "PostToolUse": [...],
  "UserPromptSubmit": [...],
  "Stop": [...]
}
```

### 2.3 PII 패턴 (차단 대상)

- 주민등록번호: `\d{6}-[1-4]\d{6}`
- 사업자등록번호: `\d{3}-\d{2}-\d{5}`
- 검색어에 포함 시 `exit 1` → 에러 메시지 반환

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `.claude/settings.json` — Hook 규칙 추가
- [ ] `scripts/check-pii.js` 신규 생성
- [ ] `scripts/run-verifier.js` 신규 생성

### 3.2 금지되는 변경

- ❌ `src/` 하위 소스코드 수정
- ❌ `CLAUDE.md` 수정
- ❌ 기존 API Route 수정
- ❌ 법령 원문 처리 로직 변경

---

## 4. Strategy (구현 힌트)

1. **check-pii.js**: stdin 또는 환경변수로 검색어 수신 → 정규식 매칭 → 감지 시 에러 메시지 출력 후 exit 1
2. **run-verifier.js**: TAX-001의 `law-verifier` 에이전트를 호출하는 트리거 스크립트
3. **settings.json Hook**:
   - `PreToolUse` — WebFetch 호출 전 check-pii.js 실행
   - `PostToolUse` — 답변 생성 후 run-verifier.js 실행
   - `UserPromptSubmit` — "예전|이전 법|옛날" 패턴 감지 시 시점 확인 요청
   - `Stop` — 면책 고지 V5 자동 검증

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 주민번호 형식 검색어 입력 시 차단 메시지 출력 + API 미전달 확인
2. [ ] 답변 생성 후 V1~V6 검증 스크립트 자동 실행 확인 (로그 출력)
3. [ ] "예전 법 기준으로" 입력 시 시점 확인 요청으로 중단 확인
4. [ ] Hook이 없을 때와 있을 때 동작 차이 비교 가능한 테스트 케이스 1건 문서화
5. [ ] `scripts/` 파일에 `console.log` 대신 `process.stderr.write` 사용 (사이드이펙트 최소화)

---

## 6. Verification (검증 단계)

1. `node scripts/check-pii.js "880101-1234567"` 실행 → 차단 메시지 + exit code 1 확인
2. `node scripts/check-pii.js "부가가치세율"` 실행 → 정상 통과 확인
3. Claude Code 세션에서 "800101-1234567번 납세자 질문" 입력 → PII 차단 확인
4. "예전 법으로 계산하면" 입력 → 시점 확인 요청 메시지 출력 확인

---

## 7. Risks / Notes

- Hook은 Claude Code CLI 환경에서만 동작 (Vercel 배포 환경과 별개)
- `run-verifier.js`는 TAX-001 완료 후 작성 가능 (law-verifier 에이전트 존재 전제)
- PII 차단이 너무 강하면 정상 쿼리도 막힐 수 있음 — 패턴 테스트 필수

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] Hook 매처(matcher) 조건식 초안
- [ ] PII 정규식 패턴 목록
- [ ] V1~V6 실행 방식 계획 (에이전트 호출 vs 직접 스크립트)

→ **인간 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] Hook별 동작 검증 결과
- [ ] 리포트: `docs/reports/TAX-002_report.md`

---

## 10. Related Tickets

- 선행: TAX-001 (law-verifier 에이전트 필요)
- 후속: TAX-003 (보안 강화 — Permissions deny 연계)
- 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 2

---

## 11. Report Link

Report: `docs/reports/TAX-002_report.md` (미작성)

---

**작성자**: AI (하네스 엔지니어링 보고서 기반)
**작성일**: 2026-05-11
**최종 수정일**: 2026-05-11
