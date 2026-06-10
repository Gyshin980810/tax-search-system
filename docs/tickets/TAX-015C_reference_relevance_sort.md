# TAX-015C 참고 목록 관련도순 정렬

> TAX-015B의 참고 목록(references)을 "선고일 최신순"에서 "검색어 관련도순"으로 정렬한다.
> 선행: **TAX-015B 완료 필수**.

---

## Metadata
- **Type**: FEAT
- **Severity**: minor
- **Layer**: usecase
- **Milestone**: Post-MVP
- **Estimated Size**: S (1~2파일)

---

## 1. Problem

### 1.1 현재 동작 (TAX-015B 완료 시점)
- 참고 목록은 어댑터가 선고일 내림차순으로 정렬한 순서를 그대로 받아 상위 5건(`MAX_REFERENCES`)만 노출.
- **실호출 검증(2026-05-21):** 국세청 판례 API(`target=prec`)의 기본 정렬은 **선고일 내림차순**이며, "검색어 관련도순" 정렬 옵션은 제공하지 않음(제공 정렬: 선고일/사건명/법원명).
- 결과적으로 회계사가 보는 5건은 "가장 관련 있는 5건"이 아니라 "가장 최근 5건"이라, 핵심 쟁점 판례가 오래되면 잘려나갈 수 있음.

### 1.2 기대 동작
- 참고 목록을 **검색어와의 관련도 점수**로 정렬한 뒤 상위 5건을 노출.
- 관련도가 동일하면 선고일 최신순으로 보조 정렬(결정론성 + 최신성 유지).
- 관련 신호가 전혀 없으면(점수 0) 현행과 동일하게 선고일순으로 동작(안전 기본값).

### 1.3 영향·중요도
- 회계사가 "관련 참고 판례"를 더 빨리 발견. ⚪참고자료(최저 신뢰 등급)의 노출 우선순위 개선이라 정확성 위험은 제한적.

---

## 2. Context

### 2.1 관련 파일
- `src/usecases/generateAnswer.ts` — `splitResults`에 관련도 점수 정렬 추가, 검색 키워드 주입.
- `tests/unit/generateAnswer.test.ts` — 관련도 정렬 테스트 추가, 기존 references 테스트 정합.

### 2.2 외부 API·리소스
- 추가 호출 없음. 이미 받은 검색 결과(references)를 재정렬할 뿐.
- 실호출 검증 근거: `docs/reports/TAX-015C_report.md`에 기록.

### 2.3 아키텍처 힌트
```
generateAnswer
  ├ queries[0].keyword (LLM 추출 검색어) ──┐
  └ splitResults(items, keyword) ──────────┴→ references를 관련도순 정렬 → 상위 5건
```

---

## 3. Scope

### 3.1 허용되는 변경
- [ ] `generateAnswer.ts` — 관련도 점수 함수 + references 정렬(점수↓ → 선고일↓ → 사건번호↑) + 키워드 주입.
- [ ] `generateAnswer.test.ts` — 관련도 정렬 단위 테스트.

### 3.2 금지되는 변경
- ❌ 벡터 DB·임베딩·외부 형태소 분석기 의존성 추가 (별도 트랙 — 필요 시 먼저 질문).
- ❌ citable(본문 있는 인용 판례) 정렬 변경 — 본 티켓은 references만 대상.
- ❌ 어댑터 API 호출/파라미터 변경.
- ❌ 원문 의역·요약 저장.

---

## 4. Strategy
1. `queries[0].keyword`를 공백 기준 토큰화(2자 미만 토큰 제거 — 노이즈 차단).
2. 각 reference의 `articleTitle`(사건명) + `lawName`을 검색 대상 문자열로, 포함된 토큰 수를 점수로 산출(부분 문자열 포함).
3. references를 점수↓ → 선고일↓ → 사건번호↑ 로 정렬 후 상위 `MAX_REFERENCES`건.
4. 점수 전부 0이면 선고일순으로 수렴(현행 동작 = 안전 기본값).

---

## 5. Acceptance Criteria
1. [ ] 검색어 토큰이 사건명에 포함된 reference가 그렇지 않은 것보다 위로 정렬됨.
2. [ ] 관련도 동일 시 선고일 최신순으로 보조 정렬(결정론적).
3. [ ] 모든 점수가 0이면 선고일순(현행) 그대로.
4. [ ] TAX-015B 동작(citable/references 분리, 5건 상한, V검증 비대상) 회귀 없음.
5. [ ] 원문 문자 단위 보존.

---

## 6. Verification
1. `npm run test` / `npm run typecheck` / `npm run lint` 통과.
2. `npm run dev` → 양도소득세 등 검색 → 참고 목록이 관련도순으로 재정렬되는지 확인.
3. 실 API 결과로 사건명-검색어 매칭이 의미 있게 동작하는지 스폿 체크(리포트 기록).

---

## 7. Risks / Notes
- **사건명 글자 매칭의 한계:** 핵심 쟁점이 사건명에 안 적힌 판례는 점수가 낮게 나올 수 있음. 의미 기반 관련도는 벡터DB(M4/M5) 영역. 본 티켓은 가벼운 휴리스틱.
- **안전 기본값:** 점수 0이면 선고일순으로 수렴하므로, 최악의 경우에도 현행보다 나빠지지 않음.
- ⚪참고자료는 최저 신뢰 등급이고 라벨로 명확히 구분되므로 정렬 변경의 정확성 위험은 제한적.

---

## 10. Related Tickets
- 선행: `TAX-015B_precedent_reference_list.md` (필수)
- 참조: `docs/reports/TAX-015_report.md`, `docs/reports/TAX-015B_report.md`

---

## 11. Report Link
Report: `docs/reports/TAX-015C_report.md` (완료)

---

**작성자**: AI 초안 (회계사 검토 대기)
**작성일**: 2026-05-21
