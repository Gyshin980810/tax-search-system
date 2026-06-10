# TAX-042E 사전 분석 — korean-law-mcp 인사이트 추출

> 작성자: AI(Claude Opus 4.7)
> 작성일: 2026-06-08
> 목적: TAX-042E 본측정(100회 cyclic + 보강 H·I) 시작 전, `C:\Users\sfami\WorkSpace\korean-law-mcp-main` (Korean Law MCP v2.3.2)의 패턴을 분석해 본측정 설계·해석에 반영할 인사이트 묶음 정리.
> 적용 원칙: **본측정 코드 변경 금지 정책(티켓 §3.2)을 깨지 않는 범위**에서, 신규 보강(보강 H·I·J·K·L)·해석 메모·합격선 재해석 권고만 제시. 본문 모든 권고는 회계사 결정용 옵션이며, 결정 전 코드 반영 금지.

---

## 0. 30초 요약

| 분석 대상 | 가장 큰 인사이트 | TAX-042E 영향 |
|---|---|---|
| `lib/fetch-with-retry.ts` | 200 OK + 빈 본문/HTML 응답을 일시 장애로 분류 → 재시도 (4회) | 보강 I에 `emptyType=empty|html` 분리 카운터 권고(보강 J) |
| `lib/risk-rules.ts:333` | 가중치 기반 `severity*N` → 4단 등급(safe/caution/warning/danger) | 보강 H의 변동성 등급 라벨 채택 권고 |
| `lib/decision-compact.ts` | 800/400자 head·tail 보존 + 문장 경계 가드 + 압축률 미달 시 원본 반환 | TAX-042F 종료 상태 재확인 + Phase 4 (TAX-026-B~) 청킹 설계 인사이트 |
| `tools/verify-citations.ts` | `[VERIFIED]`·`[PARTIAL_VERIFIED]`·`[HALLUCINATION_DETECTED]` 3단 마커 + `isError=true` | TAX-042D `verifyMarker` 3종이 같은 패턴 — 정합성 확인됨 (변경 없음) |
| `lib/cache.ts` | LRU 500개 + TTL 24h(정상) / 1h(검색) | **🚨 우리 `nationalTaxLaw.ts`도 같은 캐시 (TTL 24h, 빈 결과 5분, max 500). 100회 cyclic 측정의 P95이 캐시 hit 영향으로 낙관적일 가능성** |
| `test/test-empty-html-retry.cjs` | 로컬 HTTP mock 서버 + carrying-state mock으로 간헐 장애 복구 검증 | 보강 K (mock 모드 측정 옵션) 제안 |
| `docs/ARCHITECTURE.md` 성능 표 | LRU cache hit rate ~82% → 응답시간 85% 감소 | 우리 측정에서도 캐시 hit/miss 비율 측정 필요 (보강 L) |
| 우리 `scripts/perf/percentile.ts` | 이미 `stdev` 산출 — `computeStats` 재사용 가능 | 보강 H `measureVariance.ts`를 처음부터 안 짜고 50% 분량으로 작성 가능 |

---

## 1. fetch-with-retry.ts 분석

### 1.1 핵심 발견 (한 줄)

**200 OK인데 빈 본문 또는 HTML 점검 페이지를 받으면, "일시 장애"로 분류해 재시도한다 (`detectBadBody` 함수, 36~42행).**

### 1.2 코드 본질

```ts
function detectBadBody(text: string): "empty" | "html" | null {
  const t = text.trim()
  if (!t) return "empty"
  if (/^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)) return "html"
  return null
}
```

- 정상 응답은 XML(`<`) 또는 JSON(`{`/`[`)으로 시작 — 그 외는 점검 페이지 가능성.
- 200인데 빈 본문이면 XML 파서가 `missing root element`로 터지므로 사전 차단.
- `Retry-After` 헤더 우선 + 없으면 `baseDelay * 2^attempt + jitter(0~50%)`.

### 1.3 우리 시스템과 비교 (비유)

