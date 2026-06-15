# TAX-6B-7 — G-5 폐지 골든셋 실측 + 회계사 검수

> 선행: TAX-6B-6 (G-5 골격 10건 작성)
> 목표: 실측 스크립트로 10건 API 호출 → sourceLaws·citations·summary 자동 채움
>       → 회계사가 결과 검수 후 expectedStatus 확정

---

## 배경

`eval/golden_repealed.json`에 G-5 폐지 케이스 10건 골격이 있다.
각 케이스의 `sourceLaws`, `answer.citations`, `answer.summary`는 실제 API 호출 결과로 채워야 하며,
`expectedStatus` 확정은 §8.1에 따라 **회계사 권한**이다.

---

## 구현 범위 (AI)

1. `scripts/diagnostics/run_g5_realtest.mjs` 작성
   - G-5 10건을 RAG 파이프라인([1]~[4])으로 순차 실행
   - 결과를 `eval/golden_repealed.json`에 자동 업데이트 (sourceLaws·answer 채움)
   - expectedStatus는 `""` 유지
2. 스크립트 실행 → JSON 업데이트 완료
3. 실측 결과 콘솔 요약 출력

## 회계사 검수 범위

- 실측 후 `eval/golden_repealed.json` 확인
- 각 케이스별 `_note`를 참조해 summary·라벨 적정성 검토
- `expectedStatus`를 `"PASS"` 또는 `"FAIL"`로 확정

---

## 합격 기준

- 10건 중 expectedStatus가 확정되면 `run_golden.test.ts`에서 자동 포함

---

## 파일

- `scripts/diagnostics/run_g5_realtest.mjs` (신규)
- `eval/golden_repealed.json` (업데이트)
- `docs/reports/TAX-6B-7_report.md` (신규)
