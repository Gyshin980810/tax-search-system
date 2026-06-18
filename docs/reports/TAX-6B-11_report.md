# TAX-6B-11 구현 리포트 — 비법령 후보 확대 + 관련도 기반 본문 선별

- **티켓**: `docs/tickets/TAX-6B-11_nonlaw_candidate_expansion.md`
- **작업일**: 2026-06-17
- **작업자**: AI (회계사 승인)
- **선행**: TAX-6B-10(방향 A — 참고 목록 점수·컷오프)

---

## 1. 배경

TAX-6B-10으로 참고 목록의 정렬·거름은 개선됐으나, **검색 단계** 자체의 두 결함이 남아 회계사 불만("심판례 관련성 낮음")의 근본 원인이 해소되지 않았다.

1. **유실**: 심판례·해석례가 `display=5`로 좁아, 관련 자료가 6위면 아예 검색 안 됨.
2. **P95 부담**: 두 트랙은 후보 전수 본문 조회(N+1)라 후보를 함부로 못 늘림.
3. **관련도 순서 소실**: `search()`가 `sortByDecisionDate`로 날짜순 재정렬.

---

## 2. 변경 사항 요약

**파일 변경 목록:**
- `src/domain/nonLawRelevance.ts` (신규) — 관련도 점수 공유 함수
- `src/adapters/nationalTaxLaw.ts` (수정) — 후보 확대·본문 선별·정렬 조정
- `src/usecases/generateAnswer.ts` (수정) — 점수 함수 domain 추출(동작 동일)
- `tests/unit/nonLawRelevance.test.ts` (신규)
- `tests/integration/nationalTaxLaw.test.ts` (신규 테스트 2건)
- 티켓/리포트 (신규)

**주요 변경:**

1. **관련도 점수 함수 domain 추출** — `extractTerms`, `scoreRelevance(title, body, terms)`를 `nonLawRelevance.ts`로 분리. usecase(참고 목록)와 adapter(본문 선별)가 **같은 기준**을 쓰는 단일 진실 원천. generateAnswer는 wrapper로 위임(동작 불변).

2. **"그물은 넓게, 손질은 관련 있는 것만"** — `searchTribunal`·`searchInterpretations`:
   - 목록 `display` 5 → **12**(유실 방지).
   - 사건명 관련도로 정렬(`rankByRelevance`) → **상위 5건만 본문 조회**(N+1 제어, 본문 조회 건수는 기존과 동일 → P95 영향 최소). 나머지는 content=''(참고 목록 후보).

3. **결정론적 정렬** — 외부 API 순서를 신뢰하지 않고 우리 점수 + 보조키(날짜↓·식별자↑)로 정렬(SSOT §7.7). `search()`는 어댑터가 관련도순으로 준 심판례·해석례를 재정렬하지 않음(NTS·판례만 `sortByDecisionDate` 유지).

---

## 3. 검증 결과

| 단계 | 결과 |
|---|---|
| `npx vitest run` (전체) | ✅ 620/620 PASS |
| `npx tsc --noEmit` | ✅ 타입 에러 0 |

**신규 테스트:**
- (domain) `extractTerms` 불용어·길이 필터, `scoreRelevance` 제목 2점/본문 1점/중복 1회/0점/합산.
- (integration) 목록 8건 전부 반환 + 본문은 관련도 상위 5건만 조회(N+1 제어), 본문 조회 항목이 모두 관련(R*)임을 확인.
- (integration) 관련 5건은 content 보유, 무관 3건은 content='' → 참고 목록 후보.

---

## 4. 잠재 위험·제한사항

- **P95 측정 권장**: 본문 조회 건수가 동일(5)해 영향은 최소로 설계했으나, 목록 조회(display 12)·정렬 비용이 추가되므로 운영 측정 권장(현행 9.67s 기준).
- **정렬 책임 분산**: 심판례·해석례는 어댑터에서, NTS·판례는 `search()`에서 정렬. 주석으로 명시했으나 향후 일관화 검토 여지.
- **휴리스틱 한계**: 부분 문자열 매칭이라 표기 변이("양도소득세" vs "양도세")는 못 잡음. 의미 매칭은 방향 C(벡터) 필요.
- **남은 근본 한계**: 외부 API 목록 자체가 12건 안에 관련 자료를 안 주면 한계. 방향 C(심판례 본문 벡터 검색)가 최종 카드.

---

**리포트 상태**: 완료
