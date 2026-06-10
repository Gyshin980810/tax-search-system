
# 📋 Research Report — 세법 API 검색 시스템 작업 계획 (PRD + SSOT 통합 분석)

> **작성일**: 2026-05-08
> **작성자**: Claude Code (Shrimp Task Manager Research Mode)
> **분석 대상**: `docs/PRD.md` v2.0 (936줄) + `docs/SSOT.md` v2.0 (571줄)
> **목적**: M0(TAX-000) 시작 전 기획·기반 분석 산출물 — 추후 작업 진행 시 참고
> **문서 우선순위**: SSOT > PRD > CLAUDE.md > 티켓

---

## 📑 목차

1. [프로젝트 목표 (Goals)](#1-프로젝트-목표-goals)
2. [범위 (Scope)](#2-범위-scope)
3. [기술 스택 (Tech Stack)](#3-기술-스택-tech-stack)
4. [제약 조건 (Constraints)](#4-제약-조건-constraints)
5. [SSOT 추가 강제 규칙](#5-ssot-추가-강제-규칙)
6. [디렉토리 구조 (M0에서 만들 것)](#6-디렉토리-구조-m0에서-만들-것)
7. [마일스톤 로드맵](#7-마일스톤-로드맵)
8. [평가·테스트 (골든셋)](#8-평가테스트-골든셋)
9. [M0(TAX-000) 작업 분할안](#9-m0tax-000-작업-분할안)
10. [위험 요소 및 대응](#10-위험-요소-및-대응)
11. [한 페이지 요약](#11-한-페이지-요약)
12. [다음 액션](#12-다음-액션)

---

## 1. 프로젝트 목표 (Goals)

### 1.1 한 줄 정의

**국세법령·지방세법령·판례·예규를 자연어로 질문하면 LLM이 검색·정리·검증하여 인용 무결성과 시점 정확성을 보장한 답변을 회계사에게 전달하는 RAG 기반 세법 검색 어시스턴트.**

### 1.2 핵심 철학 (절대 우선순위)

```
정확성(Accuracy) > 완전성(Completeness) > 속도(Speed) > 편의성(UX)
```

> **"틀린 답은 없는 답보다 나쁘다."**

### 1.3 비전

회계사가 **"이 시스템에서 못 찾으면 직접 찾아도 없다"**고 신뢰할 수 있는 세법 검색 인프라.

### 1.4 1차 사용자

| 항목 | 내용 |
|---|---|
| 누구 | 회계사·세무사 |
| 규모 | 50명 이내 |
| 도메인 지식 | 높음 (전문 용어 그대로 노출 가능) |
| 기술 친숙도 | 보통 (웹 검색 수준) |
| 1일 검색 횟수 | 5~20회 |

---

## 2. 범위 (Scope)

### 2.1 MVP 핵심 기능 (P0)

| ID | 기능 | 마일스톤 |
|---|---|---|
| FR-1 | 국세법령 API 직접 매칭 검색 | M1 (TAX-001) |
| FR-2 | 지방세법령 API 직접 매칭 검색 | M1 후속 |
| FR-3 | 자연어 쿼리 변환 (LLM 1차) | M2 (TAX-002) |
| FR-4 | 검색 결과 → 자연어 답변 생성 (LLM 2차) | M2 |
| FR-5 | 답변 라벨링 (🟢 직접근거 / 🟡 유사사례 / ⚪ 참고 / ⚫ 폐지) | M2 |
| FR-6 | law-verifier 검증 레이어 (V1~V6, 필수) | M3 (TAX-003) |
| FR-7 | 통합 검색 UI (국세·지방세 한 화면) | M2 후속 |
| FR-8 | 원문 링크·개정일·시행일·현행 여부 표시 | M1 |
| FR-14 | 인용 복사 기능 (출처 메타데이터 포함) | M2 후속 |
| FR-16 | 법적 면책 고지 (모든 답변 하단) | M2 |

### 2.2 Post-MVP (P1~P3)

| ID | 기능 | 우선순위 |
|---|---|---|
| FR-9 | 벡터 DB 의미 유사도 검색 | P1 (M4) |
| FR-10 | 판례·예규·해석례 데이터 적재 | P1 (M5) |
| FR-15 | 시점 검색 (과거 시점 적용 법령) | P1 |
| FR-17 | 부칙·경과조치 자동 연결 | P1 |
| FR-18 | 골든셋 회귀 테스트 자동화 | P1 |
| FR-11 | 최근 검색어 기록 | P2 |
| FR-12 | 즐겨찾기·북마크 | P2 |
| FR-13 | PDF·노트 내보내기 | P3 |

### 2.3 Out of Scope (Non-Goals)

- ❌ 회계사 계정·로그인 시스템 (MVP 한정)
- ❌ 유료 결제·구독 관리
- ❌ 다국어 지원
- ❌ 모바일 네이티브 앱
- ❌ 자동 세무 계산·신고
- ❌ 세무 자문 (의사결정은 항상 회계사)
- ❌ 의뢰인 정보 저장 (개인정보 처리 회피)

---

## 3. 기술 스택 (Tech Stack)

### 3.1 확정된 도구 (PRD §8)

| 영역 | 선택 | 결정 근거 |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS | SSOT §1.1 확정 |
| RAG 프레임워크 | Vercel AI SDK (LangChain 미사용) | 결정론적 직선 흐름, LangChain은 디버깅 복잡도 증가 |
| LLM (실증) | Gemini 2.0 Flash | 무료, 빠름, 한국어 양호 |
| LLM (운영) | Claude 또는 GPT | 정확도·안정성 |
| 벡터 DB | pgvector(Postgres) 또는 Pinecone | Vercel과 궁합 양호 |
| 임베딩 모델 | Voyage-2 또는 OpenAI text-embedding-3-small | 한국어 성능·비용 균형 |
| 외부 API | 국세법령정보시스템·지방세법령정보시스템 | API 키 발급 완료 |
| 검증 레이어 | Claude Code 서브에이전트 (`.claude/agents/law-verifier.md`) | 독립 감시자 분리 |
| 배포 | Vercel | 50명 이내 규모에 충분 |

### 3.2 시스템 아키텍처 (헥사고날)

```
UI (app/)
  ↓
API Route (app/api/)
  ↓
Usecase (src/usecases/)  ← RAG 5단계 오케스트레이션
  ↓
Adapter (src/adapters/)  ← LLM·외부 API·벡터 DB
  ↑
Port (src/ports/)        ← 인터페이스 (교체 가능)
```

**계층별 책임과 금지 규칙:**

| 계층 | 책임 | 절대 금지 |
|---|---|---|
| UI | 표현·입력 | 비즈니스 로직 |
| API Route | 검증·인증·매핑 | 외부 fetch·DB 직접 호출 |
| Usecase | RAG 5단계 오케스트레이션 | fetch·DB 직접 호출 (Port만 사용) |
| Adapter | 외부 I/O 정규화 | 비즈니스 판단 |

### 3.3 RAG 5단계 파이프라인 (압축·생략 금지)

```
[1] 자연어 쿼리 변환 (LLM 1차)         → src/adapters/llmQueryRewriter.ts
       ↓
[2] 외부 API 검색                        → src/adapters/nationalTaxLaw.ts, localTaxLaw.ts
       ↓
[3] 답변 생성 + 라벨링 + Trust Tier      → src/adapters/llmAnswerGenerator.ts
       ↓
[4] law-verifier 검증 (V1~V6, 필수!)    → src/adapters/lawVerifier.ts
       ↓
[5] 회계사 화면 출력                      → app/
```

**단계별 입출력 스키마 (PRD §9.2.1):**

| 단계 | 입력 | 출력 |
|---|---|---|
| [1] | `string` + `TemporalContext` | `SearchQuery[]` |
| [2] | `SearchQuery` | `TaxLaw[]` |
| [3] | `TaxLaw[]` + 원본 질문 + `TemporalContext` | `LabeledAnswer` |
| [4] | `LabeledAnswer` + `TaxLaw[]` | `VerificationResult` |
| [5] | `VerificationResult` + `LabeledAnswer` | UI 렌더링 |

---

## 4. 제약 조건 (Constraints)

### 4.1 정확성 4대 규칙 (CLAUDE.md §6 + SSOT §7)

#### ① 인용 무결성 (Citation Integrity)

- ❌ 법령 본문 임의 요약·가공·**의역 금지**
- ✅ 발췌 인용은 외부 API 원문과 **문자 단위 일치** (퍼지 매칭 금지)
- ✅ 부분 인용 시 생략 표시는 `(…)`로 통일
- ✅ 조문 번호·항·호 표기는 원문 형식 유지

#### ② 출처·시점·Trust Tier (T1~T4)

| Tier | 출처 | 활용 |
|---|---|---|
| **T1** | 법률·시행령·시행규칙 본문 | 🟢 1순위 |
| **T2** | 법령 부칙·경과조치 | 🟢 시점 분기 시 필수 |
| **T3** | 국세청 예규·해석례·기재부 회신 | 🟡 (사안 일치 시 🟢 가능) |
| **T4** | 대법원·헌법재판소 판례 | 🟡 또는 ⚪ |

**규칙:**
- T1·T2가 존재하면 T3·T4만 단독으로 🟢 인용 금지
- LLM 시스템 프롬프트에 Tier 정의 강제 주입

**시점 라벨 의무:**
- `[현행]` — 답변 생성 시점 시행 중
- `[적용 시점: YYYY.MM.DD ~ YYYY.MM.DD]` — 명시된 시점
- `[폐지: YYYY.MM.DD]` — 폐지된 조문 (⚫)

#### ③ 라벨링 시스템

| 라벨 | 의미 | 표현 규칙 |
|---|---|---|
| 🟢 직접 근거 | 검색 조문이 직접 적용 | 단정형 허용 |
| 🟡 유사 사례 | 논리적 유사, 사실관계 차이 가능 | **단정 금지** |
| ⚪ 참고 자료 | 관련 쟁점 | "참고가 될 수 있는 자료" |
| ⚫ 폐지 | 폐지·삭제된 조문 | 폐지 시점 명시 |

#### ④ law-verifier 검증 V1~V6 (우회 금지)

| 항목 | 통과 조건 | 실패 시 |
|---|---|---|
| **V1** 출처 존재 | 모든 인용 조문이 검색 결과에 존재 | 재검색 1회 → FAIL → E-VERIFY-FAIL |
| **V2** 인용 무결성 | 발췌 = 원문 (문자 단위) | 재생성 1회 → FAIL |
| **V3** 라벨 적정성 | Trust Tier 매칭 | 재생성 1회 |
| **V4** 시점 표기 | 시점 라벨 부착 | 재생성 1회 |
| **V5** 면책 고지 | 답변 하단 면책 부착 | 자동 부착 |
| **V6** 단정 금지 | 🟡에서 단정 표현 검출 | 재생성 1회 |

> **재시도 후에도 FAIL이면 → 미검증 답변을 회계사에 노출 금지** ("확인 어려움" 안내)

### 4.2 비기능 요구사항

| 카테고리 | 지표 | 목표 |
|---|---|---|
| 성능 | 검색 응답 시간 (직접 매칭) | < 3초 (P95) |
| 성능 | RAG 응답 시간 | < 15초 (P95) |
| 성능 | 동시 회계사 | 10명 이상 |
| 신뢰성 | 환각률 | **0건/100쿼리** |
| 신뢰성 | 인용 무결성 위반율 | **0%** |
| 신뢰성 | 출처/시점 라벨 누락률 | **0%** |
| 신뢰성 | 캐시 TTL | 24시간 이하 |
| 결정론성 | LLM `temperature` | 0.0~0.2 |
| 결정론성 | LLM `top_p` | 0.9 이하 |

### 4.3 보안·개인정보

| 규칙 | 설명 |
|---|---|
| ❌ PII 입력 거부 | 검색어에 주민번호·사업자번호 → 입력 거부 (E-PII-DETECTED) |
| ❌ 시크릿 노출 | API 키·토큰을 로그·에러·UI에 출력 금지 |
| ❌ 회계사 식별자 | 이메일·이름·IP를 로그에 포함 금지 |
| ❌ Git 커밋 | `.env`, `.env.local` 커밋 금지 |
| ✅ 마스킹 | 휴대폰·이메일은 마스킹 후 저장 |
| ✅ 환경변수 | Vercel(프로덕션) / `.env.local`(로컬) + `.env.example` 템플릿 |

### 4.4 환경변수 (단계별)

| 환경변수 | 단계 |
|---|---|
| `NATIONAL_TAX_API_KEY` | M1 |
| `LOCAL_TAX_API_KEY` | M1 후속 |
| `GEMINI_API_KEY` | M2 |
| `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY` | 운영 단계 |
| `VOYAGE_API_KEY` 또는 `OPENAI_API_KEY` | M4 |
| `DATABASE_URL` | M4 |

**Fail-fast**: 필수 환경변수 누락 시 앱 시작 실패.

---

## 5. SSOT 추가 강제 규칙

> SSOT는 PRD가 "무엇을 보장하는가"라면 "어떻게 강제하는가"를 정의합니다.

### 5.1 §3.4 — 아키텍처 예외 규정

- 단순 정적 페이지(소개·약관) → UI Layer만 사용 가능
- 헬스체크(`/api/health`) → Usecase 없이 직접 응답 가능
- 그 외에는 §3.1, §3.2, §3.3 모두 준수

### 5.2 §4 — 동시 변경 강제

**환경변수 추가 시 반드시 4곳 동시 갱신:**

```
1. .env.example                  (값 없는 템플릿)
2. src/config.ts                 (읽기·검증 로직)
3. CLAUDE.md (환경변수 섹션)
4. PRD.md §12 (외부 의존성 표)
```

**검색 결과 스키마 변경 시:**
- ❌ **출처·시점·Trust Tier 필드는 절대 제거 금지**

**LLM 시스템 프롬프트 변경 시:**
- 라벨링·인용 무결성·시점 표기 규칙 누락 금지
- 변경 후 골든셋 회귀 테스트 통과 필수

### 5.3 §5.3 — Fail-fast 환경변수 검증 패턴

```typescript
// src/config.ts (예시)
// 필수 환경변수 목록을 정의합니다
const required = ['NATIONAL_TAX_API_KEY', 'LOCAL_TAX_API_KEY'];

// 환경변수가 하나라도 누락되면 앱 시작을 즉시 중단합니다
// 이게 바로 'Fail-fast' 원칙 — 나중에 터지는 것보다 시작 시 터지는 게 안전!
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`필수 환경변수 누락: ${key}`);
  }
}
```

### 5.4 §7.7 — 결정론성·재현성 (검색 결과 정렬 기준 고정)

```
1순위: 개정일 내림차순
2순위: 시행일 내림차순
3순위: 조문 번호 오름차순
```

### 5.5 §10 — Definition of Done (5단계 완료 조건)

| 단계 | 조건 |
|---|---|
| 1️⃣ 기능 | Acceptance Criteria 모두 만족 |
| 2️⃣ 범위 | 허용된 파일만 수정, 무관한 변경 없음 |
| 3️⃣ 검증 | law-verifier V1~V6 통과 + 골든셋 회귀 합격선 통과 |
| 4️⃣ 문서화 | `docs/reports/{티켓ID}_report.md` 작성 |
| 5️⃣ **인간 확인** | **회계사가 실제 브라우저에서 동작 확인 + 승인** |

> ⚠️ 5번이 핵심 — AI가 "끝났습니다"라고 해도 회계사 승인 없이는 **미완료**.

### 5.6 §8.2 — 금지 사항 (v2.0 신설 4개)

- ❌ RAG 5단계 임의 압축·생략
- ❌ law-verifier 검증 단계 우회
- ❌ 답변 발췌의 의역·요약
- ❌ 시점 라벨 누락된 답변 노출

### 5.7 §13 — 골든셋 작성 규칙

- ✅ 회계사가 작성·검수
- ❌ **AI는 골든셋을 임의 수정·삭제 금지** (정답 위변조 방지)
- ✅ 골든셋 추가·수정은 별도 티켓

### 5.8 §14 — 법적 면책 고지 표준 문구

```
※ 본 답변은 AI 검색 시스템이 공식 법령 API에서 추출·정리한 정보입니다.
   법적 효력은 원문에 있으며, 본 답변은 회계사의 의사결정 보조 자료입니다.
   사실관계 매칭과 최종 적용 판단은 회계사의 책임입니다.
   인용된 법령은 [개정일] / [시행일] 기준이며, 추후 개정될 수 있습니다.
```

---

## 6. 디렉토리 구조 (M0에서 만들 것)

```
tax-search-system/
├── app/                          # UI 페이지, API Route (Next.js App Router)
│   └── api/                      # HTTP 진입점 (Usecase 호출만)
│       └── health/               # 헬스체크 엔드포인트 (§3.4 예외)
├── src/
│   ├── domain/                   # 엔티티·값 객체
│   │                             #   TaxLaw, SearchQuery, LabeledAnswer,
│   │                             #   VerificationResult, TemporalContext, Citation
│   │                             #   disclaimer.ts (면책 고지 표준 문구)
│   ├── usecases/                 # 애플리케이션 로직 (RAG 5단계 오케스트레이션)
│   ├── adapters/                 # 외부 시스템 연동
│   │                             #   nationalTaxLaw.ts, localTaxLaw.ts,
│   │                             #   llmQueryRewriter.ts, llmAnswerGenerator.ts,
│   │                             #   lawVerifier.ts
│   ├── ports/                    # 인터페이스 정의 (어댑터 교체 가능)
│   └── config.ts                 # Fail-fast 환경변수 검증
├── .claude/
│   └── agents/                   # Claude Code 서브에이전트
│       └── law-verifier.md       # (TAX-003에서 작성)
├── docs/
│   ├── SSOT.md                   # ✅ 존재
│   ├── PRD.md                    # ✅ 존재
│   ├── tickets/                  # 작업 티켓 (칸반 카드)
│   │   └── _TEMPLATE.md
│   ├── reports/                  # 구현 리포트 (완료 후 필수)
│   └── scratch/                  # 임시 메모 (선택적)
├── eval/                         # 정확성 평가 골든셋 (M3에서 활성화)
│   ├── golden_direct.json        # G-1
│   ├── golden_similar.json       # G-2
│   ├── golden_temporal.json      # G-3
│   ├── golden_hallucination.json # G-4
│   └── golden_repealed.json      # G-5
├── tests/                        # 테스트 (도입 시점 미정)
├── .env.example                  # 환경변수 템플릿
└── CLAUDE.md                     # ✅ 존재 (프로젝트 루트)
```

---

## 7. 마일스톤 로드맵

| 단계 | 티켓 | 산출물 | 검증 기준 |
|---|---|---|---|
| **M0** ⭐현재 | TAX-000 | Next.js 초기화, 폴더 구조, `.env.example`, README | `npm run dev` 정상 |
| **M1** | TAX-001 | 국세법령 API Adapter, Port 정의, 검색 API | "부가가치세" 검색 → 10건 + 메타데이터 |
| **M2** | TAX-002 | RAG 통합 (자연어 쿼리 변환 + 답변 생성 + 라벨링 + UI + 인용 복사 + 면책) | 자연어 질문 → 라벨링된 답변 |
| **M3** | TAX-003 | law-verifier + V1~V6 검증 + 골든셋 G-1 30건 | 환각률 0%, 라벨 정확도 ≥ 95% |
| **M4** | TAX-004 | 벡터 DB + 의미 유사도 검색 | 직접 매칭 0건 케이스 → 유사 사례 도출 |
| **M5** | TAX-005 | 판례·예규 적재·임베딩 + 골든셋 G-2 30건 | G-2 라벨 정확도 ≥ 95% |
| M6 | 추가 | 지방세, UI 다듬기, 시점 검색, 부칙 | 회계사 피드백 기반 |

**현재 위치:** M0 직전 (기획·기반 문서 단계)

---

## 8. 평가·테스트 (골든셋)

| 셋 | 규모 | 위치 | 목적 |
|---|---|---|---|
| G-1 직접 근거 | 50건 | `eval/golden_direct.json` | 기본 정확도 측정 |
| G-2 유사 사례 | 30건 | `eval/golden_similar.json` | 라벨링 정확도 |
| G-3 시점 검색 | 20건 | `eval/golden_temporal.json` | 시점 정확성 |
| G-4 환각 유발 | 20건 | `eval/golden_hallucination.json` | 환각률 0% 검증 |
| G-5 폐지 조문 | 10건 | `eval/golden_repealed.json` | ⚫ 라벨 정상 동작 |

**합격선:**
- 환각률 0% / 인용 무결성 위반율 0%
- 라벨 정확도 ≥ 95% / 시점 정확도 ≥ 95%
- 재현율(Recall) ≥ 80%

---

## 9. M0(TAX-000) 작업 분할안

> SSOT의 강제 규칙을 모두 반영한 10개 서브태스크 (총 ~32시간, 4~5일)

| # | 서브태스크 | 예상 시간 | SSOT 근거 | 산출물 |
|---|---|---|---|---|
| 1 | Next.js 14+ App Router + TS + Tailwind 초기화 | 4h | §1.1 | `package.json`, `next.config.js`, `tsconfig.json`, `tailwind.config.ts` |
| 2 | 헥사고날 폴더 구조 생성 (`.claude/agents/`, `eval/`, `docs/reports/` 포함) | 2h | §2 | 빈 디렉토리 + `.gitkeep` |
| 3 | 도메인 타입 정의 (`TaxLaw`, `SearchQuery`, `LabeledAnswer`, `VerificationResult`, `TemporalContext`, `Citation`) | 6h | §2 | `src/domain/*.ts` |
| 4 | Port 인터페이스 정의 (`TaxLawSearchPort`, `LlmQueryRewriterPort`, `LlmAnswerGeneratorPort`, `LawVerifierPort`) | 4h | §3.2, §4.2 | `src/ports/*.ts` |
| 5 | `src/config.ts` + Fail-fast 환경변수 검증 | 3h | §5.3, §6 | `src/config.ts` |
| 6 | ESLint + Prettier + Husky 사전 커밋 훅 + 한국어 주석 가이드 | 4h | §8.3 | `.eslintrc`, `.prettierrc`, `.husky/` |
| 7 | README.md (한국어) + `docs/reports/TAX-000_report.md` + `docs/scratch/` | 3h | §9.1, §10.4 | 프로젝트 개요 + M0 완료 리포트 |
| 8 ⭐ | `.env.example` + 4곳 동시 갱신 (CLAUDE.md, PRD §12) | 2h | §4.1 | `.env.example` + 문서 동기화 |
| 9 ⭐ | 헬스체크 엔드포인트 `/api/health` | 2h | §3.4 (예외 허용) | `app/api/health/route.ts` |
| 10 ⭐ | 법적 면책 고지 상수 정의 (`src/domain/disclaimer.ts`) | 2h | §14 | 표준 문구 코드화 |

> **⭐ 표시는 SSOT 분석으로 추가된 서브태스크입니다.**

---

## 10. 위험 요소 및 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| LLM 환각 | **법적 책임 위험** | law-verifier V1 필수, 면책 고지 |
| LLM 의역 | **인용 왜곡** | V2 인용 무결성, 시스템 프롬프트로 의역 금지 |
| 시점 혼동 | **잘못된 세무 판단** | V4 시점 라벨, 모호 시 회계사 확인 요청 |
| 부칙·경과조치 누락 | **신·구법 적용 경계 오인** | FR-17 부칙 자동 연결 |
| 외부 API 장애 | 사용성 저하 | 캐시 24h, 명확한 에러 메시지 |
| 법령 개정 미반영 | 잘못된 답변 | TTL 24h, 시행일 강제 표시 |
| LLM 비용 폭증 | 운영 부담 | 1차는 작은 모델, 답변 생성만 큰 모델 |
| LLM이 유사 사례를 직접 적용 단정 | **잘못된 의사결정 유도** | V6 단정 금지, 라벨링 강제 |
| 개인정보 검색어 노출 | **개인정보 침해** | 주민·사업자번호 패턴 필터링 |
| 골든셋 부재로 회귀 검출 실패 | 정확성 저하 무자각 | M3에서 G-1 30건, 이후 점진적 확장 |

---

## 11. 한 페이지 요약

```
┌──────────────────────────────────────────────────────────┐
│  프로젝트: 세법 API 검색 시스템                              │
│  문서 우선순위: SSOT > PRD > CLAUDE.md > 티켓               │
├──────────────────────────────────────────────────────────┤
│  철학: 정확성 > 완전성 > 속도 > 편의성                       │
│  스택: Next.js + TS + Tailwind + Vercel AI SDK +          │
│        Gemini 2.0 Flash → Claude/GPT (운영)               │
│  구조: UI → API Route → Usecase → Adapter (Port 분리)     │
│  파이프라인: 5단계 RAG (압축·생략 금지, SSOT §3.3)          │
├──────────────────────────────────────────────────────────┤
│  강제 규칙 (SSOT 핵심):                                    │
│  • Usecase에서 fetch·DB 호출 금지 (Port만 사용)            │
│  • 답변 생성 모든 경로 law-verifier 통과 필수                │
│  • 환경변수 추가 시 4곳 동시 갱신                            │
│  • 검색 결과 정렬 기준 고정 (개정일→시행일→조문번호)          │
│  • LLM 프롬프트 변경 시 골든셋 회귀 통과 필수                │
│  • AI는 골든셋 수정·삭제 금지                                │
├──────────────────────────────────────────────────────────┤
│  DOD (5단계 완료 조건):                                    │
│  ① 기능 ② 범위 ③ 검증 ④ 문서화 ⑤ 회계사 브라우저 승인       │
├──────────────────────────────────────────────────────────┤
│  KPI: 환각률 0% / 인용 무결성 위반 0% / 시점 라벨 100%     │
├──────────────────────────────────────────────────────────┤
│  M0 다음 → TAX-000 (10개 서브태스크, ~32h)                 │
└──────────────────────────────────────────────────────────┘
```

---

## 12. 다음 액션

### 12.1 즉시 가능한 작업 (Research Mode 종료 후)

1. **`plan_task` 호출** — "M0(TAX-000) 작업을 plan_task로 계획해줘"
2. **`split_tasks` 호출** — "위 10개 서브태스크를 split_tasks로 등록해줘"
3. **티켓 작성** — `docs/tickets/TAX-000_initial-setup.md` 생성
4. **티켓 템플릿 확인** — `docs/tickets/_TEMPLATE.md` 검토 (없으면 생성)

### 12.2 인간(회계사) 결정 필요 사항

- [ ] M0 작업 분할안 승인 (10개 서브태스크)
- [ ] LLM 운영 단계 선택 (Claude vs GPT)
- [ ] 벡터 DB 선택 (pgvector vs Pinecone) — M4 진입 전
- [ ] 임베딩 모델 선택 (Voyage-2 vs OpenAI) — M4 진입 전
- [ ] 골든셋 G-1 50건 작성 시작 (M3 진입 전 필수)

### 12.3 후속 문서 작성 필요

- [ ] `docs/tickets/_TEMPLATE.md` (티켓 표준 양식)
- [ ] `docs/DOMAIN.md` (세법 도메인 용어 사전, NEXT_STEPS 1순위)
- [ ] `eval/README.md` (골든셋 작성 가이드, M3에서)
- [ ] `.claude/agents/law-verifier.md` (검증 서브에이전트, TAX-003에서)

---

## 📌 참조 문서

- `docs/SSOT.md` v2.0 — 최상위 강제 규칙 (헌법)
- `docs/PRD.md` v2.0 — 제품 사양 (사양서)
- `CLAUDE.md` — AI 1페이지 행동 지침
- `docs/tickets/_TEMPLATE.md` — 티켓 양식 (작성 예정)
- `.claude/agents/law-verifier.md` — 검증 서브에이전트 (TAX-003에서 작성)

---

**리포트 끝.**

> 본 리포트는 Shrimp Task Manager Research Mode를 통해 수행된 PRD + SSOT 통합 분석 결과이며, 추후 M0(TAX-000) 작업 시작 시 기초 자료로 활용됩니다.
