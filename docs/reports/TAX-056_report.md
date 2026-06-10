# TAX-056 구현 리포트 — 베타 접근 패스코드 게이트

- **티켓**: `docs/tickets/TAX-056_beta_access_passcode_gate.md`
- **구현일**: 2026-06-11
- **구현자**: Claude + 회계사 승인
- **상태**: ✅ 완료 (회계사 §6 브라우저 검증 대기)

---

## 1. 변경 사항 요약

베타 테스트(지인 회계사 소수) 배포를 위한 **단일 공유 패스코드 접근 게이트**를 구현했습니다.
개인 계정·식별 없이, "건물 정문 자물쇠" 방식으로 미인가 접근을 차단합니다.

### 파일 변경 목록

**신규 (6):**
- `proxy.ts` — 정문 경비원. 모든 요청의 쿠키 세션 검증 (Edge 런타임)
- `src/auth/session.ts` — 서명·검증 순수함수 (Web Crypto, Edge·Node 공용)
- `app/login/page.tsx` — 패스코드 입력 화면
- `app/api/auth/login/route.ts` — 패스코드 검증 + 서명 쿠키 발급 (Node 런타임)
- `app/api/auth/logout/route.ts` — 쿠키 만료(로그아웃)
- `tests/unit/session.test.ts` — 서명·검증 회귀 테스트 13건

**수정 (4):**
- `src/config.ts` — `BETA_ACCESS_CODE`·`SESSION_SECRET` 필수 환경변수 추가
- `.env.example` — 신규 환경변수 2개 템플릿 추가
- `tests/setup.ts` — 테스트용 더미 환경변수 2개 주입
- `docs/SSOT.md` §1.3 — 베타 접근 제어 한 줄 명시 (회계사 승인)

### 주요 변경 설명

- **세션 방식**: 쿠키에 패스코드 평문이 아니라 `HMAC-SHA256(SESSION_SECRET, "beta-valid")` 서명만 저장. 시크릿을 모르면 위조 불가
- **상수 시간 비교**: 패스코드 검증에 `constantTimeEqual` 사용 (타이밍 공격 방지)
- **쿠키 속성**: `httpOnly`·`secure`(프로덕션)·`sameSite=lax`·`maxAge=30일`(회계사 결정)
- **세션 유지**: 30일 (회계사 결정)
- **신규 npm 의존성 0개** — Next.js 내장 + Web Crypto만 사용

---

## 2. 회계사 결정 사항 (구현 전 승인)

| 결정 | 선택 |
|---|---|
| SSOT §11.3 정합 처리 | SSOT §1.3에 베타 접근 제어 한 줄 추가 후 구현 |
| 세션 유지 기간 | 30일 |

---

## 3. 검증 결과

| 검증 | 방법 | 결과 |
|---|---|---|
| 타입 체크 | `npx tsc --noEmit` | ✅ 에러 0 |
| 신규 단위 테스트 | `vitest run session.test.ts` | ✅ 13/13 |
| 전체 회귀 테스트 | `vitest run` | ✅ 450/450 (기존 437 + 신규 13) |
| 프로덕션 빌드 | `npm run build` | ✅ 성공, Proxy 정상 번들 |
| 런타임 — 쿠키 없이 `/` 접속 | curl | ✅ 307 → `/login` |
| 런타임 — 틀린 패스코드 | curl POST | ✅ 401 거부 |
| 런타임 — 맞는 패스코드 | curl POST | ✅ 200 + Set-Cookie(HttpOnly·30일) |
| 런타임 — 발급 쿠키로 `/` 접속 | curl | ✅ 200 통과 |
| 런타임 — 쿠키 평문 노출 | 쿠키값 확인 | ✅ 서명 hex 64자, 패스코드 없음 |

> RAG 파이프라인·law-verifier V1~V6·usecase·adapter·domain 무변경 → 답변 정확성 로직 영향 없음.

---

## 4. 설계 결정 메모

- **`middleware.ts` → `proxy.ts` 마이그레이션**: Next.js 16.2에서 `middleware` 파일 컨벤션이 deprecated되어 권장 컨벤션인 `proxy.ts`(함수명 `proxy`)로 작성. 티켓 §2.1은 `middleware.ts`로 명시했으나 프레임워크 권장 반영. matcher config는 동일
- **미들웨어는 config를 import하지 않음**: `proxy.ts`는 Edge 런타임이고 `src/config.ts`는 `server-only`라, `process.env.SESSION_SECRET`을 직접 읽음. config Fail-fast(앱 시작)와 proxy 시크릿 부재 차단이 이중 안전장치로 작동

---

## 5. 잠재 위험 / 한계

- **단일 공유 패스코드** → 개인별 접근 기록 불가 (베타 의도된 한계). 대규모 전환 시 Clerk 등 계정 인증으로 교체
- **패스코드 유출 시**: `BETA_ACCESS_CODE` 교체 + `SESSION_SECRET` 교체 → 기존 발급 쿠키 전부 무효화(재로그인 강제)
- **`SESSION_SECRET` 미설정 시**: proxy가 전 요청을 `/login`으로 차단(안전측 fail). 단 config Fail-fast가 먼저 앱 시작을 막음

---

## 6. 배포 시 필수 작업 (회계사)

1. `.env.local`에 `BETA_ACCESS_CODE`·`SESSION_SECRET` 설정 후 `npm run dev`로 §6 브라우저 검증
2. Vercel 대시보드 → Settings → Environment Variables에 두 변수 등록 (Production)
3. 지인 회계사에게 URL + 패스코드 전달

---

**리포트 작성일**: 2026-06-11
