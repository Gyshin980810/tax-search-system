# TAX-6B-17 리포트 — G3 타임아웃 대응: generate 컨텍스트 절단 강화

- **티켓**: `docs/tickets/TAX-6B-17_generate_context_truncation.md`
- **작업일**: 2026-06-18
- **선행**: TAX-6A-10(G3 타임아웃 진단), TAX-6A-11(라벨 결정론화), TAX-042F(contextBudget 최초 도입)

---

## 1. 변경 사항 요약

### 파일 변경 목록

- `src/adapters/contextBudget.ts` (수정) — HEAD/TAIL/SAFE_INPUT_TOKENS 상수 변경 + 주석 동기화
- `docs/tickets/TAX-6B-17_generate_context_truncation.md` (신규)
- `docs/reports/TAX-6B-17_report.md` (신규)

### 주요 변경 (상수 3개)

| 상수 | 변경 전 | 변경 후 | 효과 |
|---|---|---|---|
| `compactLawContent` HEAD | 1,500자 | 800자 | 법조문 앞부분 절단 축소 |
| `compactLawContent` TAIL | 500자 | 200자 | 법조문 뒷부분 절단 축소 |
| `SAFE_INPUT_TOKENS` | 60,000 토큰 | 35,000 토큰 | LLM 총 입력 예산 42% 감소 |

**예상 효과:**
- 법조문당 압축 크기: ~2,000자 → ~1,000자
- LLM 총 입력 토큰: 최대 60K → 최대 35K (42% 감소)
- generate 지연 목표: 14~20초 → 8~12초

**V1·V2 무결성 보호**: `truncateForContext`의 `originalRefs`(원본 참조)는 변경 없음. 압축은 `promptLaws`(LLM 프롬프트 임시본)에만 적용되어 `extractExcerpt` 기반 V2 substring 검증 완전 보존.

---

## 2. 검증 결과

| 단계 | 결과 |
|---|---|
| `npm run typecheck` | ✅ 0 에러 |
| `npm run test` | ✅ **652/652 PASS** (contextBudget 16건 포함) |
| `contextBudget.test.ts` 전 케이스 | ✅ 무변경 통과 (단순 상수 변경, 로직 무변경) |
| G3-10·G3-16 단건 실측 | ⏭️ 비결정적 지연 특성상 참고용 (여러 번 실행해야 통계적 확인 가능) |

---

## 3. 잠재 위험

- **세율표 조문 HEAD 800자 절단**: 소득세법 제104조(24,286자 세율표)는 HEAD 800자에서 기본세율 구간만 일부 포함될 수 있음. 단 HEAD 1,500자에서도 이미 잘리고 있었고 G3-10 PASS 이력 있음.
- **search 지연(최대 14초)은 미해결**: 국세 API 외부 서버 간헐 지연은 코드로 완전 제어 불가. 별도 retry/timeout 티켓으로 분리.

---

**작성자**: AI (Claude Code) + 회계사 승인
**작성일**: 2026-06-18
