# TAX-034: 심판례 카드 관계 그래프(Impact Map) UI

> 작성일: 2026-05-25 / 선행 티켓: TAX-033 (코어 API 완료)

---

## 목적

TAX-033에서 구현한 `GET /api/impact-map?caseNo=` 코어를 화면에 연결한다.
심판례 인용 카드 하단에 "관계 그래프 보기" 버튼을 추가하고,
클릭 시 mermaid 그래프를 토글 패널로 표시한다.

## 배경

- TAX-033 완료: `/api/impact-map` → ImpactMap + mermaid 코드 반환
- 현재 `AnswerCard.tsx` 심판례 카드에는 그래프 진입점 없음
- 회계사가 심판례 인용 카드에서 "이 심판례는 어떤 조문·결정에 연결되어 있는가"를 한눈에 확인할 수 있게 함

## 범위

### 변경 파일

| 파일 | 구분 |
|---|---|
| `app/components/ImpactMapPanel.tsx` | 신규 |
| `app/components/AnswerCard.tsx` | 수정 (심판례 카드 조건부 블록 1개 추가) |
| `tests/unit/ImpactMapPanel.test.tsx` | 신규 |

### 명시적 제외

- API Route·Usecase·Adapter·도메인 타입 수정 없음 (TAX-033 코어 무수정)
- `AnswerCard`의 기존 로직 변경 없음 (심판례 조건부 추가만)

## 요구사항

1. 심판례 카드 하단에 "관계 그래프 보기" 버튼 (토글)
2. 클릭 시 `/api/impact-map?caseNo={caseNumber}` 호출 (lazy — 최초 클릭에만 조회)
3. 로딩 중 스피너 텍스트 표시
4. mermaid SVG 렌더링 (`graph LR` 코드 → 브라우저 렌더링)
5. API 에러(404/503 등) 시 메시지 표시
6. `caseNumber` 없는 심판례는 버튼 미표시

## 기술 결정

- **라이브러리**: `mermaid` v11 공식 패키지 (dynamic import — SSR 안전)
- **렌더링**: `mermaid.render()` → SVG → `dangerouslySetInnerHTML`
- **상태**: open / loaded / loading / error / svgHtml — 컴포넌트 로컬 상태