> 우편함을 열었는데 "공사중" 안내문(HTML)이 들어 있었다면, **빈 봉투(empty)인지 안내문(html)인지를 따로 세는** 것이 원인 분석에 도움이 된다.

| 항목 | korean-law-mcp | 우리 TAX-042C 보강 A·D |
|---|---|---|
| 빈 응답 감지 위치 | HTTP 응답 본문 레벨 | LLM 생성 결과(`object`) 레벨 |
| 분류 세분화 | empty / html / null | empty 단일 |
| 재시도 횟수 | 3 | 1 |
| Retry-After 우선 | ✅ (보강 D와 동일) | ✅ |
| Jitter | `random * baseDelay * 0.5` (0~50%) | `random * baseDelay` (0~100%) |

### 1.4 본측정 보강 권고 — 보강 J (Empty 분류)

본측정 코드 변경 시 보강 I 카운터에 한 칸만 더 추가:

- `emptyResponseCount` → `emptyResponseCount` + 분류 컬럼 (`emptyType: 'citations-zero' | 'summary-blank' | 'both'`)
- 이유: TAX-042E 합격 조건 13번 "빈 응답율 ≤ 2%"가 실패하면, **어떤 종류의 빈 응답**인지가 후속 대응을 좌우. citations 없음 vs summary 공백 vs 둘 다는 원인이 다르다.

> 이 보강은 코드 +5줄·옵션 컬럼 추가만으로 가능 — 본측정 시작 전 반영 권고 (보강 I와 같은 PR).

---

## 2. risk-rules.ts:333 computeRiskScore 분석

### 2.1 핵심 발견

티켓 §1.2 보강 H가 인용한 `computeRiskScore`의 정신은 **"여러 비결정적 신호를 정량값으로 합산한 뒤, 사람이 결정하기 쉬운 4단 등급으로 변환"**.

```ts
export function computeRiskScore(findings: { severity: "high" | "medium" }[]): {
  score: number; grade: RiskGrade; gradeLabel: string
} {
  let score = 0
  for (const f of findings) score += f.severity === "high" ? 3 : 1
  let grade: RiskGrade
  if (score === 0) grade = "safe"
  else if (score <= 3) grade = "caution"
  else if (score <= 8) grade = "warning"
  else grade = "danger"
  return { score, grade, gradeLabel: GRADE_LABELS[grade] }
}
```

- **discrete 가중치 합산** (high=3, medium=1) → 비결정적 표본을 **이산화된 등급**으로 변환.
- **임계값 기반 4단 라벨** (safe/caution/warning/danger) → 사람이 한 글자로 결정.
- **단순함이 신뢰성**: 함수 13줄, 분기 4개, 가중치 2종.

### 2.2 비유

> 학생의 시험 점수 분포가 들쭉날쭉할 때, "평균 78점" 같은 숫자보다 "B+ 등급"이라는 라벨이 학부모 결정에 더 도움이 되는 것과 같다. **숫자는 측정용, 등급은 결정용.**

### 2.3 보강 H 적용안 — 변동성 4단 등급

| 등급 | citations 표준편차 (5케이스 평균) | 의미 | 후속 조치 |
|---|---|---|---|
| 🟢 stable | σ ≤ 0.5 | 출력이 거의 같음 | 추가 대응 불필요 |
| 🟡 acceptable | 0.5 < σ ≤ 1.0 | 변동 1건 내외 | Phase 4 진입 가능 |
| 🟠 variable | 1.0 < σ ≤ 2.0 | 변동 2건 가능 | TAX-043 검토 |
| 🔴 unstable | σ > 2.0 | LLM 비결정성 큼 | SYSTEM_PROMPT 추가 강화 필수 |

> 합격 조건 12번 "평균 표준편차 ≤ 1.0"는 위 표의 `acceptable` 상한. 등급 라벨을 같이 리포트하면 회계사 결정이 빨라진다.

