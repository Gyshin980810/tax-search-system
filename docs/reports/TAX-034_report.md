# TAX-034 구현 리포트 — 심판례 관계 그래프 UI

> 작성자: AI / 작성일: 2026-05-25 / 기반 티켓: docs/tickets/TAX-034_impact_map_ui.md

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 구분 | 설명 |
|---|---|---|
| `app/components/ImpactMapPanel.tsx` | 신규 | 관계 그래프 토글 패널 컴포넌트 |
| `app/components/AnswerCard.tsx` | 수정 | 심판례 카드 하단에 `<ImpactMapPanel>` 조건부 블록 추가 |
| `tests/unit/ImpactMapPanel.test.tsx` | 신규 | 패널 단위 테스트 (16케이스) |
| `docs/tickets/TAX-034_impact_map_ui.md` | 신규 | 티켓 파일 |
| `package.json` | 수정 | `mermaid` v11.15.0 의존성 추가 |

### 외부 변경 없음

- API Route·Usecase·Adapter·도메인 타입 **무수정** — TAX-033 코어 그대로 사용
- `AnswerCard.tsx` 기존 로직 **무수정** — 심판례 조건부 블록 1개만 추가

---

## 주요 결정 및 설계 근거

### 1. mermaid 라이브러리 선택

`mermaid` 공식 패키지(v11)를 선택. 이유:
- TAX-033 코어가 이미 `graph LR` 코드를 생성하므로 추가 변환 계층 불필요
- `react-flow` 사용 시 ImpactMap 노드·엣지 배열을 별도 변환해야 하는 불필요한 복잡도 추가
- dynamic import로 SSR 문제 해결 (`'use client'` + `useEffect`와 동일한 패턴)

### 2. Lazy Load 전략

버튼 최초 클릭에서만 API 조회 + mermaid 렌더링 수행.
- `loaded` 상태로 재조회 방지 (닫기→열기 반복해도 fetch 1회)
- 초기 페이지 로딩 성능 보존 (mermaid 번들 ~2.5MB → lazy import)

### 3. mermaid initialize 1회 보장

`mermaidInitialized` ref로 같은 컴포넌트 인스턴스에서 중복 initialize 방지.
`mermaid.initialize({ startOnLoad: false, theme: 'default' })` — startOnLoad false로 자동 파싱 방지.

### 4. uniqueId 충돌 방지

```ts
'imap-' + caseNumber.replace(/\W/g, '').toLowerCase()
```
같은 페이지에 심판례 인용 카드가 여러 개 있을 때 `mermaid.render(id, ...)` ID 충돌 방지.

### 5. 최소 변경 (§9.7)

`AnswerCard.tsx` 수정은 import 1줄 + 조건부 블록 1개로 최소화:
```tsx
{citation.taxLaw.sourceType === '심판례' && citation.taxLaw.caseNumber && (
  <ImpactMapPanel caseNumber={citation.taxLaw.caseNumber} />
)}
```
기존 `원문 보기`·`CitationCopy` 등 **무손상**.

### 6. 원문 보존 (§6.1)

`dangerouslySetInnerHTML={{ __html: svgHtml }}` — mermaid.render()가 반환한 SVG 그대로 삽입. 별도 가공 없음. 그래프 노드 라벨은 TAX-033에서 이미 원문 조각으로 보장됨.

---

## 검증 결과

### 타입 검사
```
npx tsc --noEmit → 에러 0
```

### 단위 테스트
```
npx vitest run
  Test Files  12 passed (12)
       Tests  215 passed (215)   [기존 199 + 신규 16]
    Duration  6.04s
```

#### ImpactMapPanel.test.tsx 테스트 목록 (16케이스)

| 분류 | 케이스 |
|---|---|
| 초기 렌더링 (3) | 버튼 노출·패널 미렌더·aria-expanded=false |
| 클릭 → 로딩 (2) | 로딩 텍스트 표시·aria-expanded=true |
| API 성공 (3) | SVG 렌더링·에러 없음·버튼 텍스트 변경 |
| API 에러 (3) | 404 전용 메시지·503 body 메시지·SVG 미렌더 |
| 네트워크 예외 (1) | fetch throw 시 일반 에러 메시지 |
| 토글 (2) | 닫기·재열기 시 fetch 재호출 없음 |
| fetch 인수 (2) | 올바른 URL·특수문자 URL 인코딩 |

### 기존 회귀
- 기존 199개 전부 통과 → AnswerCard 수정·ImpactMapPanel 추가로 인한 회귀 없음

---

## 화면 동작 흐름

```
심판례 인용 카드
  ├── 세목·라벨·Tier 배지
  ├── 사건명
  ├── 결정일
  ├── 인용 발췌
  ├── [원문 보기 →]  [복사]
  └── ▼ 관계 그래프 보기   ← TAX-034 신규
        ↓ (클릭)
        [관계 그래프 불러오는 중…]
        ↓ (완료)
        ┌────────────────────────────┐
        │  graph LR                  │
        │  조심2011서1540             │
        │    → 조세특례제한법 제69조  │
        │    → 조심2009서1234        │
        └────────────────────────────┘
        ▲ 관계 그래프 닫기
```

---

## 잠재 위험

| 항목 | 내용 |
|---|---|
| mermaid 번들 크기 | ~2.5MB. dynamic import + lazy load로 초기 로딩 영향 없음. 그래프 최초 열기에만 다운로드. |
| mermaid 파싱 오류 | `mermaid.render()`가 throw 시 catch → 일반 에러 메시지로 표시 (회계사에게 stack trace 미노출). |
| SSR 빌드 경고 | mermaid가 내부적으로 document 참조 시 Next.js 빌드 경고 가능. `'use client'` + dynamic import 조합으로 방지했으나, 빌드 로그 확인 권장. |
| caseNumber 없는 심판례 | 버튼 미표시 (조건부 렌더링으로 안전하게 처리됨). |

---

## 후속 작업

| 티켓 | 내용 |
|---|---|
| TAX-035 | PRD·SSOT 정합 — FR-19/FR-20 신설, impact_map 기능 명문화 |

---

**작성자**: AI (회계사 검토 요청)
