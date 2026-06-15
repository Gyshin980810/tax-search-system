# TAX-6B-3 최근 검색어 + PII 마스킹 (FR-11)

## Metadata
- **Type**: FEAT
- **Severity**: minor
- **Layer**: ui
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S

## 1. Problem
### 1.1 현재 동작
SearchBar는 검색어를 localStorage에 저장하지 않아 최근 질문을 재입력해야 한다.
PII(주민·사업자번호) 거부는 서버사이드 usecase에서만 처리되어, 클라이언트 즉각 피드백이 없다.
휴대폰·이메일 등 개인식별 정보가 검색어에 포함될 경우 원문 저장 가능성이 있다.

### 1.2 기대 동작
- 검색어를 localStorage에 최대 5개 저장하고 포커스 시 드롭다운으로 표시
- 제출 전 `detectPii`로 선제 거부 + 인라인 에러 표시 (서버 왕복 불필요)
- localStorage 저장 전 `maskPhoneEmail`로 휴대폰·이메일 마스킹 (§7)
- onSubmit에는 원문(마스킹 전) 전달 — 검색 정확도 유지

### 1.3 영향·중요도
개인정보 원문 저장 방지(§7 준수) + 검색 UX 개선 (FR-11).

## 2. Scope
### 2.1 허용
- `src/utils/piiFilter.ts` — `maskPhoneEmail()` 신규 export
- `app/components/SearchBar.tsx` — controlled input + 드롭다운 + PII 인라인 에러
- `tests/unit/maskPhoneEmail.test.ts` — 마스킹 단위 테스트 (신규)
- `tests/unit/SearchBar.test.tsx` — 컴포넌트 동작 테스트 (신규)

### 2.2 금지
- ❌ `detectPii` 로직 변경 (재사용만)
- ❌ 서버사이드 PII 검사 제거 (클라이언트 검사는 추가 계층, 대체 아님)
- ❌ `onSubmit`에 마스킹된 문자열 전달 (검색 정확도 저하)
- ❌ localStorage에 원문 저장 (§7)

## 3. Acceptance Criteria
1. [ ] 정상 검색어 제출 시 localStorage에 마스킹본 저장, onSubmit에는 원문 전달
2. [ ] 주민·사업자번호 포함 시 `pii-error` 표시, onSubmit 미호출
3. [ ] 포커스 시 최근 검색어 드롭다운 표시, 항목 클릭 시 입력란 채움
4. [ ] 최대 5개 저장 (초과 시 가장 오래된 것 제거)
5. [ ] 휴대폰 번호·이메일 마스킹 후 저장 (원본 미보관)
6. [ ] `npx vitest run` 전체 GREEN

## 4. Related
- 참조: CLAUDE.md §7, FR-11
- 선행: TAX-6B-2 / 후속: TAX-6B-4

**작성자**: Claude (AI) / **작성일**: 2026-06-14
