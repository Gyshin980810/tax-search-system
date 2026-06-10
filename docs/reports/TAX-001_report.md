# TAX-001 구현 리포트 — GAN-스타일 4-에이전트 분리 구조

> 완료일: 2026-05-12
> Phase: 1 / Step 1

---

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `.claude/agents/tax-planner.md` | 신규 생성 |
| `.claude/agents/tax-searcher.md` | 신규 생성 |
| `.claude/agents/tax-generator.md` | 신규 생성 |
| `.claude/agents/law-verifier.md` | 신규 생성 |

---

## 에이전트 구성 요약

| 에이전트 | 모델 | tools | color | 역할 |
|---|---|---|---|---|
| tax-planner | claude-haiku-4-5-20251001 | (없음) | blue | 자연어 → API 파라미터 변환 |
| tax-searcher | claude-haiku-4-5-20251001 | WebFetch | blue | 외부 API 호출, 원문 반환 |
| tax-generator | claude-sonnet-4-6 | Read | blue | TaxLaw[] → 라벨링 + 답변 생성 |
| law-verifier | claude-opus-4-7 | Read, Grep | red | V1~V6 독립 검증 |

---

## 검증 체크리스트

- [x] `.claude/agents/` 아래 4개 파일 존재
- [x] 각 파일 frontmatter에 `tools` / `color` / `model` 항목 존재
- [x] `law-verifier.md` 본문에 V1~V6 체크리스트 전부 포함
- [x] `tax-generator.md`의 `tools`에 Grep 없음 (검증 전담 분리 확인)
- [x] `tools:` 키 사용 (기존 prd-writer.md 형식 준수, `allowed-tools:` 아님)

---

## 주요 설계 결정

1. **에이전트 키 형식**: 티켓에는 `allowed-tools:` 키로 기술되어 있으나, 기존 `prd-writer.md` 형식을 기준으로 `tools:` 키 사용
2. **tax-generator tools**: `Read`만 허용 (원문 파일 참조 용도). `Grep`은 law-verifier 전담으로 분리
3. **law-verifier 독립성**: 생성 에이전트와 별도 인스턴스임을 명시하여 자기 검증 방지

---

## 잠재 위험

- 에이전트 파일은 구조·지시문만 정의하며 실제 오케스트레이션 코드는 TAX-005(Eval Harness)와 연동 필요
- `law-verifier`가 Opus 모델 사용으로 호출 비용 증가 예상 — TAX-006 모델 선택 전략으로 완화 예정
