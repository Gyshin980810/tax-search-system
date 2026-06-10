# TAX-015 판례(판례·prec) 검색 수직 슬라이스 — 비(非)법령 자료 파이프라인 개통

> 자료유형이 다른 자료(판례)를 RAG 5단계 파이프라인 전체에 1종 먼저 통과시켜
> "통합 서랍" 구조를 검증한다. 나머지 3종(해석례·기재부 회신·조세심판원)은 후속 TAX-016.
>
> 선행 결정(2026-05-20, 회계사 협의):
> - 자료 범위: 판례 + 국세청 해석례·예규 + 기재부 회신 + 조세심판원 결정례
> - 검색 방식: API 직접 검색(국가법령정보 OpenAPI target 확장) — 벡터 DB 경로(M4/M5)와 별개 트랙
> - 데이터 구조: 통합 서랍 (기존 `TaxLaw` 확장, 자료유형 구분자 추가)

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: domain | adapter | usecase | api | ui
- **Milestone**: Post-MVP
- **Estimated Size**: L (분할의 1/2 — 본 티켓은 판례 1종으로 한정)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작
- `src/adapters/nationalTaxLaw.ts`가 국가법령정보 OpenAPI를 `target='law'`(법령)로만 호출 → 조문만 검색됨.
- 도메인 모델 `TaxLaw`에는 Trust Tier `T4(판례)`가 정의돼 있으나, 실제 판례를 검색·표현하는 경로가 없음.
- 검증 `lawVerifier.ts` V1은 인용 실재 확인을 `lawName + articleNumber`로만 수행 → 조문번호가 없는 판례는 대조 불가.

### 1.2 기대 동작
- 회계사가 검색 시, 직접 근거 조문이 빈약하면 **판례(T4)** 가 검색 결과에 함께 포함된다.
- 판례는 🟡유사사례/⚪참고자료 라벨로만 제시되며(단정 금지), 사건번호·법원명·선고일·원문 링크가 표기된다.
- 판례 인용도 law-verifier V1·V2를 통과해야 회계사 화면에 노출된다(환각·의역 차단 동일 적용).

### 1.3 영향·중요도
- 실무에서 조문이 불분명할 때 회계사는 판례→해석례 순으로 근거를 찾는다. 본 기능은 그 첫 단계를 시스템화한다.
- 비법령 자료를 다루는 "통합 서랍" 구조의 정합성을 1종으로 먼저 검증해, 후속 3종 추가(TAX-016)의 위험을 낮춘다.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일
- `src/domain/TaxLaw.ts` (수정 — `SourceType` 추가 + 선택 필드)
- `src/adapters/nationalTaxLaw.ts` (수정 — 판례 target 검색 + 응답 정규화 + 결과 병합)
- `src/adapters/lawVerifier.ts` (수정 — V1 식별자 매칭을 자료유형별로 분기)
- `app/components/AnswerCard.tsx` / `app/components/CitationCopy.tsx` (수정 — 자료유형별 표기)
- `src/domain/Citation.ts` (확인 — 라벨 타입 영향 여부)
- `.env.example` (확인 — 추가 키 불필요 예상, 동일 `NATIONAL_TAX_API_KEY` 사용)

### 2.2 외부 API·리소스 — 실호출 진단으로 확정 (2026-05-20, CLAUDE.md §11)
- 목록: `GET https://www.law.go.kr/DRF/lawSearch.do?OC=<key>&target=prec&type=JSON&query=<kw>&display=&page=`
  - 응답: `PrecSearch.prec[]` (단건이면 객체, 복수면 배열 — 정규화 필요)
  - 항목 필드: `사건번호`, `사건명`, `선고일자`(YYYY.MM.DD), `법원명`, `데이터출처명`, `판례일련번호`, `판례상세링크`, `사건종류명`
- 본문: `GET .../DRF/lawService.do?OC=<key>&target=prec&ID=<판례일련번호>&type=JSON`
  - 성공 시 `PrecService.{판시사항, 판결요지, 참조판례, 법원명, 사건번호, 선고일자, ...}`
  - **본문 내 HTML 태그(`<br/>`) 포함** → content는 원문 그대로 보존(§6.1), 화면에서만 렌더링
- 🔴 **응답의 `판례상세링크`에 `OC=<API키>`가 포함** → sourceUrl로 그대로 쓰지 말고 키 제거/재구성(§7)
- ⚠️ **본문 제공이 데이터출처별로 갈림**:
  - `데이터출처명: '대법원'`(법원) → 본문 조회 성공 ✅ → 발췌 인용(🟡) 가능
  - `데이터출처명: '국세법령정보시스템'`(국세청) → 본문 "일치하는 판례 없음" ❌ → **메타+링크만 ⚪참고** (발췌 없음)
  - (조사 완료) 국세청 자체 공식 OpenAPI 본문 경로 없음 — 비공식 스크래핑 비채택
- 참고: https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=precInfoGuide

### 2.3 아키텍처 힌트
```
UI → /api/answer → generateAnswer Usecase → ISearchPort
                                              └ NationalTaxLawAdapter
                                                   ├ searchLaws(target=law)  [기존]
                                                   └ searchPrecedents(target=prec) [신규]
                                                   → 결과 병합 → TaxLaw[] (sourceType 구분)
```

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경
- [ ] `src/domain/TaxLaw.ts` — `SourceType` 타입, `TaxLaw`에 선택 필드(`issuingBody?`, `caseNumber?`, `decisionDate?`) 추가. 기존 필드 의미·이름 유지(하위호환).
- [ ] `src/adapters/nationalTaxLaw.ts` — 판례 검색 메서드, 응답 정규화, 법령+판례 결과 병합, 캐시 키에 자료유형 반영.
- [ ] `src/adapters/lawVerifier.ts` — V1 식별자 매칭을 `sourceType`별로 분기(법령=조문번호, 판례=사건번호). V2~V6 로직은 유지.
- [ ] `app/components/AnswerCard.tsx`, `CitationCopy.tsx` — 자료유형 배지·메타 표기(최소 변경).

