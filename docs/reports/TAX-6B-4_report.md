# TAX-6B-4 리포트 — 즐겨찾기·북마크 (FR-12)

**작성일:** 2026-06-14
**담당:** Claude (AI)

---

## 1. 배경 및 목표

자주 질의하는 세법 질문을 localStorage 북마크로 저장하고 목록에서 재실행할 수 있도록 한다. 개인정보 저장 금지 원칙(§7)에 따라 저장 전 마스킹 적용.

---

## 2. 변경 사항 요약

**파일 변경 목록:**
- `src/utils/bookmarkStore.ts` (신규) — BookmarkEntry CRUD, maskPhoneEmail 자동 적용
- `app/components/BookmarkList.tsx` (신규) — 접힘/펼침 목록 UI
- `app/components/AnswerCard.tsx` (수정) — ☆/⭐ 토글 버튼 + useState/useEffect
- `app/page.tsx` (수정) — `<BookmarkList onSelect={...} />` 삽입
- `tests/unit/bookmarkStore.test.ts` (신규) — CRUD + PII 마스킹 10건
- `tests/unit/BookmarkList.test.tsx` (신규) — 컴포넌트 6건
- `tests/unit/AnswerCard.test.tsx` (수정) — 즐겨찾기 describe 4건 추가

**주요 변경:**
1. `bookmarkStore.ts` — `addBookmark`·`isBookmarked`·`removeBookmark` 모두 `maskPhoneEmail`을 내부 적용해 §7 준수. 외부 호출자가 마스킹 여부를 신경 쓸 필요 없음.
2. `AnswerCard.tsx` — PASS 게이트 통과 후 요약 영역에 토글 버튼. `useEffect`로 마운트 시 isBookmarked 동기화.
3. `BookmarkList.tsx` — 북마크 0건이면 `null` 반환(page.tsx 내 불필요한 공백 없음).
4. `page.tsx` — SearchBar 직하단에 삽입(2줄 변경).

**범위 준수:**
- law-verifier 무영향
- 서버사이드 저장 없음
- onSubmit 시그니처 무변경

---

## 3. 검증 결과

1. **bookmarkStore.test.ts** — **10/10 PASS** (CRUD, 마스킹, removeBookmark)
2. **BookmarkList.test.tsx** — **6/6 PASS** (접힘/펼침, 선택, 제거, 마지막 항목 제거 후 패널 소거)
3. **AnswerCard.test.tsx** — **7/7 PASS** (기존 3 + 북마크 4 추가)
4. **`npx tsc --noEmit`** — 타입 에러 0
5. **`npx vitest run`** — **전체 539/539 GREEN**

---

## 4. 잠재 위험

- **BookmarkList onSelect ↔ SearchBar 비동기**: 항목 클릭 시 handleSearch가 직접 호출되지만 SearchBar 입력란은 갱신되지 않음. 기본 UX상 허용 수준(Phase 6B MVP).
- **localStorage 용량**: 북마크 무제한 저장. 추후 최대 개수 제한 추가 검토.
- **육안 검증 미실시**: `npm run dev` 실제 토글·목록 동작은 회계사 운영 환경 확인 권장.

---

## 5. 다음 단계

- TAX-6B-5 UI 다듬기 (라벨 시인성·ARIA·단축키)

**리포트:** docs/reports/TAX-6B-4_report.md
