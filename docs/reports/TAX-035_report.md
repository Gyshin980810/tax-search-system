# TAX-035 구현 리포트 — PRD·SSOT 정합 (Impact Map 명문화)

> 작성자: AI / 작성일: 2026-05-25 / 기반 티켓: docs/tickets/TAX-035_prd_ssot_impact_map.md

---

## 변경 사항 요약

### 파일 변경 목록

| 파일 | 구분 | 내용 |
|---|---|---|
| `docs/PRD.md` | 수정 (v2.2 → v2.3) | FR-21/FR-22 신설, ImpactMap 엔티티 추가, 별도 트랙 2 추가, 변경 이력 |
| `docs/SSOT.md` | 수정 (v2.2 → v2.3) | §2 디렉토리 책임 갱신, §11.2 차기 목록 추가, 변경 이력 |
| `docs/tickets/TAX-035_prd_ssot_impact_map.md` | 신규 | 티켓 파일 |

### 코드 변경 없음

TAX-033(코어)·TAX-034(UI) 구현 내용을 문서에 반영하는 **순수 문서 정합** 작업.

---

## 변경 내용 상세

### PRD.md v2.3

#### 1. §5.2 확장 기능 — FR-21·FR-22 신설

| ID | 기능 | 상태 | 티켓 |
|---|---|---|---|
| FR-21 | 심판례 관계 그래프 코어 — `/api/impact-map`, 관련법령·참조결정 원문 명시 연계(추정 없음, 전부 🟢) | ✅ 완료 | TAX-033 |
| FR-22 | 심판례 카드 관계 그래프 UI — mermaid `graph LR` 토글 패널, Lazy load | ✅ 완료 | TAX-034 |

**설계 원칙 명문화:**
- law-verifier RAG 5단계 파이프라인 **외부** 독립 기능 (심판례 원문 명시 연계라 검증 불필요)
- caseNumber 없는 카드는 버튼 미표시

#### 2. §10.1 도메인 엔티티 — `ImpactMap` 추가

```
ImpactMap: 심판례 관계 그래프 전체
  - 중심 심판례 + 연결된 법령 조문·참조 심판례 노드·엣지 집합
  - 모든 엣지는 원문 명시 연계 (추정 없음)
  - ImpactNode·ImpactEdge 포함
  - src/domain/ImpactMap.ts
```

#### 3. §16 마일스톤 — 별도 트랙 2 추가

| 항목 | 내용 |
|---|---|
| 티켓 | TAX-031~034 ✅ |
| 완결 시점 | 2026-05-24~05-25 |
| 내용 | 검색 정확도 개선(TAX-031/032) + 심판례 관계 그래프(TAX-033/034) |
| 비용 | $0 추가 (기존 API 키 재사용) |
| 검증 | 전체 테스트 215개 통과, 회귀 없음 |

---

### SSOT.md v2.3

#### 1. §2 디렉토리 책임 갱신

| 경로 | 추가 내용 |
|---|---|
| `src/domain/` | ImpactMap·ImpactNode·ImpactEdge, relatedLawParser·mermaid (TAX-033) |
| `src/usecases/` | buildImpactMap (TAX-033) |
| `src/ports/` | IImpactMapPort (TAX-033) |

#### 2. §11.2 차기(Post-MVP) 목록 추가

```
- 심판례 관계 그래프 코어 (FR-21, P1 ✅ 완료 — TAX-033)
- 심판례 카드 관계 그래프 UI (FR-22, P1 ✅ 완료 — TAX-034)
```

---

## 검증 결과

### 정합성 확인

| 체크 항목 | 결과 |
|---|---|
| PRD FR 번호 충돌 없음 (FR-21/22 미사용 확인) | ✅ |
| SSOT §2 기존 행 무수정 (추가만) | ✅ |
| 변경 이력에 날짜·버전·내용 기록 | ✅ |
| 코드 변경 없음 (tsc·vitest 불필요) | ✅ |

### PRD·SSOT 정합 항목

| 기능 | PRD | SSOT | 코드 |
|---|---|---|---|
| 심판례 관계 그래프 코어 (FR-21) | v2.3 §5.2 | v2.3 §11.2 | TAX-033 ✅ |
| 심판례 카드 UI (FR-22) | v2.3 §5.2 | v2.3 §11.2 | TAX-034 ✅ |
| ImpactMap 엔티티 | v2.3 §10.1 | v2.3 §2 | src/domain/ImpactMap.ts ✅ |
| buildImpactMap usecase | — | v2.3 §2 | src/usecases/buildImpactMap.ts ✅ |
| IImpactMapPort 인터페이스 | — | v2.3 §2 | src/ports/impactMapPort.ts ✅ |

---

## TAX-033~035 전체 완료 요약

| 티켓 | 내용 | 상태 |
|---|---|---|
| TAX-033 | 심판례 관계 그래프 코어 (API + 도메인 + 어댑터) | ✅ 완료 |
| TAX-034 | 심판례 카드 mermaid 토글 UI | ✅ 완료 |
| TAX-035 | PRD·SSOT 정합 (FR-21/FR-22 명문화) | ✅ 완료 |

---

**작성자**: AI (회계사 검토 요청)
