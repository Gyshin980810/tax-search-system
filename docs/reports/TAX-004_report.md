# TAX-004 구현 리포트 — Skills 디렉토리 구축

> 완료일: 2026-05-12
> Phase: 2 / Step 1

---

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `.claude/skills/tax-search/SKILL.md` | 신규 생성 |
| `.claude/skills/tax-search/references/law-api-schema.md` | 신규 생성 |
| `.claude/skills/tax-search/references/query-patterns.md` | 신규 생성 |
| `.claude/skills/tax-verify/SKILL.md` | 신규 생성 |
| `.claude/skills/tax-verify/references/v1-source-check.md` | 신규 생성 |
| `.claude/skills/tax-verify/references/v2-citation-integrity.md` | 신규 생성 |
| `.claude/skills/citation-format/SKILL.md` | 신규 생성 |
| `.claude/skills/trust-tier/SKILL.md` | 신규 생성 |

---

## Skills 디렉토리 구조

```
.claude/skills/
  tax-search/
    SKILL.md                          ← 검색 단계 워크플로우 (3단계)
    references/
      law-api-schema.md               ← TaxLaw[] 필드 정의 + TypeScript 타입
      query-patterns.md               ← 자연어→API 쿼리 변환 패턴 10가지
  tax-verify/
    SKILL.md                          ← V1~V6 검증 절차 체크리스트
    references/
      v1-source-check.md              ← V1 출처 존재 확인 방법 + 슈도코드
      v2-citation-integrity.md        ← V2 Grep 활용 문자단위 비교 방법
  citation-format/
    SKILL.md                          ← 인용 포맷 6가지 규칙
  trust-tier/
    SKILL.md                          ← T1~T4 분류 기준 + 결정 플로우차트
```

---

## 각 SKILL.md 핵심 내용 요약

### tax-search/SKILL.md
- 3단계 워크플로우: 파라미터 변환 → API 호출 → 결과 반환
- 시점 모호 감지 시 즉시 변환 중단 → 시점 확인 요청 강제화
- 빈 결과 1회 재검색 후 `[]` 반환 (추측 금지)

### tax-verify/SKILL.md
- CLAUDE.md §6.4 V1~V6 체크리스트를 실행 가능한 형태로 재작성
- 각 V 항목: 통과 조건 + 실패 시 처리 방법 + 재시도 정책
- 최종 출력 JSON 형식 명시 (`final_status: PASS | E-VERIFY-FAIL`)

### citation-format/SKILL.md
- 생략 표기 통일: `(…)` 유일 허용 (`...`, `···`, `[중략]` 금지)
- 조문 번호 원문 형식 유지 (`제X조 제Y항 제Z호`)
- 면책 고지 표준 문구 포함

### trust-tier/SKILL.md
- T1~T4 분류 기준 + 라벨 결정 플로우차트
- T1/T2 존재 시 T3/T4 단독 🟢 인용 금지 규칙 명시
- 폐지 처리 (⚫ 라벨) 규칙 포함

---

## 검증 체크리스트

- [x] `.claude/skills/` 아래 4개 디렉토리 + 각 SKILL.md 파일 존재
- [x] `tax-verify/SKILL.md`의 V1~V6가 `CLAUDE.md §6.4`와 일치
- [x] `trust-tier/SKILL.md`의 T1~T4가 `CLAUDE.md §6.2`와 일치
- [x] `citation-format/SKILL.md`에 `(…)` 생략 표기 명시
- [x] `tax-search/references/` 2개 파일 존재 (law-api-schema.md, query-patterns.md)
- [x] `tax-verify/references/` 2개 파일 존재 (v1-source-check.md, v2-citation-integrity.md)

---

## 설계 결정

1. **SKILL.md는 frontmatter 불필요**: 에이전트 파일과 달리 순수 마크다운 체크리스트 형식 — 에이전트가 참조하는 문서이므로 Claude Code가 직접 실행하지 않음
2. **references/ 서브 디렉토리 분리**: SKILL.md는 간결한 워크플로우만, 상세 스키마·예시는 references/에 분리하여 가독성 확보
3. **V1~V6 실행 가능 형태 재작성**: CLAUDE.md §6.4는 정책 문서, SKILL.md는 법 집행 체크리스트 — 실행 관점에서 재작성

---

## 잠재 위험

- SKILL.md는 에이전트가 참조하는 문서이므로 에이전트 실행 시 명시적으로 참조를 지시해야 활용됨
- `law-api-schema.md`의 필드 정의는 실제 외부 API 응답 형식과 맞춰야 함 (TAX-004 이후 API 연동 시 검증 필요)
