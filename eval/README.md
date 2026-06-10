# eval/ — 골든셋 평가 인프라

## 디렉토리 구조

```
eval/
├── README.md                   # 이 파일
├── GOLDEN_SET_GUIDE.md         # ★ 골든셋 30건 작성 방법 (회계사용 단계별 가이드)
├── golden_direct.json          # V1~V6 직접 검증용 픽스처 (실제 API 없음)
├── baseline.json               # 실제 API 응답 기반 기준선 (통과율 목표 포함)
├── golden-set/                 # 케이스별 상세 요구사항 (마크다운)
│   ├── G-1_basic-deduction.md
│   ├── G-2_real-estate.md
│   ├── G-3_corporate-tax.md
│   ├── G-4_inheritance.md
│   └── G-5_local-tax.md
└── reports/                    # 평가 실행 결과 리포트
    └── 2026-05-12_eval.md
```

---

## 골든셋 케이스 목록

| ID | 설명 | 핵심 검증 포인트 |
|---|---|---|
| **G-1** | 소득세법 기본공제 (본인 150만원) | T1 🟢, [현행], V1~V6 PASS |
| **G-2** | 1세대 1주택 비과세 요건 | T1 조문 2개, [현행], V1~V6 PASS |
| **G-3** | 법인세 손금 범위 | T1 조문 2개 (제19조·제27조), [현행] |
| **G-4A** | 상속세 기초공제 현행 | T1 🟢, [현행] |
| **G-4B** | 상속세 기초공제 개정 전 (시점 분기) | T1 ⚫폐지, [폐지:...] |
| **G-5** | 지방세 재산세 납부기한 | T1 LOCAL, [현행] |

---

## 파일별 역할

### `golden_direct.json`

law-verifier V1~V6 로직을 **실제 API 없이** 단위 테스트하기 위한 픽스처.

각 케이스에는 다음이 포함됩니다:
- `sourceLaws`: 검색 단계([2])가 반환한 TaxLaw 배열 (Mock)
- `answer`: 답변 생성 단계([3])가 만든 LabeledAnswer (Mock, `verificationResult.status: "PENDING"`)
- `expectedStatus`: 검증 후 기대되는 `'PASS'` 또는 `'FAIL'`

**테스트 실행:**
```bash
npx vitest run tests/golden/run_golden.test.ts
```

내부적으로 `LawVerifierAdapter.verify(answer, sourceLaws)`를 직접 호출합니다.

### `baseline.json`

실제 국세법령정보시스템 API를 사용한 E2E 평가용 기준선.

- `pass_k`: 합격 기준 통과 케이스 수
- `threshold`: 합격률 목표 (1.0 = 100%)
- `cases`: 각 케이스별 예상 법령·라벨·시점 라벨

### `golden-set/*.md`

각 골든 케이스의 **요구사항 원문** (인간이 작성한 스펙).

- 예상 조문 (법령명, 조문번호, Trust Tier)
- 예상 라벨
- 예상 답변 구조
- V1~V6 검증 기준

---

## V1~V6 검증 항목 요약

| 항목 | 통과 조건 | 재시도 정책 |
|---|---|---|
| **V1** 출처 존재 | 인용 조문이 sourceLaws에 존재 | 재검색 1회 → 재생성 |
| **V2** 인용 무결성 | excerpt가 원문에 완전 포함 | 재생성 1회 |
| **V3** 라벨 적정성 | T1/T2→🟢⚫, T3/T4→🟡⚪⚫ | 재생성 1회 |
| **V4** 시점 표기 | temporalLabel 비어 있지 않음 | 재생성 1회 |
| **V5** 면책 고지 | disclaimer 비어 있지 않음 | 자동 부착 |
| **V6** 단정 금지 | 🟡유사사례 있을 때 단정 패턴 없음 | 재생성 1회 |

재시도 후에도 FAIL → `AppError('E-VERIFY-FAIL')` → UI에 "확인 어려움" 안내

---

## 합격선 (M3)

- `golden_direct.json` 6개 케이스: **100% PASS** (law-verifier 단위)
- `baseline.json` 기준: **5/5 케이스 PASS** (실제 API + E2E)
- Playwright E2E 5개 시나리오: **100% PASS**

---

**참조:**
- `src/adapters/lawVerifier.ts` — V1~V6 구현체
- `tests/golden/run_golden.test.ts` — 골든셋 직접 검증 테스트 러너
- `CLAUDE.md §6.4` — 검증 V1~V6 원문 규칙
