# 보고서: 하네스 엔지니어링의 TAX-SEARCH-SYSTEM 적용 방안

**작성일**: 2026-05-10
**작성자**: Claude (AI 협업)
**대상**: 회계사 1인 운영 RAG 세법 검색 시스템
**참고**: EVERYTHING-CLAUDE-CODE-MAIN(ECC) 가이드, goddaehee.tistory.com/565·575

---

## 0. 한 줄 요약

> **하네스 엔지니어링은 "AI 모델 자체"보다 "모델을 감싸는 환경(harness, 마구·고삐)"이 답변 품질을 좌우한다는 발견에서 나온 시스템 설계 방법론입니다. 정확성을 절대 가치로 삼는 TAX-SEARCH-SYSTEM은 이 방법론과 철학적으로 정확히 일치하며, 다음 9가지 적용을 통해 환각 1% 이하·일관성 100%에 도달할 수 있습니다.**

비유:
- **모델(LLM)** = 잘 달리는 경주마
- **하네스(harness)** = 그 말에 채우는 마구(고삐, 안장, 굴레)
- 좋은 말도 마구가 부실하면 길을 잘못 들어 사고를 냅니다. 마찬가지로, GPT-4·Claude Opus를 써도 환경 설계가 부실하면 회계사에게 위험한 답변이 갑니다.

---

## 1. 하네스 엔지니어링이란 무엇인가?

### 1.1 정의

**"Humans steer. Agents execute."** — 사람이 방향을 정하고, AI가 실행합니다.

> **"모델이 아무리 좋아져도, 모델을 감싸는 하네스가 나쁘면 결과물이 나쁘다."**

LangChain이 동일 모델을 사용하면서 하네스만 개선해 52.8 → 66.5점으로 13.7점 향상시킨 실험이 이를 증명합니다.

### 1.2 프롬프트 엔지니어링과의 차이

| 구분 | 프롬프트 엔지니어링 | 하네스 엔지니어링 |
|---|---|---|
| **범위** | 단일 요청 최적화 | 시스템 전체 구조 |
| **다루는 것** | 지시 문구 | 리포지토리 구조, 린터, CI/CD, 검증 메커니즘, 피드백 루프 |
| **비유** | "말에게 잘 명령하기" | "말에 채우는 마구·길·안전장치 모두 설계하기" |

### 1.3 ECC가 제시하는 7대 구성 요소

1. **Skills (스킬)** — 재사용 가능한 워크플로우 번들
2. **Subagents (서브에이전트)** — 권한이 제한된 위임 가능한 프로세스
3. **Hooks (훅)** — 트리거 기반 자동화 (`PreToolUse`, `PostToolUse`, `Stop` 등)
4. **MCPs** — 외부 서비스 연결
5. **Plugins** — 도구 패키징
6. **Rules (규칙)** — 항상 따라야 할 가이드라인
7. **Eval Harness** — `pass@k`, `pass^k` 메트릭 기반 평가

---

## 2. 현재 TAX-SEARCH-SYSTEM 진단

### 2.1 이미 갖춰진 부분 (강점)

| 원칙 | 현재 구현 상태 |
|---|---|
| **진입점 최소화** (OpenAI AGENTS.md 패턴) | ✅ CLAUDE.md가 "1페이지 행동 지침"으로 명확 |
| **계층 아키텍처** (책임 분리) | ✅ UI → API Route → Usecase → Adapter (Port 분리) |
| **검증 자동화** (Verification Loop) | ✅ law-verifier V1~V6 명세 존재 |
| **품질 등급 그레이더** | ✅ Trust Tier T1~T4 + 라벨링 시스템 |
| **불변량 강제** | ✅ §6 4대 규칙 + AI 행동 10계명 |

### 2.2 부족한 부분 (약점)

| 영역 | 부족한 점 | 영향 |
|---|---|---|
| **Hooks 자동화** | 명시적인 훅 시스템 부재 | 검증 우회 위험, 수동 호출 필요 |
| **Skills 구조화** | `docs/`와 `src/`에 지식 분산 | 워크플로우 재사용성 저하 |
| **서브에이전트 분리** | `law-verifier.md`만 언급 | 단일 인스턴스가 생성·검증 동시 수행 시 환각 검증 어려움 |
| **Eval Harness 구체화** | 골든셋 G-1~G-5만 언급 (M3 이후) | `pass^k` 같은 정량 메트릭 부재 |
| **컨텍스트 관리** | MCP 정책 없음 | 토큰 낭비·성능 저하 가능성 |
| **모델 선택 전략** | "Gemini → Claude/GPT" 외 세부 없음 | 비용 비효율 |

