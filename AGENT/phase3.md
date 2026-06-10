# Phase 3: 운영 안정화 (5-8주)

> 진입 조건: Phase 2 게이트 통과 (TAX-004~006 모두 completed)
> 목표: MCP 관리 정책 + 법령 개정 대응 Memory + 검증 이력 Observability
> 완료 조건: TAX-007 + TAX-008 + TAX-009 모두 completed
> 병렬 실행: TAX-007, TAX-008, TAX-009 동시 실행 가능 (TAX-009는 TAX-005 필요)

---

## TAX-007: MCP 컨텍스트 관리 정책 문서화

**Phase 3 / 병렬 실행 가능 / TAX-002 완료 후**

### 목적

활성 MCP 5개 이내 유지로 200K 컨텍스트 윈도우 보호.
Phase 2~3에서 추가될 MCP 계획을 사전에 수립하여 토큰 낭비 방지.

### 현재 MCP 현황 (.mcp.json 기준)

| MCP | 역할 | 우선순위 |
|---|---|---|
| shrimp-task-manager | 작업 관리 | 필수 |
| sequential-thinking | 순차 사고 지원 | 필수 |

> 현재 2개 — 권장 한도(5개) 내 충족

### Phase 2~3 추가 계획 (총 5개 이내)

| 추가 시점 | MCP | 목적 |
|---|---|---|
| 외부 API 통합 시 | law-go-kr (자체 구축) | 국세법령정보센터 직접 호출 |
| 메타데이터 저장 시 | supabase | 검증 로그·골든셋 결과 저장 |
| 메모리 영속화 시 | memory | 세션 간 컨텍스트 유지 |

### 5개 초과 시 처리 프로세스

1. 신규 MCP 추가 필요 시 기존 MCP 비활성화 검토
2. 컨텍스트 윈도우 영향 평가 (200K 토큰 기준)
3. 우선순위 낮은 MCP 비활성화 후 추가
4. 변경 사항 `docs/mcp-policy.md`에 기록

### 생성할 파일

**docs/mcp-policy.md** (신규 생성)

```markdown
# MCP 관리 정책

## 원칙
- 활성 MCP 최대 5개
- 추가 전 컨텍스트 윈도우 영향 평가 필수

## 현재 활성 MCP 목록
[목록]

## 추가 계획
[계획]

## 변경 이력
[이력]
```

### 검증 체크리스트

- [ ] `docs/mcp-policy.md` 생성 + 현재 MCP 목록 포함
- [ ] 최대 5개 한도 정책 명시
- [ ] Phase 2~3 추가 계획 3종 문서화
- [ ] 초과 시 처리 프로세스 정의
- [ ] `docs/reports/TAX-007_report.md` 작성

---

## TAX-008: Memory 법령 개정 대응 정책 구현

**Phase 3 / 병렬 실행 가능 / TAX-001 완료 후**

### 목적

세법은 매년 개정(소득세법·법인세법 1/1 시행 다수).
작년 조문이 올해 `[폐지]`일 수 있으므로 메모리 무효화 정책이 필수.

### 메모리 3계층 분리

| 계층 | 내용 | 갱신 주기 |
|---|---|---|
| user-global | 회계사 선호 (응답 톤, 자주 쓰는 양식) | 영속 |
| project-shared | 시스템 운영 정보 | 반영속 |
| 법령 캐시 | 조문별 원문·시점 정보 | TTL = 시행기간 (공포일~폐지일) |

### 무효화 트리거 3종

| 트리거 | 대상 | 처리 |
|---|---|---|
| T1: 세법 개정 공포일 | 해당 조문 캐시 | 즉시 무효화 |
| T2: `[현행]`→`[폐지]` 라벨 변경 | 해당 조문 메모리 | 즉시 무효화 |
| T3: 1월 1일 (회계 연도 전환) | 전체 시점 라벨 | 재검증 알림 발송 |

### scripts/invalidate-memory.js 구현 지침

```
CLI 인수:
  --trigger=[개정공포일|폐지라벨|연도전환]
  --law-id=[조문ID] (T1, T2 전용)

동작:
  T1/T2: .claude/projects/ 에서 해당 조문 캐시 파일 삭제 또는 만료 표시
  T3:    전체 시점 라벨 파일 스캔 → [현행] 라벨 목록 출력

출력:
  JSON: { trigger, affected_laws: [], timestamp }
```

