# TAX-6B-8 — FR-18 골든셋 회귀 CI

> 선행: TAX-6B-7 (G-5 폐지 골든셋 실측)
> 목표: master push 시 골든셋 V1~V6 회귀 테스트 자동 실행

---

## 배경

`tests/golden/run_golden.test.ts`가 `eval/golden_*.json`의 저장된 데이터를
`LawVerifierAdapter`만으로 검증한다. 외부 API 호출이 없으므로 API 키 없이도
CI에서 항상 실행 가능하다.

기존 `ci.yml`은 `main`·`develop` 브랜치를 대상으로 하므로 `master` 브랜치를
감시하지 않는다.

---

## 구현 범위 (AI)

1. `.github/workflows/golden.yml` 신규 생성
   - trigger: `master` push + `pull_request` targeting `master`
   - `npm ci` → `npx vitest run tests/golden/run_golden.test.ts --reporter=verbose`
   - 실패 시 `eval/golden_*.json` 아티팩트 업로드 (7일 보관)
2. 티켓·리포트 작성

---

## 합격 기준

- master push 시 golden.yml job이 자동 트리거됨
- API 키 없이 실행 가능 (외부 API 미호출)
- 골든셋 V1~V6 검증 실패 시 CI 실패로 표시

---

## 파일

- `.github/workflows/golden.yml` (신규)
- `docs/reports/TAX-6B-8_report.md` (신규)
