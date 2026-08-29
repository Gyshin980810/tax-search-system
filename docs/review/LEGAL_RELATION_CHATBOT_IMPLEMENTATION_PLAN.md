# 법리 관계 검색 세법 챗봇 구체 구현 계획서

> 용도: Claude 구현 지시 및 티켓 분해 기준
> 작성일: 2026-07-22
> 상태: 구현 전 설계안 — 아래 승인 항목을 확정한 뒤 티켓별로 진행
> 평가 근거: `docs/review/LEGAL_RELATION_CHATBOT_ROADMAP_REVIEW_V2.md`
> 문서 위계: `docs/SSOT.md` > `docs/PRD.md` > `CLAUDE.md` > 본 계획서 > 개별 티켓

---

## 0. Claude 작업 지침

이 문서를 전달받은 Claude는 다음 순서를 지킨다.

1. `docs/SSOT.md`, `docs/PRD.md`, `CLAUDE.md`, 재평가서와 본 계획서를 먼저 읽는다.
2. 전체 기능을 한 번에 구현하지 않는다.
3. 먼저 LR-001 설계 결정 티켓 초안을 작성하고 코드 변경 없이 회계사 승인을 요청한다.
4. 이후에도 **1티켓 = 1브랜치 = 1PR** 원칙으로 진행한다.
5. 티켓별 구현 전에 근본 원인, 변경 파일, 구현 순서, 검증 방법을 제시하고 승인받는다.
6. 답변 생성 경로를 변경하는 티켓은 기존 RAG 5단계와 law-verifier V1~V6를 절대 우회하지 않는다.
7. 법령·판례·심판례 원문은 변경·요약 저장하지 않는다.
8. 유료 LLM·임베딩 호출 또는 성능 측정 실행 전 비용과 호출 범위를 제시하고 승인을 받는다.

### 최초 요청사항

Claude는 이 계획서를 읽은 직후 다음 작업만 수행한다.

- LR-001 티켓 초안 작성
- 아래 §14의 네 가지 설계 결정을 이해하기 쉬운 장단점과 함께 승인 요청
- 코드·DB·평가셋은 아직 변경하지 않음

---

## 1. 목표와 설계 결론

### 1.1 목표

현재 구축된 판례·심판례·해석례 벡터 DB와 인용 그래프를 기반으로 다음 자료를 찾는 세법 검색 기능을 만든다.

- 같은 방향의 법리를 적용한 자료
- 논리적으로 유사한 자료
- 중요한 사실관계 때문에 구별되는 자료
- 유사한 쟁점에서 다른 결론을 낸 자료
- 후속 판결 또는 법령 개정으로 효력이 변경된 것이 수기 검수로 확인된 자료

### 1.2 권장 설계

첫 버전은 **오프라인 관계 인덱스 + 온라인 검증 관계 조회** 방식으로 구현한다.

- 오프라인: 법리 카드 추출 → 후보 문서쌍 생성 → 관계 판정 → 원문 검증 → 저장
- 온라인: 기존 답변 생성 완료 후 이미 검증·저장된 관계만 조회
- 온라인 관계판정 LLM 호출: 파일럿에서 사용하지 않음
- 기존 `generateAnswer`와 V1~V6: 파일럿에서 변경하지 않음
- 관계 기능 실패: 기존 검증 답변에 영향을 주지 않는 fail-soft 처리

### 1.3 온라인 LLM 판정을 첫 버전에서 제외하는 이유

| 방안 | 장점 | 단점 |
|---|---|---|
| **오프라인 사전 판정 — 추천** | 재현성·검수·비용 통제가 쉽고 질문 응답 시 LLM 지연이 추가되지 않음 | 미리 처리하지 않은 문서는 관계 결과가 없을 수 있음 |
| 온라인 즉시 판정 | 새로운 문서쌍도 즉시 비교할 수 있어 초기 coverage가 높음 | 기존 P95 지연 악화, 호출비 증가, 질문마다 결과가 달라질 위험 |

---

## 2. 첫 파일럿 범위

### 2.1 포함

- 자료 유형: 판례 + 조세심판원 결정례
- 쟁점: 1개
- 회계사 검수 문서쌍: 20~30개
- 임베딩: `issueEmbedding` 1종
- 검색: 기존 exact pgvector + 기존 `citation_edges` 1-hop을 후보 생성 신호로 사용
- 산출물: 내부 JSON 또는 Markdown shadow 결과
- 관계 상태: 후보, 검증 통과, 회계사 확정, 기각, 기권, 원문 변경으로 무효