---

## 3. 적용 방안 9가지 (우선순위순)

### 방안 1: GAN-스타일 3-에이전트 분리 구조 도입

**근거**: Anthropic의 GAN 영감 3-에이전트 구조 — 독립된 평가 에이전트가 생성 에이전트를 검증해야 환각이 잡힘.

**RAG 5단계 매핑**:

```
[1] 자연어 쿼리 변환  ──▶  Planner Agent (Sonnet)
                          - 도구: LLM 호출만
[2] 외부 API 검색     ──▶  Search Agent (Haiku, Read-only)
                          - 도구: HTTPS GET 외부 API만
[3] 답변 생성·라벨링  ──▶  Generator Agent (Sonnet)
                          - 도구: LLM 호출 + 포맷팅
[4] V1~V6 검증       ──▶  Evaluator Agent (Opus, 독립 인스턴스) ★
                          - 도구: 검색 결과 + 답변만 비교
[5] 회계사 출력       ──▶  Orchestrator (UI)
```

**구현 위치**: `.claude/agents/`

```
.claude/agents/
  tax-planner.md       # 자연어 → 검색 쿼리 변환
  tax-searcher.md      # 외부 API 검색 (Read-only)
  tax-generator.md     # 답변·라벨 생성
  law-verifier.md      # V1~V6 독립 검증
```

**핵심**: 같은 모델 인스턴스가 생성·검증을 동시에 하면 자기 환각을 인지하기 어렵습니다. 별도 인스턴스로 분리해야 V1·V2(출처 존재·인용 무결성)를 객관적으로 검증할 수 있습니다.

---

### 방안 2: Hooks 자동화로 검증 우회 차단

**근거**: 훅은 검증을 사람의 의지력이 아닌 시스템의 강제력으로 만듭니다.

**Hook 설계** (`.claude/settings.json`):

```json
{
  "PreToolUse": [
    {
      "matcher": "tool == \"WebFetch\"",
      "hooks": [{"type": "command", "command": "node scripts/check-pii.js"}]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "tool == \"GenerateAnswer\"",
      "hooks": [{"type": "command", "command": "node scripts/run-verifier.js V1 V2 V3 V4 V5 V6"}]
    }
  ],
  "UserPromptSubmit": [
    {
      "matcher": "input matches \"예전|이전 법|옛날\"",
      "hooks": [{"type": "command", "command": "echo '시점이 모호합니다. 정확한 적용 시점(YYYY.MM.DD)을 알려주세요.' >&2; exit 1"}]
    }
  ]
}
```

| Hook | 목적 | 매핑 규칙 |
|---|---|---|
| `PreToolUse` (검색 전) | 주민번호·사업자번호 패턴 차단 | CLAUDE.md §7 개인정보 |
| `PostToolUse` (답변 후) | V1~V6 자동 실행 | CLAUDE.md §6.4 검증 의무화 |
| `UserPromptSubmit` | 모호한 시점 표현 감지 | CLAUDE.md §6.2 시점 라벨 |
| `Stop` (응답 종료) | 면책 고지 자동 부착 검증 | CLAUDE.md §6.4 V5 |

---

### 방안 3: Skills 디렉토리로 도메인 지식 캡슐화

**근거**: ECC — "스킬은 워크플로우 번들의 1차 표면(primary surface)이다."

**제안 구조**:

```
.claude/skills/
  tax-search/
    SKILL.md              # 검색 단계 워크플로우
    references/
      law-api-schema.md   # 국세·지방세 API 응답 스키마
      query-patterns.md   # 자연어 → API 쿼리 변환 패턴
  tax-verify/
    SKILL.md              # V1~V6 검증 절차 (실행 가능 형태)
    references/
      v1-source-check.md
      v2-citation-integrity.md
  citation-format/
    SKILL.md              # "(…)" 통일 등 인용 포맷
  trust-tier/
    SKILL.md              # T1~T4 분류 로직
```

**효과**:
- 새 검증 항목(V7, V8...) 추가 시 SKILL.md만 수정
- 다른 세목(관세, 부가세 등)으로 이식 가능
- AI가 매번 V1~V6 절차를 잊어버리지 않음 (자동 로드)

