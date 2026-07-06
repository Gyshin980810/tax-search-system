# [TAX-6B-32] 참고목록 인용 그래프 반영 — 1-hop 확장 + 피인용 랭킹 리포트

> 작성: 2026-07-06 · 상태: **구현 완료** (라이브 §6 검증은 회계사 몫)

---

## 1. 요약

검색된 심판례·판례가 **원문에서 직접 지목한 선례**(citation_edges, TAX-6B-31 적재)를
참고목록 확정 직전에 1-hop 확장하고, **피인용수(권위 신호)**로 정렬을 부스트한다.

- 확장·부스트 모두 **참고목록(references) 전용** — 발췌 인용(citations)으로 승격되지 않음(SSOT §7.4, V1~V6 비대상)
- SQL 배치 최대 3콜, **LLM·임베딩 호출 0**(P95 보호)
- `citationGraphPort` 미주입·DB 오류 시 기존 동작 100% 동일(graceful degrade)

## 2. 회계사 결정 반영 (2026-07-06)

| 결정 항목 | 선택 | 반영 위치 |
|---|---|---|
| 착수 강도 | 보수적 착수(상한 3·가중치 0.5) | `MAX_CITATION_EXPANSION=3`, `CITATION_BOOST_WEIGHT=0.5` |
| 확장 컷오프 | **면제**(원문 지목 = 결정론적 관련) | `applyCitationGraph`에서 확장 문서는 `MIN_RELEVANCE_SCORE` 미적용 |
| 부스트 범위 | **전체 적용**(기존+확장) | `getInDegrees` 1콜로 전체 후보에 `citationBoost` 가산 |

## 3. 변경 파일

**신규:**
- `src/ports/citationGraphPort.ts` — `ICitationGraphPort` + `CitationEdge`(IVectorSearchPort와 독립)
- `src/adapters/citationGraph.ts` — `PgCitationGraphAdapter`(pg 배치 3쿼리, APPEAL 제외 SQL)
- `tests/unit/citationGraph.test.ts` — 확장·상한·부스트·degrade·승격금지·SQL계약 13건

**수정:**
- `src/domain/nonLawRelevance.ts` — `citationBoost`·`CITATION_BOOST_WEIGHT` 추가(기존 함수 무변경)
- `src/usecases/generateAnswer.ts` — `applyCitationGraph`([4.5]확장·[4.6]부스트) + 선택적 주입
- `app/api/answer/route.ts` — `PgCitationGraphAdapter` 조립·주입(DATABASE_URL 있을 때만)

## 4. 핵심 설계

### 4.1 사건번호 정규화 정합 (이번 세션 필수 발견)

검색 후보 표기(`조심 2018지166`)와 엣지·DB 표기(`조심2018지0166`)가 달라, usecase에서
`normalizeTribunalCaseNumber`(TAX-6B-31 산물)로 **정규화한 뒤** 조회·중복제거·부스트 조회한다.
이 정규화가 없으면 확장·부스트가 표기 변이로 어긋난다.

### 4.2 흐름 (buildReferences [4]과 [5] 사이 삽입)

```
[4] 벡터 라이브 검색
 ▼
[4.5] getOutgoing(후보 사건번호) → 미노출·FOLLOWS/REFERS·in_corpus 엣지
      → getDocumentsByCaseNumbers(대상) → 확장 문서 후보 합류(점수 0)
[4.6] getInDegrees(기존+확장 전체) → 각 점수에 citationBoost 가산
      → 확장 문서는 부스트 상위 3건만 절단(비대화 방지)
 ▼
[5] 병합 → 정렬 → 상한(MAX_REFERENCES)
```

### 4.3 안전장치

- **APPEAL 제외**: `getOutgoing` SQL이 `edge_type IN ('FOLLOWS','REFERS')`만 조회
  — 원심/환송은 "선례 지지"가 아니므로 확장에서 배제(단위 테스트로 SQL 계약 검증)
- **승격 금지**: 확장 문서는 `merged` 배열에만 존재, `citations` 경로 접근 지점 자체가 없음(구조적)
- **부스트는 순서만 조정**: 컷오프는 [3]에서 끝나 부스트가 탈락 자료를 되살리지 못함
- **degrade**: 미주입 시 입력 배열 그대로 반환(deep-equal), 오류는 try/catch로 기존 목록 복귀

## 5. 검증 결과

1. `tsc --noEmit` 오류 0
2. `eslint`(변경 6파일) 오류 0
3. `npm run test` — 50파일 **768/768 GREEN**(신규 13건 포함, 기존 755건 무회귀)
   - 확장(지목 선례 추가) / 중복 방지 / 상한 3건(피인용 순) / 부스트 역전 정렬
   - degrade(미주입·throw) / 승격 금지 / `citationBoost` 순수함수 / SQL 계약(APPEAL 제외·빈입력 무조회)

## 6. 라이브 검증 (회계사 몫 — LLM 과금·DB 연결 필요)

1. `npm run dev` → 심판례가 잡히는 질문(예: "가지급금 인정이자") 검색
2. 참고목록에 인용 선례가 추가되는지, 원문 링크 정상인지 확인
3. DB 연결 제거 후 같은 질문 → 기존과 동일한 참고목록(오류 없음) 확인
4. 응답 시간이 유의미하게 늘지 않는지(SQL 3콜은 ms 단위)

## 7. 잠재 위험 / 후속

- 확장 문서가 질문과 다른 쟁점일 수 있음(선례이나 논점 차이) → 상한 3건 + 라벨(T3🟡·T4⚪)로 완화
- `CITATION_BOOST_WEIGHT=0.5`는 보수 초기값 — 골든셋 회귀로 부작용 확인 후 튜닝
- 확장 유래(어느 문서가 지목했는지) UI 노출은 이 티켓 범위 밖(데이터만 준비) — 후속 결정
- **G-2 골든셋 회귀 실측**은 라이브 필요 → 회계사 판단(§6과 함께)

## 8. 관련

- 선행: `TAX-6B-31`(citation_edges 적재, 필수)
- 후속: `TAX-6B-33`(OVERRULED 검수 큐)
- 참조: `TAX-6B-10`~`12`(참고목록 관련도), `TAX-6B-26`(선택적 포트 주입 선례)
