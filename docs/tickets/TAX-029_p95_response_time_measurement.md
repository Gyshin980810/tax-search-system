# TAX-029 RAG 5단계 누적 응답시간 P95 측정

> 작성자: AI(Claude Opus 4.7) / 작성일: 2026-06-05
> 배경: TAX-028(골든셋 30건 작성) §9-④에서 분리된 후속 티켓. ROADMAP §3 Phase 4(TAX-026-B~) 코딩 실착수 게이트의 마지막 잔여 항목.
> 골든셋 트랙: TAX-036에서 40건 머지 완결(목표 30 +10 초과). 본 티켓이 P95 측정으로 게이트 해제.

---

## Metadata

- **Type**: TASK
- **Severity**: major (Phase 4 게이트)
- **Layer**: infra / observability
- **Milestone**: Post-MVP (Phase 4 진입 게이트)
- **Estimated Size**: M (스크립트 2~3개 + 리포트)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- PRD §7.1 응답시간 목표는 명시되어 있다.
  - 검색 응답 시간(직접 매칭) **< 3초 (P95)**
  - RAG 응답 시간(LLM 2회 + 검증) **< 15초 (P95)**
- PRD §15.2 "응답시간 P95" KPI는 **부하 100회 측정 / RAG 5단계 누적 / 합격선 < 15초**로 정의돼 있다.
- 그러나 **실측 데이터가 한 번도 없다.**
  - TAX-012-H(P95 재측정) 잔여로 표시(`PHASE3-EVALUATION_2026-05-18_report.md` line 141·148)
  - TAX-028에서 별도 분리(§9-④, 2026-05-23 회계사 결정)
  - TAX-026 Phase 4 코딩 게이트 미해제

### 1.2 기대 동작

1. `npm run perf:p95` (가칭) 명령으로 RAG 5단계 누적 응답시간을 **100회** 측정한다.
2. 결과 출력:
   - 각 단계별(쿼리 변환 / 검색 / 답변 생성 / 검증) 평균·P50·P95·P99·최대치
   - 전체 누적 P95
   - 합격선(< 15초) 통과 여부
   - 골든셋 어느 케이스로 측정했는지 (재현 가능성)
3. `docs/reports/TAX-029_report.md`에 측정 결과 + Phase 4 게이트 해제 판단 명시.

### 1.3 영향·중요도

- **Phase 4 게이트 마지막 잔여건.** 본 티켓 통과 시 TAX-026-B(pgvector 스키마) 코딩 실착수 가능.
- 회귀 베이스라인 확보: 향후 검증 단계 추가·LLM 모델 교체 시 비교 기준.
- **운영 비용 우려**: 100회 측정 = OpenAI API 200회 호출(쿼리 변환 1회 + 답변 생성 1회 per case). GPT-4o-mini 기준 $0.5~$2 예상.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `scripts/perf/measureP95.ts` (신규 생성 예정) — 측정 러너
- `scripts/perf/reportP95.ts` (신규 또는 통합) — 리포트 출력
- `package.json` (수정) — `perf:p95` 스크립트 추가
- `eval/golden_direct.json` (참조 전용) — 측정 케이스 선정용 소스
- `src/usecases/searchTaxLawWithAnswer.ts` (참조 전용) — RAG 5단계 엔트리
- `docs/reports/TAX-029_report.md` (신규 생성 예정) — 결과 리포트

### 2.2 외부 API·리소스

- **OpenAI GPT-4o-mini** — 쿼리 변환 + 답변 생성 (실 호출 필요)
- **국세법령정보시스템 OpenAPI** — 검색(법령·비법령 4트랙)
- 측정 환경 인증:
  - `OPENAI_API_KEY` (실 키)
  - `NATIONAL_TAX_API_KEY` (실 키)

### 2.3 아키텍처 힌트

```
[사용자 질문] (골든셋 케이스에서 추출)
     ↓ t0
[1] queryRewrite (LLM 1차)        ─── t1 측정
     ↓
[2] searchTaxLaw (외부 API)        ─── t2 측정
     ↓
[3] llmAnswerGenerator (LLM 2차)   ─── t3 측정
     ↓
[4] lawVerifier (V1~V6 정규식)     ─── t4 측정
     ↓
[5] 화면 출력 형태 직렬화          ─── t5 측정 (선택)
     ↓
[누적 응답시간 = t_total]
```

