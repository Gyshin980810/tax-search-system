# TAX-016C 구현 리포트 — 조세심판원 결정례(특별행정심판재결례) 검색 추가

- **티켓:** `docs/tickets/TAX-016C_tribunal_search.md`
- **작업일:** 2026-05-22
- **상태:** 구현 완료 (회계사 수동 검증 대기)
- **선행:** TAX-015B/C/D, TAX-016A, TAX-016B (완료)
- **경로:** A′ (open.law.go.kr 공동활용 "특별행정심판" — 기존 OC 키 재사용)
- **Trust Tier:** T3 (회계사 결정 2026-05-22)

---

## 배경

비법령 검색 트랙의 마지막 자료원. 조세 불복 단계에서 자주 인용되는 **조세심판원 결정례**를 검색 결과에 편입한다. 016B(국세청 해석, 본문 없음)와 달리 **본문(주문·재결요지·이유)이 제공**되어 발췌 인용(citable)·V검증 대상이 된다.

---

## 접근 경로 확정 (실호출 조사)

CLAUDE.md "추측 코딩 금지" 원칙에 따라 모든 외부 동작을 실호출로 확정한 뒤 구현했다.

**조사 과정의 정정 이력(투명성):**
- 1차 후보 `decc`는 **오답**으로 판명. `target=decc`는 기존 키로 접근되나 **일반 행정심판재결례**(재결청=국민권익위·시도 행정심판위)이고 세법 쿼리는 0건 → 조세심판원 미포함.
- 회계사가 공동활용 "특별행정심판" 카테고리 가이드에서 정확한 target **`ttSpecialDecc`** 확인·공유(016B의 ntsCgmExpc와 동일한 A′ 흐름).

**`ttSpecialDecc` 실호출 확정(2026-05-22):**

| 항목 | 실측 결과 |
|---|---|
| 목록 요청 | `lawSearch.do?target=ttSpecialDecc&type=JSON&query=...` (기존 키) |
| 목록 래퍼 | `{ Decc: { decc: RawTtSpecialDecc[] } }` (재결청="조세심판원") |
| 데이터량 | 양도소득세 7,257 · 증여 11,270 · 법인세 2,807건 |
| 식별자 | `청구번호` (예: "조심 2020부1558") |
| 일자 | `의결일자` ("YYYY.MM.DD") |
| 본문 요청 | `lawService.do?target=ttSpecialDecc&ID=특별행정심판재결례일련번호` |
| 본문 래퍼 | `{ SpecialDeccService }` — **주문·재결요지·이유 제공** ✅ |
| ⚠️ 상세링크 | `lawService.do?OC=...` — **OC 키 포함** → 키 제거 필요 |
| 원문 링크 | 키없는 직접 뷰어(deccInfoP)는 일반 decc 전용·일련번호 미해결(실측) → **청구번호 검색 딥링크 `allDeccSc.do?query=청구번호`**(레코드 노출 실측 확인) |

> 조사용 임시 스크립트는 키를 출력하지 않고 사용 후 즉시 삭제했다.

---

## 변경 사항 요약

### 파일 변경 목록

**Adapter (수정)** — `src/adapters/nationalTaxLaw.ts`
- `RawTtSpecialDecc`·`RawTtSpecialDeccSearch`·`RawSpecialDeccService` 인터페이스 추가.
- `toTribunalSourceUrl()` — 청구번호로 `allDeccSc.do` 검색 딥링크(키 미포함).
- `searchTribunal()` — `target=ttSpecialDecc` 목록 조회 → 각 본문 조회(판례 2단계 패턴 복제).
- `fetchTribunalBody()` — `SpecialDeccService`의 주문+재결요지+이유를 원문 그대로 결합. 실패 시 빈 문자열(부분 실패 허용).
- `toTribunalTaxLaw()` — `sourceType='심판례'`, `trustTier='T3'`, `issuingBody='조세심판원'`, `caseNumber=청구번호`, `decisionDate=의결일자`.
- `search()` 병렬 검색·병합에 심판례 추가 — Tier 순 **법령 → 해석례 → 심판례 → 판례**, 부분 실패 허용.

