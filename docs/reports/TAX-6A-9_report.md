# TAX-6A-9 리포트 — G-3 법령 연혁 API 연동 (방안 A: G-3 케이스 재설계)

**작성일:** 2026-06-14  
**담당:** Claude (AI)  
**검토:** 회계사 승인 완료

---

## 1. 배경 및 목표

G-3 시점 검색 골든셋 20건이 "과거 시점 기준 조문 조회"를 요구하는 설계였으나,  
국세법령정보시스템 OpenAPI가 **현행 법령만 반환**하는 구조임을 TAX-6A-9 진단에서 확인.

회계사가 **방안 A (G-3 케이스 재정의)** 를 승인 — 과거 시점 케이스를 현행 API로 처리 가능한 케이스로 재설계.

---

## 2. 진단 결과

### 2.1 API 연혁 조회 불가 확인

국세법령정보시스템 OpenAPI에는 `enfDate`(시행일자) 파라미터가 없음:
- `law.go.kr` API 파라미터: `lsNm`(법명), `ancDate`(공포일), `lsId`(법령 ID) — 시행일 기준 조회 미지원
- 특정 과거 시점의 조문 내용 조회는 구조적으로 불가

### 2.2 방안 비교 (회계사 승인 당시)

| 방안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| **A (채택)** | G-3 케이스를 현행 기준으로 재설계 | API 제약 우회 가능, 즉시 실행 | G-3 의미가 일부 약해짐 |
| B | law.go.kr 연혁 페이지 스크래핑 | 과거 조문 실제 반영 | 스크래핑 허가 불명확, 유지보수 부담 |

---

## 3. 변경 사항

### 3.1 `src/adapters/lawVerifier.ts`

**TEMPORAL_LABEL_PATTERNS 확장** (회계사 방안 X 승인, 2026-06-14):
```typescript
// 추가 패턴 2종
/^\[적용 시점: \d{4}\.\d{2}\.\d{2}\]$/,        // 단일 날짜 (시작일만)
/^\[적용 시점: \d{4}\.\d{2}\.\d{2}~\]$/,        // 종료일 없는 범위
```

LLM이 targetDate만 알고 조문 시행일자를 모를 때 단일 날짜 형식을 생성하는 패턴을 허용.

**checkV2 비법령 면제** (회계사 승인 2026-06-14):
```typescript
if (content.length === 0) continue  // content=0 비법령 V2 면제
```

국세청 해석례 등 API가 본문을 제공하지 않는 레코드에 대해 발췌 검증을 면제.

### 3.2 `eval/golden_temporal.json`

**G-3 20건 전체 재구성** — 과거 시점 → 현행 API 처리 가능한 케이스로 교체:

| 케이스 | 원래 설계 | 재설계 내용 |
|---|---|---|
| G3-06 | 소득세법 제59조의2 | → 제59조의4 (자녀세액공제 개정, 현행 시행) |
| G3-09 | 소득세법 시행령 | → 소득세법 제89조 (1세대1주택) |
| G3-10 | 소득세법 시행령 제155조 (미래 시행) | → 소득세법 제104조 (양도소득세율, 2026-04-21 시행) |
| G3-11 | 소득세법 시행령 | → 소득세법 제88조 |
| 나머지 | 각종 조문 | targetDate를 현행 시행일자 이후로 조정 |

**9건 PASS 케이스 answer 병합:**
- `scripts/diagnostics/rebuild_g3.mjs`: 20개 케이스 현행 원문 채우기
- `scripts/diagnostics/merge_g3_answers.mjs`: 재실측 PASS 결과 병합
- disclaimer V5 수정: 하드코딩 오류 → `src/domain/disclaimer.ts` DISCLAIMER 상수와 일치

---

## 4. 파일 변경 목록

| 파일 | 변경 유형 | 설명 |
|---|---|---|
| `src/adapters/lawVerifier.ts` | 수정 | TEMPORAL_LABEL_PATTERNS +2패턴, V2 비법령 면제 |
| `eval/golden_temporal.json` | 수정 | G-3 20건 재구성 + 9건 PASS answer 병합 |
| `scripts/diagnostics/rebuild_g3.mjs` | 신규 | G-3 재구성 원문 채우기 스크립트 |
| `scripts/diagnostics/fix_g3_10.mjs` | 신규 | G3-10 미래 시행 → 현행 조문 교체 |
| `scripts/diagnostics/merge_g3_answers.mjs` | 신규 | 재실측 PASS 결과 golden_temporal에 병합 |
| `docs/reports/TAX-6A-9_g3_rebuild.json` | 신규 | 재구성 원시 데이터 |
| `docs/reports/phase6a_review_temporal.json` | 갱신 | 재실측 결과 (3차, 9/20 PASS) |

---

## 5. 검증 결과

### 5.1 vitest 정적 테스트

```
Test Files  1 passed (1)
      Tests  95 passed (95)
```

- G-3 PASS 케이스 9건 전체 V1~V6 GREEN
- 기존 golden_direct.json (66건), golden_hallucination.json 회귀 없음

### 5.2 G-3 골든셋 현황

| 상태 | 건수 | 비고 |
|---|---|---|
| PASS (expectedStatus='PASS') | 9건 | vitest GREEN, V1~V6 전체 통과 |
| 회계사 검수 대기 (_draft 유지) | 11건 | answer 미병합, expectedStatus='' |

### 5.3 TEMPORAL_LABEL_PATTERNS 회귀 검사

기존 패턴(`[현행]`, `[적용 시점: ~]`, `[폐지: ~]`, `[결정: ~]`) 모두 기존 케이스에서 정상 동작 확인.

---

## 6. 잠재 위험

- **G-3 11건 미완료**: 회계사 검수 + answer 데이터 병합이 남아 있음. 운영에 직접 영향 없음 (run_golden은 expectedStatus 기준 필터).
- **비결정적 LLM**: G-3 실측에서 20번 중 9번 PASS — V4·V3 실패가 여전히 발생하는 케이스 존재. 라벨 강화(TAX-042D·051)로 개선 중.
- **단일 날짜 패턴 확장**: `[적용 시점: YYYY.MM.DD]` 허용으로 사양 문서(SSOT §7.5)와 1자 불일치 존재 (BUG-003 범위 — 별도 정합 티켓).

---

## 7. 다음 단계

G-3 나머지 11건 회계사 검수 → answer 병합 → expectedStatus='PASS' 설정이 남아 있으나,  
운영 시스템에 직접 영향 없고 Phase 6A 전체 완결 판단은 회계사 결정.

**다음 티켓 후보:** Phase 6B (부칙·경과조치 자동 연결 FR-17) 또는 G-4 골든셋 추가 검수.
