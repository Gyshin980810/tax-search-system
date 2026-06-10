# 세법 검색 워크플로우 — tax-search SKILL

## 역할
자연어 질문을 외부 API 검색 파라미터로 변환하고, 검색 결과를 정규화된 TaxLaw[] 형식으로 반환한다.

## 단계별 워크플로우

### 단계 1: 자연어 → 파라미터 변환 (tax-planner)
1. 질문에서 핵심 법령명, 조문번호, 키워드 추출
2. 시점 표현 감지 (`예전`, `이전 법`, `바뀌기 전` 등) → 시점 확인 요청 (자의적 판단 금지)
3. 출력 형식: `{ lawName?: string, articleNumber?: string, keyword: string, lawType: "NATIONAL" | "LOCAL" }`

### 단계 2: 외부 API 호출 (tax-searcher)
1. 국세법령정보시스템 API 호출 (`lawType: "NATIONAL"`)
2. 지방세법령정보시스템 API 호출 (`lawType: "LOCAL"`)
3. 결과가 빈 배열이면 키워드를 넓혀 1회 재검색
4. 여전히 빈 배열이면 `[]` 반환 (추측 금지)

### 단계 3: 결과 반환
- 원문 그대로 반환 (수정·요약 금지)
- 반드시 `references/law-api-schema.md` 필드 형식 준수

## 주의사항
- ❌ 법령 원문 수정·요약·의역 금지
- ❌ 검색 결과 없을 때 임의 추정 금지
- ❌ 시점 모호 시 자의적 시점 선택 금지
- ✅ 항상 원문 링크(`source_url`) 포함
- ✅ 빈 결과는 `[]` 그대로 반환
