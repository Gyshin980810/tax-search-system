# TAX-007 구현 리포트 — MCP 컨텍스트 관리 정책 문서화

> 완료일: 2026-05-12
> Phase: 3 / 병렬 실행

---

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `docs/mcp-policy.md` | 신규 생성 |

---

## 정책 핵심 내용

| 항목 | 내용 |
|---|---|
| 최대 활성 MCP | 5개 이내 |
| 현재 활성 MCP | 2개 (shrimp-task-manager, sequential-thinking) |
| Phase 2~3 추가 계획 | 3개 (law-go-kr, supabase, memory) |
| 초과 시 처리 | 우선순위 낮은 MCP 비활성화 후 추가, 변경 이력 기록 |

---

## Phase별 추가 계획 요약

| 추가 시점 | MCP | 추가 후 총 수 |
|---|---|---|
| M3 외부 API 통합 시 | `law-go-kr` | 3개 |
| 메타데이터 저장 시 | `supabase` | 4개 |
| 메모리 영속화 시 | `memory` | 5개 (한도) |

---

## 검증 체크리스트

- [x] `docs/mcp-policy.md` 생성 + 현재 MCP 목록 포함
- [x] 최대 5개 한도 정책 명시
- [x] Phase 2~3 추가 계획 3종 문서화
- [x] 초과 시 처리 프로세스 정의 (비활성화 우선순위 포함)

---

## Phase 3 게이트 확인 (부분)

| 작업 | 상태 |
|---|---|
| TAX-007: MCP 관리 정책 | ✅ completed |
| TAX-008: Memory 법령 개정 대응 | 진행 중 |
| TAX-009: Observability 로그 | 진행 중 |
