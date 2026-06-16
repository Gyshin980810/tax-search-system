# TAX-030-C 리포트 — 신고 환류 스크립트 (ops_feedback → 골든셋 시드)

- **티켓**: `docs/tickets/TAX-030_wrong_case_harvesting.md` (§9 분할의 C — 환류 스크립트)
- **브랜치**: `feat/tax-030-c-harvest-to-seeds` (master 기반, 030-A·B 머지 완료 후 분기)
- **작성일**: 2026-06-16
- **상태**: 코드 구현·검증 완료 (실 DB 리포트 생성은 운영 데이터 축적 후)

---

## 1. 변경 사항 요약

### 파일 변경 목록 (신규 3 / 수정 4)

| 파일 | 구분 | 내용 |
|---|---|---|
| `scripts/golden/harvestToSeeds.ts` | 신규 | `ops_feedback` 집계 → 회계사 검토용 리뷰 리포트(md) 생성 |
| `tests/unit/harvestToSeeds.test.ts` | 신규 | `buildReviewMarkdown` 순수함수 단위 테스트 8종 |
| `docs/reports/TAX-030-C_report.md` | 신규 | 본 리포트 |
| `src/ports/opsLogPort.ts` | 수정 | `OpsFeedbackRow` 타입 + `IOpsLogPort.listFeedback` 읽기 메서드 추가 |
| `src/adapters/opsLog.ts` | 수정 | `PgOpsLogAdapter.listFeedback`(GROUP BY 집계 SELECT) + `NullOpsLogAdapter` 빈 배열 |
| `package.json` | 수정 | `golden:harvest` 스크립트 1줄 등록 |
| `eval/GOLDEN_SET_GUIDE.md` | 수정 | "7단계 — 운영 환류" 절 추가 |
| `tests/unit/submitFeedback.test.ts` · `generateAnswer.test.ts` | 수정 | Port 확장에 따른 가짜 Port에 `listFeedback` 동기화 |

### 주요 변경

- **신고 환류 공급선 신설**: 회계사 👎 신고(`ops_feedback`)를 `query_hash`로 묶어 **빈도순**으로
  집계 → `eval/golden_harvest_review.md`(검토용 표)로 출력. 회계사가 이 표를 보고 골든셋 시드를
  입력하면 기존 `buildCases`(TAX-028) 흐름으로 자연스럽게 이어진다.
- **회계사 결정 2건 반영**: ① DB 읽기 = `IOpsLogPort.listFeedback`(계층 정합·테스트 용이)
  ② 출력 = 검토용 리뷰 리포트(자동화는 "무엇을·얼마나 신고당했나"까지, 정답 조문은 회계사 기입).

### 설계 결정 — "데이터 갭"

- `buildCases`의 시드는 `lawName`·`articleNumber`(정답 조문)를 요구하지만 `ops_feedback`에는
  **구조적으로 없다.** "어떤 조문이 직접근거인가"는 세법 판단이므로 회계사 몫(CLAUDE.md §6.3, 티켓 §3.2).
- 따라서 스크립트는 정답 조문을 **자동 생성하지 않고**, 리포트의 "정답 조문" 칸을 빈칸으로 둬
  회계사가 채우게 한다. 자기참조 채점 오류(AI가 틀린 답을 모아 AI가 정답으로 박제) 방지.

### 저장소 변경 반영 (원안 대비)

- 원안 티켓(2026-05-23)은 `logs/wrong_cases/*.json` 파일에서 읽도록 설계됐으나, 회계사 결정
  (2026-06-16)으로 저장소가 **Neon Postgres(`ops_feedback`)** 로 바뀌었다(서버리스 파일 휘발).
  본 스크립트는 파일이 아니라 **DB SELECT**(어댑터 경유)로 읽는다.

---

## 2. 검증 결과

| # | 검증 항목 | 결과 |
|---|---|---|
| 1 | `npx tsc --noEmit` 타입 체크 | ✅ PASS (exit 0) |
| 2 | `npm run build` 프로덕션 빌드 | ✅ PASS |
| 3 | `npx vitest run` 전체 회귀 | ✅ PASS (37 파일 / **595 테스트**, 587→+8) |
| 4 | 빈 신고 → "집계할 신고가 없습니다" 안내 + 표 미생성 | ✅ PASS |
| 5 | 행 존재 시 빈도순 표 생성·순위·신고수 표시 | ✅ PASS |
| 6 | "정답 조문" 칸을 빈칸으로 유지 (회계사 기입란) | ✅ PASS |
| 7 | 마지막 신고 시각은 날짜(YYYY-MM-DD)만 노출 | ✅ PASS |
| 8 | 파이프(`|`) 포함 질문 escape (표 깨짐 방지) | ✅ PASS |
| 9 | 다중 사유 ` / ` 결합 / 사유 없으면 `(사유 없음)` | ✅ PASS |
| 10 | 방어적 마스킹: 휴대폰·이메일이 와도 리포트엔 마스킹되어 노출 | ✅ PASS |

### SQL 집계 설계 (PgOpsLogAdapter.listFeedback)

```sql
SELECT query_hash,
       (array_agg(query_norm ORDER BY created_at DESC))[1]   AS query_norm,
       (array_agg(source_types ORDER BY created_at DESC))[1] AS source_types,
       array_remove(array_agg(NULLIF(reason,'') ORDER BY created_at DESC), NULL) AS reasons,
       COUNT(*)::int AS report_count,
       MAX(created_at) AS last_reported_at
FROM ops_feedback
GROUP BY query_hash
ORDER BY report_count DESC, last_reported_at DESC
```

---

## 3. 개인정보 보호 (CLAUDE.md §7 / SSOT §7.8·§14.2)

- ✅ 읽기 전용 — 저장 컬럼을 추가하지 않음. `ops_feedback`에 식별자 컬럼이 **구조적으로 없음**(030-B).
- ✅ 리포트의 질문·사유에 `maskPhoneEmail`을 **방어적으로 한 번 더** 적용(적재 시 1차 + 리포트 시 2차).
- ✅ 회계사 식별자(이메일·이름·IP)는 조회·출력 어디에도 포함되지 않음(단위 테스트로 검증).

---

## 4. 잠재 위험 / 제한사항

- ⚠️ 정답 조문은 회계사 수기 입력이 필수 — 자동화는 "후보 모으기"까지. (의도된 설계)
- ⚠️ `golden_harvest_review.md`는 **회귀 게이트가 아님** — 검수 없이 `golden_direct.json` 편입 금지.
- ⚠️ 로컬·`DATABASE_URL` 미설정 시 `NullOpsLogAdapter`는 빈 배열 → 빈 리포트(스크립트 main은 URL 없으면 안내 후 종료).
- 📌 실제 리포트 생성·검증은 베타 운영 중 👎 신고가 축적된 뒤 `npm run golden:harvest`로 수행.
- 📌 신고 남용·중복(같은 답변 연타)은 `query_hash` GROUP BY로 1행 집계되나, 빈도 가중은 회계사 판단에 위임.

---

## 5. 다음 단계

1. (운영) 베타에서 👎 신고 축적 → `npm run golden:harvest` → 리포트 검토 → 골든셋 환류.
2. TAX-6B-9(내용 검증기 방안 A) — 신고 사례 기반 `expectedContent` 대조.
3. TAX-044/045 — 운영 로그 1~2주 축적 후 도메인 사전·정확도 개선.
