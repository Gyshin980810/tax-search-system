# TAX-6B-5 리포트 — UI 다듬기 (접근성·단축키)

**작성일:** 2026-06-14
**담당:** Claude (AI)

---

## 1. 변경 사항 요약

**파일 변경 목록:**
- `app/components/AnswerCard.tsx` (수정) — `LABEL_TITLES`·`TIER_TITLES` + title/cursor-help + role="article"
- `app/components/SearchBar.tsx` (수정) — form aria-label, input ARIA, Escape·Ctrl+K

**주요 변경:**
1. 라벨·Tier 배지에 `title` 툴팁 — 마우스오버 시 의미 설명(예: "유사 사례: 논리적으로 유사하나 단정 금지")
2. citation 카드에 `role="article"` + `aria-label="인용 N: 법령명 조문번호"` — 스크린리더 내비게이션 지원
3. SearchBar form에 `aria-label="세법 검색"`, input에 `role="combobox"` / `aria-autocomplete="list"` / `aria-expanded`
4. 드롭다운 `ul`에 `role="listbox"` / `aria-label="최근 검색어"`, 항목 `li`에 `role="option"`
5. `Escape` 키 → 드롭다운 즉시 닫힘
6. `Ctrl+K`(Cmd+K) → 검색 입력란 포커스 (전역 단축키)

---

## 2. 검증 결과

1. **`npx vitest run tests/unit/AnswerCard.test.tsx`** — 라벨 title·role="article" 포함 **9/9 PASS**
2. **`npx vitest run tests/unit/SearchBar.test.tsx`** — Escape·Ctrl+K·aria 포함 **14/14 PASS**
3. **`npx tsc --noEmit`** — 타입 에러 0
4. **`npx vitest run`** — **전체 545/545 GREEN**

---

## 3. 잠재 위험

- **Ctrl+K 충돌**: 일부 브라우저 확장(예: 개발자도구, 검색 바)이 Ctrl+K를 점유할 수 있음. 운영 환경 확인 권장.
- **육안 검증 미실시**: `npm run dev` 실제 툴팁 표시·포커스 동작은 회계사 운영 환경 확인 권장.

**리포트:** docs/reports/TAX-6B-5_report.md
