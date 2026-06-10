# [TICKET-ID] 티켓 제목

> 티켓 작성자는 아래 모든 섹션을 채웁니다.
> AI가 작업 시작 전 이 티켓 + `CLAUDE.md` + `docs/SSOT.md`를 읽습니다.
>
> 파일명 규칙: `TAX-NNN_short_description.md` (언더스코어 사용, 소문자)
> 예: `TAX-001_national_tax_search.md`, `BUG-002_cache_invalidation.md`

---

## Metadata

- **Type**: FEAT | BUG | TASK | REFACTOR
- **Severity**: minor | major | critical
- **Layer**: ui | api | usecase | adapter | domain | infra | docs
- **Milestone**: MVP | Post-MVP | Later
- **Estimated Size**: S (1~2파일) | M (3~5파일) | L (6파일 이상, 분할 검토)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작
> 현재 시스템이 어떻게 동작하는지, 또는 기능이 없는지 기술합니다.

예:
- 현재 국세법령 검색 기능이 존재하지 않음
- 또는: 지방세 검색 시 결과가 중복으로 표시됨

### 1.2 기대 동작
> 이 티켓 완료 후 어떻게 동작해야 하는지 기술합니다.

예:
- 사용자가 검색창에 키워드를 입력하면 국세법령 API에서 관련 조문을 조회
- 결과에는 조문 제목, 법령명, 개정일, 원문 링크 포함

### 1.3 영향·중요도
> 이 기능이 왜 필요한지, 누가 사용하는지 명시합니다.

예:
- MVP의 핵심 기능. 없으면 제품 의미 없음
- 회계사 50명 전원이 사용할 검색 경로

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일
> AI가 탐색을 줄일 수 있도록 후보 경로를 나열합니다.

예:
- `app/api/search/route.ts` (신규 생성 예정)
- `src/usecases/searchTaxLaw.ts` (신규 생성 예정)
- `src/adapters/nationalTaxLaw.ts` (신규 생성 예정)
- `src/domain/taxLaw.ts` (신규 생성 예정)

### 2.2 외부 API·리소스
> 참조해야 할 API 문서, 데이터 형식 등.

예:
- 국세법령정보시스템 OPEN API
- API 문서: https://www.law.go.kr/DRF/openapi.do
- 응답 형식: JSON
- 인증: API 키 (환경변수 `NATIONAL_TAX_API_KEY`)

### 2.3 아키텍처 힌트
> 어느 계층에 무엇을 둘지 힌트.

```
UI → /api/search → searchTaxLawUsecase → nationalTaxLawAdapter → 국세청 API
```

---

## 3. Scope (작업 범위) ⭐ 가장 중요

### 3.1 허용되는 변경
> AI가 건드려도 되는 파일·영역을 명확히 제한합니다.

- [ ] `src/adapters/nationalTaxLaw.ts` 신규 생성
- [ ] `src/usecases/searchTaxLaw.ts` 신규 생성
- [ ] `app/api/search/route.ts` 신규 생성
- [ ] `src/domain/taxLaw.ts` 타입 정의
- [ ] `.env.example`에 `NATIONAL_TAX_API_KEY` 추가

### 3.2 금지되는 변경
> 실수로라도 건드리면 안 되는 영역을 명시합니다.

- ❌ UI 레이아웃 변경 (별도 티켓에서 처리)
- ❌ 지방세 API 연동 (TAX-002에서 처리)
- ❌ 데이터베이스 스키마 변경
- ❌ 기존 폴더 구조 변경
- ❌ `package.json` 의존성 추가 (필요하면 먼저 물어볼 것)
- ❌ 법령 원문 임의 가공·요약 저장

---

## 4. Strategy (구현 힌트)

> 반드시 이대로 해야 하는 건 아니지만, 권장 접근법을 제시합니다.

예:
1. **Domain 먼저**: `TaxLaw`, `SearchQuery`, `SearchResult` 타입 정의
2. **Port 정의**: `ITaxLawAdapter` 인터페이스 (`search(query): Promise<SearchResult[]>`)
3. **Adapter 구현**: `nationalTaxLawAdapter` — `fetch` 로 국세청 API 호출 → 응답 정규화
4. **Usecase 구현**: `searchTaxLawUsecase(adapter)` — 검색어 전처리 + Adapter 호출
5. **Route 작성**: `app/api/search/route.ts` — 요청 검증 + Usecase 호출 + 응답 매핑
6. **환경변수**: `.env.local` 에 `NATIONAL_TAX_API_KEY` 설정

---

## 5. Acceptance Criteria (완료 조건)

