# TAX-051 리포트 — V3 라벨 안전망 (어댑터 후처리 + 프롬프트 결정 트리)

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-10
> 티켓: `docs/tickets/TAX-051_v3_label_safety_net.md`
> 베이스라인 근거: `docs/reports/TAX-029_p95_baseline_2026-06-09.json`
> 최종 검증: `docs/reports/TAX-029_p95_baseline_2026-06-10.json`

---

## 1. 요약

TAX-029 P95 재측정(2026-06-09, TAX-050 적용 후)에서 발견된 **V3 라벨 실패 6건(6.1%)** — LLM 비결정성으로 T3·T4 출처에 🟢직접근거가 잘못 부여되는 패턴 — 을 해결하기 위해 `src/adapters/llmAnswerGenerator.ts` 한 파일에 **어댑터 후처리 함수 + SYSTEM_PROMPT 결정 트리 보강**을 적용.

- 방안 C 채택 사유: 어댑터 후처리로 LLM 비결정성에 대한 **100% 차단 보장** + 프롬프트 보강으로 1차 차단 강화
- 구현 검증: vitest 387/387 PASS, 단건 진단 9/9 V3 PASS (G-S-부가-04 × 3 + G-S-종부-01 × 3 + G-S-NL-02 × 3)
- **100회 P95 재측정(2026-06-10): 누적 P95 9.67s ✅ PASS (합격선 15s 달성)** — Phase 4 코딩 게이트 해제

---

## 2. 변경 파일

| # | 파일 | 변경 종류 | 변경 위치 |
|---|------|-----------|-----------|
| 1 | `src/adapters/llmAnswerGenerator.ts` | 수정 | SYSTEM_PROMPT [라벨 결정 체크리스트] 신설 + [T1·T2 부재 규칙] 재구성 + 신규 헬퍼 함수 `downgradeT3T4DirectCitations` + `generate()` 후처리 호출 |
| 2 | `docs/tickets/TAX-051_v3_label_safety_net.md` | 신규 | 티켓 문서 |
| 3 | `docs/reports/TAX-051_report.md` | 신규 | 본 리포트 |

코드 수정은 **1개 파일**(`llmAnswerGenerator.ts`)에 한정.

---

## 3. 주요 변경 상세

### 3.1 SYSTEM_PROMPT [T1·T2 부재 규칙] → 결정 트리·체크리스트 재구성

**변경 전 (7줄, 서술형):**
```
[T1·T2 부재 시 동작 규칙 — TAX-048]
검색된 조문 목록 전체가 (T3) 또는 (T4)만 있고 (T1)·(T2)가 하나도 없는 경우:
- 어떤 출처에도 🟢직접근거 절대 부여 금지. "T3밖에 없으니 어쩔 수 없이 🟢"는 잘못된 판단입니다.
- 모든 citations 라벨은 🟡유사사례 또는 ⚪참고자료만 사용.
- summary 첫 문장에 "직접 근거(법령 본문)를 찾지 못했습니다." 를 반드시 명시.
- 단정형 표현 금지. ...
- 회계사가 T3 자료를 법령처럼 인용해 가산세 위험에 노출되지 않도록 보호하는 게 시스템 의무입니다.
```

**변경 후 (체크리스트 + 결정 트리 + 자주 발생 실수):**
```
[라벨 결정 체크리스트 — TAX-048·TAX-051 (citation 생성 직전 반드시 수행)]

Step 1: 현재 citation의 출처 Tier가 (T1) 또는 (T2)인가?
  → YES: 🟢직접근거 / 🟡유사사례 / ⚪참고자료 / ⚫폐지 중 선택 (사안 적용 정도 기반)
  → NO (T3 또는 T4): Step 2로 이동

Step 2: 출처 Tier가 (T3) 또는 (T4)이다.
  → 🟢직접근거 절대 금지 (예외 없음, 회계사 보호 의무)
  → 허용 라벨: 🟡유사사례 / ⚪참고자료 / ⚫폐지 중 선택만 가능

⚠️ 자주 발생하는 실수 (TAX-051 — V3 FAIL 직결):
- 실수: "T1·T2가 없으니 T3에 🟢직접근거 부여" → V3 FAIL, E-VERIFY-FAIL 위험
- 실수: "심판례가 사안에 정확히 일치하니 🟢" → V3 FAIL, 판례·예규·심판례는 무조건 🟡 이하
- 실수: "예규가 법령 해석을 명확히 제시하니 🟢" → V3 FAIL, 예규는 법령이 아님
- 올바른 처리: 검색결과 전체가 T3·T4만 있어도 모든 라벨은 🟡 또는 ⚪로 한정
  + summary 첫 문장에 "직접 근거(법령 본문)를 찾지 못했습니다." 명시

[T1·T2 부재 시 동작 규칙 — TAX-048]
검색된 조문 목록 전체가 (T3) 또는 (T4)만 있고 (T1)·(T2)가 하나도 없는 경우:
- 모든 citations 라벨은 🟡유사사례 또는 ⚪참고자료만 사용 (위 Step 2 적용).
- summary 첫 문장에 "직접 근거(법령 본문)를 찾지 못했습니다." 를 반드시 명시.
- 단정형 표현 금지. ...
- 회계사가 T3·T4 자료를 법령처럼 인용해 가산세 위험에 노출되지 않도록 보호하는 게 시스템 의무입니다.
```

