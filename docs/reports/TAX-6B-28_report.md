# TAX-6B-28 리포트 — 라벨 프롬프트 사문화 정리 + 고지 코드 안전망

**작업일**: 2026-07-02
**티켓**: `docs/tickets/TAX-6B-28_label_prompt_cleanup.md`
**설계 결정**: 방안 1(안전망 먼저 + 타깃 정리) — 회계사 승인(일회성 비용 확인) 2026-07-02
**상태**: 구현 완료 (골든셋 회귀는 회계사 일회성 검증)
**브랜치**: `feat/tax-6b-28-label-prompt-cleanup`

---

## 1. 근본 원인 (P4 재정의)

P4는 "답변 프롬프트의 라벨 규칙 ~60줄이 `resolveCitationLabel` 결정론화로 사문화됐으니
지우자"였다. 그러나 조사 결과 그 60줄은 **세 종류가 섞여** 있었다.

- ① 라벨 **값** 결정 규칙(결정 표·체크리스트) — ⚫ **죽음**(라벨은 Tier로 재계산됨).
- ② summary **어조** 규칙(단정 금지, "유사 사례에서는") — 🟢 **살아있음**(V6·어조).
- ③ "직접 근거 못 찾음" **고지** 규칙(TAX-048) — 🟢 **살아있음·회계사 보호 핵심**.

따라서 "60줄 통삭제"는 정확성을 후퇴시킨다. 특히 ③은 잠재 버그와 얽혀 있었다.

### 잠재 버그
`downgradeT3T4DirectCitations`는 LLM이 T3·T4에 🟢를 **잘못** 붙인 경우
(`downgradedCount > 0`)에만 고지를 자동 추가했다. LLM이 처음부터 올바르게 🟡로 붙이면
(정상 케이스) 고지는 오직 SYSTEM_PROMPT에만 의존했다. 프롬프트가 옅어지면 전체 T3·T4
결과에서 "직접 근거 없음" 고지가 사라질 수 있었다.

---

## 2. 변경 사항

### 파일 변경 목록
- `src/adapters/llmAnswerGenerator.ts` (수정)
  - **신규** `ensureNoDirectBasisDisclosure(citations, summary, matchStage)` — 최종 citations가
    전부 T3·T4(T1·T2 부재)이고 `expanded`가 아니면 "직접 근거(법령 본문)를 찾지 못했습니다."
    고지를 보장(멱등, 빈 citations 무관여). `generate()` 말미(downgradeVectorLabels 이후)에 배선.
  - `SYSTEM_PROMPT`에서 **죽은 라벨-값 [결정 표]·[결정 체크리스트] 제거**(~34줄),
    [라벨링 규칙]은 "라벨 값은 시스템이 Tier로 자동 계산" + ⚫폐지 신호 + 어조 규칙으로 압축.
- `tests/unit/noDirectBasisDisclosure.test.ts` (신규, 7건)

### 보존한 것(정확성 계약 불변)
- `resolveCitationLabel`·`downgradeVectorLabels`·`downgradeT3T4DirectCitations`·
  `upgradeT1T2UnderlabeledCitations` **로직 무변경** → V3 결정론 계약 불변.
- summary 어조(단정 금지/"유사 사례에서는"), TAX-048 고지 규칙, ⚫폐지 신호,
  [시점 라벨 규칙], [질문 전제 검증 — TAX-6A-8] **프롬프트에 그대로 유지**.

---

## 3. 검증 결과

1. `npx tsc --noEmit` — **오류 0**
2. `npx vitest run` (전체) — **665/665 PASS** (기존 658 + 신규 7)
   - 핵심 빈틈(전체 T3, 정상 🟡, direct → 고지 부착) / T1 존재 시 미부착 / expanded 스킵 /
     멱등 2종 / 빈 citations 무관여 / matchStage 미지정
   - 기존 45개 테스트 파일 무회귀(라벨 결정론·벡터 천장·1b 승격 통합 모두 PASS)

---

## 4. 잠재 위험·제한 (정직 고지)

- **프롬프트 텍스트 변경은 골든셋 회귀로만 정량 검증 가능**(회계사 키·과금, **일회성**).
  라벨 **값**은 이미 결정론 계산이라 V3는 구조적으로 불변이고, 이번 변경의 잔여 위험은
  summary 어조/citation 선정 쪽뿐이다. 어조·고지 규칙을 프롬프트에 보존하고 고지를
  코드로 이중 보장해 위험을 최소화했다.
- 프롬프트 축소로 요청당 입력 토큰이 줄어 **지속 비용은 오히려 감소**(일회성 검증 외 추가 과금 없음).

---

## 5. 관련
- 근거: 검색 정확도 향상 분석(2026-07-02) 문제 P4
- 계약 정합: TAX-6A-11(라벨 결정론화), TAX-048(T1·T2 부재 고지), TAX-051(V3 안전망),
  TAX-6A-8(전제 검증), TAX-037·038·050(시점 라벨)
