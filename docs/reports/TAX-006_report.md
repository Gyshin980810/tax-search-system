# TAX-006 구현 리포트 — 단계별 모델 선택 전략 적용

> 완료일: 2026-05-12
> Phase: 2 / Step 1 (TAX-004와 병렬)

---

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `.claude/settings.json` | `agents` 섹션에 4개 에이전트 항목 추가 |

---

## 추가된 모델 설정

| 에이전트 | 모델 | 이유 |
|---|---|---|
| `tax-planner` | `claude-haiku-4-5-20251001` | 단순 쿼리 변환 — 저렴한 비용으로 충분 |
| `tax-searcher` | `claude-haiku-4-5-20251001` | HTTP 검색 호출만 — 복잡한 추론 불필요 |
| `tax-generator` | `claude-sonnet-4-6` | 복잡한 세법 추론 + Trust Tier 라벨링 |
| `law-verifier` | `claude-opus-4-7` | 환각 검증 critical — 정확도 최우선 |

---

## RAG 단계별 모델 매핑

| RAG 단계 | 에이전트 | 모델 계열 | 비용 효율 |
|---|---|---|---|
| [1] 자연어 쿼리 변환 | tax-planner | Haiku | 최저비용 |
| [2] 외부 API 검색 | tax-searcher | Haiku | 최저비용 |
| [3] 답변 생성·라벨링 | tax-generator | Sonnet | 중간비용 |
| [4] V1~V6 검증 | law-verifier | Opus | 최고정확도 |

**예상 효과**: 90% 트래픽(플래닝·검색)을 Haiku로 처리 → 비용 대폭 절감,
검증 단계만 Opus 사용으로 정확도 유지

---

## 기존 에이전트 보존 확인

기존 7개 에이전트 (prd-writer, security-auditor, code-refactorer, vibe-coding-coach,
frontend-designer, content-writer, project-task-planner) 및 hooks, permissions.deny 섹션
모두 보존됨.

---

## 검증 체크리스트

- [x] `settings.json` agents에 tax-planner/searcher/generator/verifier 4개 항목 추가
- [x] `law-verifier` model이 `claude-opus-4-7`
- [x] `tax-planner`/`tax-searcher` model이 `claude-haiku-4-5-20251001`
- [x] `tax-generator` model이 `claude-sonnet-4-6`
- [x] 에이전트 파일 `model:` 과 `settings.json` 설정 일치
- [x] 기존 7개 에이전트 항목 보존 확인
- [x] `hooks` 섹션 보존 확인
- [x] `permissions.deny` 섹션 보존 확인

---

## Phase 2 게이트 확인

| 작업 | 상태 |
|---|---|
| TAX-004: Skills 디렉토리 구축 | ✅ completed |
| TAX-005: Eval Harness (pass^3=100%) | ✅ completed |
| TAX-006: 모델 선택 전략 적용 | ✅ completed |

**Phase 2 게이트 통과 → Phase 3 진입 가능**
