# 하네스 엔지니어링 시스템 구축 — AI 실행 계획서

> 작성일: 2026-05-12
> 기반 문서: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md`
> 목표: 환각 1% 이하 · pass^3 = 100% 일관성 달성

---

## 0. 문서 구조

| 파일 | 내용 |
|---|---|
| `TASK_PLAN.md` | 전체 로드맵 (이 문서) |
| `phase1.md` | Phase 1 상세 실행 지침 (TAX-001~003) |
| `phase2.md` | Phase 2 상세 실행 지침 (TAX-004~006) |
| `phase3.md` | Phase 3 상세 실행 지침 (TAX-007~009) |

---

## 1. 전체 실행 로드맵

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 1: 핵심 안전장치 (1-2주) — 즉시 적용
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [Step 1]  TAX-001  4-에이전트 분리 구조 구축   ← 선행 없음
  [Step 2]  TAX-002  Hooks 자동화 + scripts      ← TAX-001 완료 후
  [Step 3]  TAX-003  Permissions deny 보안 강화  ← TAX-002 완료 후
  ✅ Phase 1 게이트: TAX-001 + TAX-002 + TAX-003 모두 completed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 2: 품질 보증 (3-4주) — M3 마일스톤
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [Step 1]  TAX-004  Skills 디렉토리 구축  ┐ 병렬 실행 가능
  [Step 1]  TAX-006  모델 선택 전략 적용  ┘
  [Step 2]  TAX-005  Eval Harness 구축     ← TAX-004 완료 후
  ✅ Phase 2 게이트: TAX-004 + TAX-005 + TAX-006 모두 completed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 3: 운영 안정화 (5-8주)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TAX-007  MCP 컨텍스트 관리 정책  ┐
  TAX-008  Memory 법령 개정 대응   ┤ 3개 모두 병렬 실행 가능
  TAX-009  Observability 로그 구현 ┘
  ✅ 최종 완료: 9개 tasks completed = 하네스 엔지니어링 구축 완료
```

---

## 2. 의존성 그래프

```
TAX-001 (시작점)
  ├── TAX-002
  │     └── TAX-003
  │           (Phase 1 완료)
  ├── TAX-004 ──┐
  │             ├── TAX-005
  │             │     └── TAX-009
  ├── TAX-006   ┘
  └── TAX-008

TAX-002 ── TAX-007
```

**임계 경로**: TAX-001 → TAX-004 → TAX-005 → TAX-009

---

## 3. 작업 목록 요약

| 작업 | Phase | Step | 의존 | 병렬 가능 | 예상 소요 |
|---|---|---|---|---|---|
| TAX-001 | 1 | 1 | 없음 | — | 1-2일 |
| TAX-002 | 1 | 2 | TAX-001 | — | 1-2일 |
| TAX-003 | 1 | 3 | TAX-002 | — | 0.5일 |
| TAX-004 | 2 | 1 | TAX-001 | TAX-006 | 2-3일 |
| TAX-005 | 2 | 2 | TAX-001, TAX-004 | — | 2-3일 |
| TAX-006 | 2 | 1 | TAX-001 | TAX-004 | 0.5일 |
| TAX-007 | 3 | — | TAX-002 | TAX-008, TAX-009 | 0.5일 |
| TAX-008 | 3 | — | TAX-001 | TAX-007, TAX-009 | 1일 |
| TAX-009 | 3 | — | TAX-001, TAX-005 | TAX-007, TAX-008 | 1-2일 |

---

## 4. AI 실행 규칙 (필수 준수)

1. **계획 먼저**: 코딩 전 구현 계획 제시 → 인간 승인 후 진행 (CLAUDE.md §8.1)
2. **Phase 게이트**: 이전 Phase 미완료 시 다음 Phase 진입 금지
3. **리포트 필수**: 각 작업 완료 후 `docs/reports/TAX-XXX_report.md` 작성
4. **검증 의무화**: law-verifier V1~V6 통과 없이 답변 노출 금지 (CLAUDE.md §6.4)
5. **원문 보존**: 법령 원문 의역·요약 금지 (CLAUDE.md §6.1)
6. **PII 보호**: 주민번호·사업자번호 저장·전송 금지 (CLAUDE.md §7)

---

## 5. 핵심 수정 사항 (계획 수립 중 발견)

| 항목 | 잘못된 형식 | 올바른 형식 | 근거 |
|---|---|---|---|
| 에이전트 파일 키 | `allowed-tools:` | `tools:` | 기존 `.claude/agents/prd-writer.md` 확인 |
| 에이전트 색상 | 미지정 | `color: blue`(검색/생성) `color: red`(검증) | prd-writer.md 형식 |

---

## 6. 참조 문서

- `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` — 하네스 엔지니어링 보고서
- `docs/PRD.md` — 제품 사양
- `docs/SSOT.md` — 아키텍처 헌법
- `CLAUDE.md` — AI 행동 지침
- `docs/tickets/TAX-001~TAX-009` — 각 작업 상세 티켓
- `AGENT/phase1.md` ~ `AGENT/phase3.md` — Phase별 실행 지침
