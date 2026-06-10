# Phase 1: 핵심 안전장치 (1-2주)

> 목표: 환각 검출 구조 + 자동 검증 강제 + 보안 차단
> 완료 조건: TAX-001 + TAX-002 + TAX-003 모두 completed
> 다음 단계: Phase 2 진입 (`AGENT/phase2.md` 참조)

---

## TAX-001: GAN-스타일 4-에이전트 분리 구조 구축

**Phase 1 / Step 1 / 선행 없음 — 지금 시작 가능**

### 목적

단일 LLM 인스턴스가 생성·검증을 동시에 수행하면 자기 환각을 스스로 인지하기 어렵다.
생성(tax-generator)과 검증(law-verifier)을 분리하여 환각 검출률 30% → 90%+ 향상.

### 생성할 파일

| 파일 | 모델 | tools | color | 역할 |
|---|---|---|---|---|
| `.claude/agents/tax-planner.md` | claude-haiku-4-5-20251001 | (없음) | blue | 자연어→검색쿼리 변환 |
| `.claude/agents/tax-searcher.md` | claude-haiku-4-5-20251001 | WebFetch | blue | 외부 API 검색 |
| `.claude/agents/tax-generator.md` | claude-sonnet-4-6 | Read | blue | 답변 생성·라벨링 |
| `.claude/agents/law-verifier.md` | claude-opus-4-7 | Read, Grep | red | V1~V6 독립 검증 |

### 에이전트 파일 형식 (기존 prd-writer.md 패턴)

```markdown
---
name: [에이전트명]
description: [설명]
tools: [tool1, tool2]
color: [blue|red]
model: [모델ID]
---

[역할 지시문]
```

> **주의**: `allowed-tools:` 키 사용 금지 — 기존 에이전트 파일은 `tools:` 키 사용

### 각 에이전트 지시문 핵심

**tax-planner.md**
- 자연어 세법 질의를 국세법령정보시스템 API 검색 파라미터로 변환
- 법령명·조문번호·키워드 3가지 검색어 세트 생성
- 모호한 시점 표현 감지 시 시점 확인 요청

**tax-searcher.md**
- WebFetch로 외부 API 호출 (Read-only, 원문 변형 금지)
- 빈 결과 시 재검색 1회
- TaxLaw[] 배열 형태로 반환

**tax-generator.md**
- TaxLaw[] 수신 후 Trust Tier T1~T4 라벨 부착
- `[현행]` / `[폐지: YYYY.MM.DD]` 시점 라벨 부착
- 검색 결과에 없는 조문 인용 절대 금지 (환각 방지)
- 답변 하단 면책 고지 포함

**law-verifier.md**
- 생성 에이전트와 완전히 독립된 인스턴스로 실행
- V1 출처 존재 → V2 인용 무결성(문자 단위) → V3 라벨 적정성
  → V4 시점 표기 → V5 면책 고지 → V6 단정 금지 순서대로 검증
- 실패 시 E-VERIFY-FAIL 발급 + 재시도 1회
- 2회 실패 시 미검증 답변 회계사에 노출 금지

### 검증 체크리스트

- [ ] `.claude/agents/` 에 4개 파일 존재
- [ ] 각 파일 frontmatter에 `tools` / `color` / `model` 항목 존재
- [ ] `law-verifier.md` 본문에 V1~V6 체크리스트 전부 포함
- [ ] `tax-generator.md`의 `tools`에 Grep 없음 (검증 전담 분리)
- [ ] `docs/reports/TAX-001_report.md` 작성

---

## TAX-002: Hooks 자동화로 검증 우회 차단

**Phase 1 / Step 2 / TAX-001 완료 후 진행**

### 목적

검증을 "매번 의식하기"가 아닌 "우회할 수 없게 만들기".
CLAUDE.md §6.4 V1~V6 우회 금지를 시스템 강제력으로 구현.

