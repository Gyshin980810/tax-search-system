# [TAX-007] MCP·컨텍스트 관리 정책 수립

> 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 6
> Phase 3 — 운영 안정화

---

## Metadata

- **Type**: TASK
- **Severity**: minor
- **Layer**: infra
- **Milestone**: Post-MVP
- **Estimated Size**: S (1~2파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- `.mcp.json`에 `shrimp-task-manager` + `sequential-thinking` 2개만 활성화 (현재 양호)
- 하지만 향후 외부 API 통합, DB 연결 등 MCP 추가 시 관리 정책 없음
- 200K 컨텍스트 윈도우가 불필요한 MCP 도구 때문에 70K까지 줄어들 수 있음

### 1.2 기대 동작

- 활성 MCP 5개 이내 정책이 문서화됨
- 각 MCP의 목적·활성 조건·비활성 조건이 명시됨
- Phase 2~3에서 추가될 MCP 계획이 미리 정의됨

### 1.3 영향·중요도

- 컨텍스트 윈도우 건강 유지 → 답변 품질 유지
- 현재는 2개로 양호하나 향후 확장 대비 정책 선제 수립

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `.mcp.json` (수정 — 주석·정책 섹션 추가)
- `docs/mcp-policy.md` (신규 생성 — MCP 관리 정책 문서)

### 2.2 현재 활성 MCP

```json
{
  "mcpServers": {
    "shrimp-task-manager": { ... },   // ✅ 활성 — 작업 관리
    "sequential-thinking": { ... }    // ✅ 활성 — 복잡한 분기 분석
  }
}
```

### 2.3 향후 추가 예정 MCP (Phase 2~3)

| MCP | 추가 시점 | 목적 | 활성 조건 |
|---|---|---|---|
| `law-go-kr` (자체 구축) | 외부 API 통합 시 | 국세법령정보센터 | 검색 작업 시만 활성 |
| `supabase` | 로그 저장 필요 시 | 검증 로그·골든셋 결과 | DB 작업 시만 활성 |
| `memory` | 세션 영속화 필요 시 | 세션 간 컨텍스트 | 장기 세션 시만 활성 |

목표: 동시 활성 최대 5개 이내.

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `docs/mcp-policy.md` 신규 생성

### 3.2 금지되는 변경

- ❌ `.mcp.json` 기존 설정 변경 (현재 2개 활성 유지)
- ❌ `src/` 하위 소스코드 수정
- ❌ `CLAUDE.md` 수정

---

## 4. Strategy (구현 힌트)

1. `docs/mcp-policy.md`에 다음 항목 작성:
   - 활성 MCP 최대 5개 원칙
   - 현재 활성 MCP 목록 및 목적
   - 향후 추가 계획 및 활성 조건
   - 비활성화 방법 (`/mcp` 명령 또는 settings.json)

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `docs/mcp-policy.md` 존재
2. [ ] "동시 활성 5개 이내" 원칙 명시
3. [ ] 현재 활성 MCP 2개의 목적 기술
4. [ ] 향후 추가 예정 MCP 3개의 추가 조건 명시

---

## 6. Verification (검증 단계)

1. `docs/mcp-policy.md` 파일 존재 확인
2. 5개 이내 원칙 명시 확인
3. 기존 `.mcp.json` 변경 없음 확인

---

## 7. Risks / Notes

- 현재 MCP 2개 상태는 양호 — 이 티켓은 정책 문서화가 목적
- 실제 MCP 추가·제거는 해당 기능 티켓에서 처리

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] mcp-policy.md 목차 초안

→ **인간 승인 후** 파일 생성

### 8.2 코딩 후 제출할 것

- [ ] 생성된 파일 경로
- [ ] 정책 요약
- [ ] 리포트: `docs/reports/TAX-007_report.md`

---

## 10. Related Tickets

- 선행: TAX-003 (보안 강화 — 허용 도메인 정책과 연계)
- 후속: 없음
- 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 6

---

## 11. Report Link

Report: `docs/reports/TAX-007_report.md` (미작성)

---

**작성자**: AI (하네스 엔지니어링 보고서 기반)
**작성일**: 2026-05-11
**최종 수정일**: 2026-05-11
