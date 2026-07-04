# TAX-6B-23 판례 인용 연결망 밀도 PoC (그래프 DB 전 효용 검증)

> 그래프 DB 도입 여부를 결정하기 전에, **DB를 전혀 건드리지 않고** 판례 본문에서
> 인용 관계(엣지)를 정규식으로 추출해 "연결망이 실제로 쓸 만큼 촘촘한가"를
> 저비용으로 측정한다. 이 PoC 결과가 그래프 DB(Apache AGE) 실착수의 게이트다.

---

## Metadata

- **Type**: TASK (분석·측정 PoC)
- **Severity**: minor
- **Layer**: infra (오프라인 스크립트) / domain (순수 추출 함수)
- **Milestone**: Post-MVP (Phase 6B)
- **Estimated Size**: S (신규 2~3파일, src·DB 무변경)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 판례 10,075건은 pgvector(`taxlaw_embeddings`)에 voyage-4 벡터로 적재돼 **의미 유사도 검색(cosine)** 만 가능하다 (`src/adapters/vectorSearch.ts`).
- 판례끼리의 **인용 관계(어느 판례가 어느 판례를 인용했는가)** 를 표현하는 데이터(엣지)가 **존재하지 않는다**.
- 회계사가 원하는 **"관련 판례 연결망 탐색"** (이 판례가 인용한/인용된 판례 추적)을 할 수단이 없다.

### 1.2 기대 동작

- 적재 대상 판례 본문(`content`)에서 **인용된 사건번호를 정규식으로 추출**해 엣지 목록(JSON)을 생성한다.
- 우리가 보유한 판례 코퍼스 **내부에서** 실제로 얼마나 연결되는지(연결 밀도)를 정량 측정·리포트한다.
- 이 수치로 **그래프 DB 도입의 효용**을 판단한다 (게이트).

### 1.3 영향·중요도

- 그래프 DB(Apache AGE 등) 실착수는 인프라·운영 부담을 동반하므로, **헛수고 방지를 위한 사전 검증**이 필수다.
- 세무 판례는 다른 세무 판례보다 일반 법리·민사 판례를 인용하는 경향이 있을 수 있어, **보유 코퍼스 내 연결이 듬성듬성하면 그래프 DB의 효용이 없다.** 이 가설을 데이터로 검증한다.
- 결정권자: 회계사. 이 PoC는 의사결정 입력만 제공하며, 그래프 DB 자체는 구현하지 않는다.

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `scripts/precedentCitationProbe.ts` (신규) — 추출·집계·리포트 실행 스크립트
- `src/domain/precedentCitation.ts` (신규) — **순수 추출 함수**(정규식 파싱). 파일시스템·DB 비의존 → 단위 테스트 대상
- `test/precedentCitation.test.ts` (신규) — 인용 추출 정규식 단위 테스트
- (입력) `scripts/precedent_full.json` — TAX-6B-16에서 생성된 변환 결과(TaxLaw[]). 없으면 `npm run convert:precedent -- --all`로 재생성
- (참고) `scripts/convertPrecedentMd.ts` — 판례 .md → TaxLaw[] 변환기(본문 구조·frontmatter 매핑 확인용)

### 2.2 외부 API·리소스

- **없음.** 외부 API 호출·LLM 호출·임베딩 과금 **전부 없음** (정규식 오프라인 처리).
- 입력은 이미 로컬에 있는 판례 JSON(또는 .md)뿐이다.

### 2.3 아키텍처 힌트

```
precedent_full.json (TaxLaw[])
      ↓ (각 content에서 정규식 인용 추출 — 순수 함수)
엣지 목록 [{ from: 사건번호, to: 인용된 사건번호 }]
      ↓ (보유 코퍼스 내 caseNumber 집합과 대조)
연결 밀도 리포트 (내부 연결 비율·고립 노드 수·허브 상위)
```

