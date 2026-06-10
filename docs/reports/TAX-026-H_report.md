# TAX-026-H 구현 리포트 — Phase 4 벡터 DB 실연결

**작성일**: 2026-06-10
**대상**: TAX-026-H (Neon pgvector 인스턴스 연결 · 마이그레이션 · 임베딩 적재 · P95 회귀 재측정)
**선행**: [TAX-026-B~G](TAX-026-BFGH_report.md) (코드 구현 완결, 2026-06-10)

---

## 배경

TAX-026-B~G에서 Phase 4 벡터 검색 코드는 모두 구현됐으나, 실제 DB 연결 없이 `DATABASE_URL` 미설정 상태로 비활성화돼 있었다. 본 작업은 회계사가 Neon 인스턴스를 생성하고 `DATABASE_URL`을 `.env.local`에 입력한 시점부터 이어받아, **벡터 검색을 운영 경로에서 실제 활성화**하는 마지막 단계다.

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 작업 | 비고 |
|---|---|---|
| `scripts/migrate.ts` | 신규 | `migrate.sql`을 Neon에 실행하는 Node 러너 |
| `scripts/extractLaws.ts` | 신규 | 골든셋 → `TaxLaw[]` 추출(임베딩 입력 생성) |
| `scripts/smokeVector.ts` | 신규 | 운영 벡터 fallback 스모크 테스트 |
| `scripts/embed.ts` | 수정 | 8192 토큰 초과 방지 `truncateContent`(6000자 상한) 추가 |
| `package.json` | 수정 | `migrate`·`embed`·`smoke:vector` npm 스크립트 추가(`--conditions=react-server` 포함) |
| `scripts/laws_for_embed.json` | 생성물 | 임베딩 적재 입력(38건, content 보유) |

> ⚠️ `src/` 비즈니스 로직·도메인·어댑터·usecase는 **무변경**. 운영 경로(`app/api/answer/route.ts`)는 TAX-026-B에서 이미 `config.databaseUrl` 조건부 주입이 구현돼 있어, `DATABASE_URL` 입력만으로 벡터 fallback이 자동 활성화됐다.

---

## 주요 변경

### 1. 마이그레이션 러너 (`scripts/migrate.ts`)

- `npm run migrate` → `scripts/migrate.sql`을 Neon에 실행
- `IF NOT EXISTS` 기반이라 재실행 안전
- 실행 결과: `vector` 확장 + `taxlaw_embeddings` 테이블 생성 성공

### 2. 골든셋 → TaxLaw 추출 (`scripts/extractLaws.ts`)

- `eval/golden_direct.json`의 `sourceLaws`·`citations.taxLaw`에서 `TaxLaw` 수집
- 법령=`lawName+articleNumber`, 비법령=`caseNumber` 기준 중복 제거
- 구버전 픽스처의 `sourceType` 누락 항목에 `'법령'` 기본값 보정(NOT NULL 위반 방지)
- 결과: 총 84건 → 중복 제거 38건 → content 보유 38건

### 3. 임베딩 토큰 상한 보정 (`scripts/embed.ts`)

- 일부 조문(부가가치세법·소득세법 시행령 등 항·호 다수)이 8192 토큰 초과 → API 오류
- `MAX_CONTENT_CHARS = 6000` 상한으로 잘라 임베딩(원문 DB 저장값은 영향 없음, 임베딩 입력 텍스트만 절단)
- 결과: 38건 전량 적재 성공(스킵 0)

---

## 검증 결과

### 1. 마이그레이션
```
[migrate] 완료 — taxlaw_embeddings 테이블 및 vector 확장 생성 성공
```

### 2. 임베딩 적재
```
[embed] 전체 38건 중 content 보유 38건 처리 예정
[embed] 배치 1/1: 38건 적재 완료
[embed] 완료 — 적재: 38건, 스킵: 0건
```

### 3. 운영 벡터 스모크 테스트 (`npm run smoke:vector`) — ✅ PASS

`scripts/smokeVector.ts`(신규)로 운영 경로가 쓰는 `PgVectorSearchAdapter` + `FallbackSearchPort`를 직접 검증(답변 생성 LLM 미호출).

**[A] 벡터 검색 직접 동작 — Neon 실연결·의미 검색 확인:**

| 질의 | 1위 결과 | 유사도 |
|---|---|---|
| 거주자 본인 기본공제 금액 | 소득세법 제50조 기본공제 | 53.4% |
| 1세대 1주택 양도세 비과세 요건 | 소득세법 제89조 비과세 양도소득 | 57.3% |
| 법인 접대비 손금불산입 한도 | 법인세법 손금불산입 조문군 | 37.3% |