### 2.2 제외

- 일반 사용자용 UI
- Impactmap 또는 관계 그래프 UI
- 전 코퍼스 일괄 법리 추출
- HNSW/ANN 전환
- 2-hop 이상 그래프 확장
- 별도 유료 리랭커
- `factEmbedding`, `holdingEmbedding`
- 질문 시 관계판정 LLM 호출
- 미검수 `OVERRULED`·`SUPERSEDED_BY_LAW` 노출
- 관계 자료의 `LabeledAnswer.citations` 자동 승격

### 2.3 추천 파일럿 쟁점

**법인의 지출이 접대비인지 광고선전비·판매촉진비인지 여부**를 추천한다.

추천 이유:

- 현재 `eval/golden_nonlaw_probe.json`에 관련 판례·심판례·해석례 후보가 이미 존재한다.
- 접대비 해당 및 비해당 결론이 함께 있어 관계 분류를 시험할 수 있다.
- 비교할 사실축이 비교적 명확하다: 지출 목적, 수혜자 범위, 특정인 대상 여부, 대가성, 사업 관련성.
- 1세대 1주택보다 법 개정에 따른 시점 분기가 덜 복잡해 첫 기술 파일럿에 적합하다.

대안:

| 후보 | 장점 | 단점 |
|---|---|---|
| **접대비 vs 광고선전비·판매촉진비 — 추천** | 관계별 사례와 서로 다른 결론을 확보하기 쉬움 | 사실관계 분류가 세밀함 |
| 1세대 1주택 비과세 | 실무 수요와 자료량이 큼 | 개정이 잦아 시점·부칙 연결까지 동시에 필요 |
| 동일 세대원 증여취득 주택 특례 | 종전·변경 해석을 검증하기 좋음 | 쟁점이 좁고 법령 버전 연결이 선행돼야 함 |

---

## 3. 전체 아키텍처

```text
[오프라인 인덱스 생성]
판례·심판례 원문
  → 법리 카드 구조화 추출
  → evidenceSpan 문자 단위 검증
  → issueEmbedding 생성
  → pgvector + citation 1-hop 후보 생성
  → 문서쌍 관계 구조화 판정
  → 관계 검증 R1~R6
  → 검수 상태와 함께 관계 DB 저장

[질문 응답]
사용자 질문
  → 기존 generateAnswer
  → 기존 RAG 5단계
  → 기존 law-verifier V1~V6
  → 검증된 답변
  → 답변에 포함된 비법령 자료의 documentKey 조회
  → VERIFIED 관계 1-hop 조회
  → 별도 관계 카드용 shadow 결과
```

### 3.1 계층 책임

```text
UI (app/)
  → API Route (app/api/)
    → Usecase (src/usecases/)
      → Port (src/ports/)
        → Adapter (src/adapters/)
```

- UI: 관계 카드 표현만 담당
- API Route: 입력 검증, 의존성 주입, 응답 매핑만 담당
- Usecase: 추출·검색·판정·검증·저장 순서 오케스트레이션
- Port: LLM, DB, 임베딩 인터페이스
- Adapter: AI SDK, Voyage, Postgres 등 외부 I/O
- Domain: 문서키, 상태 전이, evidence 검증, 관계 규칙

---

## 4. 데이터 계층 분리

### 4.1 기존 `citation_edges`

기존 테이블은 **원문에서 확인된 인용 사실** 전용으로 유지한다.

- `REFERS`
- `FOLLOWS`
- `APPEAL`

금지사항:

- 법리 관계를 이 테이블에 저장하지 않는다.
- `OVERRULED`로 기존 `edge_type`을 덮어쓰지 않는다.
- 기존 유일성·적재·피인용 랭킹 의미를 변경하지 않는다.

### 4.2 신규 테이블 3개

관계 비교와 법적 효력 변경을 한 테이블에 섞지 않는다.

| 테이블 | 책임 |
|---|---|
| `legal_propositions` | 문서별·쟁점별 파생 법리 카드와 원문 증거 저장 |
| `legal_comparison_edges` | 두 법리 카드 사이의 유사·구별·다른 결론 관계 저장 |
| `legal_validity_events` | 폐기·변경 등 권위 있는 효력 변경 사실 저장 |

별도 테이블 방식은 테이블 수와 조인이 늘지만, LLM 비교 결과가 법적 효력 변경으로 오인되는 것을 구조적으로 막는다.

---

## 5. Canonical Document Key

### 5.1 규칙

문서 식별 우선순위는 다음과 같다.

