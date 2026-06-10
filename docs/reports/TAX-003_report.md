# TAX-003 구현 리포트 — 보안 강화 (Lethal Trifecta 차단)

> 완료일: 2026-05-12
> Phase: 1 / Step 3

---

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `.claude/settings.json` | `permissions.deny` 섹션 추가 |
| `.claude/settings.local.json` | `permissions.allow` 개발 예외 추가 (기존 MCP 설정 보존) |
| `.gitignore` | 프로젝트 루트에 신규 생성 |

---

## permissions.deny 규칙 목록 (9개)

| 규칙 | 차단 대상 |
|---|---|
| `Read(**/.env*)` | .env, .env.local 등 환경 변수 파일 |
| `Read(~/.ssh/**)` | SSH 개인키·설정 |
| `Read(~/.aws/**)` | AWS 자격증명 |
| `Read(**/users/**)` | 사용자 데이터 경로 |
| `Write(~/.ssh/**)` | SSH 설정 쓰기 |
| `Write(~/.aws/**)` | AWS 자격증명 쓰기 |
| `Bash(curl * \| bash)` | 파이프 실행 (공급망 공격 차단) |
| `Bash(ssh *)` | SSH 외부 접속 |
| `Bash(nc *)` | netcat 외부 통신 |

---

## Lethal Trifecta 위험 구조

```
사적 데이터 (회계사 식별자, API 키)
  +
신뢰 불가 콘텐츠 (외부 API 법령 텍스트)
  +
외부 통신 (LLM 서비스 호출)
  =
프롬프트 인젝션 → 데이터 유출 위험
```

settings.json `permissions.deny`로 이 경로의 블래스트 반경을 시스템 수준에서 최소화.

---

## .gitignore 주요 항목

- `.env`, `.env.local`, `.env.*.local` — 환경 변수 파일
- `logs/*.json`, `logs/*.log` — 개인정보 포함 가능 로그
- `.claude/settings.local.json` — 개인 로컬 예외 설정

---

## 검증 체크리스트

- [x] `.claude/settings.json`에 `permissions.deny` 배열 9개 항목 존재
- [x] `Read(**/.env*)` 규칙 포함
- [x] `Bash(curl * | bash)` 규칙 포함
- [x] `agents`, `hooks` 섹션 보존 확인
- [x] `.gitignore`에 `.env.local` 포함
- [x] `.claude/settings.local.json` 기존 MCP 설정 보존 + `permissions.allow` 추가

---

## Phase 1 게이트 확인

| 작업 | 상태 |
|---|---|
| TAX-001: 4-에이전트 분리 구조 | ✅ completed |
| TAX-002: Hooks 자동화 + 스크립트 | ✅ completed |
| TAX-003: 보안 강화 (permissions.deny) | ✅ completed |

**Phase 1 게이트 통과 → Phase 2 진입 가능**