- DB·src 런타임 코드(어댑터/유스케이스/포트)는 **건드리지 않는다.** 순수 함수 + 오프라인 스크립트만 추가한다.

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경

- [ ] `src/domain/precedentCitation.ts` 신규 — 인용 사건번호 추출 순수 함수
- [ ] `scripts/precedentCitationProbe.ts` 신규 — 추출·집계·리포트 스크립트
- [ ] `test/precedentCitation.test.ts` 신규 — 추출 함수 단위 테스트
- [ ] `package.json` 에 실행 스크립트 1줄 추가 가능 (예: `"probe:citation"`) — **의존성 추가는 금지**

### 3.2 금지되는 변경

- ❌ DB 스키마 변경·그래프 DB(Neo4j/Apache AGE) 도입 (이 티켓은 측정만, 도입은 후속 티켓)
- ❌ `src/adapters/`, `src/usecases/`, `src/ports/` 런타임 코드 수정
- ❌ pgvector 적재 데이터·`taxlaw_embeddings` 변경
- ❌ LLM·임베딩·외부 API 호출 (정규식 오프라인 처리만)
- ❌ `package.json` **의존성** 추가 (필요하면 먼저 질문)
- ❌ 판례 원문(`content`) 가공·요약 저장 (§6.1 — 읽기 전용으로만 파싱)
- ❌ 기존 폴더 구조 변경

---

## 4. Strategy (구현 힌트)

> 권장 접근법(강제 아님). 정확성 우선 — 추출 정밀도를 측정 가능하게.

1. **Domain 순수 함수 먼저** (`precedentCitation.ts`)
   - `extractCitedCaseNumbers(content: string): string[]` — 한국 판결문 표준 인용 형식에서 사건번호만 추출
     - 주요 패턴: `대법원 YYYY. M. D. 선고 NNNN두NNNNN 판결`, `【참조판례】` 섹션, `NNNN누/도/다/구합/...` 등 사건번호 토큰
     - 자기 자신(출처 판례의 사건번호) 제외, 중복 제거
   - 정규식은 **보수적으로** — 오탐(없는 인용 생성)보다 누락이 안전(과대 연결 방지)
2. **추출 스크립트** (`precedentCitationProbe.ts`)
   - `scripts/precedent_full.json` 로드 → 각 항목 `caseNumber` + `extractCitedCaseNumbers(content)`
   - 보유 코퍼스의 `caseNumber` 집합(`Set`) 구성
   - 엣지 분류: **내부 엣지**(인용 대상이 코퍼스에 존재) vs **외부 엣지**(코퍼스 밖)
3. **리포트 출력** (콘솔 + `docs/reports/TAX-6B-23_report.md`)
   - 핵심 지표(아래 §5) 산출
   - 엣지 목록은 `scripts/precedent_edges.json` 으로 덤프(후속 그래프 적재 재사용 가능)
4. **단위 테스트** — 실제 판결문 인용 형식 샘플 3~5개로 추출 정확도 검증(정탐/오탐/자기참조 제외)

---

## 5. Acceptance Criteria (완료 조건)

> 측정 결과 수치 자체는 합격/불합격이 아니다. **측정을 정확히 수행하고 리포트하면 완료.**
> "그래프 DB를 할지 말지"는 이 수치를 보고 회계사가 별도 결정한다.

1. [ ] `npm run probe:citation` 실행 시 에러 없이 완료, 아래 지표를 출력한다:
   - 전체 판례 수 / 인용을 1건 이상 포함한 판례 수(비율)
   - 추출된 총 엣지 수 / **내부 엣지 수**(코퍼스 내부 연결) / 외부 엣지 수
   - **내부 연결 밀도**: 내부 엣지를 가진 판례 비율(= 보유 코퍼스만으로 연결망이 형성되는 정도)
   - 고립 노드 수(내부 인용·피인용 0건)
   - 피인용 상위 10건(허브 후보)
