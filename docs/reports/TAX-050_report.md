# TAX-050 리포트 — V4 시점 라벨 강화 (LLM 프롬프트 보강 A2)

> 작성자: AI(Claude Sonnet 4.6) / 작성일: 2026-06-09
> 티켓: `docs/tickets/TAX-050_v4_temporal_label_strengthening.md`
> 베이스라인 근거: `docs/reports/TAX-029_p95_baseline_2026-06-09.json`

---

## 1. 요약

TAX-029 P95 재측정(2026-06-09)에서 발견된 **V4 시점 라벨 실패 11건(10.1%)**의 직접 원인 — LLM 프롬프트의 결정 트리 부재 — 을 해결하기 위해 `src/adapters/llmAnswerGenerator.ts`의 두 군데를 수정.

- 방안 A2 채택 사유: 검증 정규식(V1~V6) 무변경(안전), LLM 추론 의존성 제거(견고)
- 결과: vitest 387/387 PASS, 실패 케이스 단건 진단 6/6 V4 PASS
- 다음 단계: 100회 P95 재측정으로 누적 P95 < 15s 합격선 도달 여부 검증

---

## 2. 변경 파일

| # | 파일 | 변경 종류 | 변경 위치 |
|---|------|-----------|-----------|
| 1 | `src/adapters/llmAnswerGenerator.ts` | 수정 | SYSTEM_PROMPT [시점 라벨 규칙] 섹션 + `generate` 메서드 userPrompt 조립부 |
| 2 | `docs/tickets/TAX-050_v4_temporal_label_strengthening.md` | 신규 | 티켓 문서 |
| 3 | `docs/reports/TAX-050_report.md` | 신규 | 본 리포트 |

코드 수정은 **1개 파일**(`llmAnswerGenerator.ts`)에 한정.

---

## 3. 주요 변경 상세

### 3.1 SYSTEM_PROMPT [시점 라벨 규칙] 섹션 보강 (라인 101-118)

**변경 전 (5줄):**
```
[시점 라벨 규칙 — CLAUDE.md §6.2 / TAX-037·TAX-038]
- 법령(sourceType='법령')의 temporalLabel은 반드시 다음 중 하나:
  "[현행]" | "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" | "[폐지: YYYY.MM.DD]"
- 비법령(sourceType='판례'|'해석례'|'심판례')의 temporalLabel은:
  "[결정: YYYY.MM.DD]" — 제공된 '결정일'을 그대로 사용. 결정일이 '불명'이면 "[현행]" 허용.
```

**변경 후 (16줄):**
```
[시점 라벨 규칙 — CLAUDE.md §6.2 / TAX-037·TAX-038·TAX-050]

[법령(sourceType='법령')의 temporalLabel 결정 트리]
1순위: 회계사가 시점을 명시하지 않았고 제공된 법령이 현행이면 → "[현행]"
       (대부분의 경우 이 옵션을 택합니다. 법령 시행일은 본문 인용에서 다루세요.)
2순위: 회계사가 과거 특정 시점(예: "2020년 기준")을 명시했고
       시작일·종료일을 모두 특정할 수 있으면
       → "[적용 시점: YYYY.MM.DD~YYYY.MM.DD]" (양쪽 날짜 8자리 필수, ~ 양옆 공백 없음)
3순위: 조문이 폐지·삭제된 경우 → "[폐지: YYYY.MM.DD]"

[금지 — 자주 발생하는 실수 (TAX-050)]
- 금지: "[적용 시점: 2025.10.01]" (종료일 없는 단일 일자)
- 금지: "[적용 시점: 2025.10.01~]" (~ 뒤 비움)
- 종료일을 특정할 수 없으면 "[현행]"으로 폴백하세요.

[비법령(sourceType='판례'|'해석례'|'심판례')의 temporalLabel]
- "[결정: YYYY.MM.DD]" — 제공된 '결정일'을 그대로 사용. 결정일이 '불명'이면 "[현행]" 허용.
```

**핵심 추가:**
- 결정 트리(1~3순위) 명시 → LLM이 [현행]을 1순위로 선택
- 금지 예시 2종 명시 → 베이스라인에서 실제 관측된 실패 형식 차단
- "종료일 특정 불가 시 [현행]으로 폴백" 안전 경로 제공