### 3.2 금지되는 변경
- ❌ 벡터 DB·임베딩 도입 (M4/M5 별도 트랙)
- ❌ 법령/판례 원문 임의 가공·요약·의역 저장 (CLAUDE.md §6.1)
- ❌ RAG 5단계 압축·생략, 검증[4] 우회 (CLAUDE.md §5)
- ❌ 해석례·기재부 회신·조세심판원 추가 (TAX-016 범위)
- ❌ 폴더 구조 변경, `package.json` 의존성 추가(필요 시 먼저 질문)

---

## 4. Strategy (구현 힌트)

1. **명세 확정 먼저**: 판례 목록·본문 API를 1회 실호출 → 응답 JSON 샘플을 리포트에 첨부 → 필드 매핑 확정.
2. **Domain 확장**: 
   ```ts
   export type SourceType = '법령' | '판례' | '해석례' | '심판례'
   // TaxLaw에 sourceType(필수, 기본 '법령')과 선택 메타 필드 추가
   ```
   기존 `articleNumber`는 법령 식별자로 유지, 판례 식별자는 `caseNumber?`에 보관.
3. **Adapter**: `searchPrecedents(keyword)` 추가 → 정규화 시 `sourceType:'판례'`, `trustTier:'T4'`, `issuingBody`=법원명, `caseNumber`=사건번호, `decisionDate`=선고일, `content`=판결요지/본문 **원문 그대로**.
4. **결과 병합·정렬**: 법령(T1·T2) 우선, 그 뒤 판례(T4). 자료유형 혼재 시 정렬 정책을 결정론적으로 정의(Tier↑ → 날짜↓).
5. **검증 분기**: V1을 `sourceType`에 따라 식별자 비교(법령=`articleNumber`, 판례=`caseNumber`)로 분기. V2는 `content.includes(excerpt)` 그대로 적용.
6. **UI**: 자료유형 배지(법령/판례) 표기, 판례는 사건번호·법원·선고일 노출. 라벨(🟡/⚪) 유지.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 판례 API 응답 샘플(원문 JSON)이 리포트에 첨부되고 필드 매핑이 문서화됨.
2. [ ] 검색 결과에 `sourceType:'판례'` 항목이 포함되며 사건번호·법원명·선고일·원문 링크를 가진다.
3. [ ] 판례 인용은 항상 🟡유사사례 또는 ⚪참고자료 라벨(🟢 단독 금지) — V3 통과.
4. [ ] 판례 인용에 대해 V1(사건번호 실재)·V2(발췌 원문 일치)가 정상 동작(고의 환각 케이스 1건으로 FAIL 확인).
5. [ ] 법령 단독 검색 기존 동작이 회귀 없이 유지(기존 골든셋/검색 정상).
6. [ ] 판례 원문이 코드에 의해 변형되지 않음(문자 단위 보존).
7. [ ] `npm run dev` 정상, 응답 5초 이내(기존 타임아웃 정책 유지).

---

## 6. Verification (검증 단계)
1. `npm run dev` 실행.
2. 직접 조문이 빈약한 질의(예: 판례가 풍부한 쟁점) 검색 → 결과에 판례 항목 표기 확인.
3. 판례 항목의 "원문 보기" 링크 → 국가법령정보/판례 본문으로 이동 확인.
4. 판례 라벨이 🟡/⚪로만 표기되고 단정형 문장이 없는지 확인(V6).
5. 의도적으로 존재하지 않는 사건번호 인용을 만들어 V1 FAIL → 미노출 동작 확인.
6. 법령만 매칭되는 기존 질의로 회귀 없음 확인.

---

## 7. Risks / Notes
- **응답 구조 상이**: 판례 본문은 목록 조회만으로 전문이 안 올 수 있음 → 본문 조회 2단계 필요 가능. 실호출로 확인.
- **V1 매칭 키 변경**: 분기 로직 오류 시 환각 검증이 무력화될 수 있음 → 자료유형별 단위 검증 필수.
- **정렬 결정론성**: 자료유형 혼재 시 정렬이 흔들리면 캐시·골든셋 회귀 위험 → 정렬 키를 명시적으로 고정.
- **Trust Tier**: 판례=T4. T1·T2 직접 근거가 있으면 판례 단독 🟢 금지(기존 규칙 유지).

---

## 8. AI Implementation Instructions
### 8.1 코딩 전 제출: 근본 동기 / 영향 파일 / 3~5단계 계획 → 인간 승인 후 코딩
### 8.2 코딩 후 제출: 변경 파일 / 요약 / 검증 PASS·FAIL / 위험 / `docs/reports/TAX-015_report.md`

---

## 10. Related Tickets
- 후속: `TAX-016_interpretation_tribunal_search.md` (해석례·기재부 회신·조세심판원 추가)
- 참조(별개 트랙): SSOT 로드맵 M4(벡터 DB)/M5(판례·예규 임베딩)

---

## 11. Report Link
Report: `docs/reports/TAX-015_report.md` (완료 — 2026-05-20, 회계사 수동 검증 대기)

---

**작성자**: AI 초안 (회계사 검토 대기)
**작성일**: 2026-05-20
**최종 수정일**: 2026-05-20