### 생성할 파일

- `docs/memory-policy.md` — 메모리 관리 정책 문서
- `scripts/invalidate-memory.js` — 무효화 트리거 CLI

### 검증 체크리스트

- [ ] `docs/memory-policy.md`에 3계층 분리 정책 명시
- [ ] 무효화 트리거 3종 정의
- [ ] `node scripts/invalidate-memory.js --help` 실행 가능
- [ ] `docs/reports/TAX-008_report.md` 작성

---

## TAX-009: Observability 로그 스키마 구현

**Phase 3 / 병렬 실행 가능 / TAX-001 + TAX-005 완료 후**

### 목적

검증 이력을 구조화된 로그로 추적하여 회계사 신뢰성 강화.
PII 마스킹으로 개인정보 보호(CLAUDE.md §7) 준수.

### 로그 스키마

```json
{
  "timestamp": "2026-05-12T14:30:00+09:00",
  "session_id": "uuid-v4",
  "phase": "planner | searcher | generator | verifier",
  "input_query_hash": "sha256(쿼리에서_PII_제거_후_해시)",
  "model_used": "claude-opus-4-7",
  "verification": {
    "V1": "PASS | FAIL",
    "V2": "PASS | FAIL",
    "V3": "PASS | FAIL",
    "V4": "PASS | FAIL",
    "V5": "PASS | FAIL",
    "V6": "PASS | FAIL",
    "retry_count": 0,
    "final_status": "PASS | PASS_AFTER_RETRY | FAIL"
  },
  "trust_tier_distribution": { "T1": 2, "T2": 0, "T3": 1, "T4": 0 },
  "labels_applied": ["[현행]", "[적용시점: 2026.01.01~]"]
}
```

### scripts/logger.js 구현 지침

```
함수: createLog(sessionId, phase, query, model, verificationResult, labels)

PII 마스킹 처리:
  1. check-pii.js 로직 재사용하여 query에서 PII 감지
  2. 감지된 PII → SHA-256 해시로 치환
  3. 해시된 query를 input_query_hash에 저장

로그 저장:
  - 로컬: logs/YYYY-MM-DD_HH-MM-SS.json
  - Vercel: Vercel 로그 시스템 활용

Node.js 내장 crypto 모듈 사용 (외부 의존성 추가 금지)
```

### .gitignore 수정

```
# 로그 파일 (개인정보 포함 가능)
logs/*.json
logs/*.log
```

### eval 연동

`scripts/run-eval.js`에서 `logger.js` 임포트 → 각 케이스 실행 결과를 로그 형식으로 저장

### 생성·수정할 파일

| 파일 | 작업 | 내용 |
|---|---|---|
| `scripts/logger.js` | 신규 생성 | createLog 함수 + JSON 스키마 |
| `logs/.gitkeep` | 신규 생성 | 디렉토리 유지용 |
| `.gitignore` | 수정 | `logs/*.json` 추가 |

### 검증 체크리스트

- [ ] `scripts/logger.js`에 `createLog` 함수 + JSON 스키마 구현
- [ ] PII 포함 쿼리 로깅 시 해시로만 저장 확인
- [ ] `.gitignore`에 `logs/*.json` 존재
- [ ] `node scripts/run-eval.js` 실행 → `logs/` 에 결과 파일 생성
- [ ] `docs/reports/TAX-009_report.md` 작성
- [ ] **전체 완료 게이트**: 9개 작업 모두 completed 상태 확인

---

## Phase 3 병렬 실행 가이드

```
Phase 2 게이트 통과
       ↓
  ┌────┴────┬─────────┐
TAX-007  TAX-008   TAX-009
  │         │         │
(정책문서) (스크립트) (로그스키마)
  │         │         │
  └────┬────┴─────────┘
       ↓
  전체 9개 completed
  하네스 엔지니어링 구축 완료 🎉
```

> TAX-009는 TAX-005(Eval Harness) 완료가 선행 조건.
> TAX-007, TAX-008은 독립적으로 바로 시작 가능.