### 3.2 userPrompt [기준 시점] 동적 메시지 (라인 333-345)

**변경 전:**
```typescript
const userPrompt = [
  `[회계사 질문]\n${question}`,
  temporal.explicit && temporal.targetDate
    ? `[기준 시점]\n${temporal.targetDate.toISOString().slice(0, 10)}`
    : '',
  `[제공된 법령 조문]\n${buildLawsContext(promptLaws)}`,
].filter(Boolean).join('\n\n')
```

**변경 후:**
```typescript
// TAX-050: temporal.explicit이 false인 경우에도 명시 메시지 주입.
// LLM이 시행일 메타데이터를 보고 자의적으로 [적용 시점] 라벨을 시도하지 않도록,
// "회계사가 시점을 명시하지 않음 → [현행] 사용" 지시를 항상 전달한다.
const temporalDirective = temporal.explicit && temporal.targetDate
  ? `[기준 시점]\n회계사가 ${temporal.targetDate.toISOString().slice(0, 10)} 기준으로 명시함 → 적용 시점 라벨 사용 가능`
  : `[기준 시점]\n회계사가 시점을 명시하지 않음 → 현행 법령 기준으로 답변, temporalLabel은 "[현행]" 사용`

const userPrompt = [
  `[회계사 질문]\n${question}`,
  temporalDirective,
  `[제공된 법령 조문]\n${buildLawsContext(promptLaws)}`,
].join('\n\n')
```

**핵심 변경:**
- `temporal.explicit=false`일 때도 명시적 지시 메시지 주입 (이전엔 빈 문자열로 통째 누락)
- LLM 추론(`enforcementDate` 메타데이터 → `[적용 시점]` 자의적 선택) 제거
- `.filter(Boolean)` 제거 (이제 빈 문자열 분기 없음)

---

## 4. 검증 결과

### 4.1 vitest 단위·통합 회귀 — PASS

```
Test Files  22 passed (22)
     Tests  387 passed (387)
   Duration 7.01s
```

V1~V6 검증 로직, zod 스키마, extractExcerpt 등 무관 영역 모두 회귀 없음.

### 4.2 베이스라인 실패 케이스 단건 진단 — PASS 6/6

| 케이스 | 베이스라인 (변경 전) | 변경 후 (3회) |
|--------|---------------------|---------------|
| **G-S-상증-03** (iter 97) | V4 FAIL × 2 → E-VERIFY-FAIL | PASS × 3 (V4 = true × 3) |
| **G-4A** (iter 84) | V4 FAIL × 2 → E-VERIFY-FAIL | PASS × 3 (V4 = true × 3) |

```
G-S-상증-03 × 3 — PASS 3/3, V3=✓ × 3, V4=true × 3
  [1/3] 8.05s   [2/3] 5.33s   [3/3] 4.04s

G-4A × 3 — PASS 3/3, V3=✓ × 3, V4=true × 3
  [1/3] 5.90s   [2/3] 5.34s   [3/3] 5.25s
```

**raw log**:
- `docs/reports/_data/TAX-042D/G-S-상증-03_1780988815558.json`
- `docs/reports/_data/TAX-042D/G-4A_1780988833609.json`

각 raw log 모두 `v1: true, v2: true, v3: true, v4: true, v5: true, v6: true` 확인.

### 4.3 V4 검증 정규식 무변경 확인

`src/adapters/lawVerifier.ts:48-53`은 무변경. V1~V6 검증 통과 경로 보호.

---

## 5. 베이스라인 대비 예상 효과

| 지표 | 베이스라인 (2026-06-09 오전) | TAX-050 적용 후 (예상) |
|------|-------------------------------|------------------------|
| V4 실패율 | 10.1% (11/109 검증 호출) | ≤ 1% (목표) |
| answer 단계 P95 | 14.14s | ≈ 9~10s (재시도 11회 제거) |
| **누적 P95** | **16.90s** (❌ FAIL) | **< 15s (예상)** ✅ |
| E-VERIFY-FAIL | 2건 (G-4A, G-S-상증-03) | 0건 (예상) |

