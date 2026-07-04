# TAX-6B-34 구현 리포트 — 심판례 주간 증분 수집

**작성일**: 2026-07-04 | **상태**: 구현 완료 | **티켓**: docs/tickets/TAX-6B-34_tribunal_incremental_sync.md

---

### 변경 사항 요약

**파일 변경 목록:**
- `scripts/collectTribunal.ts` (수정) — `--incremental` 모드 추가, 공용 헬퍼(`fetchJsonWithRetry`·`runPool`) export
- `tests/unit/collectTribunal.test.ts` (수정) — `splitKnownNew` 테스트 5건 추가
- `docs/tickets/TAX-6B-34_tribunal_incremental_sync.md` (수정) — 설계 보강·상태 갱신

**주요 변경:**
- `npm run collect:tribunal -- --incremental`: `sort=ddes` 최신 페이지부터 조회하며
  기지(旣知) 판정 후 **한 페이지 전체가 기지면 조기 종료**. 신규 건만 본문 수집해
  `scripts/tribunal_incremental_<YYYYMMDD>.json`(embed.ts 입력 포맷)에 기록.
- **기지 판정 = 원장(scripts/tribunal/list.json) ∪ DB**(페이지 단위 `ANY($1)` 질의).
  DB 단독으로는 content_hash dedup으로 전용 행이 없는 병합 사건번호 3,981건이 매주
  "신규"로 오인돼 조기 종료가 무력화되기 때문(티켓 §4.1). 성공 항목은 원장에 추가돼
  자가 치유. DB 질의는 `withRetry`(embed.ts 재사용)로 Neon 순단에 대비.
- `--max` 테스트 실행은 원장을 갱신하지 않음(임베딩 없이 버린 건의 영구 누락 방지).

**검증 결과:**
1. `npm run typecheck` — 0 오류
2. `npm run test` — vitest **718/718 통과** (신규 24건 포함)
3. **실 API·DB 스모크**(`--incremental --max 5`, 2026-07-04): 원장 139,840건 로드 →
   1페이지에서 신규 41건 감지(전량 수집 후 실제로 새로 공개된 결정례) → 5건 본문 수집
   성공(조심 2026부0166 등, 본문 9,734~29,906자) → 산출물 필드·포맷 embed 호환 확인
4. §7 키 보호 — 산출물 전체에 `OC=` 미노출, sourceUrl은 키 없는 공개 뷰어 링크
5. §6.1 — content는 주문+재결요지+이유 원문 그대로(기존 parseBody 재사용, 변형 0)

**잠재 위험:**
- API가 뒤늦게 공개하는 **과거 의결일자 심판례**는 최신순 조기 종료에 걸리지 않아 놓칠 수
  있음(날짜 필터 미지원 API의 구조적 한계). 의심 시 연 1회 전량 재수집으로 보정 가능.
- 회계사가 수집 후 임베딩을 건너뛰면 원장에는 있고 DB에는 없는 건이 생김 —
  **수집→임베딩 두 명령은 항상 짝으로 실행**할 것(아래 주간 루틴).

**주간 실행 루틴(수동, 매주 1회 — 회계사 결정):**
```
npm run collect:tribunal -- --incremental
npm run embed -- --input scripts/tribunal_incremental_<YYYYMMDD>.json
```

**리포트:** docs/reports/TAX-6B-34_report.md (본 문서) · 짝 티켓: TAX-6B-35(판례)
