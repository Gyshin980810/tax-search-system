# TAX-6B-18B 리포트 — embed.ts 대용량 입력 스트리밍 보강

> TAX-6B-18 [3] 임베딩+적재 단계의 선행 점검·보강.
> 심판례 전량(`scripts/tribunal_full.json` ≈ 2.16GiB)을 적재하기 전,
> `embed.ts`가 대용량 입력을 견디는지 점검하고 스트리밍으로 보강했다.
>
> 작성일: 2026-06-29

---

## 배경 — 왜 이 작업이 필요했나

심판례 수집(TAX-6B-18A)은 이미 완료되어 `scripts/tribunal_full.json`(2.16GiB, 139,840건)이 존재한다.
다음 단계는 `npm run embed`로 이 파일을 voyage-4 임베딩 후 pgvector(Neon)에 적재하는 것이다.

그런데 **결제(voyage·Neon) 전에 코드 점검**에서 치명적 문제를 발견했다.

- 기존 `embed.ts`는 입력 파일을 `JSON.parse(readFileSync(inputFile, 'utf8'))`로 **통째로** 읽었다.
- Node(V8)의 문자열 한계는 **536,870,888자 ≈ 0.50 GiB**(실측 `buffer.constants.MAX_STRING_LENGTH`).
- 입력 파일은 **2.16 GiB**로 한계의 약 **4.3배** → 실행 즉시 `Cannot create a string longer than...`로 사망.

즉, voyage·Neon을 결제하고 나서야 이 에러를 만나게 될 상황이었다. 결제 전에 막은 것이 이 작업의 핵심 가치다.

---

## 변경 사항 요약

**파일 변경 목록:**
- `scripts/embed.ts` (수정) — 대용량 스트리밍 + 배치 즉시 처리로 개조
- `tests/unit/embed.test.ts` (신규) — 순수 함수 11건 단위 테스트

**주요 변경:**

1. **크기 기반 분기 (`iterateLaws`)**
   - 입력 < 0.5GiB(문자열 한계): 기존처럼 통째로 `JSON.parse` — pretty-print 등 **모든 형식 호환, 기존 동작·작은 파일 회귀 0**.
   - 입력 ≥ 0.5GiB: `readline` **줄 스트리밍**(`writeJsonArrayBatch` 형식 = 한 줄 1객체). `parseArrayLine`이 `[`·`]`·빈 줄을 건너뛰고 끝의 `,`를 떼어 파싱.

2. **2패스 + 배치 즉시 처리로 메모리 절약**
   - 1패스(품질 검사): 본문(`content`)은 흘려보내고 식별자 메타만 모아 `inspectNonLawCaseNumbers` 실행 → 14만 건 메타만 메모리(수십 MB).
   - 2패스(적재): 한 줄씩 읽어 20건(`BATCH_SIZE`) 차면 즉시 임베딩·upsert 후 배치를 비움 → 전체를 메모리에 올리지 않음.
   - 기존 안전장치 유지: `content_hash` 멱등성(재실행 안전), 품질 게이트(`--allow-case-issues`), `content` 원문 그대로 저장(§6.1).

3. **`--dry-run`을 환경변수 없이 실행 가능하게 분리**
   - 환경변수(`DATABASE_URL`·`VOYAGE_API_KEY`) 검사를 **실제 적재 직전**으로 이동.
   - 효과: **결제(Neon·voyage) 전에도** `--dry-run`으로 입력 스트리밍·품질 검사를 실측할 수 있다.

4. **테스트 가능 구조**
   - 순수 함수(`parseArrayLine`·`iterateLaws`·`truncateContent`·`sha256`) export.
   - `import.meta.url` 가드로 직접 실행 시에만 `main()` 동작(`collectTribunal.ts`와 동일 패턴) → vitest import 안전.

**검증 결과:**
1. `npx tsc --noEmit` — 에러 0
2. `npx vitest run tests/unit/embed.test.ts` — 신규 11/11 PASS
3. `npx vitest run` — 전체 **641/641 PASS** (42개 파일, 회귀 0)
4. **실측 — 2.16GiB `--dry-run`:**
   ```
   [embed] 입력: scripts/tribunal_full.json (2.16 GiB) — 줄 스트리밍 모드
   [embed] 전체 139840건 중 content 보유 139791건 처리 예정
   [embed] 비법령 caseNumber 품질 오류: 중복 94그룹, 누락 0건
   [embed] --dry-run 모드: ... DB 저장 없이 종료
   ```
   → 문자열 한계·메모리 에러 없이 **2.16GiB 전체를 끝까지 처리**. 품질 검사 정상 작동.

**잠재 위험:**
- **줄 스트리밍은 `writeJsonArrayBatch`(한 줄 1객체) 형식을 가정**한다. 다른 대용량 파일이 pretty-print면 `parseArrayLine`이 깨질 수 있음 → 현재 대상 `tribunal_full.json`은 이 형식이 보장됨(`collectTribunal.ts`가 생성). 타 파일 적용 시 형식 확인 필요.
- 품질 검사가 **중복 94그룹**을 보고한다(수집 단계 finalize와 동일). 실제 적재 시 `--allow-case-issues`로 강행할지, 중복을 정리할지는 적재 직전 결정 필요(14만 중 약 188건 규모).
- 본 작업은 **임베딩·적재를 실제로 수행하지 않았다**(dry-run만). 실제 적재는 voyage·Neon 결제 후.

---

## 다음 단계 (결제 후)

1. voyage 콘솔에서 실단가 확인 → 결제
2. Neon Launch($19/월) 구독 → `DATABASE_URL` 확보, `migrate.sql` vector(1024) 스키마 확인
3. `.env.local`에 `VOYAGE_API_KEY`·`DATABASE_URL` 설정
4. (선택) 소량 적재 테스트: `npm run embed -- --input scripts/tribunal_full.json` 실행 후 초반 배치 로그·DB 건수 확인
5. 전량 적재 → 검색 경로 전환 검증(TAX-6B-18 [4]) → `docs/reports/TAX-6B-18_report.md` 작성

---

**관련 티켓:** `docs/tickets/TAX-6B-18_tribunal_full_load.md` (§4[3] 임베딩+적재)
**선행 리포트:** `docs/reports/TAX-6B-18A_report.md` (수집기)