> 구체적이고 검증 가능한 조건으로 작성합니다.
> AI는 이 조건을 만족할 때까지 작업을 계속합니다.

1. [ ] `/api/search?q=부가가치세` 요청 시 최소 1건 이상의 결과 반환
2. [ ] 각 결과 항목에 다음 필드 포함:
   - `title` (조문 제목)
   - `lawName` (법령명)
   - `articleNumber` (조문 번호)
   - `revisionDate` (개정일)
   - `sourceUrl` (원문 링크) ⭐ 필수
3. [ ] API 키 누락 시 앱 시작 단계에서 실패 (Fail-fast)
4. [ ] 외부 API 장애 시 사용자에게 명확한 에러 메시지 전달
5. [ ] 응답 시간 5초 이내 (기본값)
6. [ ] 기존 기능(정적 페이지 등)이 깨지지 않음
7. [ ] 법령 원문이 AI에 의해 변경되지 않음

---

## 6. Verification (검증 단계)

> 회계사(인간)가 브라우저에서 직접 확인할 순서입니다.

1. 저장소 루트에서 `npm run dev` 실행
2. 브라우저에서 `http://localhost:3000` 접속
3. 검색창에 "부가가치세" 입력 후 검색
4. 결과 최소 1건 이상 표시되는지 확인
5. 결과 항목의 "원문 보기" 링크 클릭 → 국세법령정보시스템으로 이동 확인
6. API 키를 제거(`.env.local`에서 `NATIONAL_TAX_API_KEY` 삭제) 후 재시작 → 시작 실패 확인
7. 네트워크 차단(기기 오프라인) 후 재검색 → 에러 메시지 표시 확인

---

## 7. Risks / Notes (위험·주의사항)

> AI나 후속 개발자가 알아야 할 주의점.

- 국세법령 API의 응답 구조가 변경될 수 있음 (분기별 확인 권장)
- 일부 법령은 API로 제공되지 않을 수 있음 → 이 경우 "검색 결과 없음" 명확히 표시
- 검색 쿼리에 특수문자 포함 시 URL 인코딩 필수
- 법령 원문이 길 경우 목록에서는 제목만, 상세 페이지에서 전문 표시

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것

- [ ] 근본 원인 분석 (또는 기능 추가 동기)
- [ ] 영향받는 파일 목록
- [ ] 구현 계획 (3~5단계)

→ **인간 승인 후** 코딩 시작

### 8.2 코딩 후 제출할 것

- [ ] 변경 파일 목록
- [ ] 변경 요약
- [ ] 검증 단계별 결과 (PASS/FAIL)
- [ ] 발견된 위험·제한사항
- [ ] 리포트 파일 경로: `docs/reports/{TICKET-ID}_report.md`

---

## 9. Ticket Size Rule (티켓 크기 규칙)

하나의 티켓은 일반적으로:
- **1~5개 파일** 수정
- **하나의 논리적 변경**
- **30분~4시간 이내 완료 가능한 범위**

이를 초과할 것 같으면 **티켓을 분할**합니다.

예: "검색 시스템 전체 구현" ❌ → "국세 Adapter(TAX-001) + 지방세 Adapter(TAX-002) + 통합 UI(TAX-003)" ✅

---

## 10. Related Tickets (관련 티켓)

> 이 티켓과 연관된 다른 티켓을 링크합니다.

- 선행: (없음) 또는 `TAX-000_project_init.md`
- 후속: `TAX-002_local_tax_search.md`, `TAX-003_unified_ui.md`
- 참조: (관련 문서·링크)

---

## 11. Report Link (리포트 연결)

> 구현 완료 후 이 줄을 갱신합니다.

Report: `docs/reports/TAX-XXX_report.md` (미작성 / 작성중 / 완료)

---

**작성자**: (이름)
**작성일**: YYYY-MM-DD
**최종 수정일**: YYYY-MM-DD

---

## 부록: 티켓 작성 팁 (회계사님용)

### 회계사님이 티켓을 작성할 때

세법 지식이 있는 회계사님이 **Context(§2)** 와 **Scope(§3)** 만 잘 쓰면, 나머지는 AI가 채워줍니다.
다음 3가지만 확실히:

1. **"무엇을 원하는가?"** → §1 Problem
2. **"건드려도 되는 곳 / 절대 건드리면 안 되는 곳"** → §3 Scope
3. **"완료됐는지 어떻게 알 수 있는가?"** → §5 Acceptance Criteria

나머지(§2 Context, §4 Strategy)는 AI에게 "이 티켓 초안 만들어줘"라고 하면 대부분 채워줍니다.
