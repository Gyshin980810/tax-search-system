# [TAX-6B-37] 심판례 참조결정 원천 보존 리포트

> 작성: 2026-07-06 · 상태: **완료** (재수집 139,840건 · 실패 0)

## 1. 요약

심판례 본문 API(`SpecialDeccService`)가 반환하지만 버려지던 **`참조결정` 필드**
(참조 심판례 사건번호 `" / "` 구분 목록)를 `--citation-source` 모드로 재수집해
`scripts/tribunal_citation_source.jsonl`에 보존했다. `content`(§6.1 인용 무결성 계약)는
완전 무변경. TAX-6B-36(판례 참조판례)의 심판례판.

## 2. 결과

| 항목 | 값 |
|---|---:|
| 처리 | 139,840건 (실패 0) |
| 참조결정 보유 | 38,204건 (27.3%) |
| 참조결정 없음 | 101,636건 |

- 산출 형식: JSONL `{seq, caseNumber, referencedDecisions}` — 빈 값 포함 전 seq 기록(done-set 겸용)
- TAX-6B-31은 `referencedDecisions`가 비어있지 않은 행만 소비 → field 엣지 57,871건 생성
- **실측 확인**: 참조결정은 심판례(조심/국심/감심)만 담음 — 대법원 판례 없음 → 심판례→판례는 body 유지

## 3. 트러블슈팅

- 1차 실행이 `Cannot create a string longer than 0x1fffffe8 characters`로 중단
  — `readFileSync`로 2.3GB `records.jsonl`을 통째로 읽던 코드 결함(외부 API 오류 아님).
  `createReadStream` + `readline.createInterface` 스트리밍으로 수정 후 완주(실패 0)
- resume 멱등: 재실행 시 산출 파일의 기존 seq 자동 스킵

## 4. 검증

1. `parseReferencedDecisions` 단위 테스트 3건 GREEN (trim만 적용, 무가공 §6.1)
2. `content` 매핑 무변경 — 전체 vitest 755/755 무회귀
3. LLM·임베딩 호출 없음 (과금 0)

## 5. 관련

- 선례: `TAX-6B-36_precedent_citation_source_fields.md`
- 소비처: `TAX-6B-31_report.md` (citation_edges 적재 완료)