1. 신뢰할 수 있는 `externalId`가 있으면 `sourceType + externalId`
2. 판례·심판례에서 `externalId`가 없으면 `sourceType + normalizedIssuingBody + normalizedCaseNumber`
3. 위 키를 만들 수 없으면 임의 대체키를 생성하지 않고 검수 대기열로 보낸다.

예시:

```text
판례|대법원|2025두34772
심판례|조세심판원|조심2012서2892
해석례|nts:123456789
```

### 5.2 금지 및 스냅샷

- `caseNumber` 단독 키 사용 금지
- `contentHash`를 문서 동일성 키로 사용 금지
- `decisionDate`는 동일성 보조 검증값으로 저장
- `contentHash`는 원문 변경 감지용으로 저장
- 원문 해시가 바뀌면 해당 법리 카드와 모든 연결 관계를 `STALE` 처리

### 5.3 필수 검증

- 기존에 확인된 법원별 동일 사건번호 충돌 유형 14건을 fixture로 만든다.
- 모든 fixture가 서로 다른 `documentKey`로 생성되는지 검증한다.
- 정규화 후 빈 문자열 또는 충돌이 발생하면 적재를 거부한다.

---

## 6. 도메인 모델

### 6.1 `legal_propositions`

권장 필드:

```text
id
document_key
source_type
external_id nullable
case_number nullable
issuing_body nullable
decision_date nullable
issue_key
issue_text
statute_refs jsonb
fact_pattern
holding
outcome
conditions jsonb
exceptions jsonb
applicable_period jsonb
evidence_spans jsonb
evidence_hash
content_hash
extractor_version
review_status
issue_embedding vector(1024)
embedding_model
embedding_input_hash
created_at
updated_at
```

원칙:

- 한 문서에 쟁점이 여러 개면 법리 카드도 여러 개 생성할 수 있다.
- `fact_pattern`, `holding`은 파생 검색 데이터이며 인용문이 아니다.
- 사용자에게 보여줄 수 있는 텍스트는 검증된 `evidence_spans[].text`와 원문 링크뿐이다.
- 권장 유일성 키는 `document_key + content_hash + extractor_version + issue_key + evidence_hash` 조합이다.

### 6.2 `legal_comparison_edges`

권장 필드:

```text
id
from_proposition_id
to_proposition_id
relation_type
same_issue
comparable_facts
material_fact_differences jsonb
from_evidence_spans jsonb
to_evidence_spans jsonb
from_content_hash
to_content_hash
relation_source
model_version nullable
prompt_version nullable
confidence nullable
review_status
abstain_reason nullable
created_at
updated_at
```

원칙:

- 관계는 원문 문서가 아니라 쟁점별 법리 카드 사이에 생성한다.
- 양쪽 원문 증거가 모두 있어야 한다.
- `confidence`는 승인 조건으로 사용하지 않고 분석용으로만 저장한다.
- 같은 법리 카드쌍에 서로 다른 쟁점·관계가 공존할 수 있어야 한다.

### 6.3 `legal_validity_events`

권장 필드:

```text
id
subject_document_key
subject_proposition_id nullable
target_document_key nullable
target_proposition_id nullable
event_type
source_review
from_evidence_spans jsonb
to_evidence_spans jsonb
from_content_hash
to_content_hash nullable
review_status
review_note nullable
created_at
updated_at
```

원칙:

- `event_type`: `OVERRULED`, `SUPERSEDED_BY_LAW`
- 모델은 `VERIFIED` 상태를 생성할 수 없다.
- `SUPERSEDED_BY_LAW`는 법령 버전·시행일·부칙 연결 전까지 `PENDING_LAW_LINK` 상태로 유지한다.
- 검수자 이메일·이름 등 개인 식별정보는 저장하지 않는다.

---

## 7. 관계 분류 체계

### 7.1 비교 관계

| 코드 | 의미 | 사용자 표현 | 필수 조건 |
|---|---|---|---|
| `SUPPORTS` | 같은 판단기준과 같은 방향의 결론 | 같은 방향의 법리 | 같은 쟁점·판단기준·결론 방향 |
| `ANALOGOUS` | 논리적으로 유사하지만 사실이 완전히 같지 않음 | 유사한 법리 | 유사 쟁점과 설명 가능한 사실 차이 |
| `DISTINGUISHES` | 중요한 사실 차이로 직접 적용이 어려움 | 구별되는 사례 | 결론을 가르는 중요 사실 차이 명시 |
| `OPPOSITE_OUTCOME` | 비교 가능한 쟁점에서 결과가 다름 | 다른 결론 | 같은 쟁점, 비교 가능한 사실, 서로 다른 outcome |
| `UNKNOWN` | 안전하게 관계를 확정할 수 없음 | 관계 확인 어려움 | 증거·시점·사실 비교 부족 |