### 생성·수정할 파일

| 파일 | 작업 | 내용 |
|---|---|---|
| `scripts/check-pii.js` | 신규 생성 | PII 패턴 차단 스크립트 |
| `scripts/run-verifier.js` | 신규 생성 | V1~V6 자동 실행 트리거 |
| `.claude/settings.json` | 수정 | hooks 섹션 추가 (agents 섹션 보존) |

### check-pii.js 구현 지침

```
입력:  process.env.CLAUDE_TOOL_INPUT (JSON)
검사:  주민번호 패턴 = /\d{6}-[1-4]\d{6}/
       사업자번호 패턴 = /\d{3}-\d{2}-\d{5}/
감지 시: process.stderr.write('[PII 차단] 개인정보 포함 쿼리')
         process.exit(1)
정상 시: process.exit(0)
로깅:   console.log 금지 — process.stderr.write 사용
```

### run-verifier.js 구현 지침

```
입력:  stdin으로 검증 대상 답변 JSON
동작:  law-verifier 에이전트 호출 트리거
출력:  { V1:'PASS', V2:'PASS', ..., final:'PASS' } JSON → stderr
실패:  process.exit(1)
```

### settings.json hooks 섹션 구조

```json
{
  "agents": { ... },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "tool == \"WebFetch\"",
        "hooks": [{ "type": "command", "command": "node scripts/check-pii.js" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "tool == \"GenerateAnswer\"",
        "hooks": [{ "type": "command", "command": "node scripts/run-verifier.js" }]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "input matches \"예전|이전 법|옛날\"",
        "hooks": [{
          "type": "command",
          "command": "echo '시점이 모호합니다. 정확한 적용 시점(YYYY.MM.DD)을 알려주세요.' >&2; exit 1"
        }]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "node scripts/run-verifier.js --check-v5" }]
      }
    ]
  }
}
```

> **주의**: 기존 `agents` 섹션 JSON 키 보존 필수

### 검증 체크리스트

- [ ] `node scripts/check-pii.js` 주민번호 입력 → exit code 1
- [ ] `node scripts/check-pii.js` 일반 검색어 → exit code 0
- [ ] `.claude/settings.json`에 `hooks` 키 존재 + `agents` 키 보존
- [ ] 모호 시점 입력('예전 법으로') → 중단 메시지 출력
- [ ] `docs/reports/TAX-002_report.md` 작성

---

## TAX-003: 보안 강화 — Permissions Deny 및 Lethal Trifecta 차단

**Phase 1 / Step 3 / TAX-002 완료 후 진행**

### 목적

Simon Willison의 Lethal Trifecta(사적 데이터 + 신뢰할 수 없는 콘텐츠 + 외부 통신) 차단.
Prompt Injection이 데이터 유출로 직결되는 경로를 시스템 수준에서 봉쇄.

### .claude/settings.json permissions 섹션 추가

```json
{
  "agents": { ... },
  "hooks": { ... },
  "permissions": {
    "deny": [
      "Read(**/.env*)",
      "Read(**/users/**)",
      "Bash(curl * | bash)",
      "WebFetch(except:*.go.kr)"
    ]
  }
}
```

### .claude/settings.local.json 개발 예외

```json
{
  "permissions": {
    "allow": [
      "WebFetch(https://api.example.com/**)"
    ]
  }
}
```

### Phase 1 완료 게이트

TAX-001, TAX-002, TAX-003 모두 `completed` 상태 확인 후 Phase 2 진입.

### 검증 체크리스트

- [ ] `.claude/settings.json`에 `permissions.deny` 배열 4개 항목 존재
- [ ] `agents`, `hooks` 섹션 보존 확인
- [ ] `.claude/settings.local.json`에 개발 예외 존재
- [ ] `docs/reports/TAX-003_report.md` 작성
- [ ] **Phase 1 게이트**: TAX-001~003 모두 completed 상태 확인
