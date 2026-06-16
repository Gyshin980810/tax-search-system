# TAX-6B-8 리포트 — FR-18 골든셋 회귀 CI

> 완료: 2026-06-15
> 선행: TAX-6B-7 (G-5 폐지 골든셋 실측)

---

## 변경 사항 요약

### 파일 변경 목록
- `.github/workflows/golden.yml` (신규) — 골든셋 회귀 CI 워크플로우
- `docs/tickets/TAX-6B-8_fr18_golden_ci.md` (신규)

### 주요 변경

**`.github/workflows/golden.yml`**

```
trigger: master push + pull_request targeting master
job: 골든셋 V1~V6 검증
  → npm ci
  → npx vitest run tests/golden/run_golden.test.ts --reporter=verbose
  → 실패 시 eval/golden_*.json 아티팩트 업로드 (7일 보관)
```

**설계 결정:**
- 기존 `ci.yml`(`main`·`develop` 대상) 수정 없음 — §8.2 티켓 범위 밖 파일 보호
- `NATIONAL_TAX_API_KEY` 불필요 — `run_golden.test.ts`는 저장된 `eval/golden_*.json`을
  `LawVerifierAdapter`만으로 검증 (외부 API 미호출)
- `--reporter=verbose` — 케이스별 PASS/FAIL 명시적 출력으로 회귀 원인 즉시 확인 가능
- 실패 시 `eval/golden_*.json` 아티팩트 업로드 — 디버깅 시 실행 시점 골든셋 파일 보존

---

## 검증 결과

1. `vitest.config.ts` 확인 — `include: ['tests/**/*.test.ts']` 패턴이 `tests/golden/run_golden.test.ts` 포함 ✅
2. API 키 환경변수 없이 실행 가능 구조 확인 ✅ (LawVerifierAdapter만 사용)
3. 기존 `ci.yml` 무변경 확인 ✅

---

## 잠재 위험

- `ci.yml`이 `main`·`develop` 브랜치 대상이므로 `master`에서는 lint·typecheck가 자동으로 실행되지 않음
  (이 티켓 범위 밖 — 별도 `ci.yml` 정비 티켓으로 검토 가능)
- G-5 `expectedStatus` 미확정 케이스는 `run_golden.test.ts`에서 자동 제외되므로 CI에는 영향 없음

---

## 다음 단계

Phase 6B 8개 티켓 전체 완료.

잔여:
- 회계사 G-5 `expectedStatus` 확정 → `run_golden.test.ts` G-5 자동 편입
- Phase 6A 타임아웃 대응 (G3-10·G3-16, 별도 티켓)
- Vercel 배포 (TAX-056 베타 게이트 환경변수 등록)
