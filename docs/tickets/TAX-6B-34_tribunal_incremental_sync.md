# TAX-6B-34 심판례 주간 증분 수집

## Metadata

- **Type**: FEAT
- **Severity**: minor
- **Layer**: infra (scripts)
- **Milestone**: Post-M6B 운영 유지보수
- **Estimated Size**: S (1파일 — `scripts/collectTribunal.ts`에 모드 추가)

---

## 1. Problem

- TAX-6B-18로 심판례 135,810건을 전량 1회성 적재했다. 그러나 조세심판원은 매주 수백 건씩
  새 결정례를 낸다. 지금은 새 심판례를 가져와 pgvector에 추가하는 경로가 없다 — 시간이
  지날수록 벡터 검색 결과가 실시간 API보다 뒤처진다.
- 국세법령정보시스템 API는 날짜 필터(`prncYd`, `date`)를 지원하지 않는다(TAX-6B-18 §2.4 실측
  확인). `sort=ddes`(최신순)만 지원한다.

## 2. 결정 사항 (회계사 확정, 2026-07-04)

| 항목 | 결정 | 이유 |
|---|---|---|
| 실행 방식 | **수동 실행** | 새 서버·스케줄러 인프라 불필요, 임베딩 비용을 사람이 매번 확인 후 지출 |
| 주기 | **매주 1회** | 신규 건수가 주당 수백 건 규모라 매주가 적재 지연·1회 비용 모두 합리적 |

→ 자동 크론은 도입하지 않는다. 회계사가 매주 명령어 두 줄(수집→임베딩)을 직접 실행한다.

## 3. 기대 동작

```
npm run collect:tribunal -- --incremental
  → sort=ddes로 최신 페이지부터 가져오면서, DB에 이미 있는 case_number를 만나면
    (한 페이지 전체가 이미 알려진 경우) 페이징 중단.
  → 신규 건만 scripts/tribunal_incremental_<YYYYMMDD>.json 에 기록.

npm run embed -- --input scripts/tribunal_incremental_<YYYYMMDD>.json
  → 기존 embed.ts 그대로 재사용 (content_hash 멱등성 그대로 적용).
```

- 전량 재수집(1,398페이지, 1~2시간) 없이, 최신 몇 페이지만 확인하고 끝난다
  (신규 수백 건 기준 페이지 수 적음 → 수 분 내 완료 예상).
- "이미 알려진 case_number" 판정은 **로컬 파일이 아니라 실제 Neon DB**에 질의해 확인한다
  (production 진실 소스가 DB이므로).

## 4. 구현 계획

**영향 파일**: `scripts/collectTribunal.ts` (수정, `--incremental` 플래그 추가) — 신규 파일 없음,
기존 페이징/재시도/§7 키 비노출 로직 재사용.

1. `--incremental` 플래그 추가 시:
   - `sort=ddes`로 페이지 1부터 순차 조회(기존 페이징 로직 재사용).
   - 매 페이지의 `caseNumber` 목록을 모아 `SELECT case_number FROM taxlaw_embeddings
     WHERE source_type='심판례' AND case_number = ANY($1)`로 DB 대조.
   - 한 페이지 전체가 이미 DB에 있으면 그 페이지에서 중단(그 이후는 전부 더 오래된 기존 데이터).
   - 신규(미존재) 건만 본문 조회 후 `scripts/tribunal_incremental_<날짜>.json`에 기록.
2. 기존 `--finalize`/체크포인트/재개 로직은 증분 모드에서도 그대로 활용(중단 시 안전).
3. 순수 함수(중단 판정 로직 등)는 기존 `tests/unit/collectTribunal.test.ts`에 케이스 추가.
4. `npm run embed`는 변경 없음(입력 파일 경로만 다르게 지정).

### 4.1 구현 중 설계 보강 (2026-07-04)

- **기지 판정 = 원장(list.json) ∪ DB**: DB 단독 대조로는 content_hash dedup으로 전용 행이
  없는 병합 사건번호 3,981건(TAX-6B-18 §발견)이 매주 "신규"로 오인돼, 전 페이지의 약 94%에
  1건 이상 산재하는 이들 때문에 조기 종료가 무력화된다. 전량 수집 목록(list.json)을
  원장으로 삼아 이를 흡수하고, 매 실행의 성공 항목을 원장에 추가해 자가 치유한다.
- **`--max`(테스트 상한) 실행은 원장 비갱신**: 테스트 산출물을 임베딩하지 않고 버릴 때
  원장에만 기록되면 해당 건이 영구 누락되므로 방지.

## 5. Acceptance Criteria

1. [ ] `--incremental` 플래그로 실행 시 전량이 아닌 최신 페이지만 조회하고 조기 종료한다.
2. [ ] DB에 이미 있는 case_number는 재조회하지 않는다(본문 API 호출 절약).
3. [ ] 신규 산출물 파일이 기존 `embed.ts` 입력 포맷과 100% 호환된다(별도 변환 불필요).
4. [ ] 키(OC) 비노출·§6.1 문자 단위 보존 등 기존 안전장치 회귀 없음.
5. [ ] vitest 전체 그린.

## 6. Risks

- DB 대조 질의가 페이지마다 발생 → 매주 실행이라 부담 적음(1회성 배치 스크립트, P95 게이트와 무관).
- 회계사가 실행을 잊으면 그만큼 지연 누적 — 자동화가 아니므로 발생 가능한 한계이며,
  이번 결정(수동/매주)에서 감수하기로 함.

---

**작성자**: AI (Claude)
**작성일**: 2026-07-04
**상태**: ✅ 구현 완료 (2026-07-04, 회계사 승인 "구현시작해" — 리포트: docs/reports/TAX-6B-34_report.md)