2. [ ] `scripts/precedent_edges.json` 에 엣지 목록 저장(`{ from, to, inCorpus: boolean }[]`)
3. [ ] `src/domain/precedentCitation.ts` 추출 함수가 **순수 함수**(I/O 없음)이고 단위 테스트로 검증됨
4. [ ] `npm run test` 신규 테스트 PASS, 기존 테스트 전부 그대로 PASS (회귀 0)
5. [ ] `npm run typecheck` 에러 0
6. [ ] 판례 원문(`content`)이 변경되지 않음 — 읽기 전용 파싱만
7. [ ] DB·런타임 어댑터 무변경(이 티켓 범위 밖 파일 diff 없음)
8. [ ] `docs/reports/TAX-6B-23_report.md` 에 지표 + **그래프 DB 도입 권고/비권고 의견**(밀도 해석) 기재

---

## 6. Verification (검증 단계)

> 회계사(인간)가 확인할 순서.

1. (선행) `scripts/precedent_full.json` 존재 확인. 없으면 `npm run convert:precedent -- --all`
2. `npm run probe:citation` 실행 → 콘솔 지표 확인
3. `scripts/precedent_edges.json` 생성 확인, 내부/외부 엣지 분류가 합리적인지 표본 점검
4. `npm run test` — 신규 단위 테스트 + 기존 테스트 전부 PASS
5. `npm run typecheck` — 에러 0
6. `docs/reports/TAX-6B-23_report.md` 의 밀도 해석·도입 의견 검토
7. 회계사가 수치를 보고 후속 결정(그래프 DB 착수 여부)

---

## 7. Risks / Notes (위험·주의사항)

- **추출 정밀도 한계**: 판결문 인용 형식이 일관되지 않으면 누락이 생길 수 있다. 보수적 정규식이라 **밀도는 하한(下限)** 으로 해석해야 한다(실제는 같거나 더 촘촘).
- **사건번호 표기 변이**: 같은 판례를 다른 표기로 인용할 수 있어, 정규화(공백·구분자 통일) 후 대조 권장.
- **외부 엣지 다수 가능성**: 세무 판례가 코퍼스 밖(민사·일반 법리) 판례를 주로 인용하면 내부 밀도가 낮게 나올 수 있다 — 이는 **결함이 아니라 핵심 발견**이며, 그래프 DB 비권고의 근거가 된다.
- **이 티켓은 그래프 DB를 만들지 않는다.** 엣지 JSON은 후속 티켓(Apache AGE 적재)에서 재사용하기 위한 산출물일 뿐이다.

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 입력 데이터(`precedent_full.json`) 존재·구조 확인 결과
- [ ] 실제 판결문 본문 표본에서 인용 형식 패턴 확인(정규식 설계 근거)
- [ ] 영향 파일 목록 + 구현 계획 3~5단계

→ **회계사 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 측정 지표 요약(§5 항목 전부)
- [ ] 테스트·typecheck 결과(PASS/FAIL)
- [ ] 그래프 DB 도입 권고/비권고 의견과 근거
- [ ] 리포트 경로: `docs/reports/TAX-6B-23_report.md`

---

## 9. Ticket Size Rule

- 신규 2~3파일, src 런타임·DB 무변경 → S 규모. 분할 불필요.

---

## 10. Related Tickets

- 선행: `TAX-6B-13_precedent_corpus_poc`(판례 코퍼스 PoC), `TAX-6B-16_precedent_full_load`(전량 적재)
- 후속(조건부): TAX-6B-24 (가칭) "Apache AGE 그래프 적재 + 관련 판례 탐색" — **본 PoC 밀도 양호 시에만** 생성
- 참조: `src/adapters/vectorSearch.ts`(병행될 의미검색), `scripts/convertPrecedentMd.ts`(본문 구조)

---

## 11. Report Link

Report: `docs/reports/TAX-6B-23_report.md` (미작성)

---

**작성자**: AI(Claude) 초안 — 회계사 검토 대기
**작성일**: 2026-06-26
**최종 수정일**: 2026-06-26
