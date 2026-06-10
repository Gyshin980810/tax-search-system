# TAX-016B 구현 리포트 — 국세청 법령해석(해석례·예규) 검색 추가

- **티켓:** `docs/tickets/TAX-016B_nts_interpretation_search.md`
- **작업일:** 2026-05-22
- **상태:** 구현 완료 (회계사 수동 검증 대기)
- **선행:** TAX-015B/015C/015D, TAX-016A (완료)
- **경로:** A′ (open.law.go.kr 공동활용 "국세청 법령해석" 카테고리 추가 승인 — 기존 OC 키 재사용)

---

## 배경

회계사 테스트에서 "가지급금·접대비 등 법인세 실무 쟁점은 근거 자료가 안 나온다"는 사각지대 확인. 원인은 **법제처 법령해석례(expc)에 해당 쟁점이 0건**이고, 권위 있는 해석이 **국세청 자체 해석·예규**에 있었기 때문. TAX-016B는 국세청 법령해석을 검색 결과에 편입한다.

---

## 접근 경로 확정 (실호출 조사)

CLAUDE.md "추측 코딩 금지" 원칙에 따라 **모든 외부 동작을 실호출로 확정**한 뒤 구현했다.

**1차 조사(경로 A 가부, 2026-05-21):** 기존 OC 키로 `target=expc`를 7개 키워드(법인세·소득세·부가가치세·감가상각·양도소득세 등) 실측 → **회신기관 전부 '법제처', 국세청 0건**. 중앙부처해석 후보 target(lsExpc/cgmExpc/centerExpc/admExpc) 전부 빈/404. → **기존 키 그대로는 국세청 해석 도달 불가** 확정.

**경로 결정(회계사):** A′ — open.law.go.kr 공동활용에서 "국세청 법령해석" 카테고리를 추가 승인받아 **기존 OC 키를 그대로 사용**(새 환경변수 불필요).

**2차 조사(승인 후 명세 확정, 2026-05-22):** `target=ntsCgmExpc` 실호출로 응답 구조를 확정:

| 항목 | 실측 결과 |
|---|---|
| 요청 | `lawSearch.do?target=ntsCgmExpc&type=JSON&query=...` (기존 키) |
| 래퍼 | `{ CgmExpc: { totalCnt, cgmExpc: RawNtsExpc[] } }` |
| 본문(전문) | **미제공 — 목록만** → 참고 목록(references) 트랙 |
| 식별자 | `안건번호` (예: "법인22601-2200") |
| 기관 | `해석기관명` = "국세청" |
| 일자 | `해석일자` ("YYYY.MM.DD") |
| 원문 링크 | `법령해석상세링크` = `taxlaw.nts.go.kr/...` — **OC 키 미포함**(그대로 사용) |
| 데이터량 | 가지급금 343건·법인세 6,372건 (실무 공백 메움) |

> 조사용 임시 스크립트는 키를 출력하지 않고 사용 후 즉시 삭제했다.

---

## 변경 사항 요약

### 파일 변경 목록

**Adapter (수정)** — `src/adapters/nationalTaxLaw.ts`
- `RawNtsExpc`·`RawNtsExpcSearch` 인터페이스 추가.
- `toNtsExpcSourceUrl()` — 상세링크(taxlaw.nts.go.kr 공개 뷰어)를 그대로 사용하되, 방어적으로 OC 파라미터 제거(§7).
- `searchNtsInterpretations()` — `target=ntsCgmExpc` 목록 조회(display=10). **본문 조회 없음**.
- `toNtsInterpretationTaxLaw()` — `sourceType='해석례'`, `trustTier='T3'`, `issuingBody='국세청'`, `caseNumber=안건번호`, `decisionDate=해석일자`, **`content=''`**(본문 미제공).
- `search()` 병렬 검색·병합에 국세청 해석 추가 — Tier 순 **법령 → 법제처 해석례 → 국세청 해석 → 판례**, 부분 실패 허용.

**UI (수정)** — `app/components/AnswerCard.tsx`
- `dateLabel(sourceType, issuingBody?)` — 해석례 일자 문구를 출처별로 정확화: 법제처=‘회신일’, **국세청=‘해석일’**(API 필드가 해석일자). 인용·참고 양쪽 호출부 갱신.

