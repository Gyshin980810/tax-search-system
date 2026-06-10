# Phase 2: 품질 보증 (3-4주) — M3 마일스톤

> 진입 조건: Phase 1 게이트 통과 (TAX-001~003 모두 completed)
> 목표: 도메인 지식 캡슐화 + pass^3=100% 평가 인프라 + 비용 최적화
> 완료 조건: TAX-004 + TAX-005 + TAX-006 모두 completed
> 다음 단계: Phase 3 진입 (`AGENT/phase3.md` 참조)

---

## TAX-004: Skills 디렉토리 구축 — 도메인 지식 캡슐화

**Phase 2 / Step 1 / TAX-001 완료 후 — TAX-006과 병렬 실행 가능**

### 목적

세법 도메인 워크플로우를 재사용 가능한 번들로 캡슐화.
V7·V8 추가 시 `tax-verify/SKILL.md`만 수정. 타 세목(관세·부가세) 이식 시 `tax-search`만 교체.

### 생성할 디렉토리 구조

```
.claude/skills/
  tax-search/
    SKILL.md              ← 검색 단계 워크플로우
    references/
      law-api-schema.md   ← 국세법령정보시스템 API 응답 스키마
      query-patterns.md   ← 자연어→API 쿼리 변환 패턴 예시 10개+
  tax-verify/
    SKILL.md              ← V1~V6 검증 절차 체크리스트
    references/
      v1-source-check.md  ← V1 출처 존재 확인 방법
      v2-citation-integrity.md ← V2 문자단위 비교 방법
  citation-format/
    SKILL.md              ← 인용 포맷 통일 규칙
  trust-tier/
    SKILL.md              ← T1~T4 분류 로직
```

### 각 SKILL.md 핵심 내용

> SKILL.md는 에이전트 파일과 달리 frontmatter 불필요 — 순수 마크다운 체크리스트

**tax-search/SKILL.md**
- 검색 워크플로우: 자연어 수신 → 법령명·조문번호·키워드 파라미터 추출
- law-api-schema.md: 응답 필드 정의 (law_id, title, content, effective_date 등)
- query-patterns.md: "부가가치세율" → `{ keyword: "부가가치세율", lawType: "TAX" }` 형식 예시

**tax-verify/SKILL.md**
- CLAUDE.md §6.4 V1~V6 체크리스트를 실행 가능한 형태로 재작성
- 각 V 항목: 통과 조건 + 실패 시 처리 방법 명시

**citation-format/SKILL.md**
- 생략 표기: `(…)` 통일 (괄호 안 점 3개)
- 조문 번호 형식: `제X조 제Y항 제Z호`
- 원문 링크 필수 첨부

**trust-tier/SKILL.md**
- T1(법률·시행령·시행규칙 본문) > T2(부칙·경과조치) > T3(예규·해석례) > T4(판례)
- T1·T2 있으면 T3·T4 단독 🟢 인용 금지
- 라벨 색상 규칙: 🟢 직접근거 / 🟡 유사사례 / ⚪ 참고자료 / ⚫ 폐지

### 검증 체크리스트

- [ ] `.claude/skills/` 아래 4개 디렉토리 + 각 SKILL.md 파일 존재
- [ ] `tax-verify/SKILL.md`의 V1~V6가 `CLAUDE.md §6.4`와 일치
- [ ] `trust-tier/SKILL.md`의 T1~T4가 `CLAUDE.md §6.2`와 일치
- [ ] `citation-format/SKILL.md`에 `(…)` 생략 표기 명시
- [ ] `docs/reports/TAX-004_report.md` 작성

---

## TAX-005: Eval Harness 구축 — pass^3=100% 골든셋

**Phase 2 / Step 2 / TAX-001 + TAX-004 완료 후 진행**

### 목적

회계사가 시스템을 "신뢰할 수 있는 도구"로 인식하려면 일관성 보장이 필요.
`pass^k`(k번 모두 성공) 메트릭만이 이를 정량화한다.

> **pass@k** (한 번이라도 성공) ❌ 부적합 — 한 번이라도 틀리면 회계사가 인용할 위험
> **pass^k** (모두 성공) ✅ 적합 — 일관성·신뢰성 보장

### 생성할 디렉토리 구조

```
eval/
  golden-set/
    G-1_basic-deduction.md    ← 소득세법 기본공제 계산
    G-2_real-estate.md        ← 부동산 양도소득세
    G-3_corporate-tax.md      ← 법인세 손금 항목
    G-4_inheritance.md        ← 상속세 시점 분기 (법 개정 전후)
    G-5_local-tax.md          ← 지방세 재산세
  baseline.json               ← pass^k 기준선
  reports/
    .gitkeep
```

