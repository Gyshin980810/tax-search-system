# [TAX-006] 모델 선택 전략 — 비용·정확도 동시 최적화

> 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 5
> Phase 2 — M3 마일스톤

---

## Metadata

- **Type**: TASK
- **Severity**: major
- **Layer**: infra
- **Milestone**: Post-MVP
- **Estimated Size**: S (1~2파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- CLAUDE.md에 "Gemini 2.0 Flash (실증) → Claude/GPT (운영)"만 명시
- RAG 5단계별로 어떤 모델을 쓸지 명시된 정책 없음
- 모든 단계에서 동일 모델 사용 → 비용 비효율 (단순 변환에도 Opus 사용 가능)

### 1.2 기대 동작

- `.claude/agents/` 각 에이전트 파일에 `model:` 필드 명시 (TAX-001 보완)
- 단계별 모델 선택 기준이 문서화됨
- 비용 절감 + 검증 단계 정확도 유지 동시 달성

### 1.3 영향·중요도

- 검증(law-verifier)은 Opus — 환각 1건이 직접 손해인 영역
- 검색·변환은 Haiku — 빠르고 저렴, 복잡한 추론 불필요
- 비용 ~60% 절감 예상 (90% 트래픽이 Haiku/Sonnet 처리)

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `.claude/agents/tax-planner.md` (TAX-001 생성 — model 필드 추가)
- `.claude/agents/tax-searcher.md` (TAX-001 생성 — model 필드 추가)
- `.claude/agents/tax-generator.md` (TAX-001 생성 — model 필드 추가)
- `.claude/agents/law-verifier.md` (TAX-001 생성 — model 필드 추가)

### 2.2 단계별 모델 매핑

| RAG 단계 | 에이전트 | 권장 모델 | 이유 |
|---|---|---|---|
| [1] 자연어 쿼리 변환 | tax-planner | `claude-haiku-4-5` | 단순 변환, 빠름·저렴 |
| [2] 외부 API 검색 | tax-searcher | `claude-haiku-4-5` | HTTP 호출 + 정규화만 |
| [3] 답변 생성·라벨링 | tax-generator | `claude-sonnet-4-6` | 복잡한 세법 추론 |
| [4] V1~V6 검증 | law-verifier | `claude-opus-4-7` | 환각 검출 critical |

### 2.3 업그레이드 조건 (Sonnet → Opus)

- 첫 시도 실패 시
- 5개 이상 조문 동시 처리
- 시점 분기가 3개 이상인 복잡한 케이스

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `.claude/agents/tax-planner.md` — `model: claude-haiku-4-5-20251001` 추가
- [ ] `.claude/agents/tax-searcher.md` — `model: claude-haiku-4-5-20251001` 추가
- [ ] `.claude/agents/tax-generator.md` — `model: claude-sonnet-4-6` 추가
- [ ] `.claude/agents/law-verifier.md` — `model: claude-opus-4-7` 추가

### 3.2 금지되는 변경

- ❌ `src/` 하위 소스코드 수정
- ❌ `CLAUDE.md` 수정
- ❌ 에이전트 역할(allowed-tools) 변경

---

## 4. Strategy (구현 힌트)

1. TAX-001 완료 후 각 에이전트 파일에 `model:` 필드 추가
2. 모델 ID는 현재 Claude Code가 지원하는 최신 ID 사용 (`claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7`)
3. 업그레이드 조건을 `law-verifier.md` 지시문에 명시

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 4개 에이전트 파일 모두 `model:` 필드 존재
2. [ ] law-verifier는 반드시 `claude-opus-4-7` 사용
3. [ ] tax-planner, tax-searcher는 Haiku 계열 사용
4. [ ] 업그레이드 조건 3가지가 law-verifier.md 또는 tax-generator.md에 명시

---

## 6. Verification (검증 단계)

1. 4개 에이전트 파일의 frontmatter에 `model:` 필드 확인
2. law-verifier의 model이 Opus인지 확인
3. 기존 TAX-001 Acceptance Criteria가 여전히 만족되는지 확인

---

## 7. Risks / Notes

- 모델 ID는 Anthropic 업데이트에 따라 변경될 수 있음 — 분기별 검토 권장
- Haiku 사용 시 복잡한 시점 분기 처리 품질 저하 가능 — 필요 시 Sonnet으로 업그레이드

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 현재 사용 가능한 모델 ID 목록 확인

→ **인간 승인 후** 에이전트 파일 수정

### 8.2 코딩 후 제출할 것

- [ ] 수정된 에이전트 파일 목록
- [ ] 단계별 모델 매핑표
- [ ] 리포트: `docs/reports/TAX-006_report.md`

---

## 10. Related Tickets

- 선행: TAX-001 (에이전트 파일 존재 필요)
- 후속: 없음 (독립 완결)
- 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 5

---

## 11. Report Link

Report: `docs/reports/TAX-006_report.md` (미작성)

---

**작성자**: AI (하네스 엔지니어링 보고서 기반)
**작성일**: 2026-05-11
**최종 수정일**: 2026-05-11