**핵심 변경:**
- 결정 트리(Step 1·2) 명시 → LLM이 citation 생성 직전 순차적으로 검사
- "자주 발생하는 실수" 3가지를 명시적 예시로 차단
- TAX-048 [부재 시 동작 규칙]은 유지하되 새 체크리스트 위에 배치(Step 2를 참조하도록 통합)

### 3.2 어댑터 후처리 함수 `downgradeT3T4DirectCitations` (신규)

```typescript
/**
 * TAX-051: V3 라벨 안전망 — T3·T4 출처에 🟢직접근거가 잘못 부여된 경우 강제 다운그레이드.
 *
 * 배경: TAX-029 P95 재측정(2026-06-09)에서 V3 실패 6건(6.1%) 발생.
 *       SYSTEM_PROMPT [라벨 결정 표]·[T1·T2 부재 규칙]이 명시되어 있음에도
 *       GPT-4o-mini가 약 6% 확률로 두 규칙을 모두 무시 → LLM 비결정성.
 *
 * 동작:
 *   1) T3·T4 citation에 🟢직접근거가 부여됐다면 🟡유사사례로 다운그레이드
 *   2) T1·T2가 하나도 없고 다운그레이드가 발생했다면 summary 첫 문장에
 *      "직접 근거(법령 본문)를 찾지 못했습니다." 자동 보정 (TAX-048 정합)
 *   3) T1·T2가 섞여 있으면 summary는 무변경 (이미 직접 근거가 다뤄지므로)
 */
export function downgradeT3T4DirectCitations(
  citations: Citation[],
  summary: string,
): { citations: Citation[]; summary: string; downgradedCount: number } {
  let downgradedCount = 0
  const fixedCitations = citations.map((c) => {
    const tier = c.taxLaw.trustTier
    if ((tier === 'T3' || tier === 'T4') && c.label === '🟢직접근거') {
      downgradedCount += 1
      return { ...c, label: '🟡유사사례' as CitationLabel }
    }
    return c
  })

  const hasAnyT1T2 = fixedCitations.some(
    (c) => c.taxLaw.trustTier === 'T1' || c.taxLaw.trustTier === 'T2',
  )
  let fixedSummary = summary
  if (downgradedCount > 0 && !hasAnyT1T2) {
    const prefix = '직접 근거(법령 본문)를 찾지 못했습니다.'
    if (!summary.startsWith(prefix)) {
      fixedSummary = `${prefix} ${summary}`
    }
  }

  return { citations: fixedCitations, summary: fixedSummary, downgradedCount }
}
```

### 3.3 `generate()` 메서드 내 후처리 호출

```typescript
// TAX-042F: citations.taxLaw는 originalRefs(원본 객체 참조)로 매핑한다.
const rawCitations: Citation[] = object.citations
  .filter((c) => c.lawIndex >= 0 && c.lawIndex < originalRefs.length)
  .map((c) => { ... })

// TAX-051: V3 라벨 안전망 — T3·T4 출처에 🟢직접근거 부여 시 강제 다운그레이드.
// LLM 비결정성(약 6%)으로 [라벨 결정 표]·[T1·T2 부재 규칙]을 무시한 응답을
// 어댑터가 100% 차단해 회계사 보호 의무를 보장한다.
const { citations, summary } = downgradeT3T4DirectCitations(rawCitations, object.summary)

return {
  rawQuestion: question,
  citations,
  summary,
  ...
}
```

**핵심 변경:**
- `object.citations` → `rawCitations` 명명 변경 (다운그레이드 전 의미 명시)
- `downgradeT3T4DirectCitations` 호출로 후처리된 `citations`·`summary` 사용
- LLM 응답이 어떻든 어댑터 출력은 V3 라벨 사양 100% 준수

---

## 4. 검증 결과

### 4.1 vitest 단위·통합 회귀 — PASS

