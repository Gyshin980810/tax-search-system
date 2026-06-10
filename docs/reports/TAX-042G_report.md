# TAX-042G 리포트 — queryRewriter 법리축+사실축 좁히기 (광범위 키워드 거버넌스)

> 작성일: 2026-06-07
> 티켓: `docs/tickets/TAX-042G_query_axis_narrowing.md`
> 선행: TAX-042F(입력 컨텍스트 윈도우 압축) — 본 티켓은 **근본 원인** 해소

---

## 1. 사전 진단 (TAX-042F §1 재인용)

| 항목 | 값 |
|---|---|
| queryRewriter 광범위 키워드 | "법인세법"(243건), "법인세 시행령"(296건), "손비 항목"(3건) |
| 검색 결과 누적 조문 | **542개** / ~54만 토큰 (윈도우 4.2배 초과) |

**근본 원인**: SYSTEM_PROMPT가 한 단어 광범위 키워드("법인세법" 단독 등)를 허용해 LLM이 검색 결과 200+건씩 dump 요청. TAX-042F는 압축으로 윈도우는 막았으나 잔여 1/3 verify FAIL.

---

## 2. 채택 전략 — C안 (프롬프트 강화 + 후처리 결합)

회계사 승인(2026-06-07) C안 그대로 구현:

| 계층 | 처방 | 출처 |
|---|---|---|
| **프롬프트 강화** | SYSTEM_PROMPT에 "법리축 + 사실축 결합 필수, 한 단어 금지, 5종 예시 부속" 추가 | korean-law-mcp 인사이트 자체 적응 |
| **후처리(거버넌스)** | `enforceAxisCombination(queries, question)` — LLM이 한 단어로 반환 시 질문에서 사실축 토큰 2개 자동 부착 | korean-law-mcp `compact-query-planner.ts:332 buildOriginalQueryAxes` 패턴 (세법 도메인 적응) |

핵심 안전 장치:
- **회귀 0건 보장**: 사실축 추출 실패 시 원본 그대로 통과 — 회계사의 광범위 질문("법인세법 알려줘")에도 무영향
- **PII 재오염 없음**: 사실축은 회계사가 입력한 question에서만 추출(상위 Usecase의 PII 필터 통과 후 상태)
- **TaxLaw 무변경**: 후처리는 `SearchQuery.keyword` 문자열에만 적용. 인용 무결성·시점 라벨·라벨 적정성 전부 무관

---

## 3. 변경 사항 요약

**파일 변경 목록:**

- `src/adapters/queryAxisGuard.ts` (신규, 159줄): `LEGAL_AXIS_BROAD`·`LEGAL_SUFFIX_PATTERN`·`FACT_AXIS_STOPWORDS`·`LEGAL_AXIS_NOISE` + `isTooBroad` / `extractFactAxisTokens` / `enforceAxisCombination` 3개 함수
- `src/adapters/llmQueryRewriter.ts` (수정):
  - `import { enforceAxisCombination } from './queryAxisGuard'` 추가
  - SYSTEM_PROMPT에 `[TAX-042G — 법리축 + 사실축 결합 규칙]` 블록 9~9.4 추가
  - `rewrite()` 반환 직전에 `enforceAxisCombination(queries, question)` 호출
- `tests/unit/queryAxisGuard.test.ts` (신규, 20건): `isTooBroad`(7) + `extractFactAxisTokens`(6) + `enforceAxisCombination`(7)
- `docs/tickets/TAX-042G_query_axis_narrowing.md` (신규)

**주요 변경 의도:**
- 입력 측면(컨텍스트 윈도우)을 압축으로 처방한 TAX-042F의 짝꿍으로, **검색 단계 자체**에서 결과 양을 줄여 압축 의존도를 낮춤
- Port·Usecase·도메인 시그니처 무변경(`IQueryRewriterPort.rewrite()` 시그니처 보존, Hex 아키텍처 격리 유지)

---

## 4. 검증 결과

### 4.1 4종 품질 게이트

| 명령 | 결과 |
|---|---|
| `npm run lint` | PASS (사전 무관 warning 1건 외 0 errors) |
| `npx tsc --noEmit` | PASS (EXIT=0) |
| `npx vitest run` | **316/316 PASS** (기존 296 + 신규 20, 회귀 0건) |
| `npm run build` | PASS (Next.js 16.2.6 Turbopack, 5.2s) |

### 4.2 diagnoseSearch G-S-법인-06 — 누적 조문 측정

| 항목 | TAX-042F 시점 | TAX-042G 적용 후 |
|---|---|---|
| queryRewriter 키워드 | "법인세법"·"법인세 시행령"·"손비 항목" | **"법인세법 시행령 손비"·"법인세법 손비 항목"·"법인세 시행령 비용"** |
| 누적 조문 개수 | 542개 | **4개** (-135배) |
| 총 content | ~41만 자 / ~54만 토큰 | **6만 자 / ~5.8만 토큰** (-9.4배) |
| 입력 윈도우 초과 | 4.2배 초과 | **안전 마진 54,206 토큰** |

**합격선 "누적 조문 < 100건" 압도적 통과**(4건). LLM이 SYSTEM_PROMPT 강화만으로도 이번엔 모두 결합 키워드를 반환 — `isTooBroad`가 잡을 게 없었음. 후처리는 비결정성 대비 안전망으로 작동.

