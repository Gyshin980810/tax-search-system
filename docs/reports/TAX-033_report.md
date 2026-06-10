# TAX-033 구현 리포트 — 심판례 관계 그래프 (impact_map) 코어

> 작성자: AI / 작성일: 2026-05-25 / 기반 티켓: docs/tickets/TAX-033_impact_map.md

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 구분 | 설명 |
|---|---|---|
| `src/domain/ImpactMap.ts` | 신규 | 그래프 도메인 타입 (ImpactNode·ImpactEdge·ImpactMap) |
| `src/domain/relatedLawParser.ts` | 신규 | 관련법령·참조결정 파서 (순수 함수) |
| `src/domain/mermaid.ts` | 신규 | ImpactMap → mermaid graph LR 코드 생성기 |
| `src/ports/impactMapPort.ts` | 신규 | IImpactMapPort 인터페이스·TribunalRelationsRaw 타입 |
| `src/adapters/nationalTaxLaw.ts` | 수정 | RawSpecialDeccService에 참조결정 필드 추가 + fetchTribunalRelations 추가 |
| `src/usecases/buildImpactMap.ts` | 신규 | buildImpactMap usecase (PII→조회→분해→조립→mermaid) |
| `app/api/impact-map/route.ts` | 신규 | GET /api/impact-map?caseNo=청구번호 |
| `tests/unit/relatedLawParser.test.ts` | 신규 | 파서 단위 테스트 (진단5 실측 변이 20건 픽스처) |
| `tests/unit/mermaid.test.ts` | 신규 | mermaid 생성기 단위 테스트 |

---

## 주요 결정 및 설계 근거

### 1. 심판례 중심 방향 (회계사 제안 채택)
조문 중심(조문 → 역방향 키워드 근사) 대신 **심판례 중심**(심판례 → 관련법령·참조결정 명시 연계)으로 설계. 이유:
- 심판례 본문의 `관련법령`·`참조결정`은 원문 명시 연계 → 추정 없이 전부 🟢
- 키워드 근사 역방향 제거 → 환각 엣지 없음 (진단2에서 "다른 조문 사건 혼입" 실증)
- 구현 복잡도 L→M 감소

### 2. 청구번호 보완 (진단5 필수 확정 사항)
본문(SpecialDeccService) 청구번호는 **20건 전부 빈값** → `fetchTribunalRelations`는 반드시 목록 응답 청구번호 사용. 공백 유무 혼재(예: "조심 2020부1558" vs "조심2011서1540")는 공백 제거 정규화 비교로 처리.

### 3. 원문 보존 (§6.1)
- `ImpactNode.label` = 원문 조각 그대로 (의역·요약 없음)
- `ParsedLawRef.rawText` = 분리된 법령 조각 원문
- `mermaid.ts`의 `escapeLabel()`은 mermaid 렌더링을 위한 표현 조정만 수행 (원문 자체는 ImpactNode.label에 보존)

### 4. 최소 변경 (§9.7)
어댑터 수정은:
- `RawSpecialDeccService`에 `참조결정?: string` 필드 추가 (기존 코드 영향 없음)
- `NationalTaxLawAdapter`에 `fetchTribunalRelations` public 메서드 추가
- 기존 `searchTribunal`·`fetchTribunalBody`·`toTribunalTaxLaw` **무손상**

### 5. 계층 아키텍처 준수 (CLAUDE.md §4)
```
buildImpactMap (usecase)
    ↓ IImpactMapPort 인터페이스만 호출
NationalTaxLawAdapter (adapter)
    ↓ fetchTribunalRelations
국세법령정보시스템 API
```
- usecase는 `fetch` 직접 호출 없음
- API route는 usecase 호출·응답 매핑만 담당

---

## 진단5 기반 확정 파서 규칙

| 변이 | 처리 규칙 |
|---|---|
| 복수 법령 (`/` 구분) | split('/') + trim + 빈 토큰 제거 |
| 시행령이 「」 밖에 | 조각 통째로 rawText (법령명은 「」 안만) |
| 조문 제목 `【】` | rawText에 포함 그대로 |
| 항 포함 (제26조 제2항) | rawText에 포함 그대로 |
| `제N조의M` | rawText에 포함 그대로 |
| 중복 항목 | rawText 기준 dedup |
| trailing `/` | 빈 토큰 필터로 자동 제거 |
| 깨진 번호 (`제O조`) | rawText 유지, 매칭 실패 허용 |

---

## 검증 결과

### 타입 검사
```
npx tsc --noEmit → 에러 0
```

### 단위 테스트
```
npx vitest run
  Test Files  11 passed (11)
       Tests  199 passed (199)   [기존 157 + 신규 42]
    Duration  5.98s
```

- `relatedLawParser.test.ts` — 36개 (진단5 실측 변이 픽스처)
- `mermaid.test.ts` — 15개 + `safeNodeId` 5개 = 20개 (→ 실제 diff: 42개 신규)

### 기존 회귀
- 기존 테스트 157개 전부 통과 → 어댑터 수정으로 인한 회귀 없음 확인

### PII 필터
- `buildImpactMap`에서 `detectPii(caseNumber)` 호출 → 기존 PII 필터 적용

### 추정 엣지
- 관련법령·참조결정 모두 심판례 본문 원문 명시 연계 → 키워드 근사 엣지 0건

---

## API 사용 예

```
GET /api/impact-map?caseNo=조심2011서1540
→ 200 { map: {...}, mermaid: "graph LR\n..." }

GET /api/impact-map
→ 400 { error: "MISSING_CASE_NO", message: "..." }

GET /api/impact-map?caseNo=존재하지않는번호
→ 404 { error: "NOT_FOUND", message: "..." }
```

---

## 잠재 위험

| 항목 | 내용 |
|---|---|
| 목록 검색 폴백 | 청구번호 완전일치 없으면 첫 번째 후보 사용. 완전히 다른 심판례가 반환될 가능성 있음. 회계사가 결과 확인 후 사용 권장. |
| 참조결정 표기 변이 미발견 케이스 | 진단5 샘플(9건)에서 파악한 변이만 처리. 예상 밖 형식이 있으면 rawText로 그대로 표시되므로 UI에서 확인 가능. |
| 깨진 번호 (`제O조`) | 파서는 원문 유지, API 링크 생성 불가. 표시만 되고 링크는 없음. |
| 본문 조회 실패 | `fetchTribunalRelations`에서 본문 조회 실패 시 목록 데이터만으로 반환 (relatedLawsRaw·referencesRaw 빈 문자열). 그래프는 중심 노드만 있는 채로 반환됨. |

---

## 후속 작업

| 티켓 | 내용 |
|---|---|
| TAX-034 | UI — 심판례 카드에서 impact_map 버튼·mermaid 렌더링 |
| TAX-035 | PRD·SSOT 정합 (FR-19/FR-20 신설, impact_map 기능 명문화) |

---

**작성자**: AI (회계사 검토 요청)
