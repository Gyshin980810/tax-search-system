# TAX-6B-4 즐겨찾기·북마크 (FR-12)

## Metadata
- **Type**: FEAT
- **Severity**: minor
- **Layer**: ui
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S

## 1. Problem
자주 사용하는 세법 질문을 매번 재입력해야 한다. 검색 결과를 북마크로 저장하고 목록에서 재실행하는 기능이 없다.

## 2. Scope
### 2.1 허용
- `src/utils/bookmarkStore.ts` — CRUD + PII 마스킹 (신규)
- `app/components/BookmarkList.tsx` — 접힘/펼침 목록 (신규)
- `app/components/AnswerCard.tsx` — 즐겨찾기 토글 버튼
- `app/page.tsx` — BookmarkList 삽입 (최소 변경)
- 테스트 파일 3건

### 2.2 금지
- ❌ 서버사이드 저장 (localStorage만)
- ❌ 북마크에 PII 원문 저장 (§7)
- ❌ law-verifier 영향

## 3. Acceptance Criteria
1. [ ] AnswerCard 요약 영역 우측에 ☆/⭐ 토글 버튼
2. [ ] 클릭 시 localStorage 저장·제거
3. [ ] BookmarkList: 북마크 있을 때만 표시, 접힘/펼침
4. [ ] 항목 클릭 시 onSelect 호출, 제거 버튼 동작
5. [ ] 저장 전 maskPhoneEmail 적용 (§7)
6. [ ] vitest 전체 GREEN

## 4. Related
- 참조: CLAUDE.md §7, FR-12
- 선행: TAX-6B-3 / 후속: TAX-6B-5

**작성자**: Claude (AI) / **작성일**: 2026-06-14
