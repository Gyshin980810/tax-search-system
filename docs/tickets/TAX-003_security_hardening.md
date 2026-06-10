# [TAX-003] 보안 강화 — Lethal Trifecta 차단

> 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 7
> Phase 1 — 즉시 적용

---

## Metadata

- **Type**: FEAT
- **Severity**: critical
- **Layer**: infra
- **Milestone**: MVP
- **Estimated Size**: S (1~2파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- Claude Code 에이전트의 파일 접근·명령 실행 권한이 제한 없이 열려 있음
- `.env*`, `~/.ssh/`, `~/.aws/` 등 민감 경로에 Read 권한이 암묵적으로 허용
- 외부 API에서 수신한 법령 텍스트가 신뢰할 수 없는 콘텐츠로 컨텍스트에 진입할 수 있음 (Lethal Trifecta 위험)

### 1.2 기대 동작

- `.claude/settings.json`의 `permissions.deny` 규칙으로 민감 경로 Read 차단
- 파이프 실행(`curl | bash`) 등 위험 명령 차단
- WebFetch는 허용 도메인(국세청·지방세 API)만 접근 가능

### 1.3 영향·중요도

- API 키·회계사 자격증명 노출 방지
- 프롬프트 인젝션 발생 시 블래스트 반경 최소화
- ECC Security Guide CVE-2025-59536 등 실제 사례 기반 대응

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `.claude/settings.json` (신규 또는 수정 — permissions 섹션)
- `.env.example` (현행 유지, 실제 `.env.local`은 git 제외 확인)

### 2.2 Lethal Trifecta 위험 구조

```
사적 데이터 (회계사 식별자, API 키)
  +
신뢰 불가 콘텐츠 (외부 API 법령 텍스트)
  +
외부 통신 (LLM 서비스 호출)
  =
프롬프트 인젝션 → 데이터 유출 위험
```

### 2.3 Permissions Deny 대상

```json
{
  "permissions": {
    "deny": [
      "Read(**/.env*)",
      "Read(~/.ssh/**)",
      "Read(~/.aws/**)",
      "Read(**/users/**)",
      "Write(~/.ssh/**)",
      "Write(~/.aws/**)",
      "Bash(curl * | bash)",
      "Bash(ssh *)",
      "Bash(nc *)"
    ]
  }
}
```

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `.claude/settings.json` — `permissions.deny` 규칙 추가
- [ ] `.gitignore` — `.env.local` 포함 여부 재확인 (미포함 시 추가)

### 3.2 금지되는 변경

- ❌ `src/` 하위 소스코드 수정
- ❌ `CLAUDE.md` 수정
- ❌ `.env.example` 실제 값 추가
- ❌ 기존 MCP 설정 변경

---

## 4. Strategy (구현 힌트)

1. `.claude/settings.json`에 `permissions` 섹션 추가 (Hook 설정과 동일 파일)
2. deny 규칙은 "최소 권한" 원칙 — 필요한 것만 열고 나머지 차단
3. `.gitignore`에 `.env.local`, `.env.*.local` 포함 여부 확인

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `.claude/settings.json`에 `permissions.deny` 배열 존재
2. [ ] `Read(**/.env*)` 규칙 포함
3. [ ] `Bash(curl * | bash)` 규칙 포함
4. [ ] `.gitignore`에 `.env.local` 포함 확인
5. [ ] 실제 `.env.local` 파일이 git 추적 목록에 없음 (`git status` 확인)

---

## 6. Verification (검증 단계)

1. `.claude/settings.json` 내 `permissions.deny` 규칙 존재 확인
2. `git check-ignore .env.local` → ignored 출력 확인
3. 기존 기능(`npm run dev`) 정상 작동 확인 (deny 규칙이 정상 동작 차단 않는지)

---

## 7. Risks / Notes

- deny 규칙이 너무 강하면 정상 스크립트도 차단될 수 있음 — 실제 사용 경로 먼저 목록화 후 규칙 적용
- Docker 격리(docker-compose.yml)는 실제 서버 배포 시 적용 — 로컬 개발 단계에서는 settings.json만으로 충분

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 현재 사용 중인 Bash 명령 경로 목록 (deny 전 화이트리스트 확인용)
- [ ] 기존 `.claude/settings.json` 내용 확인

→ **인간 승인 후** 수정

### 8.2 코딩 후 제출할 것

- [ ] 변경된 규칙 목록
- [ ] 정상 기능 영향 없음 확인
- [ ] 리포트: `docs/reports/TAX-003_report.md`

---

## 10. Related Tickets

- 선행: 없음 (TAX-001, TAX-002와 병렬 가능)
- 후속: TAX-007 (MCP 컨텍스트 관리 — MCP 별 권한 정책)
- 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 7

---

## 11. Report Link

Report: `docs/reports/TAX-003_report.md` (미작성)

---

**작성자**: AI (하네스 엔지니어링 보고서 기반)
**작성일**: 2026-05-11
**최종 수정일**: 2026-05-11