`OPPOSITE_OUTCOME`을 자동으로 “반대 법리”라고 표시하지 않는다. 결론만 다르고 법리가 같을 수 있기 때문이다.

### 7.2 효력 관계

| 코드 | 의미 | 승인 주체 |
|---|---|---|
| `OVERRULED` | 후속·상급 판단으로 기존 판단이 폐기 또는 변경됨 | 회계사 수기 검수 필수 |
| `SUPERSEDED_BY_LAW` | 법령 개정으로 기존 판단의 적용 가능성이 변경됨 | 법령 버전 연결 + 회계사 검수 필수 |

---

## 8. Evidence Span과 무효화

### 8.1 evidence 형식

```json
{
  "start": 120,
  "end": 184,
  "text": "원문에서 그대로 복사된 문자열",
  "section": "판결요지"
}
```

### 8.2 검증 규칙

```text
sourceContent.slice(start, end) === evidence.text
```

- 공백·문장부호를 포함해 문자 단위로 일치해야 한다.
- 퍼지 매칭을 사용하지 않는다.
- 관계 판정은 양쪽 문서에서 각각 최소 1개 이상의 증거를 요구한다.
- 실패 시 관계를 저장하지 않거나 `REJECTED`로 저장한다.

### 8.3 원문 변경

1. 현재 원문의 `contentHash`를 다시 계산한다.
2. 저장된 해시와 다르면 법리 카드를 `STALE` 처리한다.
3. 해당 카드에 연결된 비교 관계와 효력 관계도 사용자 노출 대상에서 제외한다.
4. 재추출·재검증 후에만 다시 활성화한다.

---

## 9. 관계 검증 R1~R6

기존 답변 검증 V1~V6를 수정하지 않고 별도 순수 함수로 구현한다.

| 항목 | 통과 조건 | 실패 처리 |
|---|---|---|
| R1 문서 동일성 | 양쪽 `documentKey`가 각각 정확히 한 현재 문서로 해석됨 | `REJECTED` |
| R2 원문 최신성 | 양쪽 `contentHash`가 현재 원문과 일치하고 `STALE`이 아님 | `STALE` |
| R3 증거 무결성 | 양쪽 evidence가 원문과 문자 단위 일치 | `REJECTED` |
| R4 쟁점·시점 정합 | 비교 가능한 쟁점이고 적용 시점 충돌이 없음 | `UNKNOWN` |
| R5 관계 일관성 | 관계 유형별 필수 사실·결론 조건 충족 | `UNKNOWN` |
| R6 승격 제한 | 효력 변경은 승인된 수기 출처만 사용자 노출 가능 | 내부 후보 유지 또는 `REJECTED` |

R5 세부 규칙:

- `SUPPORTS`: 결론 방향이 같아야 한다.
- `DISTINGUISHES`: 하나 이상의 중요한 사실 차이를 구체적으로 기록해야 한다.
- `OPPOSITE_OUTCOME`: 같은 쟁점, 비교 가능한 사실, 서로 다른 결론을 모두 충족해야 한다.
- 하나라도 애매하면 강제로 관계를 만들지 않고 `UNKNOWN`으로 기권한다.

---

## 10. 오프라인 처리 흐름

### 10.1 법리 카드 추출

1. 파일럿 원문을 `TaxLaw`에서 조회한다.
2. LLM이 `issueText`, 사실관계, 판단기준, 결론, 조건·예외, evidence 위치를 구조화 출력한다.
3. Zod 스키마와 evidence 문자 검증을 통과한 결과만 저장한다.
4. 원문은 수정하거나 요약본으로 대체하지 않는다.

새 LLM 어댑터는 현재 AI SDK v6 기준으로 다음 방식을 사용한다.

- `generateText`
- `Output.object({ schema })`
- 엄격한 Zod 스키마
- timeout, retry, abort signal
- `NoObjectGeneratedError` 명시 처리

기존 `generateObject` 기반 어댑터는 이 기능 티켓에서 리팩터링하지 않는다.

### 10.2 임베딩

- 기존 Voyage 어댑터와 `voyage-4`, 1024차원을 재사용한다.
- 첫 파일럿은 `issueText` 한 종류만 임베딩한다.
- 배치 생성은 기존 `embedMany` 경로와 비용 로그를 사용한다.
- `factEmbedding`, `holdingEmbedding`은 Recall 개선이 측정된 뒤 별도 티켓으로 검토한다.

