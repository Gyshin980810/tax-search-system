# TAX-008 구현 리포트 — Memory 법령 개정 대응 정책 구현

> 완료일: 2026-05-12
> Phase: 3 / 병렬 실행

---

## 파일 변경 목록

| 파일 | 작업 |
|---|---|
| `docs/memory-policy.md` | 신규 생성 |
| `scripts/invalidate-memory.js` | 신규 생성 |

---

## 메모리 3계층 정책

| 계층 | 내용 | 무효화 방식 |
|---|---|---|
| user-global | 회계사 선호 | 수동 갱신만 |
| project-shared | 시스템 운영 정보 | 수동 갱신 |
| 법령 캐시 | 조문별 원문·시점 | 무효화 트리거 자동 처리 |

---

## 무효화 트리거 3종

| 트리거 | CLI 옵션 | 처리 |
|---|---|---|
| T1: 세법 개정 공포일 | `--trigger=개정공포일 --law-id=<ID>` | 해당 조문 캐시 만료 표시 |
| T2: [현행]→[폐지] 변경 | `--trigger=폐지라벨 --law-id=<ID>` | 해당 조문 메모리 만료 표시 |
| T3: 1월 1일 연도전환 | `--trigger=연도전환` | 전체 [현행] 라벨 재검증 목록 출력 |

---

## 검증 결과

| 테스트 | 명령어 | 결과 |
|---|---|---|
| 도움말 출력 | `node scripts/invalidate-memory.js --help` | ✅ 정상 출력 |
| T3 연도전환 트리거 | `node scripts/invalidate-memory.js --trigger=연도전환` | ✅ JSON 출력 + 2개 파일 탐지 |
| 오류 처리 (trigger 없음) | `node scripts/invalidate-memory.js` | ✅ exit(1) + 오류 메시지 |

---

## T3 연도전환 실행 결과 샘플

```json
{
  "trigger": "연도전환",
  "law_id": null,
  "affected_laws": [
    { "file_path": "...2026-05-07.md", "action": "재검증_필요" },
    { "file_path": "...ROADMAP_REVIEW_CHECKLIST.md", "action": "재검증_필요" }
  ],
  "timestamp": "2026-05-12T11:57:11.304Z"
}
```

---

## 검증 체크리스트

- [x] `docs/memory-policy.md`에 3계층 분리 정책 명시
- [x] 무효화 트리거 3종 정의
- [x] `node scripts/invalidate-memory.js --help` 실행 가능
- [x] `--trigger=연도전환` JSON 출력 + 실제 메모리 파일 탐지 확인

---

## Phase 3 게이트 확인 (부분)

| 작업 | 상태 |
|---|---|
| TAX-007: MCP 관리 정책 | ✅ completed |
| TAX-008: Memory 법령 개정 대응 | ✅ completed |
| TAX-009: Observability 로그 | 진행 중 |