### 2.4 코드 절감 (보강 H 인프라 재사용)

- 우리 `scripts/perf/percentile.ts:27` `computeStats(samples)`가 이미 `{mean, stdev, p50, p95, p99, max}`를 반환.
- 보강 H의 `measureVariance.ts`는 시간(ms)이 아니라 **citations 개수**를 입력으로 같은 함수에 넣으면 동작. 새 통계 함수 작성 불필요.
- 추정 절감: 신규 80줄 → 40줄로 축소 가능.

---

## 3. decision-compact.ts 분석

### 3.1 핵심 발견

판례 본문을 **앞 800자 + 중략 마커 + 뒤 400자**로 축약하되, **3가지 안전 장치**가 함께 있음:

1. **문장 경계 가드** (47~57행): `다.\n`, `라.\n`, `다. `, `라. `, `\n\n` 등 한국어 판례 종결어미를 후보로, head 50% 이상 위치에 있는 가장 늦은 경계 선택.
2. **압축률 미달 시 원본** (118행, 151행): `compact.length >= original.length * 0.95` → 5% 미만 절감이면 그냥 원본.
3. **이중 축약 방지** (234행): `⋯ 중략 N자` 마커가 이미 있으면 다시 안 누른다.

### 3.2 비유

> 책 요약본을 만들 때 "주제별 첫 문단은 통째로 살리고, 결론도 통째로 살리고, 중간은 'X자 생략'으로 묶는다." 그런데 **문장이 중간에 끊기면 의미가 깨지므로**, 마침표 위치에서만 끊고, 끊을 곳이 없으면 원본을 그대로 둔다.

### 3.3 TAX-042 영향

#### 3.3.1 TAX-042F 종료 상태 재확인

- TAX-042F는 입력 컨텍스트 윈도우 처리로 이미 종료된 상태(`docs/reports/TAX-042F_report.md`, 2026-06-07).
- 다만 decision-compact의 **문장 경계 가드**가 우리 TAX-042F 처리에 들어가 있는지 확인 필요 — 들어 있지 않으면 TAX-044(별도 티켓) 후보.

#### 3.3.2 Phase 4 (TAX-026-B) 청킹 설계 인사이트

- 우리는 법령 단위 자연 청크(조문 단위)를 쓰는데, **법령 본문이 1500자 초과**할 때(특히 부칙·별표) decision-compact 같은 축약이 필요할 수 있음.
- Phase 4 본격 착수 시 별도 검토 권고.

### 3.4 보강 권고

> 본 TAX-042E 측정에는 직접 영향 없음. 측정 후 답변 시간 P95이 22s 초과 시, 입력 토큰 길이를 raw 로그에 추가하고 P95(answer)과의 상관관계를 산출하면 decision-compact 도입 ROI를 판단 가능 (TAX-043 후보).

---

## 4. verify-citations.ts 분석

### 4.1 핵심 발견

LLM 답변에서 인용된 법령·조문을 법제처 API로 **사후 교차검증**하는 도구. 결과를 3단 마커로 분류:

| 마커 | 조건 | 응답 처리 |
|---|---|---|
| `[VERIFIED]` | 모든 인용 ✓ | 정상 반환 |
| `[PARTIAL_VERIFIED]` | ⚠ 있고 ✗ 없음 | 정상 반환 + 경고 |
| `[HALLUCINATION_DETECTED]` | ✗ 1건 이상 | `isError=true`로 차단 — LLM이 "검증 통과"로 오인 못하게 |

### 4.2 우리 TAX-042D verifyMarker와의 정합성 확인

우리 TAX-042D의 verifyMarker 3종:
- `VERIFIED` — V1~V6 모두 PASS
- `PARTIAL_VERIFIED` — V1~V6 일부 FAIL (재시도 후 안전한 케이스)
- `LABEL_MISMATCH` — V3 라벨 불일치 검출

→ **정신은 동일** (3단 분류 + 부정형 마커). 마커명도 2/3 일치. TAX-042D 변경 불필요.