100회 반복 → 단계별·누적 P50/P95/P99 산출.

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `scripts/perf/measureP95.ts` 신규 생성 (측정 러너 — `performance.now()` 기반)
- [ ] `scripts/perf/reportP95.ts` 신규 또는 measureP95에 통합 (백분위 계산·테이블 출력)
- [ ] `package.json` — `"perf:p95": "tsx scripts/perf/measureP95.ts"` 스크립트 추가
- [ ] `docs/reports/TAX-029_report.md` 신규 작성

### 3.2 금지되는 변경

- ❌ `src/adapters/*` 수정 (관측만, 비즈니스 로직 무변경)
- ❌ `src/usecases/*` 수정 (단계 측정용 hook은 신규 wrapper로 처리, 본문 무수정)
- ❌ 골든셋(`eval/golden_direct.json`) 수정 — 읽기 전용
- ❌ LLM 모델 교체 (`gpt-4o-mini` 유지)
- ❌ 타임아웃 임의 변경 (현 `LLM_TIMEOUT_MS = 10_000` 유지)
- ❌ 측정 비용 절감을 위한 캐싱·모킹 — **실제 운영 경로 그대로** 측정해야 의미 있음(아래 §9-① 참조)
- ❌ 측정 결과로 도출된 병목 최적화 — **별도 후속 티켓**

---

## 4. Strategy (구현 힌트)

1. **측정 케이스 선정 (회계사 §9-② 결정 의존)**
   - 옵션 A: 골든셋 40건 중 PASS 24건만 → 평균 4.2회 반복으로 100회 도달
   - 옵션 B: 골든셋 PASS 24건 + 네거티브 6건 가중 분포로 100회
   - 옵션 C: 단일 대표 케이스(예: G-1) 100회 반복 — 변동성 최소화·실측 분포 손실
   - **권장**: 옵션 B — PRD §15.2 "부하 100회" 정의에 부합

2. **단계별 측정 hook**
   - usecase 외부에서 wrapper 적용 (코드 무수정):
   ```typescript
   const t0 = performance.now()
   const rewritten = await queryRewrite(question)
   const t1 = performance.now()
   const laws = await searchTaxLaw(rewritten)
   const t2 = performance.now()
   const answer = await llmAnswerGenerator(laws, question)
   const t3 = performance.now()
   const verified = await lawVerifier(answer)
   const t4 = performance.now()
   ```

3. **백분위 계산**
   - 단계별·누적 누적 배열을 정렬 → `Math.floor(0.95 * n)` 인덱스 = P95
   - P50·P95·P99·max·mean·stdev 출력

4. **결과 출력 포맷 (예시)**
   ```
   === TAX-029 P95 측정 결과 (n=100) ===
   단계              평균    P50    P95    P99    Max
   [1] queryRewrite  1.8s    1.7s   3.2s   4.1s   4.8s
   [2] searchTaxLaw  0.9s    0.8s   1.9s   2.4s   3.1s
   [3] answerGen     5.2s    4.8s   9.1s   11.3s  12.7s
   [4] verify        0.01s   0.01s  0.02s  0.03s  0.05s
   ───────────────────────────────────────────────
   누적             7.9s    7.4s   12.8s  15.2s  17.8s
   ───────────────────────────────────────────────
   합격선 P95 < 15초: ✅ PASS (12.8s)
   ```

5. **회귀 베이스라인 보존**
   - 결과 JSON을 `docs/reports/TAX-029_p95_baseline_2026-06-05.json`으로 저장 → 향후 비교 기준

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `npm run perf:p95` 명령 1회 실행으로 100회 측정 + 단계별·누적 P50/P95/P99 출력
2. [ ] 측정 케이스 선정 방식이 §9-② 회계사 결정과 일치
3. [ ] 출력에 합격선(< 15초) 통과 여부 명시
4. [ ] 결과 JSON 백업 파일 생성 (`docs/reports/TAX-029_p95_baseline_YYYY-MM-DD.json`)
5. [ ] `docs/reports/TAX-029_report.md` 작성 — 측정 환경·결과·Phase 4 게이트 판단
6. [ ] `src/` 비즈니스 로직 무변경 (`git diff src/` empty)
7. [ ] vitest 회귀 게이트 통과 (253/253 유지)
8. [ ] (P95 미달성 시) 병목 단계 식별 + 후속 최적화 티켓 후보 제시

---

## 6. Verification (검증 단계)

1. `git diff src/` → 출력 없음 확인 (비즈니스 로직 무변경)
2. `npx vitest run` → 253/253 PASS
3. `npm run perf:p95` → 100회 측정 정상 완료
4. 결과 리포트 검토:
   - 100회 모두 정상 응답 (E-LLM-TIMEOUT·E-LLM-UNAVAILABLE 0건)
   - 단계별 P95 합산이 누적 P95와 합리적 범위 (단계 직렬 가정)
   - 합격선 판정 일관성
