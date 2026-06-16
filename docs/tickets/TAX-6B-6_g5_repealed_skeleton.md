# TAX-6B-6 G-5 폐지 골든셋 골격 + 로더

## Metadata
- **Type**: TEST
- **Severity**: minor
- **Layer**: eval
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S

## 1. 목표
`eval/golden_repealed.json`에 폐지·일몰 세법 케이스 10건 골격 작성. run_golden에 G-5 로더 추가.

## 2. Scope
### 2.1 허용
- `eval/golden_repealed.json` (신규) — 10건 골격, `expectedStatus: ''`
- `tests/golden/run_golden.test.ts` — G-5 로더 추가(빈 골격 제외 필터)

### 2.2 금지
- ❌ `expectedStatus` 확정 (§8.1 회계사 게이트)
- ❌ 법령 원문 지어내기 (§6.1)
- ❌ `summary`·`citations.excerpt` AI 자동 생성

## 3. G-5 케이스 목록

| ID | 대상 조항 | 폐지 유형 |
|---|---|---|
| G5-01 | 조세감면규제법 | 전부폐지 (1998) |
| G5-02 | 조특법 임시투자세액공제 | 일몰종료 (2011) |
| G5-03 | 물품세법 | 전부폐지 (1977) |
| G5-04 | 영업세법 | 전부폐지 (1977) |
| G5-05 | 소득세법 구 개인연금저축 소득공제 | 조항삭제 (2014 전환) |
| G5-06 | 조특법 구 고용창출투자세액공제 | 일몰종료 |
| G5-07 | 구 부가가치세법 (2013 전부개정 이전) | 전부개정폐지 |
| G5-08 | 조특법 구 해외자원개발투자 세액공제 | 일몰종료 |
| G5-09 | 소득세법 구 비과세 이자·배당 특례 | 조항삭제 |
| G5-10 | 조특법 구 기업도시 세액감면 | 일몰종료 |

## 4. Acceptance Criteria
1. [x] `eval/golden_repealed.json` 10건 존재
2. [x] `expectedStatus: ''` (회계사 검수 전 — 실행 제외)
3. [x] run_golden에 G-5 로더 추가, 빈 골격 필터
4. [x] `npx vitest run` 전체 GREEN (새 케이스 0건 추가 — 정상)

## 5. 다음 단계 (TAX-6B-7 회계사 게이트)
회계사가 실제 시스템으로 각 질문 실측 후:
1. `sourceLaws` 채우기 (API 응답 원문)
2. `answer.citations` 채우기 (⚫폐지 + [폐지: YYYY.MM.DD] 확인)
3. `expectedStatus: 'PASS' | 'FAIL'` 확정
4. `npx vitest run tests/golden/run_golden.test.ts` GREEN 확인

**작성자**: Claude (AI) / **작성일**: 2026-06-14
