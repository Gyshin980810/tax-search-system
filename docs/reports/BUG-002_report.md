# BUG-002 구현 리포트 — V2 인용 무결성에 summary 큰따옴표 인용 검사 추가

> 완료일: 2026-05-19
> 관련 티켓: `docs/tickets/BUG-002_v2_summary_citation_integrity.md`
> 선행: TAX-012 (Phase 3 law-verifier 통합), Phase 3 재평가 H-2
> Severity: critical (환각 차단 핵심 경로 — PRD §0·§18 최우선 위험)

---

## 1. 근본 원인

`src/adapters/lawVerifier.ts`의 V2 블록이 `for (const citation of answer.citations)`만
순회하여 `citation.excerpt`만 원문 대조했다. LLM 자유 생성 칸인 `answer.summary`는
검사 대상에서 제외되어, 요약문에 따옴표 친 환각 인용을 넣어도 V2를 통과해
회계사에게 노출되는 사각지대가 있었다 (PRD §18 1·2순위 위험).

---

## 2. 파일 변경 목록

| 파일 | 작업 | 내용 |
|---|---|---|
| `src/adapters/lawVerifier.ts` | 수정 | `extractQuotedSpans()` 헬퍼 추가 + V2 블록에 `summary` 큰따옴표 인용 원문 대조 덧붙임 (기존 `excerpt` 검사 불변) |
| `tests/unit/lawVerifier.test.ts` | 수정 | V2 describe에 summary 환각 차단 테스트 4건 추가 |
| `eval/golden_direct.json` | 수정 | 네거티브 FAIL 픽스처 `G-N1` **초안** 1건 추가 (회계사 검수 대기) |
| `eval/GOLDEN_SET_GUIDE.md` | 수정 | "5-1단계 — 네거티브(FAIL 기대) 케이스 작성" 절 추가 |

> 금지 항목(티켓 §3.2) 전부 미변경: V1·V3·V4·V5·V6 로직, 퍼지/유사도 매칭,
> `excerpt` 기존 검사, LLM 호출, UI·API·재시도 정책, 원문 가공·구조·의존성,
> PRD/SSOT 본문.

---

## 3. 주요 변경 내용

### 3.1 큰따옴표 스팬 추출 헬퍼

```ts
function extractQuotedSpans(text: string): string[] {
  const spans: string[] = []
  for (const m of text.matchAll(/"([^"]+)"/g)) spans.push(m[1])   // 직선 "..."
  for (const m of text.matchAll(/“([^”]+)”/g)) spans.push(m[1])   // 곡선 “...”
  return spans
}
```

**승인된 설계 결정 (회계사 확인)**:
- 따옴표 범위: 직선 `"..."` + 곡선 `“...”` 둘 다 (LLM 한국어 출력의 곡선 따옴표
  환각 인용까지 포착). 작은따옴표·낫표(`「」`)는 범위 밖.
- 오탐 정책: 길이 임계값 미도입·엄격 (SSOT §7.1 "1자라도 불일치 시 FAIL"
  그대로). 빈 스팬만 제외, 그 외 전부 원문 대조.

### 3.2 V2 summary 검사 (기존 excerpt 검사 뒤에 덧붙임)

```ts
// V2 (추가): summary 내 큰따옴표 인용도 원문 대조 (BUG-002)
for (const span of extractQuotedSpans(answer.summary)) {
  const quoted = span.trim()
  if (quoted.length > 0 && !sourceLaws.some((law) => law.content.includes(quoted))) {
    checks.v2 = false
    failReasons.push(`V2: summary 인용이 원문과 불일치 — (인용 앞 30자: "${quoted.slice(0, 30)}")`)
  }
}
```

`citations.excerpt` 검사와 `summary` 검사는 **둘 다 충족해야 V2 PASS** (한쪽이라도
위반이면 `checks.v2 = false`). 사양(SSOT §7.1)대로 `content.includes()` 단순
문자열 포함만 사용 — 퍼지 매칭 없음.

### 3.3 골든셋 네거티브 픽스처 G-N1 (M-5 부분 해소)