5. `docs/reports/TAX-029_p95_baseline_*.json` 생성 확인
6. 회계사가 `docs/reports/TAX-029_report.md`에서 Phase 4 게이트 해제 판단 가능 여부 확인

---

## 7. Risks / Notes (위험·주의사항)

| 위험 | 수준 | 대응 |
|---|---|---|
| OpenAI API 비용 발생($0.5~$2 예상) | 저 | §9-③ 회계사 사전 승인 필수 |
| 외부 API 일시 장애로 측정 중단 | 중 | 재시도 로직 1회 / 실패 케이스 별도 집계 |
| 네트워크 환경에 따른 변동성 | 중 | 측정 환경(로컬/Vercel preview) 리포트 명시 + 동일 환경 재측정 가능성 보존 |
| 100회 측정 중 PII 검출로 중단 | 저 | 골든셋은 PII 없음 보장 |
| LLM 응답 비결정성으로 검증 단계 재시도 발생 시 측정 왜곡 | 중 | 재시도 발생 케이스 별도 플래그 + 리포트 명시 |
| 합격선 < 15초 미달 가능성 | 중 | 본 티켓은 **측정**이 목적 — 미달성 시 별도 최적화 티켓 분기(§3.2) |

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] §9 회계사 결정 4건 확정 회신 수신
- [ ] 영향받는 파일 목록 (3~4 파일)
- [ ] 측정 스크립트 의사 코드(20~40줄)
- [ ] 예상 비용 견적($ 단위)

→ **회계사 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 측정 명령·환경 (Node 버전·OS·네트워크)
- [ ] 100회 결과 테이블 (단계별·누적 P50/P95/P99/Max)
- [ ] 합격선 판정 결과
- [ ] 결과 JSON 백업 경로
- [ ] (P95 미달 시) 병목 분석 + 후속 티켓 후보
- [ ] 리포트: `docs/reports/TAX-029_report.md`

---

## 9. 회계사 결정점 (구현 전 확정)

| # | 결정 항목 | 선택지 | 권장 | 영향 |
|---|---|---|---|---|
| ① | 측정 모드 | **A. 실 API 100회**(운영 경로 그대로) / B. Mock LLM 100회(결정성·무비용) / C. 혼합(검증 단계만 실측) | **A** | A는 실 운영 P95 산출 가능, 비용 $0.5~$2 / B는 무료지만 측정 의미 약함 |
| ② | 측정 케이스 분포 | **A. 골든셋 40건 가중 분포 100회** / B. PASS 24건 균등 4회씩(=96회+α) / C. 단일 대표 케이스 100회 | **A** | A는 PRD §15.2 정의 부합, C는 변동성 최소이나 실측 분포 손실 |
| ③ | OpenAI 비용 사전 승인 (예상 $0.5~$2) | **승인** / 보류 | **승인** | 보류 시 모드 B로 전환 |
| ④ | 측정 실행 환경 | **A. 로컬(개발자 PC)** / B. Vercel preview 배포 후 / C. 둘 다 비교 | **A** | A는 즉시 실행 가능, B는 운영 환경 근사 |

> 회계사 회신란 (확정 대기):
> - ① 측정 모드 = ?
> - ② 측정 케이스 분포 = ?
> - ③ 비용 승인 = ?
> - ④ 실행 환경 = ?
> - 승인일/서명 = ?

---

## 10. Related Tickets (관련 티켓)

- 선행: `TAX-028_golden_set_authoring_support.md` (골든셋 30건 작성 — 40건 완결로 초과 달성)
- 병행 완결: `TAX-036_nonlaw_golden_track.md` (비법령 40건)
- 게이트 해제 대상: `TAX-026_vector_db_phase4.md` (Phase 4 코딩 실착수)
- 후속(조건부): TAX-030+ (P95 미달성 시 병목 최적화 티켓 — 측정 결과 후 ID 부여)
- 참조: `docs/PRD.md` §7.1 응답시간 / §15.2 부하 100회 KPI / §15.3 회귀 테스트, `docs/SSOT.md` §3.3 RAG 5단계

---

## 11. Report Link (리포트 연결)

Report: `docs/reports/TAX-029_report.md` (미작성)

---

**작성자**: AI(Claude Opus 4.7) — 회계사 §9 결정 확정 대기
**작성일**: 2026-06-05
**최종 수정일**: 2026-06-05