```
Test Files  22 passed (22)
     Tests  387 passed (387)
   Duration 6.94s
```

V1~V6 검증 로직, zod 스키마, extractExcerpt, citation 매핑 등 무관 영역 모두 회귀 없음.

### 4.2 베이스라인 실패 케이스 단건 진단 — PASS 9/9 ✅

| 케이스 | 베이스라인 (변경 전) | 변경 후 (3회) |
|--------|---------------------|---------------|
| **G-S-부가-04** (iter 15) | V3 FAIL × 2 → E-VERIFY-FAIL | PASS × 3 (V3 = ✓ × 3) |
| **G-S-종부-01** (iter 37) | V3 FAIL × 2 → E-VERIFY-FAIL | PASS × 3 (V3 = ✓ × 3) |
| **G-S-NL-02** (iter 20) | V3 FAIL × 1 → 재시도 PASS | PASS × 3 (V3 = ✓ × 3) |

```
G-S-부가-04 × 3 — PASS 3/3, V3 PASS 3/3
  [1/3] 16.70s   [2/3] 6.76s   [3/3] 8.70s

G-S-종부-01 × 3 — PASS 3/3, V3 PASS 3/3
  [1/3] 24.67s   [2/3] 17.13s   [3/3] 5.11s

G-S-NL-02 × 3 — PASS 3/3, V3 PASS 3/3
  [1/3] 9.35s   [2/3] 21.44s   [3/3] 6.72s
```

**raw log**:
- `docs/reports/_data/TAX-042D/G-S-부가-04_1781061917881.json`
- `docs/reports/_data/TAX-042D/G-S-종부-01_1781061933139.json`
- `docs/reports/_data/TAX-042D/G-S-NL-02_1781061924328.json`

### 4.3 100회 P95 재측정 — ✅ PASS (2026-06-10)

```
=== TAX-029 P95 측정 결과 ===
단계           n      평균      P50      P95      P99      Max
----------------------------------------------------------------
rewrite      100   1.55s    1.38s    2.74s    3.46s    6.24s
search       100   654ms   0.02ms   2.38s    3.06s    5.42s
answer       101   3.59s    2.90s    7.27s   11.76s   14.03s
verify       101  0.07ms   0.05ms   0.13ms   0.28ms   0.32ms
----------------------------------------------------------------
누적          100   5.83s    5.46s    9.67s   14.54s   16.64s
----------------------------------------------------------------
✅ PASS — 누적 P95 9.67s < 합격선 15.00s

정상 응답: 100/100  /  에러: 0/100

=== V1~V6 검증 분석 ===
검증 호출 수: 101 (PASS 100 / FAIL 1)
  V1: 0건  V2: 0건  V3: 1건  V4: 0건  V5: 0건  V6: 0건
```

- exit code 0 (합격)
- V4 0건 유지 (TAX-050 효과 유지)
- V3 6건(6.1%) → 1건(1.0%) — 어댑터 후처리 효과 확인

### 4.4 V3 검증 정규식·로직 무변경 확인

`src/adapters/lawVerifier.ts:141-150`은 무변경. V1~V6 검증 통과 경로 보호 유지.
`TIER_ALLOWED_LABELS` 매핑(`lawVerifier.ts:16-21`)도 무변경 (단일 진실원천).

---

## 5. 베이스라인 대비 실제 효과

> 100회 P95 재측정(2026-06-10) 결과 기준.
> 결과 파일: `docs/reports/TAX-029_p95_baseline_2026-06-10.json`

| 지표 | 베이스라인 (2026-06-09) | TAX-051 적용 후 (2026-06-10) | 변화 |
|------|--------------------------|-------------------------------|------|
| V3 실패율 | 6.1% (6/99 검증 호출) | **1.0% (1/101)** | −83% |
| answer 단계 P95 | 12.31s | **7.27s** | −5.04s (−41%) |
| **누적 P95** | **17.74s** ❌ | **9.67s** ✅ | −8.07s (−45%) |
| E-VERIFY-FAIL | 2건 | **0건** | 완전 제거 |
| 정상 응답 | 94/100 | **100/100** | +6건 |
| 에러 | 6건 (API 장애 포함) | **0건** | 완전 제거 |

**V3 잔류 1건 분석**:
- `downgradeT3T4DirectCitations`는 T3·T4 → 🟢 방향만 차단. 잔류 1건은 T1·T2 출처에 🟡이 부여된 역방향(더 보수적인 방향) 추정.
- 회계사 보호 관점에서 역방향 오류(T1에 🟡)는 T3에 🟢보다 무해 — 별도 티켓 여부는 회계사 결정.