`golden_direct.json`에 summary 환각 인용 `expectedStatus:"FAIL"` 픽스처 초안 추가.
**재평가 M-5("골든셋 6건 전부 PASS, 네거티브 0건")를 처음으로 부분 해소** —
"틀린 답을 FAIL로 거르는 능력"이 골든셋으로 회귀 검증되기 시작했다.
정답값(`expectedStatus`)은 SSOT §13.2상 회계사 검수 필수 → `description`에
`[초안 → 회계사 검수 대기]` 표기, AI 임의 확정하지 않음.

---

## 4. 검증 결과

| 단계 | 명령 | 결과 |
|---|---|---|
| 타입 체크 | `npm run typecheck` | ✅ 오류 없음 |
| 린트 | `npm run lint` | ✅ 오류 없음 |
| 테스트 | `npm run test` | ✅ **83 passed (83)** — 이전 78 + V2 단위 4 + 골든 G-N1 1 |
| 골든러너 | (vitest 포함) | ✅ 기존 6건 PASS 유지 + G-N1 의도대로 FAIL 판정 |

### Acceptance Criteria 대응

- [x] AC1 — summary에 `sourceLaws` 없는 `"..."` 인용 시 `checks.v2 === false`
- [x] AC2 — summary 인용이 `sourceLaws[].content` 부분 문자열이면 V2 통과
- [x] AC3 — 따옴표 없는 일반 요약문은 V2에 영향 없음
- [x] AC4 — 기존 `excerpt` 기반 V2 검사 불변, 기존 단위 테스트 그린 유지
- [x] AC5 — `npm run test` 기존 + 신규 전부 그린 (83건)
- [x] AC6 — lint·typecheck 무오류
- [x] AC7 — 골든러너 전체 통과, 신규 FAIL 픽스처(G-N1)가 의도대로 FAIL
- [x] AC8 — 코드 동작이 PRD §6.3.2 / SSOT §7.1 "모든 큰따옴표 발췌 원문 대조,
  단순 문자열 매칭, 퍼지 금지"와 일치

### 사전 점검 (티켓 §7) — 회귀 영향 0건

기존 G-1~G-5(6건) 모두 summary에 큰따옴표 인용이 없는 서술형 문장 →
새 summary 검사가 기존 PASS를 깨지 않음 (사전 점검 완료, 실측으로 재확인).

---

## 5. 잔여·위험·회계사 결정 사항

### 5.1 골든셋 G-N1 정답값 회계사 검수 (필수)

`G-N1`은 **초안**이다. `expectedStatus:"FAIL"`이 타당한지 회계사 검수 후 확정.
검수 완료 시 `description`의 `[초안 → 회계사 검수 대기]` 표기를 제거한다.

### 5.2 eval/README.md 표현 모순 (회계사 결정 — 본 PR 범위 밖)

`eval/README.md` 88~91행이 *"golden_direct.json 6개 케이스 100% PASS"*로 명시되어
있으나, G-N1(FAIL 기대) 추가로 케이스 수·구성이 바뀌었다. README는 티켓 §3.1
허용 변경 목록 밖이므로 **본 PR에서 수정하지 않음**. 합격선 표현 갱신
(예: "PASS 6건 100% + 네거티브 FAIL 정상 검출")은 별도 문서 갱신 세션에서
회계사 결정에 따라 처리 권고 (SSOT §9.3 문서 정합은 별도 세션).

### 5.3 범위 밖 (별도 처리)

- BUG-001(V5 자동 부착)은 별도 PR로 완료됨 (`docs/reports/BUG-001_report.md`).
- 재평가 M-1·M-2·M-3·M-4·M-6·M-7·N-1·N-2는 별도 티켓 대상 (미착수).

---

## 6. 결론

V2가 `citations.excerpt`뿐 아니라 `answer.summary`의 큰따옴표 인용까지 원문
대조하도록 확장 완료. LLM이 요약문에 따옴표 친 환각 인용을 넣는 사각지대를
차단했다. 재평가 **H-2 해소**, **M-5 부분 해소**(골든셋 네거티브 케이스 최초 도입).

> **회계사 노출 게이트**: 재평가가 권고한 HIGH 2건(BUG-001·BUG-002)이 모두
> 구현 완료되었다. 단 ① G-N1 정답값 회계사 검수 ② 골든셋 30건 작성
> ③ P95 재측정은 잔여이며, M3 노출 게이트 최종 통과 판단은 회계사 몫이다.

---

**작성자**: Claude (BUG-002 구현)
**작성일**: 2026-05-19
