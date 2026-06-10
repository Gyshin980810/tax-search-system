# [TAX-004] Skills 디렉토리로 도메인 지식 캡슐화

> 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 3
> Phase 2 — M3 마일스톤

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: infra
- **Milestone**: Post-MVP
- **Estimated Size**: M (3~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 세법 도메인 지식(V1~V6 검증 절차, Trust Tier 분류, 인용 포맷 규칙)이 `CLAUDE.md`, `docs/SSOT.md`에 산재
- AI가 매 세션마다 같은 절차를 CLAUDE.md에서 다시 읽어야 해 컨텍스트 낭비
- 검증 항목 추가(V7, V8) 시 CLAUDE.md를 직접 수정해야 하는 구조

### 1.2 기대 동작

- `.claude/skills/` 아래 도메인별 SKILL.md 파일이 존재
- AI가 특정 작업 시 해당 스킬을 자동 로드하여 절차 수행
- 새 검증 항목 추가는 SKILL.md만 수정 (CLAUDE.md 불변)

### 1.3 영향·중요도

- 워크플로우 재사용성 향상 — 국세 → 지방세 → 관세 순서로 확장 시 스킬만 복제
- CLAUDE.md §6.4 V1~V6가 실행 가능한 형태로 존재해야 TAX-005(Eval Harness)가 가능

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `.claude/skills/tax-search/SKILL.md` (신규)
- `.claude/skills/tax-verify/SKILL.md` (신규 — V1~V6 기반)
- `.claude/skills/citation-format/SKILL.md` (신규)
- `.claude/skills/trust-tier/SKILL.md` (신규)

### 2.2 SKILL.md 파일 형식

```markdown
---
name: skill-name
description: 스킬 설명 (한 줄)
allowed-tools: Read, Grep, Bash
---

# 스킬 이름

## 활성화 조건
## 실행 절차
## 출력 포맷
```

### 2.3 소스 문서

- `CLAUDE.md §5` — RAG 5단계 파이프라인 (tax-search 스킬 기반)
- `CLAUDE.md §6.1~6.4` — 4대 규칙 (citation-format, trust-tier, tax-verify 스킬 기반)

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경

- [ ] `.claude/skills/tax-search/SKILL.md` 신규 생성
- [ ] `.claude/skills/tax-verify/SKILL.md` 신규 생성
- [ ] `.claude/skills/citation-format/SKILL.md` 신규 생성
- [ ] `.claude/skills/trust-tier/SKILL.md` 신규 생성

### 3.2 금지되는 변경

- ❌ `CLAUDE.md` 내용 수정 (스킬이 CLAUDE.md를 대체하는 것이 아님)
- ❌ `src/` 하위 소스코드 수정
- ❌ 법령 원문 처리 로직 변경

---

## 4. Strategy (구현 힌트)

1. `tax-search/SKILL.md` — CLAUDE.md §5 RAG 5단계를 실행 절차로 변환
2. `tax-verify/SKILL.md` — CLAUDE.md §6.4 V1~V6를 체크리스트 형태로 변환
3. `citation-format/SKILL.md` — §6.1 인용 무결성 규칙 (부분 인용 `(…)` 통일 등)
4. `trust-tier/SKILL.md` — §6.2 T1~T4 분류 로직 + 라벨 선택 의사결정 트리

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] `.claude/skills/` 아래 4개 폴더·파일 존재
2. [ ] 각 SKILL.md에 frontmatter (`name`, `description`, `allowed-tools`) 포함
3. [ ] `tax-verify/SKILL.md`가 V1~V6를 순서대로 체크리스트로 포함
4. [ ] `trust-tier/SKILL.md`가 T1→T2→T3→T4 우선순위를 명시
5. [ ] 스킬 내용이 CLAUDE.md와 충돌하지 않음 (상위 문서 우선 원칙 유지)

---

## 6. Verification (검증 단계)

1. `.claude/skills/` 폴더에 4개 파일 존재 확인
2. `tax-verify/SKILL.md` 열어 V1~V6 항목 6개 모두 존재 확인
3. `trust-tier/SKILL.md`에서 T1이 T3보다 우선임이 명시되어 있는지 확인
4. 스킬 파일 내용과 CLAUDE.md §6 내용 비교 — 상충 없음 확인

---

## 7. Risks / Notes

- SKILL.md는 CLAUDE.md의 요약·복사본이 아닌 "실행 가능한 절차서"로 작성해야 함
- CLAUDE.md가 헌법이고 스킬은 시행령 수준 — 충돌 시 CLAUDE.md 우선

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 4개 스킬의 `allowed-tools` 및 핵심 절차 초안

→ **인간 승인 후** 파일 생성

### 8.2 코딩 후 제출할 것

- [ ] 생성된 스킬 파일 목록
- [ ] 각 스킬이 대응하는 CLAUDE.md 섹션 매핑표
- [ ] 리포트: `docs/reports/TAX-004_report.md`

---

## 10. Related Tickets

- 선행: TAX-001 (에이전트 구조 확인 후 스킬 구성)
- 후속: TAX-005 (Eval Harness — tax-verify 스킬 기반)
- 참조: `docs/reports/HARNESS-ENGINEERING-ADOPTION_report.md` 방안 3

---

## 11. Report Link

Report: `docs/reports/TAX-004_report.md` (미작성)

---

**작성자**: AI (하네스 엔지니어링 보고서 기반)
**작성일**: 2026-05-11
**최종 수정일**: 2026-05-11