**Usecase (무변경)** — `src/usecases/generateAnswer.ts`
- 본문 없는 비법령을 이미 `contentlessRefs`로 분류해 `buildReferences`가 참고 목록에 편입(TAX-015B/D). **코드 변경 불필요**.

**검증기 (무변경)** — `src/adapters/lawVerifier.ts`
- 국세청 해석은 `content=''`라 `citable`에 포함되지 않아 LLM 인용 후보가 아니며 V검증 대상도 아니다.

**테스트 (추가)** — `tests/integration/nationalTaxLaw.test.ts`
- `ntsCgmExpc` mock·핸들러 추가 + 신규 3건: ① 본문 없는 메타·T3·국세청 기관·키없는 링크, ② 병합 시 판례보다 앞(해석례 T3 < 판례 T4), ③ 국세청 해석 부분 실패해도 법령·법제처 해석례 정상 반환.

### 환경변수
- **추가 없음.** 경로 A′가 기존 `NATIONAL_TAX_API_KEY`를 그대로 사용 → CLAUDE.md §7.1 갱신 불필요.

---

## 동작 규칙 (정리)

```
국세청 해석(ntsCgmExpc) = sourceType '해석례' + issuingBody '국세청' + content ''
  → splitResults가 contentlessRefs로 분류
  → buildReferences가 관련도순(TAX-015C) 참고 목록에 편입(상위 10건)
  → 발췌 없음·law-verifier V검증 비대상(citation 승격 금지, TAX-015B 원칙)
```

- 법제처 해석례(expc, 본문 있음)는 인용 카드(발췌)로, 국세청 해석(본문 없음)은 참고 목록으로 → 둘 다 화면에서 ‘해석례’ 배지, `issuingBody`로 구분.

---

## 검증 결과

| 항목 | 결과 |
|---|---|
| `npm run typecheck` (tsc) | ✅ 에러 0 |
| `npm run test` (vitest) | ✅ **120개 전부 통과** (기존 117 + 신규 3) |
| `npm run lint` (eslint) | ✅ 경고/에러 0 |
| AC#2 국세청 해석 식별자·기관·일자·링크 포함 | ✅ 통합 테스트 |
| AC#3 참고 목록에 ⚪참고자료(T3)·발췌 없음 | ✅ content='' → references |
| AC#4 LLM 인용 후보(citable) 미전달 | ✅ content='' → splitResults에서 제외 |
| AC#5 원문 링크 키 미노출 | ✅ taxlaw.nts.go.kr, OC 없음 |
| AC#6 환경변수 미설정/실패 시 부분 실패 허용 | ✅ 부분 실패 테스트 |
| AC#7 기존 동작 회귀 없음 | ✅ 전체 통과 |

> 회계사 수동 검증 권장: `npm run dev` → http://localhost:3000 → "가지급금" 검색 → "관련 참고자료"에 국세청 해석 노출 + 원문 링크가 taxlaw.nts.go.kr로 열리는지 확인.

---

## 잠재 위험 / 한계

- **본문 부재:** 국세청 해석은 목록만 제공 → 회계사는 원문 링크(taxlaw.nts.go.kr)로 전문 확인. 발췌 인용 불가(설계 — V2 우회 금지).
- **공동활용 승인 의존:** ntsCgmExpc는 해당 카테고리 승인이 유지돼야 동작. 승인 만료·취소 시 부분 실패로 조용히 빠짐(나머지 검색 정상).
- **외부 링크 호스트:** 원문 링크가 law.go.kr이 아닌 taxlaw.nts.go.kr(국세청 홈택스)다. 정상 동작이나, 통합 테스트의 "모든 sourceUrl은 law.go.kr" 불변식은 국세청 해석이 섞이면 성립하지 않음(해당 테스트는 법령 전용 시나리오라 무관).

---

## 후속 작업
- **TAX-016C (보류):** 조세심판원 결정례 — 유효 target 미확정, 추가 조사 필요.
- 엄브렐러 `TAX-016`은 016C 완료 시 종료.

**리포트:** `docs/reports/TAX-016B_report.md`
