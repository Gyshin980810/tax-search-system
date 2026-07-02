# TAX-6B-27 쿼리 변환 프롬프트 "10자 이내" 규칙이 축 결합 규칙·예시와 모순

> 문서 위계: SSOT > PRD > CLAUDE.md > 티켓. 충돌 시 상위 문서 우선.
> 작성 배경: 검색 정확도 향상 분석(2026-07-02) 문제 P5.

---

## Metadata

- **Type**: BUG
- **Severity**: minor (재현율 저하 유발, 데이터 손상은 아님)
- **Layer**: adapter (프롬프트 텍스트)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

`llmQueryRewriter.ts`의 `SYSTEM_PROMPT`에 **서로 모순되는 규칙**이 공존한다.

```
3. 각 키워드는 10자 이내로 간결하게 작성합니다.        ← (A) 10자 상한
...
6. 모든 검색 키워드는 **법리축 + 사실축**을 결합합니다. ← (B) TAX-042G 축 결합
8. ✅ 권장: 법리축과 사실축을 공백으로 결합
   - 좋은 예: "법인세법 시행령 접대비"(11자),
              "양도소득세 비과세 1세대1주택"(16자),      ← (B)의 예시가 (A)를 위반
              "부가가치세 면세 의료용역"(12자)
```

- 규칙 (A)는 "10자 이내"를 요구하는데, 뒤에 오는 규칙 (B, TAX-042G)의 **권장 예시 자체가
  11~16자**로 (A)를 정면으로 위반한다.
- `querySchema`는 `keyword: z.string().min(1).max(100)`이라 스키마상 10자 강제는 없다.
  즉 (A)는 **LLM에게만 주는 잘못된 지시**다.

### 1.2 영향

- LLM(GPT-4o-mini, temperature 0)이 규칙 (A)를 지키려 하면 **법리축 또는 사실축 한쪽을
  버려** 축 결합이 깨진다 → TAX-042G가 막으려던 "법리축 단독 200건 dump" 또는
  "사실축 단독 오매칭"으로 되돌아가 **재현율 저하**.
- 규칙끼리 모순되면 temperature 0에서도 LLM 해석이 흔들려 **비결정성**을 키운다
  (TAX-6A-11이 어렵게 확보한 결정론을 갉아먹음).

### 1.3 중요도

- 재현율은 정확성 보증(§2)의 전제. 근거 조문이 검색되지 않으면 답변이 빈약해진다.
- 다만 데이터·라벨을 건드리지 않는 **프롬프트 텍스트 정합** 문제라 위험도는 낮다.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/llmQueryRewriter.ts` — `SYSTEM_PROMPT`(31~50), `querySchema`(52~58).
- `src/adapters/queryAxisGuard.ts` — `enforceAxisCombination`(후처리로 축 결합 보강).
- 근거 규칙: TAX-042G(법리축+사실축 결합)가 규칙 3(10자)보다 나중·더 구체적 → **우선**.

### 2.2 왜 규칙 3이 원래 있었나

초기(TAX-011-B) 프롬프트는 단일 세법 용어("접대비")만 뽑던 시절의 "간결하게" 지침.
이후 TAX-042G가 축 결합을 도입하며 키워드가 길어졌으나, 규칙 3의 "10자 이내"는
갱신되지 않고 남아 **모순으로 화석화**됨.

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [x] `src/adapters/llmQueryRewriter.ts`: `SYSTEM_PROMPT` 규칙 3을 축 결합(6~8)과
      정합하도록 수정. "10자 이내" 하드 상한 제거, "간결하게 + 축 결합 우선"으로 문구 조정.
- [x] `SYSTEM_PROMPT`를 export해 프롬프트 내부 정합성을 잠그는 가드 테스트 추가.

### 3.2 금지되는 변경

- ❌ `querySchema`의 `.max(100)`·`.max(3)` 변경 (쿼리 개수·길이 정책은 별개)
- ❌ `enforceAxisCombination`·`MAX_LLM_QUERIES`·`lookupArticleHints` 로직 수정
- ❌ 규칙 6~8(TAX-042G 축 결합) 내용 변경 — 이것이 정답 기준
- ❌ temperature·타임아웃 등 다른 파라미터 변경

---

## 4. Acceptance Criteria

1. [ ] `SYSTEM_PROMPT`에 "10자 이내" 같은, 자체 예시가 위반하는 하드 글자수 상한이 없다.
2. [ ] 규칙 3이 축 결합(6~8)을 우선하도록 정합된 문구로 바뀐다.
3. [ ] 축 결합 규칙(6~8)과 예시는 그대로 유지된다(재현율 기준 불변).
4. [ ] 프롬프트 정합성 가드 테스트 PASS, 기존 테스트 전부 PASS, typecheck 0.

---

## 5. Verification

1. `npx vitest run` — 신규 가드 + 기존 PASS
2. `npx tsc --noEmit` — 0

---

## 6. Risks / Notes

- LLM 프롬프트 변경이라 실제 쿼리 품질은 회계사 골든셋 회귀로 확인 권장(LLM 과금 → 별도).
- 본 변경은 모순 제거(축 결합을 방해하던 상한 삭제)라 **재현율에 중립~긍정**, 축소 위험 없음.

---

## 7. Report Link

Report: `docs/reports/TAX-6B-27_report.md`