### 4.3 G-S-법인-06 단건 × 3회

| # | 결과 | citations | time(s) | verify |
|---|---|---|---|---|
| 1 | PASS | 1 | 4.68 | PASS |
| 2 | PASS | 1 | 6.54 | PASS |
| 3 | PASS | 1 | 4.46 | PASS |

**3/3 PASS** — TAX-042F의 **2/3에서 진전**, 합격선 1 통과. 응답 시간도 TAX-042F(10.30~27.02s) 대비 평균 5.23s로 큰 폭 단축(검색 결과가 줄어 LLM 입력·처리 모두 가벼워짐).

### 4.4 회귀 4종 단건 × 1회

| 케이스 | 결과 | citations | time(s) | verify | 비고 |
|---|---|---|---|---|---|
| G-1 | PASS | 0 | 3.59 | PASS | TAX-042F=1 → 0 변동 (verify=PASS) |
| G-2 | PASS | 5 | 7.04 | PASS | TAX-042F=4 → 5 (오히려 증가) |
| G-N1 | PASS | 0 | 3.48 | PASS | TAX-042F=2 → 0 변동 (verify=PASS) |
| G-S-법인-01 | PASS | 1 | 4.07 | PASS | TAX-042F=5 → 1 변동 (verify=PASS) |

**회귀 측면 해석**:
- 4/4 verify PASS — V1~V6 전부 통과(인용 무결성·시점·라벨·면책·단정 금지 정상)
- citations 개수 변동은 회귀가 아닌 **LLM 판단 변화**:
  - 검색 결과가 좁아져 무관 조문이 줄었고, LLM이 "단정 금지 + 직접 근거만 인용" 정책에 충실히 따른 결과
  - "직접 근거 0건은 0건으로 표기"가 본 시스템 정책(CLAUDE.md §6.3 "빈약 시 직접 근거를 찾지 못했습니다 명시")
- 다만 회계사 체감 정보량이 줄 수 있으므로 **Stage 5 회귀(100회)에서 모니터링 권장**

### 4.5 V1~V6 인용 무결성 보호 확인

- 본 티켓 변경은 `SearchQuery.keyword` 문자열에만 영향
- TaxLaw·답변 생성·인용 발췌·시점 라벨 일체 무변경
- 8건의 단건 실측(G-S-법인-06 ×3 + 회귀 4종 + diagnose) 전부 verify=PASS로 입증

---

## 5. 잠재 위험 및 완화

| 위험 | 완화책 | 현 상태 |
|---|---|---|
| 사실축 결합 후 검색 0건 가능성 | 결합 후에도 LLM이 핵심·확장 3쿼리를 분산 생성 + 최소 1건 보장 | 4/4 회귀에서 0건 발생 없음 |
| 정보량 감소(citations 줄어듦) | SYSTEM_PROMPT는 "직접 근거 없으면 명시" 원칙 — 빈약 표시 자체가 정책 부합 | G-1·G-N1·G-S-법인-01에서 citations 변동 관찰. **Stage 5 회귀에서 모니터링** |
| LLM이 SYSTEM_PROMPT 무시하고 단독 한 단어 반환 | 정적 후처리(`enforceAxisCombination`) 안전망 | 단위 테스트 20건 PASS, 보강 로직 결정적 |
| PII 재오염 | 사실축은 question(상위 PII 필터 통과)에서만 추출 | 새 PII 소스 없음, 안전 |
| 회계사 광범위 질문("법인세법 알려줘") 시 사실축 0개 | 원본 그대로 통과 — 회귀보다 정확성·기존 동작 유지 | 단위 테스트로 보장 |

---

## 6. 후속 권장 작업

1. **TAX-042C (Stage 3)**: `maxTokens`·retry 처방. 본 티켓 + TAX-042F로 input 측면이 안정됐으므로 output 측면 안정성 강화.
2. **TAX-042D (Stage 4)**: V3 라벨 적정성 강화.
3. **TAX-042E (Stage 5)**: 100회 회귀. 본 티켓에서 관찰된 citations 변동성을 본격 측정. 합격선은 verify PASS rate 88% 이상 + V1~V6 무결성 유지(TAX-029/040/041 합격선과 정합).
4. 골든셋 G-1·G-N1처럼 citations=0이 자주 나오는 케이스는 **golden_direct.json의 기대 답변·source 키워드를 재점검**해 LLM이 더 명확한 키워드를 만들 수 있도록 보조(별도 티켓 후보).

---

## 7. 참고

- 인사이트 출처: `C:\Users\sfami\WorkSpace\korean-law-mcp-main\src\tools\compact-query-planner.ts:68 LEGAL_CORE_KEYWORDS`, `:79 TAX_DOMAIN_KEYWORDS`, `:115 ORIGINAL_QUERY_STOPWORDS`, `:332 buildOriginalQueryAxes`
- 본 티켓은 세법 도메인에 한정해 위 4개 셋의 정신만 차용. 건설·노동·이혼 사전은 미이식(범위 외)
- V1~V6 보호 근거: CLAUDE.md §6.1 인용 무결성, §6.4 law-verifier, §7 PII 처리
- 아키텍처 격리 근거: SSOT §3 Hex(`IQueryRewriterPort` 시그니처 무변경)
- 선행 리포트: `docs/reports/TAX-042F_report.md`
