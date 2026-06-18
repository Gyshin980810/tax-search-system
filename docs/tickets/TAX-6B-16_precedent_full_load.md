# TAX-6B-16 판례 코퍼스 전량 적재 (PoC 300건 → 전량 10,083건)

> TAX-6B-13(판례 PoC)·TAX-6B-15(voyage-4 임베딩 전환)의 후속.
> PoC 규모(최근 대법원 300건)였던 판례 참고 코퍼스를 세무 판례 전량으로 확장한다.

---

## Metadata

- **Type**: FEAT (데이터 적재 / 변환기 정책 변경)
- **Severity**: minor
- **Layer**: scripts / data
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S (변환기 main() 확장 + 전량 변환·적재)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작
- 판례 참고 코퍼스가 **최근 대법원 판례 300건(PoC, TAX-6B-13)**만 적재돼 있다.
- 후보 풀이 작아 일부 질의에서 판례 참고 목록이 빈약할 수 있다.

### 1.2 기대 동작
- `precedent-kr-main/세무` 폴더 전체(**대법원 7,397 + 하급심 2,686 = 10,083건**)를 적재한다.
- voyage-4(1024차원, TAX-6B-15) 임베딩으로 pgvector에 적재한다.

### 1.3 영향·중요도
- 참고 목록(references, trustTier='T4') 후보 풀 대폭 확대 → 판례 참고 품질 향상.
- voyage 첫 2억 토큰 무료라 금전 비용 **$0**.
- P95(응답 속도)는 적재량과 무관(병목=답변 생성 LLM) — 적재 후 voyage 전환 확인용으로만 재측정.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일
- `scripts/convertPrecedentMd.ts` (수정) — `--all`(세무 전체)·`--out`(출력 경로) 모드 추가, 기존 PoC 동작 보존
- `package.json` (수정) — `convert:precedent`·`probe:precedent` 스크립트 추가(TAX-6B-13에서 가져옴)
- `scripts/precedentRelevanceProbe.ts` (신규, 6B-13에서 가져옴) — 관련도 점검용
- `tests/unit/convertPrecedentMd.test.ts` (신규, 6B-13에서 가져옴) — 변환 순수 함수 테스트
- `scripts/precedent_full.json` (생성물, git 미커밋 — 95MB)

### 2.2 사전 확인 (브랜치 정합)
- 판례 검색 배선(TAX-6B-14: `generateAnswer.ts`·`vectorSearch.ts`·`route.ts`·`precedentReferences.test.ts`)은 **이미 master에 머지됨**(PR #8에 동봉).
- master에 없던 것은 변환기(TAX-6B-13)뿐 → 변환기 파일만 가져와 정식 반영.

### 2.3 데이터 안전 (다른 법령 혼입 방지)
- 소스 경로를 `세무/대법원`·`세무/하급심`으로 **명시 제한** — 형제 폴더(가사·민사·형사·특허 등) 제외.
- 각 .md frontmatter `사건종류: 세무`가 이중 안전장치(조세 형사사건도 세무로 분류된 정상 데이터).

---

## 3. Scope (작업 범위)

### 3.1 허용되는 변경
- [x] `convertPrecedentMd.ts`: `--all`·`--out` 모드 추가(순수 함수 무변경)
- [x] `package.json`: `convert:precedent`·`probe:precedent` 스크립트
- [x] 변환기·테스트·probe 파일 master 반영
- [x] 전량 변환(`precedent_full.json`) + pgvector 적재

### 3.2 금지되는 변경
- ❌ `mdToTaxLaw`·`splitFrontmatter`·`parseFrontmatter`·`selectRecentFiles` 순수 함수 변경(회귀 위험)
- ❌ content 가공·요약(§6.1 인용 무결성 — 원문 그대로)
- ❌ 임베딩 어댑터·검색·라벨링·검증 로직 변경
- ❌ 심판례·해석례 데이터 삭제(판례만 확장)

---

## 4. Strategy (구현)

1. **변환기 전량 모드**: `--all` 시 `FULL_SOURCE_DIRS`(대법원+하급심) 순회, 상한 없음(`Infinity`), 출력 `precedent_full.json`.
2. **중복 안전**: `embed.ts`의 `content_hash` 스킵 → 기존 PoC 303건 자동 스킵, 신규만 적재.
3. **심판례·해석례 보존**: 입력 파일에 판례만 있으므로 다른 sourceType 미영향(TRUNCATE 불필요).

---

## 5. Acceptance Criteria (완료 조건)

1. [x] `--all` 변환이 10,083건을 스킵 0건으로 변환한다.
2. [x] pgvector `taxlaw_embeddings`에 판례 10,075건 적재(심판례 83·해석례 3 보존). 변환 10,083건 중 동일 본문 중복 8건은 `content_hash`로 스킵(정상).
3. [x] `npm run typecheck` 0 에러, `npm run test` 전건 PASS(652/652).
4. [x] `npm run smoke:vector` 의미 검색 정상.
5. [~] `npm run perf:p95` — 회계사 결정으로 생략(LLM 과금, 적재량 무관·병목=답변 LLM).

---

## 6. Verification (검증 단계)

1. `npm run typecheck` — 0 에러
2. `npm run test` — 전건 PASS
3. `npm run convert:precedent -- --all --dry-run` — 10,083건/스킵 0 확인
4. `npm run embed -- --input scripts/precedent_full.json` — 적재
5. `npm run smoke:vector` + `npm run perf:p95`
6. **정확도 정량 회귀(reviewPhase6a)는 회계사 결정으로 생략**(LLM 과금)

---

## 7. Risks / Notes (위험·주의사항)

- **대량 적재 시간**: 약 504배치(BATCH_SIZE=20), 수십 분 소요. 중단 시 `content_hash`로 재실행 안전.
- **voyage rate limit**: 결제 수단 등록으로 해제됨(무료 토큰 2억, 비용 $0). 429 시 재실행으로 이어가기.
- **`precedent_full.json`(95MB)**: git 미커밋(대용량) — `.gitignore` 확인.

---

## 8. Related Tickets (관련 티켓)

- 선행: `TAX-6B-13`(판례 PoC), `TAX-6B-14`(판례 라이브 배선), `TAX-6B-15`(voyage-4 전환)

---

## 11. Report Link

Report: `docs/reports/TAX-6B-16_report.md`

---

**작성자**: AI (Claude Code) + 회계사 승인
**작성일**: 2026-06-18
