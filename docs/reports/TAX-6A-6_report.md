# TAX-6A-6 리포트: G-3 시점 검색 골든셋 20건 골격 생성

> 작성일: 2026-06-11  
> 작성자: Claude Code  
> 상태: **완료 (회계사 검수 대기)**

---

## 변경 사항 요약

**파일 변경 목록:**
- `eval/golden_temporal.json` (신규) — G-3 시점 검색 골든셋 20건 골격
- `tests/golden/run_golden.test.ts` (수정) — G-3 선택적 로드 + 빈 expectedStatus 필터

---

## 주요 내용

### 1. golden_temporal.json — 20건 골격

개정 전/후 비교 케이스 중심으로 8개 세목 영역 구성:

| 케이스 범위 | 영역 | 비교 시점 |
|---|---|---|
| G3-01~02 | 법인세율 | 2017(3구간) vs 2019(4구간, 2018 개정 후) |
| G3-03~04 | 소득세 최고세율 | 2017(40%) vs 2019(42%, 3억~5억 신설) |
| G3-05~06 | 소득세 공제 | 근로소득공제 한도(2019), 자녀세액공제(2018) |
| G3-07~08 | 간이과세 기준금액 | 2020(4,800만원) vs 2021(8,000만원) |
| G3-09~11 | 1세대 1주택 | 보유요건(2017), 거주요건(2020), 고가주택기준(2020) |
| G3-12~14 | 종합부동산세 | 공제(2020, 6억), 세율(2022, 중과), 공제(2023, 9억 완화) |
| G3-15~16 | 증여재산공제 | 2015(3,000만원) vs 2020(5,000만원) |
| G3-17~18 | 퇴직소득세 | 구 방식(2015) vs 신 방식(2019) |
| G3-19~20 | 취득세 | 개정 전(2020.07) vs 다주택 중과(2020.08 이후) |

**골격 구조:**
```json
{
  "id": "G3-XX",
  "description": "...",
  "question": "YYYY년 기준 ...",
  "targetDate": "YYYY-MM-DD",
  "sourceLaws": [ { ..., "content": "(회계사 검수 후 실제 API 원문으로 교체)" } ],
  "answer": {
    "citations": [ { ..., "temporalLabel": "[적용 시점: (검수 후 기재)]" } ],
    "summary": "",
    "temporalLabel": "[적용 시점: (검수 후 기재)]"
  },
  "expectedStatus": ""
}
```

### 2. run_golden.test.ts — G-3 선택적 로드

```typescript
// G-3: expectedStatus가 채워진 케이스만 포함 (회계사 검수 전 골격 제외)
const temporalCases = existsSync(temporalPath)
  ? JSON.parse(...).cases.filter(
      (c) => c.expectedStatus === 'PASS' || c.expectedStatus === 'FAIL'
    )
  : []

const allCases = [...directSet.cases, ...temporalCases]
```

- 현재: G3 전체 0건 포함 (모두 빈 expectedStatus) → 빌드·테스트 영향 없음
- 회계사 검수 후 expectedStatus 채우면 자동으로 러너에 포함됨

---

## 검증 결과

1. `vitest run` — **468/468 PASS** (기존 468건 전체 유지, 신규 0건 추가)
2. G-3 파일 로드 경로 확인 (existsSync → 정상 로드)
3. 빈 expectedStatus 필터 동작 확인 (20건 전부 제외됨)
4. G-1·G-2 케이스 회귀 없음

---

## 설계 결정 사항

| 결정 | 이유 |
|---|---|
| 별도 파일 (golden_temporal.json) | TAX-6A-1 Gate C 결정 — 시점 골든셋은 별도 파일 |
| expectedStatus: "" (빈 칸) | 회계사 검수 전 AI 자동 채점 방지 원칙 (CLAUDE.md §8.1) |
| `_note` 필드 추가 | 회계사가 어떤 법률 변경을 확인해야 하는지 안내 |
| 러너 필터 방식 | 한 파일에서 검수 전/후 케이스를 구분 — 별도 러너 불필요 |

---

## 회계사 검수 가이드

각 케이스의 `_note` 필드를 참고하여 다음 순서로 검수:

1. **실제 API 원문 확인**: `sourceLaws[].content`를 국세법령정보시스템에서 해당 연도 기준으로 조회
2. **시행일 기재**: `revisionDate`·`enforcementDate` 실제 날짜로 교체
3. **excerpt 기재**: 답변에 인용할 핵심 문장 발췌
4. **temporalLabel 확정**: `[적용 시점: YYYY.MM.DD~YYYY.MM.DD]` 형식으로 교체
5. **summary 작성**: 회계사가 직접 답변 요약 작성
6. **expectedStatus 확정**: `"PASS"` 또는 `"FAIL"` 중 선택

---

## 잠재 위험

- **조문 번호 불일치 가능성**: 골격의 조문 번호는 AI 추정치 — 실제 API 결과와 다를 수 있음(회계사 검수 필수)
- **시행일 경과조치**: 특히 취득세(G3-20), 1주택 거주요건(G3-10) 등 부칙 경과조치 조항 별도 확인 필요
- **G3-17(퇴직소득 구 방식)**: 2015년 기준 조문이 현재 법령 API에서 조회 안 될 수 있음 — 부칙 또는 개정 이력 탭 활용 필요

---

## 다음 단계

- **TAX-6A-7**: G-4 환각 유발 골든셋 20건 골격 생성 → `eval/golden_hallucination.json`
- 회계사 검수 후 `golden_temporal.json` 정답값 채우기 → 자동으로 러너에 포함됨
