# TAX-6B-2 부칙·경과조치 답변·UI 표시 (FR-17, 프론트엔드)

## Metadata
- **Type**: FEAT
- **Severity**: major
- **Layer**: ui
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S

## 1. Problem
### 1.1 현재 동작
TAX-6B-1로 부칙이 `trustTier='T2'` TaxLaw로 검색 결과에 포함되고, LLM이 citation으로 선정한다(SYSTEM_PROMPT 우선순위 (1) T1·T2). 그러나 `AnswerCard.tsx`는 부칙을 일반 조문 인용 카드와 동일하게 렌더링해, 회계사가 **"이것이 본법령의 경과조치(시점 경계)"임을 한눈에 구분할 수 없다.**

### 1.2 기대 동작
부칙 citation을 `⏱경과조치` 배지 + 좌측 강조 보더로 시각 구분해, 본법령 조문과 묶여 있음을 인지시킨다.

### 1.3 영향·중요도
부칙·경과조치는 신·구법 적용 경계 직접 근거(T2). 구분 표시 누락 시 회계사가 일반 조문으로 오인할 수 있다(PRD §16 FR-17).

## 2. Context
- `app/components/AnswerCard.tsx` — citation 렌더 루프
- 부칙 TaxLaw 식별: `articleTitle === '부칙'` AND `trustTier === 'T2'` (TAX-6B-1 `buchikToTaxLaw` 산출)
- 발췌(excerpt)는 어댑터 자동 추출 → V2 무결성은 어댑터가 보장(LLM 미생성)

## 3. Scope
### 3.1 허용
- [ ] `AnswerCard.tsx` — 부칙 citation 감지 헬퍼 + `⏱경과조치` 배지 + 좌측 보더 강조
- [ ] `tests/unit/AnswerCard.test.tsx` — 부칙 렌더 단위 테스트(신규)
### 3.2 금지
- ❌ lawVerifier 완화 / V1~V6 판정 로직 변경
- ❌ 부칙 발췌 텍스트 가공(§6.1 — 어댑터 자동추출 유지)
- ❌ summary 시점경계 보강(별도 분리 — 회계사 결정 2026-06-14)
- ❌ 렌더 구조 그룹화·6B-3/4 편의기능 선반영

## 4. Strategy
방안 A(회계사 결정 2026-06-14): 카드 흐름·렌더 구조는 유지하고 부칙 citation에 배지·좌측 보더만 추가하는 최소 변경. 부모-부칙 그룹화(방안 B)·전용 패널(방안 C)은 채택하지 않음.

## 5. Acceptance Criteria
1. [ ] 부칙 citation에 `⏱경과조치` 배지 노출 (`data-testid="addendum-badge"`)
2. [ ] 부칙 카드에 좌측 강조 보더 적용
3. [ ] 일반 조문 citation에는 배지 미노출(회귀 없음)
4. [ ] `npx vitest run` 전체 GREEN(run_golden 95/95 무손상)
5. [ ] `npx tsc --noEmit` 0에러

## 6. Verification
1. `npx vitest run tests/unit/AnswerCard.test.tsx` GREEN
2. `npx vitest run` 전체 GREEN
3. `npm run dev` → 시점 질의로 부칙 [경과조치] 육안 확인

## 10. Related
- 선행: TAX-6B-1(부칙 동반 조회) / 후속: 없음
- 참조: PRD §16 FR-17, `app/components/AnswerCard.tsx`

## 11. Report Link
Report: `docs/reports/TAX-6B-2_report.md` (작성 예정)

**작성자**: Claude (AI) / **작성일**: 2026-06-14
