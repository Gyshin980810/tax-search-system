# [TAX-6B-37] 심판례 수집기 인용 원천 필드(참조결정) 보존

> TAX-6B-36(판례 참조판례·판례내용 보존)의 **심판례판**. 회계사 승인 2026-07-06
> ("지금 심판례도 field 정밀화").

---

## Metadata

- **Type**: FEAT
- **Severity**: minor
- **Layer**: infra (scripts)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S (2~3파일 + 재수집)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- `collectTribunal.ts`는 심판례 본문 API(`SpecialDeccService`) 응답에서 `주문`·`재결요지`·`이유`만
  `content`로 결합해 저장한다.
- 같은 응답에 **`참조결정` 필드**(이 심판례가 참조한 다른 심판례 사건번호가 `" / "`로 구분된
  구조화 목록, 예: `조심2022서1437 / 조심2016부3139 / 조심2023서9833`)가 있으나 **버려지고 있다.**
- 판례의 `참조판례`(TAX-6B-36)와 정확히 대칭. 실측 표본 20건 중 35% 보유, 보유분 평균 1.7건.

### 1.2 기대 동작

- 본문 재조회 시 `참조결정`을 함께 파싱해 **별도 원천 파일**
  `scripts/tribunal_citation_source.jsonl`에 저장(있는 경우만).
- `content`(검색·답변 경로, §6.1 인용 무결성 계약)는 **완전 무변경** — 인용 그래프(TAX-6B-31)의
  심판례→심판례 정밀 추출 전용 원천으로만 사용.

### 1.3 영향·중요도

- TAX-6B-31의 심판례→심판례 엣지를 `참조결정` 구조화 필드로 정밀화(오탐0·날짜 대조 여지).
- ⚠️ **`참조결정`은 심판례만 담는다**(대법원 판례 인용 없음, 실측 확인) — 심판례→판례는 본문(이유)
  괄호 인용에 계속 의존(정밀화 대상 아님).

---

## 2. Context (기술적 맥락)

- `scripts/collectTribunal.ts` — `parseBody`(기존, content) 옆에 `parseReferencedDecisions` 추가.
- 원천은 `records.jsonl`에 없으므로 **본문 재조회 불가피**(13.5만건). 개별 요청 재시도 + append
  방식으로 resume 안전하게(중간 중단 시 이미 처리한 seq 스킵).
- 산출물 형식: JSONL(`{seq, caseNumber, referencedDecisions}` 행) — 처리한 모든 seq 기록(빈 참조결정
  포함)해 done-set을 파일 자체로 삼는다. TAX-6B-31이 `referencedDecisions` 비어있지 않은 행만 사용.

## 3. Scope

### 3.1 허용되는 변경

- [ ] `scripts/collectTribunal.ts` — `parseReferencedDecisions` + `--citation-source` 모드 추가
- [ ] `tests/unit/collectTribunal.test.ts` — 파싱 함수 테스트
- [ ] `.gitignore` — `tribunal_citation_source.jsonl` 등재

### 3.2 금지되는 변경

- ❌ `content`(주문+재결요지+이유) 매핑 일체 (§6.1)
- ❌ `records.jsonl`·`tribunal_full.json` 스키마 변경
- ❌ LLM·임베딩 호출 (과금 0)

## 4. Acceptance Criteria

1. [ ] `parseReferencedDecisions`가 `참조결정` 필드를 trim만 적용해 반환(무가공, §6.1)
2. [ ] `--citation-source` 재실행 시 이미 처리한 seq를 스킵(resume 멱등)
3. [ ] `content` 매핑 무변경 — 기존 vitest 무회귀
4. [ ] `tsc` 오류 0, `npm run test` GREEN

## 5. Related Tickets

- 선례: `TAX-6B-36_precedent_citation_source_fields.md` (판례판)
- 후속: `TAX-6B-31_citation_edges_load.md` (이 원천을 심판례→심판례 field 엣지로 소비)

## 6. Report Link

Report: `docs/reports/TAX-6B-37_report.md` (미작성)
