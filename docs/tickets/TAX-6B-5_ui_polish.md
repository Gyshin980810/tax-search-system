# TAX-6B-5 UI 다듬기 (라벨 시인성·접근성·단축키)

## Metadata
- **Type**: FEAT
- **Severity**: minor
- **Layer**: ui
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S

## 1. Scope
### 1.1 허용
- `app/components/AnswerCard.tsx` — 라벨/Tier 배지 title 툴팁, citation 카드 role="article"
- `app/components/SearchBar.tsx` — form aria-label, input role/aria-expanded/aria-autocomplete, Escape·Ctrl+K 단축키
- 테스트 추가 (AnswerCard·SearchBar)

### 1.2 금지
- ❌ law-verifier V1~V6 판정 로직 변경
- ❌ SearchBar onSubmit 시그니처 변경

## 2. Acceptance Criteria
1. [ ] 라벨 배지 hover 시 title 툴팁 표시
2. [ ] citation 카드 role="article"
3. [ ] form aria-label="세법 검색", input role="combobox"
4. [ ] Escape 키 → 드롭다운 닫힘
5. [ ] Ctrl+K → 검색 입력란 포커스
6. [ ] vitest 전체 GREEN

**작성자**: Claude (AI) / **작성일**: 2026-06-14
