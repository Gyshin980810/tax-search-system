# TAX-6B-3 리포트 — 최근 검색어 + PII 마스킹 (FR-11)

**작성일:** 2026-06-14
**담당:** Claude (AI)

---

## 1. 배경 및 목표

SearchBar가 검색어를 저장하지 않아 재입력 불편이 있고, 휴대폰·이메일이 포함된 검색어를 원문 그대로 보관할 가능성이 있었다. 본 티켓에서는 최근 검색어 localStorage 저장·드롭다운 표시와 PII 클라이언트 선제 차단을 구현한다.

---

## 2. 변경 사항 요약

**파일 변경 목록:**
- `src/utils/piiFilter.ts` (수정) — `maskPhoneEmail()` 신규 export
- `app/components/SearchBar.tsx` (수정) — controlled input + 드롭다운 + PII 인라인 에러
- `tests/unit/maskPhoneEmail.test.ts` (신규) — 마스킹 단위 테스트
- `tests/unit/SearchBar.test.tsx` (신규) — 컴포넌트 동작 테스트
- `docs/tickets/TAX-6B-3_recent_queries_pii_masking.md` (신규)

**주요 변경:**
1. `maskPhoneEmail(text)` — 한국 휴대폰(010-XXXX-XXXX 등)·이메일 정규식 마스킹. `piiFilter.ts`에 추가해 단일 PII 관련 모듈로 응집.
2. SearchBar: `question` controlled input + `useEffect`로 localStorage 로드 + 포커스 시 드롭다운 표시
3. 제출 흐름: `detectPii` 선제 거부(주민·사업자번호) → `maskPhoneEmail` 마스킹 후 localStorage 저장 → `onSubmit`에는 원문 전달(검색 정확도 유지)
4. PII 거부 시 `data-testid="pii-error"` 인라인 에러 표시, 입력 변경 즉시 소거

**범위 준수:**
- 서버사이드 PII 검사(`detectPii` in usecases) 무변경
- `onSubmit` 시그니처 무변경
- law-verifier V1~V6 무영향

---

## 3. 검증 결과

1. **`npx vitest run tests/unit/maskPhoneEmail.test.ts tests/unit/SearchBar.test.tsx`** — **20/20 PASS**
   - 휴대폰 하이픈·점·공백·구번호 마스킹
   - 이메일 마스킹 + 도메인 유지
   - 마스킹 불필요 케이스 원본 반환
   - PII 입력 거부 + 인라인 에러
   - localStorage 최대 5개 저장 + 최신 우선
2. **`npx tsc --noEmit`** — 타입 에러 0 (EXIT 0)
3. **`npx vitest run`** — **전체 520/520 GREEN** (run_golden 회귀 무손상)

---

## 4. 잠재 위험

- **클라이언트 선제 거부 의존 금지**: 클라이언트 PII 차단은 편의 계층이며 서버사이드 `detectPii` 가 최종 방어선. 서버 검사를 제거해서는 안 됨.
- **마스킹 우회 미방어**: `maskPhoneEmail`은 정규식 기반으로 새로운 포맷(VoIP 등)은 커버하지 않을 수 있음. 주민·사업자번호는 `detectPii`가 입력 자체를 차단해 더 강한 보호.
- **육안 검증 미실시**: `npm run dev` 실제 드롭다운 동작은 회계사 운영 환경 확인 권장.

---

## 5. 다음 단계

- TAX-6B-4 즐겨찾기·북마크 (FR-12)

**리포트:** docs/reports/TAX-6B-3_report.md