### 10.3 후보 문서쌍 생성

후보 신호:

1. 같은 `issueKey`
2. `issueEmbedding` 유사도
3. 같은 법령·조문 참조
4. 기존 `citation_edges` 1-hop
5. 결정일과 적용 시점 호환성

파일럿에서는 회계사가 고른 20~30 문서쌍을 우선 사용한다. 전 코퍼스의 모든 조합을 생성하지 않는다.

### 10.4 관계 판정

LLM 출력 필드:

```text
relationType
sameIssue
comparableFacts
materialFactDifferences[]
fromEvidenceSpans[]
toEvidenceSpans[]
abstainReason nullable
```

구조화 출력 후 R1~R6를 실행하고, 모델 결과는 최초에 `AUTO_CANDIDATE`로만 저장한다.

---

## 11. 질문 단위 Shadow Usecase

### 11.1 신규 Usecase

`generateAnswerWithRelationShadow` 또는 동등한 상위 Usecase를 추가한다.

책임:

1. 기존 `generateAnswer` 호출
2. 기존 답변의 V1~V6 성공 확인
3. 답변에 포함된 판례·심판례·참고자료의 `documentKey` 생성
4. `VERIFIED` 관계 1-hop 조회
5. 시점·쟁점·상태 필터링
6. 관계 유형별 정렬 및 최대 건수 제한
7. 기존 답변과 관계 shadow 결과 조립

금지:

- 기존 `generateAnswer` 내부에 관계 로직 직접 삽입
- API Route에서 관계 검색·검증 순서 조립
- 관계 조회 실패로 기존 답변 실패 처리
- `references` 관계 자료를 `citations`로 자동 승격
- 파일럿에서 관계판정 LLM 온라인 호출

### 11.2 내부 출력 예시

```json
{
  "answer": "기존 LabeledAnswer",
  "relations": {
    "mode": "shadow",
    "status": "verified|none|abstained|unavailable",
    "items": [
      {
        "anchorDocumentKey": "판례|대법원|2025두34772",
        "relatedDocumentKey": "심판례|조세심판원|조심2012서2892",
        "relationType": "DISTINGUISHES",
        "issueText": "지출이 접대비에 해당하는지 여부",
        "materialFactDifferences": ["수혜자가 불특정 다수인지 여부"],
        "anchorEvidence": [],
        "relatedEvidence": [],
        "reviewStatus": "VERIFIED",
        "sourceUrls": []
      }
    ]
  }
}
```

---

## 12. 예상 파일 구조

```text
src/domain/
  documentKey.ts
  legalRelation.ts
  relationVerifier.ts

src/ports/
  legalPropositionRepositoryPort.ts
  legalRelationRepositoryPort.ts
  legalPropositionExtractorPort.ts
  legalRelationClassifierPort.ts

src/adapters/
  postgresLegalRelationRepository.ts
  llmLegalPropositionExtractor.ts
  llmLegalRelationClassifier.ts

src/usecases/
  extractLegalPropositions.ts
  buildLegalRelationCandidates.ts
  importLegalValidityEvents.ts
  findVerifiedLegalRelations.ts
  generateAnswerWithRelationShadow.ts

scripts/
  extractLegalPropositions.ts
  buildLegalRelationCandidates.ts
  importLegalValidityEvents.ts

tests/unit/
  documentKey.test.ts
  relationVerifier.test.ts
  legalRelationState.test.ts

tests/integration/
  legalRelationRepository.test.ts
  generateAnswerWithRelationShadow.test.ts
```

실제 파일명은 기존 프로젝트 명명 규칙과 충돌 여부를 확인한 뒤 티켓에서 확정한다.

---

## 13. 티켓 로드맵

### LR-001. 설계 결정 및 상위 문서 정합

- 관계 정의, canonical document key, 저장 분리, 노출 정책 확정
- PRD·SSOT에 필요한 변경 범위 제시
- 구현 금지

완료 조건:

- §14 승인 4건 기록
- 문서 충돌 0건
- 후속 티켓 범위 확정

### LR-002. 문서키와 관계 데이터 모델

- `documentKey` 순수 함수·타입
- 신규 3개 테이블 DDL
- repository port의 최소 인터페이스

완료 조건:

- 기존 `citation_edges` DDL·데이터 무변경
- 동일 사건번호 충돌 fixture 14건 분리
- 복수 관계 공존
- DDL 멱등·롤백 검증

### LR-003. 단일 쟁점 스모크 평가셋

