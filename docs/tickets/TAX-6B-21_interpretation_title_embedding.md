# TAX-6B-21 해석례 제목 전량 벡터 적재 (본문 없는 경량 선행 단계)

> TAX-6B-20(본문 적재)의 **싸고 안전한 선행 단계**.
> 본문이 아니라 **목록 API의 제목(+메타)만** 임베딩해 의미 검색 후보 풀을 넓힌다.
> 회계사 승인 전까지 실제 수집·임베딩은 착수하지 않는다.

---

## Metadata

- **Type**: FEAT
- **Severity**: minor
- **Layer**: infra (수집 스크립트) + adapter (검색 경로) + docs
- **Milestone**: Post-MVP (Phase 6B 데이터 인프라)
- **Estimated Size**: M (수집기 1 + 검색 경로 조정)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작 (TAX-6B-19 직후)

- 해석례 검색은 **제목 글자 매칭**으로 후보를 추린 뒤(최대 `display`=12건),
  TAX-6B-12의 의미 재정렬로 순서만 다듬는다.
- 한계: 후보 진입 자체가 **"글자가 겹쳐야"** 하므로, 동의어·다른 표현
  (예: 질의어 "특수관계자 저가양도" ↔ 제목 "부당행위계산부인 관련 질의")은
  **글자 무겹침 → 후보에서 누락**된다.

### 1.2 기대 동작

- 해석례 **제목(+법령명·일자·caseNumber 등 메타)을 전량 벡터 DB에 적재**.
- 검색 시 글자 무겹침이라도 **의미가 가까우면 후보로 회수**(recall 향상).
- 본문이 없으므로 발췌 인용(🟢 직접 근거) 승격은 여전히 불가 → **참고 목록 한정**(현행 정책 유지).

### 1.3 영향·중요도

- 본문 스크래핑(불안정·무결성 위험) 없이, **expc + ntsCgmExpc 둘 다** 목록 API의 제목만으로
  ~14.5만 건(expc ~8,757 + ntsCgmExpc ~136,280)을 한 번에 커버 가능.
- TAX-6B-20(본문) 착수 전, 효과를 저비용으로 먼저 측정하는 단계.

---

## 2. Context (기술적 맥락)

### 2.1 핵심 전제 — "제목은 본문 API가 필요 없다"

- 제목·caseNumber·일자·법령명은 **목록 API(`lawSearch.do`)** 응답에 이미 포함.
- 따라서 **본문 API 부재(ntsCgmExpc)나 스크래핑 불안정과 무관**하게 두 소스 모두 적재 가능.
- §6.1 무결성 위험: 제목은 원문 메타 그대로 저장(가공·요약 금지) → 위험 거의 없음.

### 2.2 관련 파일

- `scripts/collectInterpretationTitles.ts` (신규 예정) — 목록 전량 수집(제목·메타), resume·throttle·scrubOc
- `scripts/embed.ts` (재사용, 무변경 목표) — voyage-4(1024) 임베딩 적재
- `scripts/embedQuality.ts` (재사용) — caseNumber 중복·누락 게이트
- `src/adapters/nationalTaxLaw.ts` / 벡터 검색 경로 (후속 단계에서 해석례 의미검색 합류)

### 2.3 외부 API·리소스

- `law.go.kr/DRF/lawSearch.do` (target=expc, ntsCgmExpc) — 목록만
- robots.txt: 목록 경로 허용(2026-06-22 확인). `Disallow`(`/is/USEISA001M.do`, `/is/USEISA003M.do`) 미접근.

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `scripts/collectInterpretationTitles.ts` 신규 — expc·ntsCgmExpc 목록 전량 수집(제목·메타 JSONL)
- [ ] 임베딩 적재 — 기존 `embed.ts` 재사용(무변경 목표), `embedQuality` 게이트 통과 후 pgvector 적재
- [ ] 검색 경로 — 해석례 벡터 후보를 의미검색으로 회수(기존 글자 매칭/실시간 폴백 보존)
- [ ] 문서 정합 (SSOT/PRD) — "제목 벡터 적재" 정책 명문화

