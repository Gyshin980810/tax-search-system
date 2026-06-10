# TAX-005 구현 리포트 — Eval Harness (pass^3=100% 골든셋)

> 완료일: 2026-05-12
> Phase: 2 / Step 2

---

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `eval/golden-set/G-1_basic-deduction.md` | 신규 생성 |
| `eval/golden-set/G-2_real-estate.md` | 신규 생성 |
| `eval/golden-set/G-3_corporate-tax.md` | 신규 생성 |
| `eval/golden-set/G-4_inheritance.md` | 신규 생성 (2개 서브케이스) |
| `eval/golden-set/G-5_local-tax.md` | 신규 생성 |
| `eval/baseline.json` | 신규 생성 |
| `eval/reports/.gitkeep` | 신규 생성 |
| `scripts/run-eval.js` | 신규 생성 |

---

## pass^k 메트릭 설명

| 메트릭 | 설명 | 적합성 |
|---|---|---|
| **pass@k** | k번 중 1번이라도 성공 | ❌ 부적합 — 한 번 틀리면 회계사가 인용 위험 |
| **pass^k** | k번 모두 성공 | ✅ 적합 — 일관성·신뢰성 보장 |

**baseline.json 설정**: `pass_k: 3, target: 1.0, threshold: 1.0`

---

## 골든셋 케이스 목록

| 케이스 | 설명 | 핵심 검증 포인트 |
|---|---|---|
| G-1 | 소득세법 기본공제 계산 | T1 + 🟢 + [현행] |
| G-2 | 부동산 양도소득세 비과세 요건 | T1(법률+시행령) + 🟢 + [현행] |
| G-3 | 법인세 손금 항목 | T1 복수 조문 + 🟢 + [현행] |
| G-4A | 상속세 기초공제 (현행) | T1 + 🟢 + [현행] |
| G-4B | 상속세 기초공제 (개정 전) | T2 부칙 + ⚫ + [폐지: YYYY] |
| G-5 | 지방세 재산세 납부 기한 | T1(지방세법) + 🟢 + lawType:LOCAL |

> G-4는 [현행]/[폐지] 시점 라벨 분기 검증 목적으로 2개 서브케이스 포함

---

## baseline.json 구조

```json
{
  "pass_k": 3,
  "target": 1.0,
  "threshold": 1.0,
  "cases": {
    "G1": { "question": "...", "expected_laws": [...], "expected_labels": [...] },
    ...
  }
}
```

---

## scripts/run-eval.js 동작

- **입력**: `eval/baseline.json` + `eval/golden-set/*.md`
- **실행 모드**:
  - 기본: 전체 골든셋 k=3 반복 평가
  - `--dry-run`: 구조 검증만 (실제 API 호출 없음)
  - `--case=G1`: 특정 케이스만 실행
- **출력**: `eval/reports/YYYY-MM-DD_eval.md` 리포트
- **종료 코드**: pass^k ≥ threshold → 0, 미달 → 1
- **외부 의존성 없음**: Node.js 내장 `fs`, `path`, `crypto` 모듈만 사용

---

## 검증 결과

| 테스트 | 명령어 | 결과 |
|---|---|---|
| dry-run 구조 검증 | `node scripts/run-eval.js --dry-run` | ✅ PASS (pass^3 = 100.0%) |
| 리포트 생성 확인 | `eval/reports/2026-05-12_eval.md` 파일 존재 | ✅ 확인 |

---

## 검증 체크리스트

- [x] `eval/golden-set/` G-1~G-5 파일 5개 존재 (G-4는 서브케이스 2개 포함)
- [x] `eval/baseline.json`에 `pass_k:3`, `target:1.0` 존재
- [x] `node scripts/run-eval.js --dry-run` → pass^3 = 100.0% + exit 0
- [x] G-4에 `[현행]`/`[폐지]` 라벨 검증 케이스 포함
- [x] `eval/reports/.gitkeep` 존재 (리포트 디렉토리 보존)

---

## 현재 한계 및 M3 이후 작업

- **현재 상태**: `--dry-run` 모드는 구조 검증만 수행 (실제 API 미연동)
- **M3 이후**: `runCase()` 함수에 실제 파이프라인 호출 추가 필요
  - tax-planner → tax-searcher → tax-generator → law-verifier 전체 파이프라인 통과 여부 측정
  - 실제 법령 API 응답으로 V1~V6 검증 수행
- **골든셋 확장**: 실제 회계사 피드백 기반 G-6~G-10 추가 예정

---

## 잠재 위험

- M3 API 연동 이전에는 pass^3 측정이 실질적으로 불가능 — 현재는 인프라만 구축
- G-4B의 폐지 날짜는 실제 API 응답으로 결정되므로 baseline.json에 날짜 미정으로 처리