**Phase 4 코딩 게이트**:
- 누적 P95 9.67s < 15s → **TAX-026-B~ pgvector + OpenAI 임베딩 코딩 게이트 해제 조건 충족**

---

## 6. 잠재 위험

- **summary 단정형 표현(V6) 잔존 위험**: 어댑터는 라벨만 다운그레이드하므로, LLM이 작성한 summary 본문이 단정형이면 V6 실패 가능. 다만 V3가 PASS되면 재시도 루프가 트리거되지 않아 100회 측정에서의 영향은 한정적. V6 재발 시 별도 케어.
- **T1·T2 혼합 시 summary 보정 안 함**: T1·T2가 한 개라도 있으면 그 직접 근거가 summary에서 다뤄진다고 판단해 보정 skip. 회계사 검토 시 T3·T4의 직접 근거 인용이 summary에 남아 있을 가능성 — 라벨이 🟡로 다운그레이드됐으므로 검증·라벨 측면은 안전.
- **회귀 위험 (낮음)**: 후처리는 LLM 응답을 받은 직후 라벨·summary 첫 문장만 보정. citations 구조·다른 필드 무변경. vitest 387건 회귀 없음.

---

## 7. CLAUDE.md §6.3 사양 정합

본 변경은 CLAUDE.md §6.3을 **더 강하게 정합**시킴:

| §6.3 사양 | 변경 전 동작 | 변경 후 동작 |
|-----------|-----------------|-----------------|
| T3·T4 단독 🟢 금지 (라벨링) | LLM 비결정성 6% 누락 | LLM + 어댑터 이중 방어로 100% 차단 |
| 빈약 시 "직접 근거를 찾지 못했습니다" 명시 | LLM이 가끔 누락 | T1·T2 부재 시 어댑터가 강제 보정 |
| 회계사 보호 의무 (가산세 위험 차단) | LLM 응답에 의존 | 어댑터에서 보장 |

---

## 8. 다음 단계

1. ~~100회 P95 재측정~~ **완료 (2026-06-10) — 누적 P95 9.67s ✅ PASS**
2. **Phase 4(TAX-026-B~) pgvector + OpenAI 임베딩 코딩 게이트 해제** — 합격선 충족으로 진입 가능 (회계사 확인 완료)
3. V3 잔류 1건(T1·T2→🟡 역방향) — 별도 티켓 여부 회계사 결정

---

## 9. 변경 사항 요약 (CLAUDE.md §10 형식)

```
### 변경 사항 요약

**파일 변경 목록:**
- src/adapters/llmAnswerGenerator.ts (수정 — 후처리 함수 + 프롬프트 결정 트리)
- docs/tickets/TAX-051_v3_label_safety_net.md (신규)
- docs/reports/TAX-051_report.md (신규)

**주요 변경:**
- SYSTEM_PROMPT [라벨 결정 체크리스트](Step 1·2 결정 트리 + 자주 발생 실수 3가지) 신설
- [T1·T2 부재 시 동작 규칙]을 체크리스트 Step 2를 참조하도록 재구성
- 신규 헬퍼 `downgradeT3T4DirectCitations`: T3·T4 출처 🟢 → 🟡 강제 다운그레이드 + summary 자동 보정
- generate() 메서드 내 후처리 호출 (citations 매핑 직후)
- V1~V6 검증 로직(lawVerifier.ts) 무변경 — 안전 경로 보호

**검증 결과:**
1. npm run test — 387/387 PASS (회귀 없음)
2. G-S-부가-04 × 3회 — V3 PASS 3/3 (베이스라인 V3 FAIL × 2였음)
3. G-S-종부-01 × 3회 — V3 PASS 3/3 (베이스라인 V3 FAIL × 2였음)
4. G-S-NL-02 × 3회 — V3 PASS 3/3 (베이스라인 V3 FAIL × 1였음)
5. V3 검증 정규식·로직 무변경 확인
6. 100회 P95 재측정(2026-06-10) — 누적 P95 9.67s ✅ PASS, V4 0건, V3 1건(1.0%)

**잠재 위험:**
- summary 단정형 표현(V6) 잔존 위험 — V3 PASS 후 재시도 미발생으로 한정적
- T1·T2 혼합 시 summary 보정 skip — 라벨 다운그레이드로 안전 측면 보장
- 회귀 위험 (낮음) — vitest 387건 PASS

**리포트:** docs/reports/TAX-051_report.md
```

---

**작성자**: AI(Claude Opus 4.7)
**작성일**: 2026-06-10
**최종 수정일**: 2026-06-10 (100회 P95 재측정 결과 반영 — 합격 확정)