- 접대비 쟁점 문서쌍 20~30개
- 관계 정답과 양쪽 원문 evidence
- 회계사 전건 검수

완료 조건:

- evidence 원문 일치 100%
- LLM 자동 정답 생성 금지
- Precision 95% 입증 주장 금지

### LR-004. 법리 카드 추출·저장

- 구조화 추출 adapter
- evidence verifier
- proposition 저장 Usecase
- contentHash 무효화

완료 조건:

- 스모크 문서 evidence 일치 100%
- 실패 결과 적재 차단
- 재실행 멱등
- 원문 변경 시 `STALE`

### LR-005. 쟁점 임베딩과 후보 검색

- `issueEmbedding` 생성·저장
- 전문 임베딩, 직접검색, citation 1-hop과 Recall@K 비교
- 후보 중복 제거와 결정론적 정렬

완료 조건:

- 기준선과 비교 결과 리포트
- ANN·2-hop·리랭커 미도입
- 소표본 결과 일반화 금지

### LR-006. TAX-6B-33 검수결과 Import

- 기존 수기 검수 파일 parser 재사용 또는 안전한 변환
- `OVERRULED`와 `SUPERSEDED_BY_LAW` 분리 적재
- 보류·해당 없음 처리

완료 조건:

- 확정 항목만 적재
- 기존 `citation_edges` 덮어쓰기 0건
- `SUPERSEDED_BY_LAW`는 법령 링크 전까지 `PENDING_LAW_LINK`
- 개인 식별자 저장 0건

### LR-007. 문서쌍 관계 판정과 R1~R6

- 구조화 관계 classifier
- 순수 함수 relation verifier
- 상태 전이

완료 조건:

- 양쪽 evidence 일치 100%
- 스모크셋 치명 오판 0건
- 불확실 결과 `UNKNOWN`
- 모델이 효력 관계를 `VERIFIED`로 승격하는 경로 0개

### LR-008. 질문 단위 Shadow Usecase

- 기존 답변 + 관계 조회 결과 조립
- 실패·기권·관계 없음 경로
- Route 없이 실행 가능한 내부 결과

완료 조건:

- 기존 `generateAnswer` 변경 없음
- 기존 V1~V6 우회 없음
- 관계 실패가 기존 답변에 미치는 영향 0건
- 온라인 관계판정 LLM 호출 0회

### LR-009. 증분 성능·비용 하네스

- 동일 입력으로 관계 기능 off/on 반복 측정
- P50/P95, DB 호출, LLM 호출, 임베딩 호출, 토큰·비용 분리

제안 게이트:

- 온라인 관계판정 LLM 추가 호출 0회
- 증분 P95 1초 이하
- 실제 상한은 실행 전 회계사 승인

### LR-010. 베타용 별도 Holdout

- 스모크셋과 분리
- 프롬프트 튜닝에 사용 금지
- 클래스별 precision, 혼동행렬, coverage, abstain, 신뢰구간 산출

완료 조건:

- 최소 비기권 표본 수 승인
- 최대 abstain 비율 승인
- 신뢰구간 방식 승인
- 고위험 관계의 false positive 0건

### LR-011. 내부 관계 카드 API·UI

- shadow 결과를 내부 전용으로 표시
- 그래프가 아닌 비교 카드 사용

권장 섹션:

- 같은 방향의 근거
- 유사하지만 사실이 다른 자료
- 구별되는 사실관계
- 다른 결론
- 수기 검수된 효력 변경 경고

완료 조건:

- 양쪽 원문 evidence, 링크, 결정일, Trust Tier, 검수 상태 표시
- `UNKNOWN`을 확정 법리처럼 표시하지 않음
- 관계 자료를 답변 인용으로 승격하지 않음

### PERF-001. 기존 종단 P95 진단 — 별도 트랙

- 현재 약 25.37초와 LLM 구간 약 17.91초 재현
- 원인별 시간을 분해하고 수정 티켓 제안
- 진단 전 모델·프롬프트 임의 변경 금지

내부 shadow 착수와 병행할 수 있지만 회계사 베타 전에 전체 P95 15초 목표 회복 여부를 확인한다.

---

## 14. 구현 전 회계사 승인 항목

Claude는 LR-001에서 다음 네 항목을 명시적으로 승인받는다.

### 결정 1. 저장 구조

- **A. 법리 카드·비교 관계·효력 관계 3테이블 분리 — 추천**
  - 장점: LLM 비교와 법적 효력을 혼동하지 않고 감사·검수가 쉬움
  - 단점: 테이블과 조인이 늘어남
