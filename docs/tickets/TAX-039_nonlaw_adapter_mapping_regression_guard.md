# TAX-039 비법령 어댑터 매핑 회귀 방지 (SSOT 매핑 표 + 통합 테스트)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-05
> 배경: TAX-037 리포트 §잠재 위험 2 — 외부 API 응답의 결정일 필드명·형식이 다양해 어댑터 매핑이 누락되면 `decisionDate`가 비어 V4가 `[현행]`으로 폴백, 결정일 정보 손실

---

## Metadata

- **Type**: TASK
- **Severity**: minor
- **Layer**: docs (SSOT) + adapter (통합 테스트)
- **Milestone**: Post-MVP
- **Estimated Size**: S (문서 1파일 + 테스트 1파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

`src/domain/TaxLaw.ts:51`이 비법령 식별·메타를 3개 필드로 정의:

```typescript
caseNumber?: string      // (판례) 사건번호 / (해석례·심판례) 문서번호
issuingBody?: string     // 법원·국세청·기재부·조세심판원
decisionDate?: string    // 선고일 / 결정일 / 회신일 (YYYY-MM-DD)
```

`NationalTaxLawAdapter`는 외부 API 응답을 위 3개 필드로 정규화하는 책임을 진다. 하지만:

1. **매핑 표가 문서화되지 않음** — 어떤 외부 필드를 `decisionDate`에 넣어야 하는지 SSOT에 명시 없음. 다음 비법령 API 통합(또는 신규 자료유형 추가) 시 매핑이 누락될 위험.
2. **회귀 테스트 없음** — 어댑터가 `decisionDate`를 채우는지 단언하는 테스트가 없음. 코드 변경 후 매핑이 사라져도 V4가 `[현행]`으로 폴백해 그린 시그널이 나옴(결정일 정보는 손실).
3. **TAX-037에서 검증한 4건은 모두 `YYYY-MM-DD` 형식**이지만, 향후 다른 API/응답이 `YYYY.MM.DD`·`YYYYMMDD` 등으로 오면 `buildTemporalLabel()` 정규식 mismatch → `[현행]` 폴백 (역시 정보 손실).

### 1.2 기대 동작

1. **SSOT §7.6 비법령 사양**에 외부 API 필드 → 도메인 필드 매핑 표가 명문화된다.
2. **`NationalTaxLawAdapter` 통합 테스트**가 비법령 응답에 대해 `decisionDate`가 `YYYY-MM-DD` 형식으로 채워지는지 단언한다 (`판례`·`해석례`·`심판례` 각 1건 이상).
3. 어댑터 매핑이 회귀하면 테스트가 FAIL.

### 1.3 영향·중요도

- **위험 등급 저**: 현재 골든셋 4건은 모두 정상 매핑 확인됨 (TAX-037 검증). 즉각적 결함 없음.
- **누적 비용 회피**: 새 비법령 API/자료유형 통합 시마다 임시 처리·디버깅 비용 발생 가능. 표준 매핑 표 + 회귀 테스트로 사전 차단.
- **TAX-038과 짝지어 효과 극대화**: LLM 프롬프트가 `decisionDate`를 신뢰하려면 어댑터가 안정적으로 채워줘야 함.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `docs/SSOT.md` §7.6 비법령 사양 — 매핑 표 추가 (수정)
- `tests/adapters/nationalTaxLaw.test.ts` 또는 신규 `tests/adapters/nationalTaxLaw.nonlaw.test.ts` — 비법령 매핑 회귀 테스트 (신규 또는 추가)
- `src/adapters/nationalTaxLaw.ts` — 참조 전용. 비법령 응답 → `TaxLaw` 매핑 로직 위치 확인용
- `src/domain/TaxLaw.ts` — 참조 전용. 도메인 필드 정의 확인용

### 2.2 외부 API·리소스

- 국세법령정보시스템 OPEN API — 비법령 응답 필드명 확인 필요 (sourceType별로 상이 가능)
- 통합 테스트는 외부 API를 실제 호출하지 않고 **fixture 또는 모킹** 사용 권장 (CI 안정성·비용)

### 2.3 아키텍처 힌트

```
외부 API 응답 (JSON)
    ↓
NationalTaxLawAdapter ─── 매핑 표(SSOT §7.6) 준수
    ↓
TaxLaw { sourceType, caseNumber, issuingBody, decisionDate(YYYY-MM-DD) }
    ↓
[통합 테스트가 단언]  decisionDate.match(/^\d{4}-\d{2}-\d{2}$/)
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경 (조정안 채택 2026-06-05)

- [x] `docs/SSOT.md` §7.2 — 비법령 매핑 표 추가 (§7.6 → §7.2로 정정: 응집도)
- [x] `tests/integration/nationalTaxLaw.test.ts` — `describe('TAX-039 ...')` 블록 추가 (기존 MSW 4트랙 모킹 재사용)
- [x] SSOT 버전 v2.4 → v2.5, 변경 이력 행 추가
- [ ] ~~tests/adapters/ 신규 디렉토리·신규 파일·신규 fixture~~ → 조정안에서 제외

### 3.2 금지되는 변경

- ❌ `src/adapters/nationalTaxLaw.ts` 매핑 로직 변경 (현재 4건 정상 작동 — 변경 시 별도 티켓)
- ❌ `src/domain/TaxLaw.ts` 필드 추가·이름 변경
- ❌ `buildTemporalLabel()` (`scripts/golden/buildNonlawCases.ts`) 변경 — TAX-037에서 완료
- ❌ `lawVerifier.ts` V4 정규식 변경
- ❌ 골든셋 `eval/golden_direct.json` 변경

---

## 4. Strategy (구현 힌트)

1. **SSOT §7.6 매핑 표 추가**

   ```markdown
   ### 비법령 자료 어댑터 매핑 표 (TAX-039)

   외부 API 응답의 다양한 필드명을 도메인 `TaxLaw`의 단일 필드로 정규화한다.
   어댑터(`NationalTaxLawAdapter` 등)는 본 표를 준수해야 한다.

   | 외부 API 필드(예) | 도메인 필드 | 정규화 규칙 |
   |---|---|---|
   | 사건번호 / 문서번호 / 결정번호 / 회신번호 | `caseNumber` | 공백 제거 후 저장 (`normalizeCaseNumber` 패턴 참조) |
   | 법원명 / 처리기관 / 회신기관 / 결정기관 | `issuingBody` | 원문 그대로 |
   | 선고일 / 결정일 / 회신일 / 생산일자 | `decisionDate` | `YYYY-MM-DD` 형식으로 정규화 |
   | 사건명 / 제목 / 안건명 | `articleTitle` | 원문 그대로 |
   | 결정요지 / 사안 / 회신요지 | `content` | 원문 그대로 (변형·요약 금지 — CLAUDE.md §6.1) |

   ⚠ 매핑 누락 시 V4 시점 라벨이 `[현행]`으로 폴백되어 결정일 맥락이 손실된다.
   ```

2. **통합 테스트 작성**

   ```typescript
   // tests/adapters/nationalTaxLaw.nonlaw.test.ts
   import { describe, it, expect, vi } from 'vitest'
   import { NationalTaxLawAdapter } from '../../src/adapters/nationalTaxLaw'

   describe('NationalTaxLawAdapter — 비법령 매핑 회귀 방지 (TAX-039)', () => {
     it.each([
       { sourceType: '심판례', fixture: 'simpan_response.json' },
       { sourceType: '해석례', fixture: 'haeseok_response.json' },
       { sourceType: '판례',   fixture: 'panrye_response.json' },
     ])('$sourceType 응답에서 decisionDate가 YYYY-MM-DD 형식으로 채워진다', async ({ sourceType, fixture }) => {
       // fetch 모킹: tests/fixtures/nonlaw_responses/{fixture} 로드
       // adapter.search() 호출
       // 매칭된 항목의 decisionDate 단언
       const matched = result.items.find(i => i.sourceType === sourceType)
       expect(matched).toBeDefined()
       expect(matched?.decisionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
       expect(matched?.caseNumber).toBeTruthy()
       expect(matched?.issuingBody).toBeTruthy()
     })
   })
   ```

3. **fixture 수집**
   - 가능한 한 실제 API 응답을 1회 호출하여 redact 후 저장
   - 또는 기존 `eval/golden_direct.json`의 비법령 4건 원본 응답에서 추출

4. **회귀 게이트 추가**
   - `npx vitest run` 전체 PASS 확인
   - 어댑터 매핑 의도적 손상 시뮬레이션(임시 주석 처리) → 테스트 FAIL 확인 → 원복

---

## 5. Acceptance Criteria (완료 조건)

1. [x] `docs/SSOT.md` §7.2에 비법령 매핑 표가 명문화됨 (`caseNumber`·`issuingBody`·`decisionDate`·`articleTitle`·`content`·`sourceType` 각 1행).
2. [x] 통합 테스트가 4트랙(판례·법제처해석례·국세청해석·심판례) 각 1건 커버 (`it.each` 4건).
3. [x] 각 케이스에서 `decisionDate`가 `YYYY-MM-DD` 정규식 매칭됨을 단언.
4. [x] `caseNumber`·`issuingBody`도 빈 문자열이 아님을 단언.
5. [x] `npx vitest run` 전체 PASS (249/249).
6. [x] 어댑터 매핑 의도적 손상(`toIsoDateLoose` 정규화 비활성화) 시 신규 테스트 4건 모두 FAIL 확인 후 원복.
7. [x] `src/adapters/nationalTaxLaw.ts` 매핑 로직 최종 변경 없음 (원복 완료).

---

## 6. Verification (검증 단계)

1. `npx vitest run tests/adapters/nationalTaxLaw.nonlaw.test.ts` → 신규 테스트 PASS
2. `npx vitest run` → 전체 PASS (기존 40건 회귀 없음)
3. `docs/SSOT.md` 매핑 표 리뷰 — 회계사 확인
4. (회귀 검증) `src/adapters/nationalTaxLaw.ts`의 `decisionDate` 매핑 1줄을 임시로 주석 처리 → 신규 테스트 FAIL → 원복
5. `npm run golden:status` → 불일치 0건 유지

---

## 7. Risks / Notes (위험·주의사항)

- **fixture 사이즈**: 실제 API 응답은 길 수 있음. 테스트 가독성·repo 사이즈를 위해 필요한 필드만 redact 후 저장 권장.
- **외부 API 응답 형식 변경**: API 제공기관이 필드명을 바꾸면 SSOT 표도 갱신 필요 → 분기별 점검 항목에 추가 권장.
- **TAX-038과의 의존성**: 본 티켓이 어댑터 매핑을 보장해야 TAX-038 LLM 프롬프트의 `decisionDate` 신뢰가 의미를 가짐. 가능하면 본 티켓 선행, TAX-038 후행 권장.
- **모킹 방식 선택**: `vi.fn()`으로 `fetch` 모킹 vs MSW. 기존 테스트 패턴(`tests/adapters/`)을 따를 것.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 영향받는 파일 목록 (SSOT 1 + 테스트 1 + fixture 1~3)
- [ ] SSOT §7.6 매핑 표 초안
- [ ] 통합 테스트 골격(설명 주석 포함)
- [ ] fixture 수집 방식 (실 API 1회 호출 vs 기존 응답 추출)

→ **회계사 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] SSOT §7.6 매핑 표 최종본
- [ ] 통합 테스트 PASS 결과
- [ ] 회귀 검증 결과 (매핑 손상 시 FAIL → 원복 후 PASS)
- [ ] vitest 전체 결과
- [ ] `npm run golden:status` 결과
- [ ] 리포트: `docs/reports/TAX-039_report.md`

---

## 9. Related Tickets (관련 티켓)

- 선행: `TAX-037_nonlaw_v4_temporal_label_spec.md` (V4 4종화 완료 2026-06-05)
- 선행: `TAX-017_ssot_prd_nonlaw_spec_align.md` (비법령 T3·sourceType 명문화)
- 병행 권장: `TAX-038_nonlaw_llm_prompt_decision_label.md` (LLM 프롬프트 `[결정]` 학습)
- 후속: (없음)
- 참조: `src/adapters/nationalTaxLaw.ts`, `src/domain/TaxLaw.ts:51`, `docs/SSOT.md §7.6`

---

## 10. Report Link

Report: `docs/reports/TAX-039_report.md` ✅ 완료

---

**작성자**: AI(Claude Opus 4.7) + 회계사 검토 필요
**작성일**: 2026-06-05
**최종 수정일**: 2026-06-05
