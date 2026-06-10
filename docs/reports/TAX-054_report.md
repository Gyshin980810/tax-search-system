# TAX-054 구현 리포트 — 비법령 의미검색 정합 + 회귀

**작성일**: 2026-06-10  
**대상**: TAX-054 (Phase 5 — downgradeVectorLabels 라벨 천장·병합·트랙분리 회귀 검증)  
**선행**: TAX-053 완료 (비법령 89건 벡터 DB 적재)

---

## 배경

TAX-053에서 비법령 89건을 벡터 DB에 적재한 후, vector 단계로 비법령이 검색될 때
기존 로직(downgradeVectorLabels·병합·트랙분리)이 정상 동작하는지 회귀 테스트로 검증한다.
신규 로직 추가 없이 **통합 테스트 추가만** 수행한다.

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 작업 | 비고 |
|---|---|---|
| `tests/integration/fallbackSearchVectorLabels.test.ts` | 🆕 신규 | 비법령 벡터 정합 통합 테스트 12건 |

> ✅ `src/`(도메인·어댑터·usecase·검증 V1~V6) **무변경**.

---

## 테스트 설계 — 3섹션 12건

### (1) FallbackSearchPort — caseNumber 이중노출 방지 + matchStage 전이 (4건)

vi.fn()으로 3개 포트(`ISearchPort`·`IEmbeddingPort`·`IVectorSearchPort`)를 순수 모킹.
외부 API 호출 없이 병합·matchStage 전이 로직만 검증.

| 테스트 | 검증 내용 |
|---|---|
| 이중노출방지 | 직접+벡터에 같은 caseNumber → 병합 후 1건만 |
| matchStage=direct | content ≥ THRESHOLD(3) → 임베딩 호출 없이 direct |
| matchStage=vector | content < THRESHOLD → 벡터 후 vector |
| 직접결과 보존 | 직접 결과가 벡터 결과보다 앞, 대체 없음 (FR-19) |

### (2) downgradeVectorLabels 라벨 천장 (5건)

vi.mock('ai', generateObject)으로 LLM 모킹. `OpenAIAnswerGeneratorAdapter.generate(matchStage)` 직접 호출.

| 테스트 | 검증 내용 |
|---|---|
| vector 천장 | LLM이 🟢 반환해도 matchStage=vector → 🟡 하향 |
| expanded 천장 | matchStage=expanded → ⚪ 하향 + "직접 근거를 찾지 못했습니다" prefix |
| direct 무변경 | matchStage=direct → 🟢 그대로 유지 |
| T3 유지 | T3 심판례 이미 🟡 → vector 단계에서도 🟡 유지 (🟢 승격 없음) |
| 폐지 보존 | ⚫폐지 라벨은 matchStage=vector여도 유지 |

### (3) citation/references 트랙 분리 (3건)

`generateAnswer` 전체 파이프라인을 4개 포트 모킹으로 검증.

| 테스트 | 검증 내용 |
|---|---|
| 트랙분리 | content 없는 비법령 → references에 포함, citations에 없음 |
| V검증 비대상 | references는 TaxLaw[] — excerpt·label 필드 없음 (citation 승격 금지) |
| 법령 content없음 드롭 | content 없는 법령은 citations도 references도 아닌 드롭 |

---

## 검증 결과

| 검증 | 결과 |
|---|---|
| 신규 통합 테스트 (`fallbackSearchVectorLabels.test.ts`) | ✅ 12/12 PASS |
| 전체 vitest 회귀 | ✅ 411/411 PASS (기존 399 + 신규 12) |
| 골든셋 40건 V1~V6 | ✅ 40/40 PASS (V1~V6 전 항목 ✔) |
| `src/` 무변경 | ✅ |
| generateAnswer.ts·V1~V6 무변경 | ✅ |

---

## 주요 확인 사항

- **🟢 승격 0** — vector/expanded matchStage에서 T3 심판례가 🟢직접근거로 승격되지 않음 확인
- **이중노출 0** — 동일 caseNumber가 직접+벡터 양쪽에 있어도 병합 후 1건
- **V검증 비대상 보증** — references는 TaxLaw[] 타입(excerpt·label 없음), citation 승격 불가 타입 수준 확인

---

## 다음 단계

**TAX-055** — G-2 유사 사례 골든셋 30건 골격 보조 (TAX-052와 병렬 가능)  
- `buildNonlawCases.ts`로 골격 생성  
- summary는 회계사 직접 작성(AI 자동 생성 금지)  
- 라벨 정확도 ≥ 95%
