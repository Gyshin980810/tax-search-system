# [BUG-002] V2 인용 무결성이 summary 내 큰따옴표 인용을 검사하지 않음 — 환각 사각지대

> 본 티켓은 Phase 3(TAX-012) PRD·SSOT 정합성 평가에서 발견된 HIGH-2 결함을 수정한다.
> AI는 작업 시작 전 이 티켓 + `CLAUDE.md` §6.1 + `docs/SSOT.md` §7.1 + `docs/PRD.md` §6.3.2를 읽는다.

---

## Metadata

- **Type**: BUG
- **Severity**: critical  *(환각 차단 핵심 경로 — PRD §0·§18 최우선 위험)*
- **Layer**: adapter  *(보조: domain 검증 규칙, eval 골든셋)*
- **Milestone**: MVP  *(M3 환각률 0% 게이트 구성요소)*
- **Estimated Size**: S (1~2파일 + 골든셋 픽스처)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

V2(인용 무결성) 검증이 **`answer.citations[].excerpt`만** 원문 대조한다.

- `src/adapters/lawVerifier.ts:60-70` — `for (const citation of answer.citations)` 루프만 존재. `citation.excerpt`가 `citation.taxLaw.content`에 포함되는지만 검사
- `answer.summary`(LLM이 자유 문장으로 생성하는 요약)는 **원문 대조 대상에서 제외**됨

### 1.2 기대 동작

PRD·SSOT가 **"답변에 포함된 모든 큰따옴표 발췌"** 를 검증하라고 규정한다.

- PRD §6.3.2: "답변에 포함된 모든 큰따옴표 발췌(`"..."`)에 대해 ① 검색 결과에서 원문 조회 ② 발췌와 원문 비교 ③ 1자라도 불일치 시 FAIL"
- SSOT §7.1 검증 알고리즘: "답변에 포함된 모든 큰따옴표 발췌(`"..."`)에 대해 ... 1자라도 불일치 시 검증 FAIL"

기대 동작:
- `answer.summary`(및 향후 회계사 가시 자유 텍스트)에서 큰따옴표로 감싼 인용 스팬을 추출한다.
- 추출된 각 스팬이 어떤 `sourceLaws[].content`에도 문자 단위로 포함되지 않으면 `checks.v2 = false`로 FAIL 처리한다(퍼지 매칭 금지 — PRD §6.3.2 "단순 문자열 매칭으로 충분").

### 1.3 영향·중요도

- `citations.excerpt`는 구조화된 필드라 비교적 안전하나, `summary`는 LLM 자유 생성 칸이다.
- LLM이 요약문에 `소득세법 제99조는 "전액 비과세"라고 규정합니다`처럼 **따옴표 친 환각 인용**을 넣으면, 현재 V2는 summary를 보지 않으므로 그대로 PASS → 회계사 노출.
- 이는 PRD §18 위험표 1·2순위(환각·의역) 및 §7.2 "인용 무결성 위반율 0%" 목표가 명시적으로 막으려던 경로다. 회계사가 보고서·세무 신고에 인용 시 가산세·법적 분쟁 직결(PRD §0).

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `src/adapters/lawVerifier.ts` (수정 — V2 로직에 summary 인용 추출·대조 추가, `:59-70`)
- `src/domain/LabeledAnswer.ts` (참조 — `summary` 필드)
- `tests/unit/lawVerifier.test.ts` (수정 — summary 환각 인용 FAIL 케이스 추가)
- `eval/golden_direct.json` (수정 — summary 환각 인용 FAIL 픽스처 추가, 회계사 검수)
- `eval/GOLDEN_SET_GUIDE.md` (수정 — 네거티브 케이스 작성 항목 보강, MED-1과 연계)

### 2.2 외부 API·리소스

- 없음. 순수 내부 문자열 검증(LLM·외부 API 호출 없음).

### 2.3 아키텍처 힌트

```
V2: for each citation.excerpt  → content.includes? (기존 유지)
  + extract "..." spans from answer.summary
      → 어떤 sourceLaws[].content 에도 미포함이면 FAIL  (신규)
```

- 검증 강도는 SSOT §7.1 "문자 단위 일치, 퍼지 매칭 금지" 준수. `.trim()` 외 정규화 도입 금지(정확성 우선, 기존 V2 정책과 일관).

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `src/adapters/lawVerifier.ts` — V2 블록에 `answer.summary`의 큰따옴표 스팬 추출 + `sourceLaws[].content` 대조 추가
- [ ] `tests/unit/lawVerifier.test.ts` — summary 환각 인용 FAIL / 정상 인용 PASS 회귀 테스트
- [ ] `eval/golden_direct.json` — summary 환각 인용 `expectedStatus:"FAIL"` 픽스처 1건 추가 (회계사 검수)
- [ ] `eval/GOLDEN_SET_GUIDE.md` — 네거티브 케이스(특히 summary 환각) 작성 가이드 1개 절 추가

### 3.2 금지되는 변경

- ❌ V1·V3·V4·V5·V6 판정 로직 변경 (BUG-001 및 별도 티켓 범위)
- ❌ 퍼지/유사도 매칭 도입 (SSOT §7.1 명시 금지)
- ❌ `citation.excerpt` 기존 V2 검사 약화·삭제
- ❌ LLM 호출 추가 (law-verifier는 순수 규칙 기반 유지 — CLAUDE.md §6.4)
- ❌ UI·API Route·재시도 정책 변경
- ❌ 법령 원문 가공, 폴더 구조·의존성 변경
- ❌ PRD/SSOT 본문 수정 (문서 정합은 별도 갱신 세션)

