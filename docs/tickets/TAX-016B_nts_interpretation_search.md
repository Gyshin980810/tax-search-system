# TAX-016B 국세청 법령해석(해석례·예규) 검색 추가 — 본문 미제공 참고자료 트랙

> TAX-016에서 분할된 자료원. 국세청 소관 법령해석(해석례·예규)을 검색 결과에 포함한다.
> **핵심 제약: 국세청 법령해석은 "목록 조회"만 제공되고 본문(전문)이 없다** → TAX-015B/015D의 "본문 미제공 → 참고 목록" 구조로 노출(citable 아님, 발췌·V2 비대상).
> 선행: TAX-015B/015C/015D, TAX-016A 완료.

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: adapter | usecase | ui
- **Milestone**: Post-MVP
- **Estimated Size**: M (접근 경로 확정 단계 포함)
- **Blocked-by**: 외부 API 접근 키/타깃 확정 (§7 참조)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작
- 검색 결과에 법령(T1·T2)·법령해석례(법제처 회신, T3 — TAX-016A)·판례(T4)는 포함됨.
- 그러나 **국세청 소관 법령해석(국세청 해석례·예규, T3)**은 빠져 있음.
- 회계사 테스트에서 드러난 사각지대: **가지급금/법인세 등 실무 쟁점은 법제처 해석례(expc)가 0건**이고, 해당 영역의 권위 있는 해석은 **국세청 자체 해석·예규**에 존재. 즉 현재 시스템은 법인세 실무 핵심 질의에 T3 근거를 제시하지 못함.

### 1.2 기대 동작
- 회계사 검색 시 **국세청 법령해석 목록**이 검색 결과에 포함된다.
- 본문이 없으므로 **참고 목록(references)** 에 ⚪참고자료(T3)로 노출 — 제목(안건명)·문서번호·생산기관(국세청)·회신일·원문 링크 표기.
- 발췌(excerpt)는 생성하지 않으며 law-verifier V검증 대상이 아니다(citation 승격 금지 — TAX-015B 원칙).

### 1.3 영향·중요도
- 법인세·소득세 실무 질의(가지급금·접대비·감가상각 등)에 대해 **회계사가 "관련 국세청 해석이 존재함"을 인지**하게 됨 → 메모리 `feedback_similar_cases`("모른다"보다 유사 사례 제시 선호)와 정합.
- 실무 판단 순서(조문 → 해석례 → 심판례 → 판례)에서 빠져 있던 국세청 해석 단계를 보강.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일
- `src/adapters/nationalTaxLaw.ts` (수정 — 국세청 해석 검색 메서드 + 정규화 + 병합)
- `src/usecases/generateAnswer.ts` (확인 — 본문 없는 비법령은 기존 `buildReferences`가 자동 처리. 코드 변경 없을 가능성 높음)
- `app/components/AnswerCard.tsx` (확인 — `해석례` 배지·`회신일` 라벨 이미 존재(TAX-016A). 국세청 구분은 `issuingBody`로 표기. 변경 최소)
- `src/adapters/lawVerifier.ts` (무변경 — references는 검증 비대상)
- `src/domain/TaxLaw.ts` (확인 — `sourceType:'해석례'` 재사용, `issuingBody`로 국세청/법제처 구분. 신규 sourceType 불필요 예상)

### 2.2 외부 API·리소스 (⚠️ 구현 전 실호출로 확정 — 추측 코딩 절대 금지)

**확정된 사실(공개 문서·이전 실호출 조사):**
- 국세청 법령해석은 **국가법령정보 공동활용(open.law.go.kr)** 카탈로그의 "국세청 법령해석 목록 조회"로 존재("중앙부처 1차 해석" 섹션).
- **본문 조회는 미제공(가이드 표상 하이픈)** — 목록(메타)만 제공.
- 동일 데이터가 공공데이터포털에도 게시: `https://www.data.go.kr/data/15140313/openapi.do` (법제처_국세청 법령해석 목록 조회).
- 이전 TAX-016A 조사 시 **기존 OC 키 + `target=expc`로는 법제처 회신만** 반환됨(국세청 해석 미도달).

