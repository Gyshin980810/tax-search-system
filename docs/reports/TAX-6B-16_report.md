# TAX-6B-16 리포트 — 판례 코퍼스 전량 적재 (PoC 300건 → 10,083건)

- **티켓**: `docs/tickets/TAX-6B-16_precedent_full_load.md`
- **브랜치**: `feat/tax-6b-16-precedent-full-load`
- **작업일**: 2026-06-18
- **선행**: TAX-6B-13(판례 PoC), TAX-6B-14(판례 라이브 배선), TAX-6B-15(voyage-4 전환)
- **회계사 결정(2026-06-18)**: ①적재 범위 = 전량 10,083건(대법원+하급심) ②6B-13 변환기 master 반영 후 적재 ③정확도 정량 회귀(reviewPhase6a) = 생략(LLM 과금)

---

## 1. 변경 사항 요약

### 파일 변경 목록
- `scripts/convertPrecedentMd.ts` (master 반영 + 수정) — `--all`(세무 전체)·`--out`(출력 경로) 모드 추가, 순수 함수 무변경
- `scripts/precedentRelevanceProbe.ts` (master 반영, 6B-13에서 가져옴)
- `tests/unit/convertPrecedentMd.test.ts` (master 반영, 6B-13에서 가져옴)
- `package.json` (수정) — `convert:precedent`·`probe:precedent` 스크립트 추가
- `.gitignore` (수정) — `precedent_*.json`(대용량)·`scripts/_*` 임시 파일 제외
- `docs/tickets/TAX-6B-16_precedent_full_load.md` (신규)
- `scripts/precedent_full.json` (생성물 95MB, git 미커밋)

### 주요 변경 (동작)
1. **사전 확인 — 머지 범위 축소**: 판례 검색 배선(6B-14)은 이미 master에 머지돼 있었음(PR #8 동봉). master에 없던 것은 변환기(6B-13)뿐 → **전체 브랜치 머지 대신 변환기 파일만 반영**(충돌 0건).
2. **변환기 전량 모드**: `--all` 시 `세무/대법원`+`세무/하급심` 순회, 상한 없음(`Infinity`). 기존 PoC 동작(`--source`/`--limit`/`--dry-run`)은 보존.
3. **전량 변환**: 10,083건 변환, 스킵 0건(선고일 1957-05-03 ~ 2026-04-16, 본문 평균 4,062자).
4. **판례 명시적 교체**: 기존 판례를 `DELETE WHERE source_type='판례'` 후 전량 재적재. 심판례 83·해석례 3건은 보존.

### 데이터 안전 (CLAUDE.md 정합)
- **다른 법령 혼입 방지**: 소스 경로를 `세무/대법원`·`세무/하급심`으로 명시 제한 — 형제 폴더(가사·민사·형사·특허 등) 제외. frontmatter `사건종류: 세무`가 이중 안전장치.
- **§6.1 인용 무결성**: content를 .md 원문 그대로 저장(임베딩 입력만 6,000자 절단, 저장 본문은 무절단 — DB max_len 65,785자 확인).

---

## 2. 적재 중 발견·조치 (PoC 중복 처리)

- **현상**: 전량 적재 초기 배치가 스킵되지 않고 신규 적재됨. 기대(PoC 303건과 겹쳐 스킵)와 불일치.
- **원인**: PoC(6B-13/15) 적재 시점과 현재 `embed.ts`의 content 저장·`content_hash` 산정 방식 차이로 동일 판례라도 hash 불일치.
- **조치**: 적재 중단 → 판례만 명시적 삭제(`source_type='판례'`, 1,283건) → 전량 깨끗이 재적재. `content_hash` 우연 일치에 의존하지 않고 "판례만 교체"(회계사 결정)를 명시적으로 보장.

---

## 3. 검증 결과

| 단계 | 결과 |
|---|---|
| `npm run typecheck` | ✅ 0 에러 |
| `npm run test` | ✅ **652/652 PASS** (기존 639 + 변환기 13) |
| `--all --dry-run` 변환 | ✅ 10,083건 / 스킵 0 |
| pgvector 최종 분포 | ✅ 판례 **10,075** + 심판례 83 + 해석례 3 / embedding 차원 **1024**(voyage-4) |
| `npm run smoke:vector` | ✅ PASS — 판례가 비법령 질의 의미검색 상위 반환, 비법령 전용 질의 `matchStage=vector` 정상 발동 |
| `npm run perf:p95` | ⏭️ 생략 (회계사 결정 2026-06-18 — LLM 과금. P95는 적재량 무관·병목=답변 LLM·이번 작업 무변경, voyage 검증은 6B-15에서 완료) |
| 정확도 정량 회귀 | ⏭️ 생략 (회계사 결정 — LLM 과금) |

> **변환 10,083건 vs 적재 10,075건(8건 차이)**: `content_hash` UNIQUE 제약으로 **동일 본문 중복 8건이 스킵**됨(데이터 무결성상 정상 — 중복 제거). 심판례 83·해석례 3건은 그대로 보존.

---

## 4. 잠재 위험 / 후속

- **`precedent_full.json`(95MB)**: git 미커밋(`.gitignore` 처리). 재현 시 `npm run convert:precedent -- --all`로 재생성.
- **적재 시간**: 약 505배치(BATCH_SIZE=20). 중단 시 `content_hash`로 재실행 안전.
- **임시 파일 정리**: `scripts/_dbcount.mjs`·`_resetPrecedent.mjs`·`_embed_full.log`는 작업 후 삭제.
- **P95**: 적재량과 무관(병목=답변 생성 LLM). voyage 전환 확인 목적의 재측정.

---

**작성자**: AI (Claude Code) + 회계사 승인
**작성일**: 2026-06-18