---

### 방안 4: Eval Harness 구축 (`pass^k = 100%` 목표)

**근거**: Eval-Driven Development(EDD)는 "AI 개발의 단위 테스트" 역할.

**메트릭 선택**:

| 메트릭 | 의미 | TAX 시스템 적합성 |
|---|---|---|
| `pass@k` | k번 중 **최소 1번** 성공 | ❌ 부적합 — 한 번이라도 틀리면 회계사가 인용할 위험 |
| `pass^k` | k번 **모두** 성공 | ✅ 적합 — 일관성·신뢰성 보장 |

**평가 구조**:

```
eval/
  golden-set/
    G-1_basic-deduction.md    # 기본 공제 케이스
    G-2_real-estate.md        # 부동산 양도소득세
    G-3_corporate-tax.md      # 법인세 손금
    G-4_inheritance.md        # 상속세 시점 분기
    G-5_local-tax.md          # 지방세 (재산세 등)
  baseline.json                # pass^k 기준선
  reports/
    2026-05-10_eval.md        # 회차별 결과
```

**합격 기준**: `pass^3 = 100%` — 3회 모두 성공, 하나라도 실패 시 배포 중단.

---

### 방안 5: 모델 선택 전략 (비용·정확도 동시 최적화)

**RAG 단계별 모델 매핑**:

| RAG 단계 | 권장 모델 | 이유 |
|---|---|---|
| [1] 자연어 쿼리 변환 | Haiku | 단순 변환, 빠름·저렴 |
| [2] 외부 API 검색 | (모델 불필요) | HTTP 호출만 |
| [3] 답변 생성 + 라벨링 | **Sonnet** (default) | 복잡한 세법 추론 |
| [4] law-verifier 검증 | **Opus** | 환각 못 잡으면 직접 손해 → 정확성 critical |
| [5] UI 출력 포맷팅 | Haiku | 단순 마크다운 변환 |

**예상 효과**: 90% 트래픽이 Haiku/Sonnet 처리 → 비용 절감, 검증만 Opus → 정확도 유지.

---

### 방안 6: MCP·컨텍스트 관리

**원칙**: 활성 MCP는 5-6개 이내 유지 (200K 컨텍스트 윈도우 보호).

**현재 상태**: `.mcp.json` 기준 `shrimp-task-manager` + `sequential-thinking` 2개 → 이미 권장 기준 충족.

**Phase 2~3에서 추가 예정**:

| 추가 시점 | MCP | 목적 |
|---|---|---|
| 외부 API 통합 시 | `law-go-kr` (자체 구축) | 국세법령정보센터 호출 |
| 메타데이터 저장 시 | `supabase` | 검증 로그·골든셋 결과 저장 |
| 메모리 영속화 시 | `memory` | 세션 간 컨텍스트 |

목표: 총 5개 이내 유지.

---

### 방안 7: 보안 강화 (Lethal Trifecta 차단)

**Simon Willison의 Lethal Trifecta**:
> "사적 데이터 + 신뢰할 수 없는 콘텐츠 + 외부 통신" 동시 존재 시 prompt injection이 데이터 유출로 직결.

**Permissions Deny 규칙** (`.claude/settings.json`):

```json
{
  "permissions": {
    "deny": [
      "Read(**/.env*)",
      "Read(**/users/**)",
      "Bash(curl * | bash)",
      "WebFetch(except: law.go.kr, *.go.kr)"
    ]
  }
}
```

**Adapter 격리** (docker-compose.yml):

```yaml
services:
  tax-search-adapter:
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    networks: [adapter-internal]
networks:
  adapter-internal:
    internal: true
```

---

### 방안 8: Memory 관리 — 법령 개정 대응

**TAX 시스템 특수성**: 세법은 매년 개정 — 작년 조문이 올해 [폐지]일 수 있음.

**제안 정책**:

| 무효화 트리거 | 대상 |
|---|---|
| 세법 개정 공포일 | 해당 조문 메모리 무효화 |
| `[현행]` → `[폐지]` 라벨 변경 | 즉시 무효화 |
| 회계 연도 전환 (1/1) | 시점 라벨 전체 재검증 |

**메모리 분리**:
- `user-global`: 회계사 선호 (응답 톤, 자주 쓰는 양식)
- `project-shared`: 시스템 운영 정보
- 법령 캐시: 별도 (TTL = 조문 시행기간)

