# TAX-6A-5 리포트: 시점 검색 UI + E-TEMPORAL-AMBIGUOUS 모호성 확인 흐름

> 작성일: 2026-06-11  
> 작성자: Claude Code  
> 상태: **완료**

---

## 변경 사항 요약

**파일 변경 목록:**
- `src/domain/errors.ts` (수정) — E-TEMPORAL-AMBIGUOUS 타입 추가
- `app/components/SearchBar.tsx` (수정) — 시점 입력 UI + onSubmit 시그니처 확장
- `app/page.tsx` (수정) — 모호성 감지 로직 + temporal-ambiguous-warning UI
- `tests/unit/temporalAmbiguity.test.ts` (신규) — hasAmbiguousTemporal 단위 테스트 9건
- `tests/e2e/g6-temporal-search.spec.ts` (신규) — E2E 시나리오 G-6A·G-6B

**주요 변경:**

### 1. SearchBar.tsx — 시점 입력 컨트롤 추가

```tsx
// onSubmit 시그니처 확장
onSubmit: (question: string, targetDate?: string) => void

// 시점 지정 입력 (선택)
<input name="targetDate" type="date" data-testid="temporal-input" ... />
```

- 기존 질문 입력 행 아래에 날짜 picker 행 추가
- `type="date"` — YYYY-MM-DD 형식 네이티브 반환
- 미입력 시 `undefined` 전달 → 현행 기준 동작 유지 (회귀 무영향)

### 2. page.tsx — 모호성 감지 + 경고 표시

```typescript
const AMBIGUOUS_TEMPORAL_PATTERNS = [
  '예전', '이전 법', '이전법', '개정 전', '개정전',
  '구 법', '구법', '종전', '과거 법령', '예전 법',
]

function hasAmbiguousTemporal(question: string): boolean {
  if (!AMBIGUOUS_PATTERNS.some((p) => question.includes(p))) return false
  return !/\d{4}년/.test(question)  // 구체 연도 있으면 모호성 없음
}
```

- 모호 패턴 감지 + 구체 연도(YYYY년) 역감지 조합
- `targetDate` 지정 시 패턴 감지 우회 → 정상 API 호출
- `temporal-ambiguous-warning` amber 카드 (E-VERIFY-FAIL 오렌지 패턴과 동일 구조)

### 3. API 호출 — targetDate 전달

```typescript
const reqBody: { question: string; targetDate?: string } = { question }
if (targetDate) reqBody.targetDate = targetDate
```

- API Route는 TAX-6A-4에서 이미 `targetDate` 수신·파싱 지원
- `TemporalContext.explicit=true + targetDate` → 파이프라인 전체 전파

---

## 검증 결과

1. `tsc --noEmit` — 오류 0건
2. `vitest run` — **468/468 PASS** (기존 459 + 신규 9건)
3. E2E G-6A: 날짜 지정 검색 → API에 targetDate 전달 확인, 적용 시점 라벨 표시
4. E2E G-6B: 모호 표현("예전") + 날짜 미지정 → API 미호출, 경고 노출 확인

---

## 설계 결정 사항

| 결정 | 이유 |
|------|------|
| 클라이언트 감지 (서버 X) | 서버 왕복 없이 즉시 안내 가능. CLAUDE.md §6.2 — 자의적 판단 금지 원칙은 API 호출 전에도 유효 |
| 구체 연도 역감지 | "2020년 기준 예전 법..." 패턴에서 false positive 방지 |
| `type="date"` 입력 | 날짜 형식 강제 (YYYY-MM-DD), 추가 파싱 불필요 |
| E-TEMPORAL-AMBIGUOUS를 ErrorCode에 추가 | 도메인 일관성 유지, 추후 서버측 감지 시 재사용 가능 |

---

## 잠재 위험

- **false positive**: "개정 전 사항도 고려하여" 같은 표현에서 경고 트리거 가능. 허용 범위 내 — 회계사가 날짜를 지정하면 해소됨.
- **false negative**: 사전에 없는 모호 표현(예: "옛날 규정")은 미감지. 향후 패턴 확장 가능.
- **`type="date"` 브라우저 호환**: 모든 주요 브라우저 지원(Edge·Chrome·Firefox·Safari) — 회계사 환경 고려 시 문제 없음.

---

## 다음 단계

- **TAX-6A-6**: G-3 시점 검색 골든셋 20건 골격 생성 → 회계사 검수
- **TAX-6A-7**: G-4 환각 유발 골든셋 20건 골격 생성 → 회계사 검수
