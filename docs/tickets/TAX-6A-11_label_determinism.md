# TAX-6A-11 — 라벨 결정론화 + temperature 고정 (G-3 비결정성 근본 제거)

> 상태: 진행 중
> 작성: 2026-06-15
> 선행: TAX-6A-10 (G-3 11건 E-VERIFY-FAIL 진단 — 진짜 병목 = 답변생성[3] 라벨 비결정성)
> 분류: 정확성·안정성 (RAG [3]·[1] 단계)

---

## 1. 배경 — "같은 질문에 다른 답"의 근본 원인

TAX-6A-10 진단에서 G-3 시점 골든셋이 **실행마다 V3 PASS/FAIL이 갈리는** 현상을 확인했다.
동일 질문·동일 코드인데 어제는 11/11 FAIL, 오늘은 1/11 FAIL. 근본 원인은 **LLM 비결정성**:

- 같은 T1 조문에 어떤 실행은 🟢직접근거, 어떤 실행은 🟡유사사례를 부여 → `checkV3` FAIL.
- `llmAnswerGenerator.ts`가 **LLM 출력 라벨(`c.label`)을 그대로 사용**(line 562)하고,
  `generateObject`에 **temperature 미설정**(기본값 1.0 → 비결정성 최대)이 직접 원인.

### 참고 자료 분석 결론
- **news.hada.io/topic?id=23038**: LLM 비결정성은 `temperature=0`으로도 완전 제거 불가
  (추론 서버 배치 크기 변화에 따른 연산 순서 차이). batch invariance는 추론 엔진 레벨 처방이라
  **OpenAI API 소비자인 우리는 직접 적용 불가** → "비결정성을 LLM이 만지는 출력 필드에서 제거"가 정공법.
- **korean-law-mcp** (`verify-citations.ts`·`compact-query-planner.ts`): LLM이 판정·라벨·쿼리변환을
  "생성"하지 않고 **결정론적 함수가 수행**, LLM은 호출(오케스트레이션)만 → 입력 같으면 출력 같음.

---

## 2. 처방

### 처방 D (근본) — 라벨 결정론화
LLM이 낸 라벨을 신뢰하지 않고, 어댑터가 Trust Tier로 라벨을 100% 재계산한다.
`lawVerifier.TIER_ALLOWED_LABELS`(단일 진실 원천)와 동일한 매핑을 강제 →
`checkV3`가 검사하는 규칙을 **구조적으로 항상 만족** → V3는 영원히 PASS.

```
resolveCitationLabel(trustTier, llmLabel):
  llmLabel === '⚫폐지' → '⚫폐지'   // 폐지는 드물고 본문 "삭제" 판독 필요 → LLM 판단 보존
  T1·T2 → '🟢직접근거'
  T3·T4 → '🟡유사사례'
```

- SYSTEM_PROMPT·answerSchema **무변경** (LLM은 여전히 label을 내지만 어댑터가 덮어씀) → 최소 변경·회귀 최소.
- matchStage(vector·expanded) 천장은 기존 `downgradeVectorLabels`가 그대로 적용.
- 기존 안전망(`downgradeT3T4DirectCitations`·`upgradeT1T2UnderlabeledCitations`)은
  입력이 이미 규칙대로라 **no-op 2중 방어**로 유지(주석 보강).

### 처방 F (즉효) — temperature 고정
`llmAnswerGenerator.ts`·`llmQueryRewriter.ts` 두 `generateObject`에 `temperature: 0` 추가.
완전 결정론은 아니나(하다 글) 비결정성 빈도를 대폭 감소.

---

## 3. 정책 변경 (회계사 보고)

기존 TAX-6A-10 (1b)의 "summary 부정형이면 T1을 🟡 유지"를 **폐기** → T1·T2는 무조건 🟢.
- 이유: `TIER_ALLOWED_LABELS`상 **T1에 🟡는 원래 V3 규칙 위반**. G3-05 잔존 FAIL의 원인.
- D는 SSOT가 정한 V3 규칙을 강제할 뿐 새 규칙을 만들지 않음 → 추가 승인 불요(SSOT 정합).

---

## 4. 범위

**수정:**
- `src/adapters/llmAnswerGenerator.ts` — `resolveCitationLabel` 추가, line 562 라벨 교체, temperature:0
- `src/adapters/llmQueryRewriter.ts` — temperature:0
- `tests/integration/upgradeT1T2Labels.test.ts` — 부정형 통합 테스트 기대값 갱신(D 정책)

**신규:**
- `tests/unit/resolveCitationLabel.test.ts` — 결정론 매핑 단위 검증

**금지:** lawVerifier `checkV3`·`TIER_ALLOWED_LABELS` 값 무변경, 골든셋 `expectedStatus` 무수정(§8.1).

---

## 5. 검증

1. `npm run build` (tsc) 통과
2. 전체 vitest 통과
3. resolveCitationLabel 단위: 폐지 보존 / T1·T2→🟢 / T3·T4→🟡
4. (후속) G-3 케이스 N회 반복측정 — V3 FAIL 0건 확인 → 회계사 내용검수 → expectedStatus 확정