**Task 1 실호출 결과(2026-05-21 — 확정):**
- 기존 OC 키 `target=expc`는 7개 키워드(법인세·소득세·부가가치세·감가상각·양도소득세 등) 전부 **회신기관=법제처뿐, 국세청 0건** → expc로는 국세청 해석 도달 불가.
- 중앙부처해석 후보 target(lsExpc/cgmExpc/centerExpc/admExpc) 전부 빈/404 응답.
- `가지급금`·`접대비`는 법제처 expc 자체가 0건 → TAX-016B가 메울 공백 확인.
- **결정: 경로 A′(open.law.go.kr 공동활용 "국세청 법령해석" 카테고리 추가 승인 — 기존 OC 키 재사용, 새 env 불필요).**

**A′ 경로 잔여 확정 필요(회계사 협조):**
- (1) open.law.go.kr 로그인 → 활용신청으로 "국세청 법령해석(중앙부처 1차 해석)" 카테고리 승인(1~2일).
- (2) 승인 후 해당 가이드의 **target 코드**와 요청 URL 예시 공유(가이드 표는 로그인 시 노출, AI 정적 fetch로는 미확인).
- (3) 응답 출력 필드(안건명·안건번호·회신일자·생산기관·원문링크 seq) 1건 샘플 공유.
- (4) 원문 링크에 OC 키 노출 여부 → 노출 시 키 제거 재구성(TAX-015/016A 선례).

### 2.3 아키텍처 힌트
```
NationalTaxLawAdapter
  ├ fetchArticles(law)              [기존]
  ├ searchInterpretations(expc)     [TAX-016A — 법제처 회신, 본문 있음 → citable]
  ├ searchPrecedents(prec)          [TAX-015 — 판례]
  └ searchNtsInterpretations(?)     [본 티켓 — 국세청 해석, 본문 없음 → references]
  → 병합: 법령(T1·T2) → 해석례(T3) → 판례(T4)
```
- 국세청 해석은 본문이 없으므로 `excerpt` 없는 `TaxLaw`로 정규화 → `generateAnswer.splitResults`가 `contentlessRefs`로 분류 → `buildReferences`가 관련도순(TAX-015C) 참고 목록에 편입.

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경
- [ ] **Task 1 (선행):** 접근 경로 실호출 확정 → 응답 샘플·필드 매핑을 리포트에 문서화.
- [ ] `nationalTaxLaw.ts` — `searchNtsInterpretations` + `toNtsInterpretationTaxLaw`(본문 없는 정규화) + 병합/부분 실패 허용 + 캐시 키 반영.
- [ ] (B 경로일 때만) 환경변수 1개 추가 — **§7.1 표 갱신 + `.env.example` 템플릿 + 회계사 확인 선행**.
- [ ] `AnswerCard.tsx` — 필요 시 국세청 해석 표기 미세 조정(기본은 기존 `해석례` 배지 재사용).
- [ ] 테스트 — 통합(MSW mock) + 단위(references 편입) 추가.

### 3.2 금지되는 변경
- ❌ **국세청 해석에 발췌(excerpt) 부여** — 본문 미제공이므로 발췌 자체가 불가, citable 승격 금지(V2 우회 금지).
- ❌ 본문 없는 자료를 LLM 인용 후보(citable)로 전달.
- ❌ 원문 의역·요약 저장, 임의 본문 스크래핑(약관·안정성 — TAX-015 선례로 비채택).
- ❌ T3 자료를 단독 🟢직접근거로 단정(T1·T2 우선 규칙).
- ❌ TAX-015/016A 구조의 광범위 리팩터(최소 변경).
- ❌ API 키(serviceKey/OC)를 로그·에러·UI·원문 링크에 노출(§7).

---

## 4. Strategy

1. **접근 경로 확정(Task 1):**
   - 1-a. 기존 OC 키로 공동활용 국세청 해석 target/필터 실호출 시도(있으면 새 키 불필요 — 최선).
   - 1-b. 실패 시 data.go.kr 15140313 serviceKey 경로 명세 확인 → 회계사에게 키 발급·환경변수 추가 확인 요청.
   - 1-c. 응답 샘플(JSON/XML) + 필드 매핑표를 리포트에 첨부.