### 3.2 금지되는 변경

- ❌ **본문 적재·스크래핑** (이건 TAX-6B-20 소관 — 본 티켓은 제목만)
- ❌ 제목·메타 임의 가공·요약 (§6.1 — 문자 단위 보존)
- ❌ 발췌 인용·🟢 직접 근거 승격 (본문 없음 → 참고 목록 유지)
- ❌ V1~V6 검증 로직 변경 (§6.4)
- ❌ Usecase에서 fetch/DB 직접 호출 (Port만)
- ❌ API 키(OC)·DATABASE_URL 로그·sourceUrl·에러 노출 (scrubOc)
- ❌ robots.txt Disallow 경로 접근, 무제한 일괄 수집 (throttle·resume 필수)

---

## 4. Strategy (구현 힌트)

1. **수집기**: `collectInterpretationTitles.ts` — 페이지네이션으로 목록 전량 순회,
   caseNumber 키로 중복 제거(또는 최신일자순), resume(중단 재개)·throttle 적용, JSONL 산출.
2. **품질 게이트**: `embedQuality.inspectNonLawCaseNumbers()`로 중복·누락 0 확인.
3. **임베딩**: `embed.ts` 재사용 — 임베딩 대상 텍스트 = `제목`(필요시 법령명 결합),
   본문 없으므로 `content=''` 유지.
4. **검색 경로**: 해석례 벡터 후보를 의미검색으로 회수 → 기존 글자 매칭 결과와 병합,
   TAX-6B-12 가중합 패턴 재사용. 실시간 폴백 보존(P95 안전).

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] expc·ntsCgmExpc 목록 제목·메타가 JSONL로 수집됨(caseNumber 유일성 보장)
2. [ ] 제목·메타가 원문과 문자 단위 일치(§6.1), scrubOc로 키 미노출
3. [ ] `embedQuality` 게이트 통과(중복·누락 0) 후 pgvector 적재(차원 1024)
4. [ ] 글자 무겹침이지만 의미가 가까운 샘플 질의에서 관련 해석례가 후보로 회수됨(회계사 샘플 확인)
5. [ ] 해석례는 여전히 참고 목록(🟡/⚪) — 발췌 인용 승격 없음(정책 회귀 없음)
6. [ ] 기존 vitest 그린 유지, P95 합격선(15s) 미회귀

---

## 6. Verification (회계사 확인 순서)

1. 수집기 dry-run 로그 확인(실적재 전, throttle·resume 동작)
2. 샘플 제목 3건이 원문 목록과 일치하는지 육안 대조
3. `npm run dev` → 동의어 질의(예: "특수관계자 저가양도")로 부당행위계산부인 해석례가 참고 목록에 노출되는지 확인
4. 링크 클릭 → 키 없는 공개 뷰어로 원문 이동 확인

---

## 7. Risks / Notes

- ℹ️ **천장 한계**: 제목은 사실관계가 없어 정밀 순위에는 한계. 정밀도가 더 필요하면 TAX-6B-20(본문)으로 승격.
- ℹ️ expc는 전 분야라 세법 외 노이즈 포함 → 의미 가중치·컷오프(TAX-6B-12 패턴)로 완화.
- ⚠️ 저장소 용량: 제목만이라 작지만(본문 대비 수십분의 1), TAX-6B-18(심판례)·6B-20과 같은 저장소 플랜 위에서 운영.
- ℹ️ caseNumber 중복 없음(해석례 내 유일) — embedQuality로 재확인.

---

## 10. Related Tickets

- 선행: TAX-6B-19(해석례 목록 전용), TAX-6B-12(의미 재정렬), TAX-6B-15(voyage-4)
- 후속: **TAX-6B-20**(본문 적재 — 본 티켓 효과 측정 후 필요 시 승격)
- 형제: TAX-6B-18(심판례 전량 적재 — 저장소 플랜 공유)

---

## 11. Report Link

Report: `docs/reports/TAX-6B-21_report.md` (미작성)

---

**작성자**: AI (회계사 의뢰)
**작성일**: 2026-06-23
**최종 수정일**: 2026-06-23