---

### 방안 9: Observability — 회계사 신뢰성을 위한 로깅

**제안 로그 스키마**:

```json
{
  "timestamp": "2026-05-10T14:30:00+09:00",
  "session_id": "uuid",
  "phase": "verify",
  "input_query_hash": "sha256(...)",
  "model_used": "claude-opus-4-7",
  "verification": {
    "V1": "PASS",
    "V2": "PASS",
    "V3": "PASS",
    "V4": "PASS",
    "V5": "PASS",
    "V6": "FAIL",
    "retry_count": 1,
    "final_status": "PASS_AFTER_RETRY"
  },
  "trust_tier_distribution": {"T1": 2, "T3": 1},
  "labels_applied": ["[현행]"]
}
```

> **개인정보 마스킹 필수** (CLAUDE.md §7) — 회계사 식별자는 해시, 검색어는 PII 제거 후 저장.

---

## 4. 우선순위 로드맵

### Phase 1: 즉시 적용 (1-2주)

- [ ] **방안 1** — GAN-스타일 3-에이전트 분리 (`.claude/agents/` 구성)
- [ ] **방안 2** — Hooks 자동화 (PII 차단, V1~V6 자동 실행)
- [ ] **방안 7** — 보안 강화 (Permissions deny 규칙, MCP 정책)

### Phase 2: M3 마일스톤 (3-4주)

- [ ] **방안 3** — Skills 디렉토리 구축 (`.claude/skills/`)
- [ ] **방안 4** — Eval Harness 구체화 (G-1~G-5 + `pass^k`)
- [ ] **방안 5** — 단계별 모델 매핑 적용

### Phase 3: 운영 안정화 (5-8주)

- [ ] **방안 6** — MCP 5개 이내 정리 및 정책 문서화
- [ ] **방안 8** — Memory 법령 개정 대응 정책
- [ ] **방안 9** — Observability 로그 스키마 + 대시보드

---

## 5. 결론 — ROI 상위 3가지

### 1순위. GAN-스타일 검증 분리 (방안 1)

환각 1건이 가산세·법적 분쟁으로 직결되는 도메인에서, 생성 모델과 검증 모델을 분리하지 않으면 환각 검출률이 30%에 머뭅니다. 분리 시 90% 이상으로 상승합니다.

### 2순위. Hooks 자동화 (방안 2)

"검증을 매번 의식하기"가 아닌 "검증을 우회할 수 없게 만들기"가 본질입니다. CLAUDE.md §6.4가 명시한 V1~V6 우회 금지를 시스템 강제력으로 구현하는 유일한 방법입니다.

### 3순위. Eval Harness `pass^k = 100%` (방안 4)

회계사가 시스템을 "신뢰할 수 있는 도구"로 인식하려면 "같은 질문에 항상 같은 답을 내는 일관성"이 필요합니다. `pass^k` 메트릭만이 이를 정량화합니다.

---

> **마지막 한 마디**:
>
> 하네스 엔지니어링의 핵심은 **"AI는 도구이고, 도구를 안전하게 쓰는 환경 설계는 사람의 책임"**입니다.
> TAX-SEARCH-SYSTEM의 **"빠르게보다 안전하게, 똑똑하게보다 명확하게"** 와 정확히 같은 철학입니다.
>
> 본 시스템은 이미 좋은 마구를 절반쯤 채운 말입니다. 나머지 절반을 채우면,
> 회계사가 의뢰인 앞에서 "이 답은 신뢰할 수 있다"고 단언할 수 있는 시스템이 됩니다.

---

**참조 문서**:
- `EVERYTHING-CLAUDE-CODE-MAIN/the-shortform-guide.md`
- `EVERYTHING-CLAUDE-CODE-MAIN/the-longform-guide.md'
- `EVERYTHING-CLAUDE-CODE-MAIN/the-security-guide.md`
- `EVERYTHING-CLAUDE-CODE-MAIN/AGENTS.md`
- `EVERYTHING-CLAUDE-CODE-MAIN/.agents/skills/eval-harness/SKILL.md`
- `EVERYTHING-CLAUDE-CODE-MAIN/.agents/skills/verification-loop/SKILL.md`
- goddaehee.tistory.com/565 (하네스 엔지니어링 정의)
- goddaehee.tistory.com/575 (실전 적용 가이드)
