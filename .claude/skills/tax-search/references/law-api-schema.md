# 국세·지방세 API 응답 스키마

## TaxLaw 객체 필드

| 필드 | 타입 | 설명 |
|---|---|---|
| `law_id` | string | 법령 고유 식별자 (예: `LAW-2024-001`) |
| `law_name` | string | 법령명 (예: `소득세법`) |
| `article_number` | string | 조문 번호 (예: `제26조 제1항 제12호`) |
| `content` | string | 조문 원문 전체 |
| `effective_date` | string | 시행 시작일 (ISO 8601: `YYYY-MM-DD`) |
| `expiry_date` | `string \| null` | 폐지일 (폐지되지 않은 경우 `null`) |
| `law_type` | `"NATIONAL" \| "LOCAL"` | 국세 / 지방세 구분 |
| `source_url` | string | 원문 링크 (필수) |
| `trust_tier` | `"T1" \| "T2" \| "T3" \| "T4"` | Trust Tier |
| `amendment_history` | `object[]` | 개정 이력 배열 |

## amendment_history 배열 항목

| 필드 | 타입 | 설명 |
|---|---|---|
| `date` | string | 개정일 (YYYY-MM-DD) |
| `summary` | string | 개정 요약 |
| `previous_content` | string | 개정 전 원문 |

## TypeScript 타입 정의

```typescript
interface TaxLaw {
  law_id: string;
  law_name: string;
  article_number: string;
  content: string;
  effective_date: string;
  expiry_date: string | null;
  law_type: "NATIONAL" | "LOCAL";
  source_url: string;
  trust_tier: "T1" | "T2" | "T3" | "T4";
  amendment_history: AmendmentRecord[];
}

interface AmendmentRecord {
  date: string;
  summary: string;
  previous_content: string;
}
```

## 빈 결과 처리

결과가 `[]`인 경우:
1. 키워드 범위를 넓혀 1회 재검색
2. 재검색 후에도 `[]`이면 그대로 반환
3. ❌ 추측·임의 생성 금지

## 주의사항
- `content` 필드는 반드시 원문 그대로 저장 (수정·요약 금지)
- `source_url`이 없으면 해당 항목은 인용 불가 (V2 FAIL 유발)
- `expiry_date`가 있는 항목은 ⚫ 폐지 라벨 필수