### 골든셋 케이스 파일 구조 (3-tuple)

```markdown
## 질문
[회계사가 실제로 할 법한 질문]

## 예상 조문
- 법령명: [조문명]
- 조문 번호: [제X조 제Y항]
- Trust Tier: [T1~T4]

## 예상 라벨
- Trust Tier 라벨: [🟢/🟡/⚪/⚫]
- 시점 라벨: [[현행] 또는 [폐지: YYYY.MM.DD]]
- 검증: V1~V6 모두 PASS
```

> G-4는 법 개정 전후 2개 케이스 포함 (`[현행]`/`[폐지]` 라벨 검증 필수)

### baseline.json 구조

```json
{
  "pass_k": 3,
  "target": 1.0,
  "threshold": 1.0,
  "cases": {
    "G1": { "question": "...", "expected_laws": [], "expected_labels": [] },
    "G2": { "question": "...", "expected_laws": [], "expected_labels": [] },
    "G3": { "question": "...", "expected_laws": [], "expected_labels": [] },
    "G4": { "question": "...", "expected_laws": [], "expected_labels": [] },
    "G5": { "question": "...", "expected_laws": [], "expected_labels": [] }
  }
}
```

### scripts/run-eval.js 구현 지침

```
FOR i in 1..3 (3회 반복):
  FOR each case in G-1~G-5:
    실행 → 결과 수집
CALCULATE: pass_k = 3회 모두 성공한 케이스 수 / 전체 케이스 수
IF pass_k < 1.0:
  process.exit(1) + 실패 케이스 리포트 출력
ELSE:
  eval/reports/YYYY-MM-DD_eval.md 생성
  process.exit(0)
```

### 검증 체크리스트

- [ ] `eval/golden-set/` G-1~G-5 파일 5개 존재
- [ ] `eval/baseline.json`에 `pass_k:3`, `target:1.0` 존재
- [ ] `node scripts/run-eval.js` 실행 → 3회 반복 결과 출력
- [ ] G-4에 `[현행]`/`[폐지]` 라벨 검증 케이스 포함
- [ ] `docs/reports/TAX-005_report.md` 작성

---

## TAX-006: 단계별 모델 선택 전략 적용

**Phase 2 / Step 1(병렬) / TAX-001 완료 후 — TAX-004와 병렬 실행 가능**

### 목적

90% 트래픽을 Haiku/Sonnet으로 처리하여 비용 절감.
검증만 Opus 사용하여 정확도 유지.

### RAG 단계별 모델 매핑

| RAG 단계 | 에이전트 | 모델 | 이유 |
|---|---|---|---|
| [1] 자연어 쿼리 변환 | tax-planner | claude-haiku-4-5-20251001 | 단순 변환, 저렴 |
| [2] 외부 API 검색 | tax-searcher | claude-haiku-4-5-20251001 | HTTP 호출만 |
| [3] 답변 생성·라벨링 | tax-generator | claude-sonnet-4-6 | 복잡한 세법 추론 |
| [4] V1~V6 검증 | law-verifier | claude-opus-4-7 | 정확도 critical |
| [5] UI 포맷팅 | (Orchestrator) | — | 별도 모델 불필요 |

### .claude/settings.json agents 섹션 추가 내용

```json
{
  "agents": {
    "tax-planner": {
      "model": "haiku",
      "description": "단순 쿼리 변환 — 비용 최소화"
    },
    "tax-searcher": {
      "model": "haiku",
      "description": "HTTP 검색 호출만 — 비용 최소화"
    },
    "tax-generator": {
      "model": "sonnet",
      "description": "복잡한 세법 추론 — 충분한 능력"
    },
    "law-verifier": {
      "model": "opus",
      "description": "환각 검증 critical — 정확도 최우선"
    }
  }
}
```

> 기존 prd-writer, security-auditor 등 에이전트 항목 보존 필수
> TAX-003에서 추가된 permissions.deny 섹션도 보존

### Phase 2 완료 게이트

TAX-004, TAX-005, TAX-006 모두 `completed` 상태 확인 후 Phase 3 진입.

### 검증 체크리스트

- [ ] `settings.json` agents에 tax-planner/searcher/generator/verifier 4개 항목
- [ ] `law-verifier` model이 `claude-opus-4-7` (또는 `opus`)
- [ ] `tax-planner`/`tax-searcher` model이 haiku 계열
- [ ] 에이전트 파일 `model:` 과 `settings.json` 설정 일치
- [ ] `docs/reports/TAX-006_report.md` 작성
- [ ] **Phase 2 게이트**: TAX-004~006 모두 completed 상태 확인
