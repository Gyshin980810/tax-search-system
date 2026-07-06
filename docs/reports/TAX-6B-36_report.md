# TAX-6B-36 구현 리포트 — 판례 수집기 인용 원천 필드 보존

**작성일**: 2026-07-06
**작성자**: Claude Sonnet 5

---

### 변경 사항 요약

**파일 변경 목록:**
- `scripts/collectPrecedent.ts` (수정)
- `tests/unit/collectPrecedent.test.ts` (수정)
- `docs/tickets/TAX-6B-36_precedent_citation_source_fields.md` (신규)
- `docs/tickets/TAX-6B-31_citation_edges_load.md` (수정 — §2.4 실측 보강 반영)
- `docs/tickets/TAX-6B-32_citation_graph_reference_expansion.md` (수정 — `APPEAL` 엣지 제외 방침 반영)

**주요 변경:**
- `parsePrecReferencedCases`·`parsePrecFullContent` 2개 순수함수 추가 — 판례 본문 응답(`PrecService`)에서
  `참조판례`(대법원 인용 구조화 필드)·`판례내용`(판결 전문)을 원문 그대로(trim만) 추출.
- `main()`의 본문 조회 지점에서 **이미 호출 중인 같은 응답을 재사용**해 두 필드를 함께 파싱 —
  추가 API 호출 0건, 과금·요청 수 불변.
- 둘 중 하나라도 값이 있으면 `precedent_citation_source_<date>.json`(`--all`이면
  `precedent_full/` 하위)에 별도 저장. `TaxLaw.content`(검색·답변 경로, 판시사항+판결요지)는
  완전히 그대로 유지 — 이 필드들은 TAX-6B-31 인용 그래프 추출 전용 원천으로만 쓰인다.
- 그래프 엣지 설계 분석(2026-07-06)에서 나온 개선안 4가지를 TAX-6B-31/32 티켓 본문에 반영:
  괄호 그룹 단위 관용구 분류(사슬 오분류 6.2% 해소), 참조판례 필드 1순위 원천화,
  원심(심급) 인용을 `APPEAL`로 분리(1-hop 확장에서 제외), 시간 방향 검증 안전판.

**검증 결과:**
1. `npx tsc --noEmit` — 오류 0
2. `npx vitest run` — 49개 파일 725/725 전체 통과 (신규 테스트 4건 포함, 기존 무회귀)
3. 실 API 호출(`--max` 소규모 테스트)은 회계사 판단으로 보류 — 파서는 오프라인 단위 테스트로만 검증

**잠재 위험:**
- `참조판례`·`판례내용` 필드가 API 응답 스키마 변경 시 이름이 달라질 수 있음(현재는 문자열 키
  직접 접근, 방어적 `?? ''` 처리로 필드 부재 시 안전하게 빈 문자열).
- 판례내용(전문)은 문서당 용량이 커서(실측 표본 7,851자) 대량 수집 시 산출 파일 크기가 커질 수
  있음 — TAX-6B-31 구현 시 스트리밍 처리 필요(이미 §9 계획에 반영됨).

**후속 연계:**
- TAX-6B-31(인용 엣지 적재)이 이 산출물을 판례→판례 엣지의 1순위 원천으로 사용.
- 다음 주간 `npm run collect:precedent` 실행부터 자동으로 산출물이 쌓이기 시작(과거 이미
  적재된 8,353건은 재수집 전까지는 이 원천이 없음 — 필요 시 `--all` 재실행으로 채울 수 있으나
  현재는 회계사 지시 없음, 별도 결정 사항).

**리포트:** 본 파일 (`docs/reports/TAX-6B-36_report.md`)
