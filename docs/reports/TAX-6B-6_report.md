# TAX-6B-6 리포트 — G-5 폐지 골든셋 골격 + 로더

**작성일:** 2026-06-14
**담당:** Claude (AI)

---

## 1. 변경 사항 요약

**파일 변경 목록:**
- `eval/golden_repealed.json` (신규) — 10건 골격, `expectedStatus: ''`
- `tests/golden/run_golden.test.ts` (수정) — G-5 로더(6줄 추가)

**주요 변경:**
1. G-5 골격 10건 — 실제 폐지·일몰 세법(조세감면규제법·임시투자세액공제·물품세법·영업세법·개인연금저축공제 등) 질문 구성
2. `sourceLaws: []`, `answer.citations: []`, `answer.summary: ""` — API 원문 지어내기 금지(§6.1)
3. `_note` 필드에 검수 절차 명시 — 실측 방법·PASS/FAIL 기준·채우기 항목
4. run_golden G-5 로더: `expectedStatus === 'PASS' || 'FAIL'`로 필터 → 골격 케이스 자동 제외(테스트 무손상)

**AI 금지 항목 준수:**
- ❌ `expectedStatus` AI 자동 확정 없음 (§8.1)
- ❌ 법령 원문·summary AI 지어내기 없음 (§6.1)

---

## 2. 검증 결과

1. `eval/golden_repealed.json` JSON 구문 유효
2. **`npx vitest run tests/golden/run_golden.test.ts`** — 545케이스 유지 **(G-5 0건 추가 — 정상)**
3. **`npx tsc --noEmit`** — 타입 에러 0
4. **`npx vitest run`** — **전체 545/545 GREEN**

---

## 3. 다음 단계 (TAX-6B-7 회계사 게이트)

회계사 검수 후 G-5 케이스에 sourceLaws·citations·expectedStatus 확정 → TAX-6B-8 회귀 CI.

**리포트:** docs/reports/TAX-6B-6_report.md