### 4.3 추가 인사이트 — looseMatch 정규화 (132~137행)

```ts
const normalize = (s: string) => s.replace(/\s+/g, "")
const looseMatch = officialNorm === targetNorm
  || officialNorm.startsWith(targetNorm)
  || targetNorm.startsWith(officialNorm.replace(/(법률|법)$/, "법"))
```

- 공백 제거 + 정확 일치 + 접두사 + `(법률|법)$` 정규화로 "법률"·"법" 어미 차이 흡수.
- 우리 V1(출처 존재) 검증이 발췌 텍스트와 원문을 비교할 때 이런 정규화를 쓰는지 확인 필요 — TAX-031/032 정확매칭 약칭사전이 이미 있을 가능성 큼 (메모리 `project_tax031_032_search_accuracy.md`).

### 4.4 보강 권고

> TAX-042E 본측정에는 영향 없음. 측정 후 V1 실패율이 갑자기 상승하면 looseMatch 정규화 점검(TAX-044 후보).

---

## 5. cache.ts 분석 — 🚨 본 분석의 가장 큰 발견

### 5.1 우리 시스템에도 같은 캐시가 있다

`src/adapters/nationalTaxLaw.ts:193~206`:

```ts
const CACHE_TTL_MS = 24 * 60 * 60 * 1000          // 24시간 (정상 결과)
const CACHE_EMPTY_TTL_MS = 5 * 60 * 1000          // 5분 (빈 결과)
const CACHE_MAX_ENTRIES = 500
const cache = new Map<string, { result: SearchResult; expiresAt: number }>()
```

- 캐시 키: `query.keyword.trim().toLowerCase()` (line 457).
- 빈 결과는 5분만 보관 → 빠른 재시도 유도. korean-law-mcp의 ttl 분리와 같은 정신.

### 5.2 측정 영향 (수치 추정)

| 측면 | 캐시 hit 영향 |
|---|---|
| 골든셋 40건 × 2.5회 = 100회 cyclic | 첫 40회 = miss / 후 60회 = hit 가능성 매우 높음 |
| 캐시 hit 시 search 단계 | 외부 API 호출 0회 → search P95 거의 0ms로 측정됨 |
| 누적 P95 | search 단계 약 4~7s가 0ms로 잡혀 → **누적 P95이 4~7s 낙관 측정** |

> **현재 baseline 누적 P95 24.66s (TAX-041 7차)는 캐시 hit 가중치가 60%인 측정값일 가능성 큼.**
> 콜드 측정(캐시 hit 0%)이면 28~32s 추정.

### 5.3 보강 권고 — 보강 L (콜드/웜 P95 분리)

- **옵션 1 (단순)**: 측정 시작 시 `cache.clear()` 후 1회만 측정 — 콜드 P95 산출. 단점: hit-rate 0%로 비현실적.
- **옵션 2 (정밀)**: 100회 측정에 캐시 hit/miss 카운터 추가 + 두 그룹 P95 분리 산출.
- **옵션 3 (Recommended)**: 측정 후 raw 로그에서 search 시간 < 100ms인 호출을 hit로 간주하고 사후 분리. 코드 변경 0줄.

> 본 분석의 가장 큰 권고: **TAX-042E 본측정 raw 로그에서 search 단계 시간 < 100ms 호출을 캐시 hit로 분류**한 뒤, hit/miss 두 그룹의 P95을 별도 산출. 운영 P95(혼합)과 콜드 P95(miss only) 동시 보고.

### 5.4 비유

> 차로 출근 시간을 측정할 때, 매일 같은 길을 가면 신호 패턴을 학습해 "체감 시간"이 짧아진다. 처음 출근(콜드)과 매일 출근(웜)의 평균을 따로 보지 않으면, **새 직원에게 출근 시간을 잘못 안내**하게 된다. 우리 시스템도 외부 회계사가 "같은 질문이 아닌 새 질문"을 던질 때의 P95이 운영 신뢰성의 핵심이다.