---

## 4. Strategy (구현 힌트 — 권장안, 강제 아님)

1. 큰따옴표 스팬 추출 헬퍼: 직선 따옴표 `"..."` 와 한글 환경 곡선 따옴표 `“...”` 를 대상으로 정규식 추출(스코프는 PRD §6.3.2의 `"..."` 기준, 곡선 따옴표는 LLM 출력 현실 반영을 위해 포함 검토 — 승인 단계에서 확정).
2. 추출된 각 스팬 `q`에 대해 `sourceLaws.some(law => law.content.includes(q.trim()))` 가 false면 `checks.v2 = false` + `failReasons` 기록.
3. **오탐(false positive) 관리**: 극단적으로 짧은 스팬(예: 2자 이하)이나 회계사 질문 재인용 등으로 인한 오탐 가능성은 골든셋 네거티브/정상 케이스로 캘리브레이션. 길이 임계값 도입 여부는 사양(§6.3.2 "1자라도 불일치 시 FAIL")과 충돌하지 않는 선에서 **승인 단계에서 결정**(임의 완화 금지).
4. 기존 `citation.excerpt` 검사와 신규 summary 검사는 **둘 다 충족해야 V2 PASS**.
5. 골든셋 정답값은 SSOT §13.2에 따라 회계사 검수.

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `summary`에 `sourceLaws` 어디에도 없는 `"..."` 인용이 있으면 `checks.v2 === false` (FAIL)
2. [ ] `summary`의 `"..."` 인용이 어떤 `sourceLaws[].content`의 부분 문자열이면 V2 통과
3. [ ] 따옴표 없는 일반 요약문은 V2에 영향 없음(기존 정상 케이스 회귀 0건)
4. [ ] 기존 `citation.excerpt` 기반 V2 검사 동작 불변(기존 단위 테스트 그린 유지)
5. [ ] `npm run test` — 기존 75건 + 신규 테스트 전부 그린
6. [ ] `npm run lint`, `npm run typecheck` 무오류
7. [ ] 골든셋 러너 전체 통과(신규 FAIL 픽스처가 의도대로 FAIL 판정)
8. [ ] 코드 동작이 PRD §6.3.2 / SSOT §7.1 문구와 일치

---

## 6. Verification (검증 단계 — 회계사 확인)

1. `npm run test` → summary 환각 인용 FAIL 케이스가 실제 FAIL로 잡히는지 확인
2. `eval/golden_direct.json`의 신규 네거티브 픽스처가 `expectedStatus:"FAIL"`로 의도대로 동작하는지 골든 러너로 확인
3. (코드 리뷰) V2 블록이 `citations` + `summary` 양쪽을 검사하는지 확인
4. `docs/reports/BUG-002_report.md` 검토

---

## 7. Risks / Notes (위험·주의사항)

- **오탐 위험**: summary에 정당하게 짧은 단어를 따옴표로 강조했으나 원문에 없는 경우 FAIL → 재생성 유발 가능. 정확성 우선 원칙상 "엄격(strict)"이 기본값이며, 완화는 사양과 충돌하지 않는 범위에서만 승인 후 도입.
- 곡선 따옴표(`“ ”`)·작은따옴표(`' '`)·낫표(`「 」`) 처리 범위는 LLM 실제 출력 표본으로 승인 단계에서 확정. 과도 확장은 별도 티켓.
- 골든셋 정답값은 회계사 검수 필수(SSOT §13.2). 본 티켓은 픽스처 초안만 제시.
- 본 수정은 V2의 환각 차단 범위를 넓히므로, 기존 6개 PASS 골든 픽스처의 summary가 원문 미포함 인용을 갖지 않는지 사전 점검 필요(현 6건은 따옴표 인용 없는 서술형 summary로 확인됨 — 회귀 영향 낮음).

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 근본 원인 분석 (V2 루프가 citations만 순회)
- [ ] 영향받는 파일 목록
- [ ] 큰따옴표 추출 범위·오탐 정책 제안 (승인 항목)
- [ ] 구현 계획 (3~5단계)

→ **인간(회계사) 승인 후 코딩 시작** (CLAUDE.md 행동 9계명 #8, #10)

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 변경 요약
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] 발견된 위험·제한사항(특히 오탐 표본)
- [ ] 리포트 파일 경로: `docs/reports/BUG-002_report.md`

---

## 9. Ticket Size Rule

- 수정 파일 1~2개(`lawVerifier.ts` + 테스트) + 골든셋/가이드 보강 → 규칙 내(S). 분할 불필요.

---

## 10. Related Tickets (관련 티켓)

- 선행: `TAX-012` (Phase 3 law-verifier 통합 — 본 결함의 발생 지점)
- 병행: `BUG-001_v5_disclaimer_auto_attach.md` (HIGH-1, 별도 PR — SSOT §8.3 1티켓 1PR)
- 연계: Phase 3 평가 MED-1(골든셋 네거티브 부재) — 본 티켓의 FAIL 픽스처·가이드 보강이 부분 해소
- 참조: PRD §6.3.2 / §7.2 / §18, SSOT §7.1, CLAUDE.md §6.1

---

## 11. Report Link (리포트 연결)

Report: `docs/reports/BUG-002_report.md` (미작성)

---

**작성자**: Claude (Phase 3 평가 기반 초안)
**작성일**: 2026-05-18
**최종 수정일**: 2026-05-18