**근거**: V4 재생성 루프(11건 × 3~5초)가 제거되면 answer P95가 약 4~5초 단축됨. 누적 P95는 search·rewrite 단계 무변경이므로 answer 감소분만큼 직접 감소.

---

## 6. 잠재 위험

- **LLM 비결정성**: 프롬프트 변경 후 다른 케이스에서 회귀 가능성. 단위 테스트 387건 + 단건 진단 6건으로 1차 보호. 100회 P95 재측정에서 최종 검증.
- **회계사가 "현재 기준으로" 같은 모호한 표현 사용 시**: TemporalContext 파서가 `explicit=true`로 분류하면 LLM이 [적용 시점]을 시도할 수 있음. 다만 G-4A("현재 기준으로 상속세 기초공제")는 이번 단건 진단에서 V4 PASS 확인 — 양호.
- **`.filter(Boolean)` 제거**: 빈 문자열 분기를 의도적으로 제거. `temporalDirective`는 항상 비어있지 않음을 보장하므로 안전.

---

## 7. CLAUDE.md §6.2 사양 정합

본 변경은 CLAUDE.md §6.2를 **더 강하게 정합**시킴:

| §6.2 사양 | 변경 전 LLM 동작 | 변경 후 LLM 동작 |
|-----------|-----------------|-----------------|
| `[현행]` = 답변 생성 시점 시행 중 (법령) | 시행일 메타데이터 보고 [적용 시점] 자의 선택 | 1순위 [현행] 채택 |
| `[적용 시점]` = 회계사가 명시한 시점 | 시점 미명시여도 [적용 시점] 시도 | explicit=true일 때만 사용 |
| 양쪽 날짜 모두 명시 | 한쪽만 적은 형식 발명 | 양쪽 특정 불가 시 [현행] 폴백 |

---

## 8. 다음 단계 (회계사 결정 대기)

1. **100회 P95 재측정** (`npm run perf:p95`) — TAX-050 누적 효과 검증, 누적 P95 < 15s 합격선 도달 여부 확인
2. 합격 시 → Phase 4(TAX-026-B~) pgvector + OpenAI 임베딩 코딩 게이트 해제
3. 미달 시 → 추가 LLM 속도 최적화 검토 또는 합격선 재검토 회계사 결정

재측정 진행 여부는 회계사 승인 후 진행.

---

## 9. 변경 사항 요약 (CLAUDE.md §10 형식)

```
### 변경 사항 요약

**파일 변경 목록:**
- src/adapters/llmAnswerGenerator.ts (수정 — 시점 라벨 결정 트리 + userPrompt 동적 메시지)
- docs/tickets/TAX-050_v4_temporal_label_strengthening.md (신규)
- docs/reports/TAX-050_report.md (신규)

**주요 변경:**
- SYSTEM_PROMPT에 법령 시점 라벨 결정 트리(1~3순위) + 금지 예시 명시
- userPrompt에 temporal.explicit=false 시에도 "[현행] 사용" 지시 명시 주입
- V1~V6 검증 로직(lawVerifier.ts) 무변경 — 안전 경로 보호

**검증 결과:**
1. npm run test — 387/387 PASS (회귀 없음)
2. G-S-상증-03 × 3회 — V4 PASS 3/3 (베이스라인 V4 FAIL × 2였음)
3. G-4A × 3회 — V4 PASS 3/3 (베이스라인 V4 FAIL × 2였음)
4. V4 검증 정규식 무변경 확인
5. 100회 P95 재측정 — 회계사 승인 후 진행

**잠재 위험:**
- LLM 비결정성에 의한 다른 케이스 회귀 (1차 387 테스트 + 단건 6회로 보호)
- "현재 기준으로" 같은 모호 표현 시 explicit 파싱 의존 (G-4A 단건 진단에서 양호 확인)

**리포트:** docs/reports/TAX-050_report.md
```

---

**작성자**: AI(Claude Sonnet 4.6)
**작성일**: 2026-06-09
**최종 수정일**: 2026-06-09
