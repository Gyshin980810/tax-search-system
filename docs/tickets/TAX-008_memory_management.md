# [TAX-008] Memory 관리 — 법령 개정 대응 정책

> 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 8
> Phase 3 — 운영 안정화

---

## Metadata

- **Type**: TASK
- **Severity**: major
- **Layer**: infra
- **Milestone**: Post-MVP
- **Estimated Size**: S (1~2파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- AI 메모리 시스템(`~/.claude/projects/.../memory/`)에 법령 관련 정보가 쌓일 경우 개정 전 조문이 남아있을 수 있음
- 세법은 매년 개정 — `[현행]`이었던 조문이 `[폐지]`로 바뀌어도 메모리에 그대로 존재하면 잘못된 답변을 유발
- 메모리 무효화·분리 정책이 없음

### 1.2 기대 동작

- 메모리 무효화 트리거(법령 개정 공포, 연도 전환)가 문서화됨
- 법령 캐시 메모리와 시스템 운영 메모리가 분리됨
- 고위험 워크플로우(외부 문서 대량 처리)에서 장기 메모리 비활성화 지침 존재

### 1.3 영향·중요도

- 세법 시점 오류 1건 = 가산세·법적 분쟁 위험
- 메모리 독성(memory poisoning) — 과거 잘못된 정보가 미래 답변에 영향
- ECC Security Guide §Memory 기반

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `docs/memory-policy.md` (신규 생성)
- `CLAUDE.md` — §7(개인정보) 및 기존 메모리 관련 규칙 참조

### 2.2 메모리 무효화 트리거

| 트리거 | 대상 메모리 | 조치 |
|---|---|---|
| 세법 개정 공포일 | 해당 조문 캐시 | 즉시 삭제 또는 무효 표시 |
| `[현행]` → `[폐지]` 변경 | 해당 조문 메모리 | 즉시 무효화 |
| 회계 연도 전환 (1/1) | 시점 라벨 캐시 전체 | 재검증 후 갱신 |
| 외부 문서 대량 처리 세션 | 세션 전체 메모리 | 세션 종료 후 격리·폐기 |

### 2.3 메모리 분리 원칙

```
user-global/
  └ preference.md        # 회계사 응답 톤, 자주 쓰는 양식

project-shared/
  └ system-ops.md        # 시스템 운영 정보 (비법령)

법령 캐시 (별도 관리)
  └ TTL = 해당 조문 시행기간
  └ 개정 시 즉시 무효화
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `docs/memory-policy.md` 신규 생성

### 3.2 금지되는 변경

- ❌ 기존 메모리 파일(`~/.claude/projects/.../memory/`) 직접 수정
- ❌ `CLAUDE.md` 수정 (정책은 별도 문서로 분리)
- ❌ `src/` 하위 소스코드 수정

---

## 4. Strategy (구현 힌트)

1. `docs/memory-policy.md`에 다음 작성:
   - 메모리 타입별 분리 정책
   - 무효화 트리거 표
   - 고위험 워크플로우(외부 문서 처리) 시 메모리 비활성화 절차
   - 법령 캐시 TTL 정의

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `docs/memory-policy.md` 존재
2. [ ] 메모리 무효화 트리거 4가지 명시
3. [ ] 메모리 타입 분리 원칙 명시 (user-global / project / 법령캐시)
4. [ ] 고위험 워크플로우에서 메모리 비활성화 방법 기술

---

## 6. Verification (검증 단계)

1. `docs/memory-policy.md` 파일 존재 확인
2. 법령 캐시 TTL 정의 존재 확인
3. 기존 메모리 파일 변경 없음 확인

---

## 7. Risks / Notes

- 실제 메모리 파일 관리는 Claude Code 세션별로 수동 확인 필요
- ECC Security Guide: "장기 메모리는 가솔린 — 잘 쓰면 연료, 새면 화재"
- 법령 개정 공포일 알림을 자동으로 받는 방법은 별도 티켓으로 분리 검토

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] memory-policy.md 목차 초안

→ **인간 승인 후** 파일 생성

### 8.2 코딩 후 제출할 것

- [ ] 생성된 파일 경로
- [ ] 정책 핵심 요약
- [ ] 리포트: `docs/reports/TAX-008_report.md`

---

## 10. Related Tickets

- 선행: TAX-003 (보안 강화 완료 후 메모리 정책 연계)
- 후속: TAX-009 (Observability — 메모리 접근 로깅)
- 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 8

---

## 11. Report Link

Report: `docs/reports/TAX-008_report.md` (미작성)

---

**작성자**: AI (하네스 엔지니어링 보고서 기반)
**작성일**: 2026-05-11
**최종 수정일**: 2026-05-11