---

## 6. 로컬 HTTP mock 패턴 분석 (test/test-empty-html-retry.cjs)

### 6.1 핵심 발견

`http.createServer`로 127.0.0.1 임의 포트 mock 서버를 띄우고:
- `?mode=empty`: 빈 응답
- `?mode=html`: HTML 점검 페이지
- `?mode=recover`: 빈 응답 2회 후 정상 XML (간헐 장애 복구)

### 6.2 비유

> 비행기 시뮬레이터처럼, "실제 비행 없이 위험 시나리오만 골라 재현"하는 환경. 비용 0, 재현성 100%.

### 6.3 보강 권고 — 보강 K (mock 측정 옵션)

- 본측정(외부 API 사용)은 19.6시간 + 비용 + 외부 API 장애 위험 + 캐시 hit 영향 등 변수가 많음.
- mock 측정 옵션을 **별도 모드**로 추가:
  - LLM은 실제 호출 (V3 라벨 결정성 측정 필수)
  - 외부 법제처 API는 mock으로 응답 (search 단계 결정화)
  - 결과: V3/V6 라벨 안정성 + 답변 P95 + 재시도 카운터를 **3시간 내 측정** 가능

> 본측정 코드 변경 금지 정책상 본 측정에 직접 적용 불가. 다만 **TAX-043으로 분리**해 측정 인프라로 추가하면 향후 회귀 시간이 19.6h → 3h로 단축.

---

## 7. 우리 percentile.ts와의 시너지 — 보강 H 인프라 재사용

### 7.1 발견

`scripts/perf/percentile.ts:27~45` `computeStats(samples: number[]): Stats`가 이미:
- `n, mean, stdev, p50, p95, p99, max` 산출
- 빈 배열 보호
- 표 출력(printReport)

### 7.2 보강 H 신규 스크립트(measureVariance.ts) 작성 절감

기존 티켓 §3.1는 변동성 측정에 별도 통계 함수가 필요한 듯 기술됨. 실제로는:

```ts
import { computeStats } from './percentile'

const citationsPerIter: number[] = []
for (let i = 0; i < 5; i++) {
  const result = await generateAnswer(...)
  citationsPerIter.push(result.citations.length)
}
const stats = computeStats(citationsPerIter)
// stats.stdev로 변동성 등급(§2.3) 판정
```

→ 예상 작성 시간 절감: 2h → 1h.

---

## 8. ARCHITECTURE.md 성능 표 — 캐시 hit rate ~82%의 함의

### 8.1 발견

korean-law-mcp의 성능 표:

| 최적화 | 효과 |
|---|---|
| LRU 캐시 (hit rate ~82%) | 반복 조회 85% 응답 시간 감소 |

### 8.2 우리 측정에 대한 의미

- 100회 cyclic에서 첫 40회만 콜드이므로 이론적 hit rate = 60%.
- 실측 hit rate가 82%에 근접하면, search 단계 P95이 콜드 대비 약 80% 줄어들 것 → **누적 P95에 대한 search 단계 기여도가 거의 0**.
- → 누적 P95 24.66s 거의 전체가 **answer + verify 단계**.

### 8.3 보강 권고 — 보강 H·I 외 부가 분석

- 본측정 raw 로그에서 다음 두 비율을 사후 산출 권고:
  1. `cacheHitRate = (search ms < 100인 호출 수) / 100`
  2. `weightedP95 = (콜드 가중치 0.4 × cold_P95) + (웜 가중치 0.6 × warm_P95)`
- 운영 환경에서는 회계사가 새 질문을 자주 하므로 콜드 비율이 더 높을 것 → `weightedP95`가 운영 P95에 더 근접.

---

## 9. 종합 권고 (회계사 결정용)

### 9.1 본측정 시작 전 반영 권고 (작은 보강 — 추가 5~10줄 코드)

