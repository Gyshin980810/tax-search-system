# TAX-6B-28 답변 SYSTEM_PROMPT 라벨 규칙 사문화 정리 + 고지 코드 안전망

> 문서 위계: SSOT > PRD > CLAUDE.md > 티켓. 충돌 시 상위 문서 우선.
> 작성 배경: 검색 정확도 향상 분석(2026-07-02) 문제 P4.
> 설계 결정: 방안 1(안전망 먼저 + 타깃 정리) — 회계사 승인 2026-07-02(일회성 비용 확인).

---

## Metadata

- **Type**: REFACTOR + BUG(잠재 고지 빈틈)
- **Severity**: minor(유지보수·토큰) + 잠재 정확성(고지 누락)
- **Layer**: adapter (프롬프트 + 후처리)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: M

---

## 1. Problem (문제 정의)

### 1.1 "사문화 60줄" 전제는 절반만 참

`llmAnswerGenerator.ts`의 라벨 프롬프트(약 71~116행)는 세 종류가 섞여 있다.

| 종류 | 상태 | 근거 |
|---|---|---|
| ① 라벨 **값** 결정 규칙(결정 표·체크리스트·"T3/T4→🟢 금지") | ⚫ 죽음 | `resolveCitationLabel`(TAX-6A-11)이 Tier로 라벨 100% 재계산 → LLM 라벨 폐기(⚫폐지만 예외) |
| ② summary **어조** 규칙("유사 사례에서는", 단정 금지) | 🟢 살아있음 | V6·답변 어조에 직접 영향, 코드가 대체 안 함 |
| ③ "직접 근거 못 찾음" **고지** 규칙(TAX-048) | 🟢 살아있음·중요 | 아래 1.2 |

즉 P4의 "죽은 라벨 규칙을 지우자"는 ①에만 해당하고, ②·③을 함께 지우면 정확성이 후퇴한다.

### 1.2 발견한 잠재 버그 — 고지가 프롬프트에만 의존

`downgradeT3T4DirectCitations`는 **LLM이 T3·T4에 🟢를 잘못 붙였을 때만**
(`downgradedCount > 0` && `!hasAnyT1T2`) "직접 근거(법령 본문)를 찾지 못했습니다" 고지를
자동 추가한다. 그런데 LLM이 **처음부터 올바르게 🟡로 붙이면**(정상 케이스, downgradedCount=0)
코드는 고지를 추가하지 않고, 오직 **SYSTEM_PROMPT(TAX-048 규칙)**가 그 고지를 만든다.

→ 라벨-값 프롬프트를 지우면서 이 고지까지 옅어지면, 전체 T3·T4 결과에서 회계사가
"직접 근거 없음"을 못 보는 위험(§6.3, 가산세 노출)이 생긴다.

---

## 2. 설계 결정 — 방안 1 (안전망 먼저 + 타깃 정리)

1. **코드 안전망 승격**: 고지를 프롬프트 의존에서 떼어내 `ensureNoDirectBasisDisclosure`로
   코드가 보장(전체 T3·T4 && citations 존재 && expanded 아님 → 고지 부착, 멱등).
2. **타깃 정리**: 죽은 라벨-값 표·체크리스트만 프롬프트에서 제거. 살아있는 어조·고지·
   ⚫폐지 신호·시점 라벨·전제 검증(TAX-6A-8)은 보존.

- 대안(코드 안전망만/보류)은 P4의 정리 목적을 달성 못하거나(전자), 잠재 버그를 방치(후자).

---

## 3. Scope

### 3.1 허용된 변경
- [x] `src/adapters/llmAnswerGenerator.ts`
  - `ensureNoDirectBasisDisclosure` 신규 + `generate()` 말미 배선.
  - `SYSTEM_PROMPT`에서 [라벨 결정 표]·[라벨 결정 체크리스트] 제거, [라벨링 규칙] 압축.
- [x] `tests/unit/noDirectBasisDisclosure.test.ts` 신규.

### 3.2 금지된 변경
- ❌ `resolveCitationLabel`·`downgradeVectorLabels`·`downgradeT3T4DirectCitations`·
  `upgradeT1T2UnderlabeledCitations` 로직 변경(라벨 결정론 계약 불변)
- ❌ 시점 라벨·전제 검증(TAX-6A-8)·⚫폐지 신호 규칙 삭제
- ❌ V1~V6 검증기(lawVerifier) 수정

---

## 4. Acceptance Criteria

1. [ ] 죽은 라벨-값 표·체크리스트가 프롬프트에서 제거된다(토큰↓).
2. [ ] summary 어조·"직접 근거 못 찾음" 고지·⚫폐지·시점·전제검증 규칙은 유지된다.
3. [ ] 전체 T3·T4 결과(정상 🟡 라벨, direct)에서 고지가 코드로 보장된다(프롬프트 무관).
4. [ ] 기존 테스트 전부 PASS, typecheck 0, 라벨 결정론(V3) 계약 불변.

---

## 5. Verification

1. `npx tsc --noEmit` — 0
2. `npx vitest run` — 신규 7건 + 기존 PASS (665/665)
3. (회계사, 일회성) 골든셋 회귀로 V3·V6 무회귀 확인 — LLM 프롬프트 변경 효과 검증

---

## 6. Risks / Notes

- 프롬프트 텍스트 변경은 LLM 답변 어조/citation 선정에 미세 영향 가능 → **일회성 골든셋
  회귀**로 확인 필요(회계사 키·과금). 프롬프트 축소 자체는 요청당 입력 토큰을 줄여
  지속 비용은 오히려 감소.
- 라벨 값은 이미 결정론 계산이라 V3는 구조적으로 불변. 이번 변경의 위험은 오직 summary
  어조/선정 쪽이며, 어조·고지 규칙을 보존하고 고지를 코드로 이중 보장해 위험을 최소화.

---

## 7. Report Link

Report: `docs/reports/TAX-6B-28_report.md`