2. 본문 없는 정규화 함수 `toNtsInterpretationTaxLaw`: `sourceType:'해석례'`, `trustTier:'T3'`, `issuingBody:'국세청'`, `caseNumber=문서/안건번호`, `decisionDate=회신일자`, `excerpt` **미설정**, `sourceUrl`=키 제거 공개 링크.
3. `search()` 병합에 국세청 해석 추가 — Tier 순서(법령 → 해석례 → 판례) 유지, `sortByDecisionDate` 재사용, **부분 실패 허용**(국세청 자료원 장애 시 나머지 결과 반환).
4. `generateAnswer`는 변경 최소 — `splitResults`가 본문 없는 국세청 해석을 `contentlessRefs`로 자동 분류, `buildReferences`가 참고 목록에 편입(이미 구현됨). 확인만.
5. 단위·통합 테스트로 회귀 방지.

---

## 5. Acceptance Criteria

1. [ ] 국세청 해석 응답 샘플(JSON)·필드 매핑이 `docs/reports/TAX-016B_report.md`에 문서화됨.
2. [ ] 검색 결과(`TaxLaw[]`)에 국세청 해석이 포함되고 안건명·문서번호·생산기관(국세청)·회신일·원문 링크를 가진다.
3. [ ] 국세청 해석은 **참고 목록(references)** 에 ⚪참고자료(T3)로 노출되며 **발췌가 없다**.
4. [ ] 국세청 해석은 LLM 인용 후보(citable)로 전달되지 않는다(본문 미제공).
5. [ ] 원문 링크에 키가 노출되지 않는다.
6. [ ] (B 경로) 환경변수 미설정 시 국세청 해석만 조용히 제외되고 나머지 검색은 정상 동작(부분 실패 허용).
7. [ ] 법령·법제처 해석례·판례(TAX-015/016A) 기존 동작 회귀 없음.

---

## 6. Verification

1. `npm run typecheck` / `npm run test` / `npm run lint`.
2. `npm run dev` → 가지급금·접대비 등 법인세 실무 쟁점 검색 → "관련 참고자료"에 국세청 해석 노출 확인.
3. 국세청 해석 항목 원문 링크 이동 확인(키 미노출 확인).
4. 환경변수 제거 상태로 검색 → 국세청 해석만 빠지고 나머지 정상(부분 실패 허용) 확인.
5. 기존 법령·해석례(expc)·판례 질의 회귀 없음.

---

## 7. Risks / Notes — 🔑 핵심 관문

- **경로 확정: A′(공동활용 추가 승인) — 2026-05-21 회계사 결정.** 기존 OC 키 재사용·새 env 불필요·기존 어댑터 패턴 재사용으로 변경 최소.
  - **선행(블로커): 회계사가 open.law.go.kr에서 "국세청 법령해석" 카테고리 활용신청 → 승인(1~2일) + target 코드/샘플 공유** 후에야 구현 착수.
  - target 코드 미확정 상태에서 추측 코딩 금지(CLAUDE.md). 승인·코드 확보 전 구현 보류.
  - (대안 B, data.go.kr serviceKey + `DATA_GO_KR_SERVICE_KEY` env 추가)는 A′ 승인 거절·지연 시 폴백으로만 재검토.
- **본문 부재**: 국세청 해석은 목록만 제공 → 회계사는 원문 링크로 전문 확인 필요(발췌 인용 불가). 화면상 "참고자료"로만 보임.
- **호출 수 증가**: 자료원 추가로 호출 1건 늘어남 → 병렬 호출·타임아웃·부분 실패 허용으로 응답 지연 방지.
- **데이터 커버리지**: 국세청 해석이 모든 쟁점을 커버하지 않을 수 있음 — 0건 주제는 빈 결과 정상.

---

## 8. AI Implementation Instructions
### 8.1 코딩 전: Task 1(접근 경로 실호출 확정) → 동기·영향 파일·단계 계획 → 회계사 승인 후 코딩.
### 8.2 코딩 후: 변경 파일 / 요약 / 검증 결과 / 위험 / `docs/reports/TAX-016B_report.md`.

---

## 10. Related Tickets
- 선행: `TAX-015B`(본문 미제공 참고 목록), `TAX-015C`(관련도순), `TAX-015D`(참고 목록 확장), `TAX-016A`(법제처 해석례)
- 엄브렐러: `TAX-016`(016B·016C 완료 시 종료)
- 후속: `TAX-016C`(조세심판원 결정례 — target 미확정, 보류)

## 11. Report Link
Report: `docs/reports/TAX-016B_report.md` (완료 — 2026-05-22, 경로 A′·target=ntsCgmExpc, 테스트 120개 통과)

---

**작성자**: AI 초안 (회계사 검토 대기)
**작성일**: 2026-05-21