→ 단어 불일치(예: "기본공제 금액" ↔ 본문 "150만원")에도 의미로 정확 매칭.

**[B] FallbackSearchPort 단계 전이 — 운영 흐름 정상:**

| 질의 | matchStage | 해석 |
|---|---|---|
| 기본공제 금액 | `vector` | 직접 매칭 빈약(< THRESHOLD 3) → 벡터 fallback **실제 발동** |
| 1세대 1주택 | `direct` | 직접 매칭 6건 ≥ 3 → 벡터 불필요 |
| 법인 접대비 | `direct` | 직접 매칭 6건 ≥ 3 → 벡터 불필요 |

→ `vector` 단계가 실제 발동해 Neon 결과가 병합됨. 운영 경로(`/api/answer`) 벡터 활성화 **실동작 확정**.

### 4. P95 회귀 (TAX-029 러너) — ❌ 합격선 미달

| 측정 | 누적 P95 | answer P95 | answer P99 | V1~V6 | 에러 |
|---|---|---|---|---|---|
| 100회 | **17.76s** ❌ | 14.41s | 20.75s | 99/99 PASS | E-LLM-TIMEOUT 1건 |
| 40회(diagnose) | **17.31s** ❌ | 13.51s | 23.08s | 40/40 PASS | 0건 |

합격선: 누적 P95 < 15.00s

**단계별(100회):**

| 단계 | P50 | P95 | P99 |
|---|---|---|---|
| rewrite | 1.81s | 3.59s | 4.87s |
| search | 0.04ms | 2.08s | 2.25s |
| **answer** | **4.05s** | **14.41s** | **20.75s** |
| verify | 0.05ms | 0.13ms | 0.33ms |

---

## P95 미달 분석 — 벡터 도입과 무관함이 확정됨

**핵심:** `scripts/perf/measureP95.ts:209`는 검색 포트로 `NationalTaxLawAdapter`를 **직접** 주입한다. 즉 P95 측정은 운영 경로(`FallbackSearchPort`)가 아니라 직접 매칭 경로를 측정하며, **벡터 검색·Neon DB를 전혀 호출하지 않는다.**

- 따라서 P95 FAIL은 Phase 4(벡터) 도입과 인과관계가 없다.
- 병목은 전적으로 `answer`(gpt-4o-mini 답변 생성) 단계의 tail latency.
- 느린 케이스(`G-S-부가-01` 25.52s, `G-S-NL-01`, `G-S-종부-01`, `G-S-부가-04`)는 모두 **항·호가 많아 content가 긴 조문** → 입력 컨텍스트 증가 → 생성 지연.

**TAX-051(같은 날) 측정값 9.67s PASS와의 차이:**
- 같은 스크립트·골든셋이며 `src/` 무변경 → 평균(5.5s)은 유사하나 tail(P95·P99)만 크게 증가.
- OpenAI gpt-4o-mini API의 시점별 응답시간 변동(외부 요인)이 유력. 단, 두 측정 모두 17s대로 재현돼 단정은 보류.

---

## 잠재 위험

- **answer tail latency가 외부 변동인지 구조적인지 미확정** — 다른 시간대 재측정으로 분리 필요.
- `.env.example`의 `DATABASE_URL=` 주석 해제 미반영(권한 제한, 수동 작업 잔존).
- 임베딩 적재량 38건(골든셋 기반)으로 소규모 — 실제 운영 커버리지 확대 시 대량 적재 별도 필요.

---

## 남은 작업

1. `.env.example`에서 `DATABASE_URL=` 주석 해제 (수동)
2. P95 후속 결정 — 다음 중 택1 (별도 티켓):
   - **재측정**으로 외부 변동 여부 확인
   - **TAX-042** LLM 속도 최적화(긴 content 압축·프롬프트·모델 조정)
   - **합격선 재검토**(answer tail이 외부 LLM 변동이라면 측정 조건·기준 현실화)

---

## 결론

TAX-026-H의 본래 목표(**Neon 연결 + 마이그레이션 + 임베딩 적재 + 운영 경로 벡터 활성화 + 스모크 검증**)는 **완료**. 벡터 검색이 Neon에서 실제 동작하고 `FallbackSearchPort`의 `vector` 단계가 운영 흐름에서 발동함을 스모크 테스트로 확정했다. P95 회귀는 합격선 미달이나, 측정 구조상 **벡터 도입과 무관**(측정 스크립트가 벡터 미경유)하며 `answer` LLM tail latency가 원인으로, 후속 티켓에서 다룬다.
