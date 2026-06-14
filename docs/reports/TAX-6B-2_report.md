# TAX-6B-2 리포트 — 부칙·경과조치 답변·UI 표시 (FR-17, 프론트엔드)

**작성일:** 2026-06-14
**담당:** Claude (AI)
**검토:** 회계사 (UI 방안 A 결정 2026-06-14)

---

## 1. 배경 및 목표

TAX-6B-1로 부칙이 `trustTier='T2'` TaxLaw로 검색 결과에 포함되고 LLM이 citation으로 선정되지만, `AnswerCard.tsx`가 부칙을 일반 조문과 동일하게 렌더링해 회계사가 **"본법령의 경과조치(시점 경계)"임을 구분할 수 없었다.** 본 티켓은 부칙 citation을 시각적으로 구분 표시한다.

UI 방안은 회계사 결정(2026-06-14)으로 **방안 A(최소 변경: 배지 + 좌측 보더, 렌더 구조 무변경)** 채택. 그룹화(B)·전용 패널(C)은 비채택. summary 시점경계 보강은 별도 분리.

---

## 2. 변경 사항 요약

**파일 변경 목록:**
- `app/components/AnswerCard.tsx` (수정) — 부칙 감지 헬퍼 + `⏱경과조치` 배지 + 좌측 보더
- `tests/unit/AnswerCard.test.tsx` (신규) — 부칙 렌더 단위 테스트 3건
- `docs/tickets/TAX-6B-2_addenda_ui_display.md` (신규) — 티켓

**주요 변경:**
1. `isAddendum(taxLaw)` 헬퍼 — `articleTitle === '부칙'` AND `trustTier === 'T2'`로 TAX-6B-1 `buchikToTaxLaw` 산출물 식별
2. 부칙 citation 카드에 `border-l-4 border-l-indigo-400` 좌측 강조
3. 배지 영역 선두에 `⏱경과조치` 배지(`data-testid="addendum-badge"`) — 부칙에만 노출

**미변경(범위 준수):**
- lawVerifier V1~V6 판정 로직 무변경
- 부칙 발췌(excerpt)는 어댑터 자동 추출 유지 — V2 무결성 보장(LLM 미생성)
- summary 시점경계 보강 미반영(별도 분리)

---

## 3. 검증 결과

1. **`npx vitest run tests/unit/AnswerCard.test.tsx`** — **3/3 PASS**
   - 부칙 citation → `⏱경과조치` 배지 노출
   - 일반 조문(T1) → 배지 미노출(회귀 방지)
   - 조문+부칙 혼합 → 부칙 카드에만 배지 1개
2. **`npx tsc --noEmit`** — 타입 에러 0 (EXIT 0)
3. **`npx vitest run`** — **전체 500/500 GREEN** (run_golden 회귀 무손상)

---

## 4. 잠재 위험

- **부칙 식별 조건 변화 위험**: `isAddendum`이 `articleTitle === '부칙'`에 의존. TAX-6B-1 `buchikToTaxLaw`가 articleTitle 형식을 바꾸면 배지가 사라질 수 있음(테스트가 고정값으로 회귀 감지).
- **V2 무결성**: 부칙 발췌는 어댑터 자동 추출 경로 유지로 본 티켓에서 변경 없음. 중첩배열(경과조치 표) 부칙의 발췌 정합은 6B-1 통합 프로브로 확인됨.
- **육안 검증 미실시**: jsdom 단위 테스트로 배지 노출은 확인했으나 `npm run dev` 실제 시점 질의 육안 확인은 회계사 측 운영 환경에서 권장.

---

## 5. 다음 단계

- (선택) summary 시점경계 보강 — 별도 티켓 검토 (V4 회귀 주의)
- TAX-6B-3 FR-11 최근 검색어 + PII 마스킹

**리포트:** docs/reports/TAX-6B-2_report.md
