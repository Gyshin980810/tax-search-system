# V1: 출처 존재 확인 방법

## 목적
답변에 인용된 모든 조문이 실제 검색 결과(TaxLaw[])에 존재하는지 확인한다.
존재하지 않는 조문 인용 = 환각(Hallucination).

## 단계별 실행

### 1단계: 인용 조문 목록 추출
답변 텍스트에서 다음 패턴으로 인용된 조문을 추출:
- "소득세법 제26조 제1항" 형식
- 조문 번호가 명시된 모든 인용

### 2단계: TaxLaw[] 배열 대조

```
FOR EACH cited_law IN extracted_citations:
  IF NOT EXISTS (law IN taxLaws WHERE
    law.law_name == cited_law.law_name AND
    law.article_number == cited_law.article_number):
    V1 = "FAIL"
    BREAK
```

### 3단계: 재검색 (FAIL 시 1회 한정)
1. 누락된 조문을 키워드로 재검색
2. 재검색 성공 → TaxLaw[]에 추가 → 재검증
3. 재검색 실패 → `E-VERIFY-FAIL`

## 주의사항
- ❌ "아마 있을 것이다"로 PASS 처리 금지
- ❌ 유사한 조문으로 대체 금지
- ✅ 정확한 법령명 + 조문번호 일치만 인정

## 흔한 V1 실패 패턴
- tax-generator가 검색 결과에 없는 조문을 "알고 있는 법령"으로 인용
- 조문 번호 오기 (제26조 → 제62조 등)
- 법령명 약칭 사용 (소세법 → 소득세법으로 정규화 필요)
