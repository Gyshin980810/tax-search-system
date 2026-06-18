# TAX-6B-17 G3 타임아웃 대응 — generate 컨텍스트 절단 강화

> G3-10·G3-16에서 재현된 generate 단계 14~20초 지연의 LLM 입력 토큰 과다 원인 제거.
> contextBudget.ts HEAD/TAIL 축소 + SAFE_INPUT_TOKENS 절감.

---

## Metadata

- **Type**: PERF (응답 지연 개선)
- **Severity**: minor
- **Layer**: adapters (contextBudget.ts)
- **Milestone**: Phase 6B
- **Estimated Size**: XS (상수 3개 + 주석 수정)

---

## 1. Problem (문제 정의)

### 1.1 진단 결과 (TAX-6A-10 → TAX-6A-11 이어짐)

`scripts/diagnostics/_debug_timeout_cases.mjs` 3회 측정:

| 시도 | search | generate | 합계 | 비고 |
|---|---|---|---|---|
| G3-10 시도1 | 14,202ms | 14,243ms | 31,067ms | search + generate 동시 지연 |
| G3-10 시도2 | 2,118ms | 9,902ms | 14,163ms | generate만 지연 |
| G3-10 시도3 | 1,429ms | 20,287ms | 23,165ms | generate 극단 지연 |

- **G3-10 최대 본문 길이**: 24,286자 (소득세법 제104조 세율표, `<img>` 태그 포함)
- **G3-16 최대 본문 길이**: 14,151자 (상증세법 제53조)
- 검색 결과: G3-10 총 42건, T1 법령 1건

### 1.2 근본 원인 (LLM 입력 토큰 과다)

현재 `contextBudget.ts`:
- `compactLawContent` HEAD=1,500 + TAIL=500 = **법조문당 ~2,000자**
- `SAFE_INPUT_TOKENS = 60,000` → 42건에서 최대 **~15건 × 2,000자 ≈ 60K 토큰** LLM 입력

GPT-4o-mini는 입력이 클수록 tail latency가 커짐. 60K 토큰 입력 시 generate 20초 구간 진입.

### 1.3 방안 A 선택 (회계사 승인 2026-06-18)

generate 단계 LLM 입력 토큰 축소:
- HEAD: 1,500→800 (법조문 앞부분 800자)
- TAIL: 500→200 (법조문 뒷부분 200자)
- SAFE_INPUT_TOKENS: 60,000→35,000

---

## 2. Context (기술적 맥락)

### 2.1 V1·V2 무결성 보호 확인

`truncateForContext`는 LLM 프롬프트용 `promptLaws`(압축본)와
인용 검증용 `originalRefs`(원본)를 분리한다(line 170-173, 215-216).
HEAD/TAIL 축소는 `promptLaws`에만 적용되고 `originalRefs`는 원본 그대로 →
**V2 extractExcerpt(원본 content substring 대조) 완전 보존.**

### 2.2 관련 파일

- `src/adapters/contextBudget.ts` (수정) — HEAD/TAIL/SAFE_INPUT_TOKENS 상수만
- `tests/unit/contextBudget.test.ts` (무변경) — 기존 테스트 모두 통과 확인

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [x] `contextBudget.ts` HEAD 1500→800, TAIL 500→200
- [x] `contextBudget.ts` SAFE_INPUT_TOKENS 60K→35K
- [x] 관련 주석 수정

### 3.2 금지되는 변경

- ❌ `compactLawContent` 로직(종결어미 경계, omitted 마커) 변경
- ❌ `truncateForContext` 알고리즘(Tier 정렬·키워드 가중치) 변경
- ❌ `originalRefs` 참조 방식 변경 (V1·V2 보호)
- ❌ `llmAnswerGenerator.ts` 및 기타 파일 변경

---

## 4. Strategy (구현)

1. `contextBudget.ts`에서 HEAD=800, TAIL=200, SAFE_INPUT_TOKENS=35_000으로 상수 변경.
2. SAFE_INPUT_TOKENS JSDoc 주석 값 동기화.
3. 기존 테스트 무변경으로 통과 여부 확인 (구조 변경 없음).

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] HEAD=800, TAIL=200, SAFE_INPUT_TOKENS=35,000 상수 적용
2. [ ] `npm run typecheck` 0 에러
3. [ ] `npm run test` 전건 PASS (기존 652+)
4. [ ] `contextBudget.test.ts` 기존 케이스 무변경 PASS
5. [ ] G3-10·G3-16 단건 generate 시간 측정 개선 확인 (선택, 비결정적이므로 참고용)

---

## 6. Risks / Notes

- **세율표 조문 중간 구간 누락 가능** — G3-10(소득세법 제104조) HEAD 800자에서 세율표 일부가 잘릴 수 있음. 단 현행 HEAD=1500에서도 24K짜리 조문은 잘리고 있으며 G3-10 PASS 이력 있음.
- **검색 지연(search 14s)은 이번 티켓 범위 밖** — 외부 국세 API 간헐 지연은 코드로 완전 제어 불가.

---

## 7. Related Tickets

- 선행 진단: TAX-6A-10, TAX-6A-11
- 관련: TAX-042F (contextBudget 최초 도입)

---

**작성자**: AI (Claude Code) + 회계사 승인
**작성일**: 2026-06-18