| 권고 | 위치 | 추가 코드 | 효과 |
|---|---|---|---|
| **보강 J** (Empty 분류) | `measureP95.ts` | +5줄 (옵션 컬럼 `emptyType`) | 빈 응답 원인 분류로 후속 대응 정확도 향상 |
| **보강 H 코드 절감** | `measureVariance.ts` (신규) | -40줄 (computeStats 재사용) | 작성 시간 2h → 1h |
| **보강 L** (사후 hit/miss 분리) | 리포트 분석 단계 | 코드 +0줄 (사후 raw 로그 분석) | 콜드/웜 P95 분리로 운영 P95 추정 가능 |

### 9.2 본측정 후 분석 권고 (코드 변경 없음)

| 권고 | 효과 |
|---|---|
| **변동성 등급 라벨 (§2.3)** | 회계사 의사결정 부담 감소 |
| **콜드/웜 P95 분리 (§5.3)** | 운영 P95 정확 추정 |
| **emptyType 분포 (§1.4)** | 빈 응답 원인 분류 |
| **cacheHitRate 산출 (§8.3)** | search 단계 기여도 평가 |

### 9.3 별도 티켓 권고 (TAX-042E 무관)

- **TAX-043 후보 1**: mock 측정 모드 (보강 K) — 회귀 측정 시간 19.6h → 3h 단축.
- **TAX-043 후보 2**: V3 실패 시 사후 verify-citations 재검증 — 환각 차단 강화.
- **TAX-044 후보**: TAX-042F 입력 윈도우 처리에 문장 경계 가드 추가 (decision-compact 패턴).

### 9.4 본측정 합격선 재해석 권고

- 캐시 영향 고려 시 누적 P95 24.66s는 **실 운영 환경에서 28~32s**일 가능성 큼.
- 합격선 < 15s는 **콜드 P95 기준**일 때 비현실적. 운영 P95 기준일 때 < 18s 정도가 현실적.
- **권고**: TAX-042E 본측정 후 회계사 결정 — (1) 합격선 < 15s 유지 + 캐시 무력화 측정 vs (2) 합격선 < 28s로 재정의 + 운영 P95 기준 vs (3) 콜드/웜 분리 합격선.

---

## 10. 본측정 시작 전 점검 항목 (체크리스트)

회계사 PC 가동 가능 시점에 다음 순서로 진행 권고:

1. [ ] 본 분석 §9.1 보강 J·H 코드 절감 적용 결정
2. [ ] `npm run lint`, `npm run build`, `npm test` 모두 통과 재확인
3. [ ] `.env.local` OpenAI API 키·법제처 API 키 유효성 확인
4. [ ] (옵션) `nationalTaxLaw.ts`의 `cache.clear()` 트리거 추가로 콜드 측정 모드 옵션화
5. [ ] PC 가동 가능 시간 24.6h 확보 확인
6. [ ] `npm run perf:p95` 백그라운드 실행 + 알림 대기
7. [ ] (이어서) `npm run perf:variance` 백그라운드 실행
8. [ ] 완료 시 §9.2 분석 권고 적용 후 종합 리포트 작성

---

## 11. 비유로 한 줄 요약

> **이번 분석은 비행기 출발 전 정비사가 "안 보이는 곳"을 한 번 더 점검한 것과 같다. 본측정은 그대로 가능하지만, 측정 후 결과를 해석할 때 캐시·빈 응답·변동성을 별도 그룹으로 분리해서 보면 회계사 결정이 훨씬 빨라진다.**

---

**관련:**
- `docs/tickets/TAX-042E_stage5_regression_measurement.md`
- `docs/reports/TAX-042D_report.md`
- `docs/reports/TAX-042F_report.md` (이미 종료)
- `C:\Users\sfami\WorkSpace\korean-law-mcp-main\` (분석 대상)
- 메모리 `project_tax042d_v3_label_strengthening.md`, `project_tax029_040_041_complete.md`

**작성:** AI(Claude Opus 4.7), 2026-06-08
