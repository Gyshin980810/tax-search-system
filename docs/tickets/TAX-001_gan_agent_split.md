# [TAX-001] GAN-스타일 3-에이전트 분리 구조 도입

> 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 1
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

- law-verifier 에이전트가 명세(CLAUDE.md §6.4)로만 언급되고 실제 `.claude/agents/` 파일이 없음
- 단일 LLM 인스턴스가 답변 생성과 검증을 동시에 수행할 경우 자기 환각을 스스로 인지하기 어려움
- RAG 5단계의 에이전트 역할 분리가 코드 수준에서 강제되지 않음

### 1.2 기대 동작

- `.claude/agents/` 아래 4개 서브에이전트 파일이 존재
- 각 에이전트는 허용 도구(allowed-tools)를 최소한으로 제한
- Evaluator(law-verifier)는 Generator와 독립된 인스턴스로 실행

### 1.3 영향·중요도

- 환각 검출률을 30% → 90% 이상으로 향상시키는 핵심 구조
- 회계사 의뢰인 보고서에 직결 — critical

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `.claude/agents/tax-planner.md` (신규 생성)
- `.claude/agents/tax-searcher.md` (신규 생성)
- `.claude/agents/tax-generator.md` (신규 생성)
- `.claude/agents/law-verifier.md` (신규 생성 — CLAUDE.md §6.4 명세 기반)

### 2.2 아키텍처 힌트

```
[1] 자연어 쿼리 변환  ──▶  tax-planner     (Sonnet, 도구: LLM 호출만)
[2] 외부 API 검색     ──▶  tax-searcher     (Haiku,  도구: WebFetch Read-only)
[3] 답변 생성·라벨링  ──▶  tax-generator    (Sonnet, 도구: LLM 호출 + 포맷팅)
[4] V1~V6 검증       ──▶  law-verifier     (Opus,   도구: Read + Grep — 독립 인스턴스)
[5] 회계사 출력       ──▶  Orchestrator UI
```

### 2.3 에이전트 파일 형식 참고

```markdown
---
name: agent-name
description: 에이전트 설명
model: claude-sonnet-4-6  # 또는 claude-haiku-4-5, claude-opus-4-7
allowed-tools: Read, Grep
---

# 에이전트 지시문
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `.claude/agents/tax-planner.md` 신규 생성
- [ ] `.claude/agents/tax-searcher.md` 신규 생성
- [ ] `.claude/agents/tax-generator.md` 신규 생성
- [ ] `.claude/agents/law-verifier.md` 신규 생성 (CLAUDE.md §6.4 V1~V6 기반)

### 3.2 금지되는 변경

- ❌ `src/` 하위 소스코드 수정
- ❌ `CLAUDE.md` 수정 (에이전트 명세는 이미 §6.4에 정의됨)
- ❌ `.mcp.json` 수정
- ❌ 법령 원문 처리 로직 변경

---

## 4. Strategy (구현 힌트)

1. `tax-planner.md` — 자연어 쿼리를 API 검색어로 변환하는 역할, allowed-tools: 없음(LLM만)
2. `tax-searcher.md` — 외부 API 호출만, WebFetch Read-only, 결과 정규화 금지
3. `tax-generator.md` — TaxLaw[] 배열을 받아 Trust Tier 라벨링 + 시점 라벨 부착
4. `law-verifier.md` — V1~V6 순서대로 검증, 실패 시 E-VERIFY-FAIL 발급, 재시도 1회

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `.claude/agents/` 아래 4개 파일 모두 존재
2. [ ] 각 에이전트 파일에 `allowed-tools` 명시 (최소 권한 원칙)
3. [ ] `law-verifier.md`에 V1~V6 검증 로직이 CLAUDE.md §6.4와 동일하게 기술
4. [ ] `tax-generator.md`와 `law-verifier.md`의 allowed-tools가 겹치지 않음 (독립성 확인)
5. [ ] 각 에이전트 파일에 사용 모델(`model:`) 명시

---

## 6. Verification (검증 단계)

1. `.claude/agents/` 폴더에 4개 파일 존재 확인
2. 각 파일 frontmatter에 `allowed-tools` 항목 존재 확인
3. `law-verifier.md` 내용이 CLAUDE.md §6.4 V1~V6 체크리스트를 모두 포함하는지 확인
4. `tax-generator`의 allowed-tools에 `Read`, `Grep`(원문 비교용)이 없는지 확인 (검증은 verifier 전담)

---

## 7. Risks / Notes

- 에이전트 파일은 구조·지시문만 정의하며 실제 LLM 호출 코드는 별도 (TAX-005에서 모델 선택 전략과 연동)
- `law-verifier`가 Opus를 사용하므로 호출 비용 증가 예상 — 검증은 배포 전 1회만 실행하여 최소화

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 4개 에이전트의 allowed-tools 목록 초안
- [ ] law-verifier V1~V6 로직 구현 계획

→ **인간 승인 후** 파일 생성

### 8.2 코딩 후 제출할 것

- [ ] 생성된 파일 목록
- [ ] 각 에이전트 allowed-tools 요약
- [ ] 리포트: `docs/reports/TAX-001_report.md`

---

## 10. Related Tickets

- 선행: 없음
- 후속: TAX-002 (Hooks — verifier 자동 호출), TAX-005 (모델 선택 전략)
- 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 1

---

## 11. Report Link

Report: `docs/reports/TAX-001_report.md` (미작성)

---

**작성자**: AI (하네스 엔지니어링 보고서 기반)
**작성일**: 2026-05-11
**최종 수정일**: 2026-05-11