- B. 비교·효력 관계를 하나의 관계 테이블에 통합
  - 장점: 초기 DDL이 단순함
  - 단점: 자동 판정이 법적 효력으로 잘못 승격될 위험이 커짐

### 결정 2. 판정 시점

- **A. 오프라인 사전 판정 — 추천**
  - 장점: 온라인 지연·비용·비결정성을 최소화함
  - 단점: 사전 처리되지 않은 문서는 관계 결과가 없음
- B. 질문 시 온라인 판정
  - 장점: 신규 문서쌍 coverage가 높음
  - 단점: 지연·비용·환각 위험이 증가함

### 결정 3. 첫 쟁점

- **A. 접대비 vs 광고선전비·판매촉진비 — 추천**
  - 장점: 기존 후보가 있고 서로 다른 결론을 비교하기 좋음
  - 단점: 사실관계 축을 세밀하게 정의해야 함
- B. 1세대 1주택 비과세
  - 장점: 실무 수요가 큼
  - 단점: 빈번한 개정과 시점 판단이 파일럿을 복잡하게 함

### 결정 4. 초기 사용자 노출

- **A. 회계사 검수 `VERIFIED` 관계만 노출 — 추천**
  - 장점: 정확성 원칙을 가장 강하게 지킬 수 있음
  - 단점: 초기 coverage와 확장 속도가 낮음
- B. R1~R6 자동 통과 관계도 노출
  - 장점: 빠르게 많은 결과를 제공할 수 있음
  - 단점: 충분한 holdout 전에는 치명 오판 위험이 남음

추천 승인 조합: **1-A / 2-A / 3-A / 4-A**

---

## 15. 검증 게이트

| 단계 | 정확성 | 원문 무결성 | 데이터·검수 | 성능 |
|---|---|---|---|---|
| 파일럿 착수 | 관계 정의와 기권 정책 승인 | evidence·hash 규칙 승인 | 문서키·DDL 승인 | 대상 아님 |
| 스모크 | 치명 오판 0건 | 양쪽 evidence 일치 100% | 20~30쌍 전건 회계사 라벨 | 계측 준비 |
| 내부 shadow | R6 과대 승격 0건 | 원문 링크·증거 표시 | LR-006·008 완료 | 증분 P95 승인 상한 내 |
| 베타용 검증 | 승인된 신뢰구간 기준으로 precision 평가 | 동일 기준 유지 | 최소 비기권 N·최대 abstain 충족 | 측정값 기록 |
| 회계사 베타 | 고위험 false positive 0건 | 동일 기준 유지 | 중단·롤백 경로 확인 | 전체 P95 15초 목표 회복 |

20~30쌍은 파이프라인 스모크셋이며 Precision 95% 인증셋이 아니다.

참고로 오류가 0건이라는 조건에서 한쪽 95% 신뢰하한이 95% 이상이려면 클래스별 비기권 표본이 대략 59건 이상 필요하다. 실제 표본 수와 신뢰구간 방식은 LR-010 전에 회계사가 승인한다.

---

## 16. 테스트 전략

### 16.1 도메인 단위 테스트

- canonical document key 정규화
- 동일 사건번호 충돌 fixture 14건
- evidence offset 문자 일치
- contentHash 변경 시 `STALE`
- 관계별 R1~R6
- 모델 결과의 효력 관계 자동 승격 차단

### 16.2 LLM·임베딩 Adapter 테스트

- AI SDK `MockLanguageModelV3`
- AI SDK `MockEmbeddingModelV3`
- 정상 구조화 출력
- 스키마 불일치
- `NoObjectGeneratedError`
- timeout·재시도·abort
- 임베딩 차원 불일치

### 16.3 DB 통합 테스트

- 신규 DDL 멱등성
- 한 법리 카드쌍의 복수 관계 저장
- unique constraint
- import 재실행 멱등성
- transaction rollback
- stale 관계 조회 차단

### 16.4 Usecase 통합 테스트

- 기존 답변 성공 + 관계 성공
- 기존 답변 성공 + 관계 없음
- 기존 답변 성공 + 관계 실패
- 기존 답변 실패 시 관계 미노출
- 관계 기권
- V1~V6와 R1~R6 분리 유지

### 16.5 회귀 테스트

- 기존 lint, typecheck, unit, integration 전부 통과
- 기존 골든셋 무변경 통과
- 답변 인용·라벨·시점 회귀 0건

---

## 17. 상태 전이

### 법리 카드

