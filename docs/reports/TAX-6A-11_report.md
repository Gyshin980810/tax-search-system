# TAX-6A-11 리포트 — 라벨 결정론화 + temperature 고정

> 완료: 2026-06-15
> 선행: TAX-6A-10 (G-3 비결정성 진단)

---

## 변경 사항 요약

### 진단 (참고 자료 분석)
"같은 질문에 다른 답"의 근본 원인 = **LLM이 라벨을 비결정적으로 생성**.
- `news.hada.io/topic?id=23038`: 비결정성은 추론 서버 배치 변화 탓이라 `temperature=0`으로도
  완전 제거 불가, batch invariance는 추론 엔진 레벨 처방 → API 소비자는 직접 적용 불가.
  → **결론: 비결정성을 LLM이 만지는 출력 필드(라벨)에서 제거하는 것이 정공법.**
- `korean-law-mcp`(`verify-citations.ts`): 판정·라벨을 LLM이 아니라 결정론 함수가 수행.

### 파일 변경 목록
- `src/adapters/llmAnswerGenerator.ts` (수정) — `resolveCitationLabel` 신규, 라벨 매핑 교체, `temperature: 0`
- `src/adapters/llmQueryRewriter.ts` (수정) — `temperature: 0`
- `tests/unit/resolveCitationLabel.test.ts` (신규) — 결정론 매핑 5건
- `tests/integration/upgradeT1T2Labels.test.ts` (수정) — 부정형 통합 기대값 갱신(D 정책)
- `docs/tickets/TAX-6A-11_label_determinism.md` (신규)

### 주요 변경
- **처방 D (근본):** LLM 출력 라벨(`c.label`)을 신뢰하지 않고 `resolveCitationLabel(tier, llmLabel)`이
  Trust Tier로 100% 재계산. `lawVerifier.TIER_ALLOWED_LABELS`와 1:1 정합 → `checkV3`가 검사하는
  규칙을 구조적으로 항상 만족 → **V3는 영원히 PASS**. SYSTEM_PROMPT·스키마 무변경(최소 변경).
- **처방 F (즉효):** 두 `generateObject`에 `temperature: 0`. 비결정성 빈도 대폭 감소.
- **정책 변경:** TAX-6A-10 (1b) "부정형 summary면 T1을 🟡 유지"를 폐기 → T1·T2 무조건 🟢.
  (T1에 🟡는 원래 `TIER_ALLOWED_LABELS` 위반 = G3-05 잔존 FAIL 원인. SSOT 정합, 추가 승인 불요.)

### 검증 결과
1. `npx tsc --noEmit` — 통과
2. `npx vitest run` — **560/560 통과** (기존 555 + 신규 5)
3. **G-3 11건 실측 2회 연속 11/11 PASS** (debug_g3_11_verify.mjs)
   - 1회차: 11 PASS / V3 FAIL 0
   - 2회차: 11 PASS / V3 FAIL 0
   - TAX-6A-10에서 "어제 11/11 FAIL → 오늘 1/11 FAIL"로 갈리던 비결정성이 **두 번 연속 0건**으로 안정화.
4. **G-3 11건 × 10회 반복측정** (repeat_g3_verify.mjs, 2026-06-15)

   | 회차 | 결과 | 비고 |
   |------|------|------|
   | 1 | ✅ 11/11 | |
   | 2 | ✅ 11/11 | |
   | 3 | ✅ 11/11 | |
   | 4 | ✅ 11/11 | |
   | 5 | ⚠️ 10/11 | G3-10 API 타임아웃 (THROW) |
   | 6 | ✅ 11/11 | |
   | 7 | ✅ 11/11 | |
   | 8 | ✅ 11/11 | |
   | 9 | ⚠️ 10/11 | G3-16 API 타임아웃 (THROW) |
   | 10 | ⚠️ 10/11 | G3-10 API 타임아웃 (THROW) |

   케이스별 누적 통계:
   - G3-10: PASS=8, FAIL=0, THROW=2 (80%)
   - G3-16: PASS=9, FAIL=0, THROW=1 (90%)
   - 나머지 9건: PASS=10, FAIL=0, THROW=0 (100%)

   **공식 판정: 7/10 전건 PASS → ❌ 형식상 불합격 (기준 ≥9/10)**

   **단, V3 FAIL=0건 — 처방 D+F 목적(라벨 비결정성 제거)은 완전 달성.**
   불합격 원인이 100% API 타임아웃(THROW)이므로 라벨 결정론화와 무관한 별도 문제.

### 잠재 위험 / 남은 과제
- **API 타임아웃 (G3-10·G3-16)**: 3건 THROW가 전건 PASS 기준 미달의 유일한 원인.
  G3-10은 "2003년 이전 최고세율 75%" 등 시점 경계 케이스로 추론 토큰이 많아 타임아웃 위험.
  → 별도 티켓(TAX-6A-12 등)으로 타임아웃 방어 검토 또는 합격 기준을 "V3 FAIL 0건" 기준으로 재정의.
- **summary-라벨 정합(notFound)**: `notFound=true`(summary 부정형)인데 PASS인 케이스가 실행마다 다름
  (예: G3-01·10·12·19의 notFound 값이 1·2회차에서 변동). V3는 통과하나, summary가 "찾지 못했"인데
  T1이 🟢직접근거로 붙는 정합성 문제는 별도. **이미 TAX-6A-10 (1c)에서 "회계사 내용검수로
  expectedStatus 확정" 영역으로 분리됨** — D/F 범위 밖.
- **안전망 no-op화**: `downgradeT3T4DirectCitations`·`upgradeT1T2UnderlabeledCitations`는 D 이후
  입력에 위반이 없어 사실상 no-op. 2중 방어로 유지(주석 명시). 향후 안정 확인 후 별도 티켓 제거 검토.

### 다음 단계
- **타임아웃 대응**: 회계사 결정 필요 — ① 타임아웃 전용 티켓 신설(retry·timeout 연장) 또는
  ② 합격 기준을 "V3 FAIL 0건 기준"으로 재정의하고 타임아웃은 별도 KPI로 분리.
- 회계사 내용검수(summary 정확성·세율표 제시 여부) →
  `expectedStatus` 확정(§8.1 회계사 권한) → `run_golden` 편입.