**UI (무변경)** — `app/components/AnswerCard.tsx`
- `심판례` 배지(SOURCE_TYPE_STYLES)·`dateLabel('심판례')='결정일'`이 이미 존재(TAX-016A 선반영). 변경 불필요.

**Usecase (무변경)** — `src/usecases/generateAnswer.ts`
- 본문 있는 심판례는 기존 `splitResults`가 citable로 분류 → LLM 인용 후보 + V검증. 본문 없으면(부분 실패) 참고 목록. 코드 변경 불필요.

**검증기 (무변경)** — `src/adapters/lawVerifier.ts`
- `matchesIdentity`가 비법령(판례·해석례·심판례)을 caseNumber로 대조 → 심판례 자동 처리.

**테스트 (추가)**
- `tests/integration/nationalTaxLaw.test.ts` — `ttSpecialDecc` mock(목록+본문)·핸들러 + 신규 3건: ① 본문·메타·T3·조세심판원·키없는 링크, ② 병합 순서(법령<심판례<판례), ③ 심판례 부분 실패 허용.
- `tests/unit/lawVerifier.test.ts` — 심판례 V1(청구번호 대조)·V1 환각·V2 의역·V3 단독 직접근거 금지 4건.

### 환경변수
- **추가 없음.** 경로 A′가 기존 `NATIONAL_TAX_API_KEY`를 그대로 사용 → CLAUDE.md §7.1 갱신 불필요.

---

## 동작 규칙 (정리)

```
조세심판원 결정례(ttSpecialDecc) = sourceType '심판례' + T3 + issuingBody '조세심판원'
  목록(청구번호·의결일·사건명) → 본문(주문·재결요지·이유) 2단계
  본문 있음 → citable → LLM 발췌 인용 + law-verifier V1~V6 검증
  (본문 부재/실패 시 → content '' → 참고 목록)
  원문 링크 = allDeccSc.do?query=청구번호 (키 미포함)
```

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` (tsc) | ✅ 에러 0 |
| `npm run test` (vitest) | ✅ **127개 전부 통과** (기존 120 + 신규 7) |
| `npm run lint` (eslint) | ✅ 경고/에러 0 |
| AC#2 식별자·기관·일자·링크 포함 | ✅ 통합 테스트 |
| AC#3 본문 발췌 인용(citable)·V1·V2 | ✅ lawVerifier 단위 테스트 |
| AC#4 T3·🟡/⚪ 라벨(V3) | ✅ T3 매핑·V3 테스트 |
| AC#5 원문 링크 키 미노출 | ✅ allDeccSc.do, OC 없음 |
| AC#6 기존 자료 회귀 없음·원문 보존 | ✅ 전체 통과 |

> 회계사 수동 검증 권장: `npm run dev` → http://localhost:3000 → "양도소득세"·"가지급금" 검색 → 조세심판원 결정례가 인용/참고로 노출, 원문 링크가 청구번호 검색으로 열리는지 확인.

---

## 잠재 위험 / 한계

- **원문 링크가 검색 딥링크:** 특별행정심판재결례는 키없는 직접 레코드 뷰어가 없어, 청구번호로 행정심판재결례 검색에 딥링크한다(레코드 노출 실측 확인). 직접 뷰어 URL이 확인되면 교체 가능.
- **공동활용 승인 의존:** ttSpecialDecc는 "특별행정심판" 카테고리 승인 유지가 전제. 만료·취소 시 심판례만 조용히 빠짐(부분 실패 허용).
- **Trust Tier T3:** 조세심판원 결정례를 T3로 분류(회계사 결정). CLAUDE.md §6.2 표에는 심판원이 명시돼 있지 않으므로, 향후 SSOT/CLAUDE.md 등급표에 심판례(T3) 명문화 권장(별도 문서 정합 티켓).

---

## 후속 작업
- 비법령 검색 트랙(판례·해석례·국세청해석·심판례) **완결**. 엄브렐러 `TAX-016` 종료 가능.
- (선택) SSOT/CLAUDE.md §6.2 등급표에 심판례 T3 명문화 정합 티켓.
- Phase 4 벡터 DB 트랙은 별개.

**리포트:** `docs/reports/TAX-016C_report.md`