```text
EXTRACTED
  → EVIDENCE_VERIFIED
  → ACCOUNTANT_VERIFIED 또는 REJECTED
  → 원문 변경 시 STALE
```

### 비교 관계

```text
AUTO_CANDIDATE
  → R1_R6_PASS
  → ACCOUNTANT_VERIFIED / REJECTED / ABSTAINED
  → 조건 충족 후 BETA_VISIBLE
  → 원문 변경 시 STALE
```

### 효력 관계

```text
IMPORTED_PENDING
  → MANUAL_VERIFIED
  → 필요한 링크 검증 완료
  → VISIBLE
```

LLM은 효력 관계를 `MANUAL_VERIFIED` 또는 `VISIBLE`로 전이할 수 없다.

---

## 18. 성능·비용 원칙

- 첫 파일럿은 리랭커를 도입하지 않는다.
- 온라인에서 관계판정 LLM을 호출하지 않는다.
- 관계 기능 on/off의 증분 P95를 별도로 측정한다.
- 기존 전체 P95 문제는 PERF-001에서 별도로 진단한다.
- 오프라인 추출·판정은 최대 문서 수, 최대 문서쌍 수, 예상 토큰, 예상 비용을 실행 전에 산출한다.
- 전 코퍼스 백필은 단일 쟁점 스모크와 holdout 결과가 나온 뒤 별도 승인받는다.

제안 초기 목표:

- 온라인 추가 LLM 호출: 0회
- 온라인 추가 임베딩 API 호출: 0회
- 관계 조회 증분 P95: 1초 이하
- evidence 문자 일치율: 100%
- 고위험 관계 치명 false positive: 0건

---

## 19. 재평가 점수를 높이기 위한 필수 증거

문서 계획만 추가해서는 재평가 점수가 크게 오르지 않는다. 다음 실행 증거가 필요하다.

1. 기존 `citation_edges`를 보존한 신규 DDL과 통합 테스트 결과
2. 동일 사건번호 충돌 14건을 분리하는 document key 테스트
3. TAX-6B-33 검수결과 import 결과와 멱등성 증거
4. 양쪽 evidence 문자 일치율 100% 결과
5. 질문 단위 shadow Usecase 실행 결과
6. 기능 off/on 증분 P95·호출 수·실제 비용
7. 별도 holdout의 precision·coverage·abstain·신뢰구간
8. 기존 답변 V1~V6와 골든셋 회귀 결과

위 증거는 재평가서의 주요 결함인 관계 데이터 혼합, 문서 식별 충돌, 검수결과 미적재, Usecase 배선 누락, 표본·통계 부족, 성능·비용 불명확성을 직접 해소한다.

---

## 20. 예상 일정

회계사 1인 검수와 AI 협업을 전제로 한 대략적인 일정이다.

| 구간 | 예상 기간 | 주요 산출물 |
|---|---:|---|
| 설계 승인·문서 정합 | 2~3일 | LR-001 |
| 문서키·DDL·저장소 | 4~6일 | LR-002 |
| 스모크셋 검수 | 3~7일 | LR-003 |
| 추출·임베딩·후보 생성 | 7~10일 | LR-004~005 |
| 검수 import·관계 판정 | 7~10일 | LR-006~007 |
| shadow·성능 측정 | 5~7일 | LR-008~009 |
| holdout 검수 | 표본 수에 따라 변동 | LR-010 |
| 내부 카드 UI | 4~6일 | LR-011 |

개발 공수는 약 25~35일, 회계사 검수와 holdout 준비를 포함한 전체 일정은 약 8~12주를 예상한다. 이는 확정 납기가 아니라 티켓 분해용 추정치다.

---

## 21. 최종 구현 원칙

1. 기존 답변 경로와 법리 관계 경로를 분리한다.
2. 원문 인용 사실과 LLM 법리 판단을 분리한다.
3. 유사 법리와 법적 효력 변경을 분리한다.
4. 파생 요약은 검색용이며 인용하지 않는다.
5. 양쪽 원문 증거가 없으면 관계를 확정하지 않는다.
6. 결론이 다르다는 이유만으로 “반대 법리”라고 단정하지 않는다.
7. 미검수 효력 변경을 사용자에게 노출하지 않는다.
8. 관계 기능 실패가 기존 검증 답변을 막지 않게 한다.
9. 작은 스모크셋으로 Precision 95%를 주장하지 않는다.
10. UI보다 데이터 식별·검증·추적 가능성을 먼저 완성한다.

> 정확성 > 완전성 > 속도 > 편의성
>
> 틀린 관계는 관계가 없는 것보다 나쁘다.

