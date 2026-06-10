# TAX-056 베타 접근 패스코드 게이트

> 베타 테스트(지인 회계사 소수)를 위한 단일 공유 패스코드 접근 차단막.
> 개인 계정·식별 없는 "건물 정문 자물쇠" 방식.

---

## Metadata

- **Type**: FEAT
- **Severity**: major
- **Layer**: infra / api / ui
- **Milestone**: Post-MVP (베타 배포 전제조건)
- **Estimated Size**: M (4~5파일)

---

## 1. Problem (문제 정의)

### 1.1 현재 동작

- 인증·접근 제어가 전혀 없음 (`middleware.ts` 부재, 인증 라이브러리 부재)
- 배포 시 **URL을 아는 누구나** 검색 화면에 접근 가능
- 회계사가 본 시스템 답변을 의뢰인 의사결정에 인용하는 도메인 특성상, 미인가 접근은 부적절

### 1.2 기대 동작

- 모든 페이지·API 요청은 **유효한 접근 세션이 없으면 `/login`으로 차단**
- 회계사가 공유받은 패스코드를 1회 입력 → httpOnly 쿠키 발급 → 이후 자동 통과
- 패스코드를 모르면 URL을 알아도 차단 (지인이 URL을 제3자에게 전달해도 안전)

### 1.3 영향·중요도

- **베타 배포의 전제조건.** 이 게이트 없이는 외부 노출 불가
- 사용 대상: 회계사 지인 소수(베타). 대규모 전환 시 Vercel Password Protection 또는 Clerk으로 교체(§7 참조)

---

## 2. Context (기술적 맥락)

### 2.1 관련 파일

- `middleware.ts` (루트, **신규**) — 모든 요청 인터셉트, 쿠키 세션 검증
- `app/login/page.tsx` (**신규**) — 패스코드 입력 폼
- `app/api/auth/login/route.ts` (**신규**) — 패스코드 검증 + 쿠키 발급
- `app/api/auth/logout/route.ts` (**신규, 선택**) — 쿠키 제거
- `src/config.ts` (**수정**) — `BETA_ACCESS_CODE`·`SESSION_SECRET` 추가
- `.env.example` (**수정**) — 신규 환경변수 2개 템플릿

### 2.2 외부 API·리소스

- 외부 API 없음. Web Crypto API(Edge 런타임) + Node crypto(Route) 사용
- 신규 의존성 **0개** (Next.js 내장 기능만 사용)

### 2.3 아키텍처 힌트

```
요청 → middleware.ts (Edge: 쿠키 HMAC 서명 검증)
         ├─ 유효 → 통과 (기존 UI·API 그대로)
         └─ 무효 → /login 리다이렉트
/login → /api/auth/login (Node: 패스코드 상수시간 비교 → 서명 쿠키 발급)
```

- 미들웨어는 **횡단 관심사(cross-cutting)** — RAG 5단계 파이프라인·usecase·adapter 무변경
- 미들웨어(Edge)는 `src/config.ts`(`server-only`)를 import하지 않고 `process.env`를 직접 읽음

---

## 3. Scope (작업 범위) ⭐

### 3.1 허용되는 변경

- [ ] `middleware.ts` 신규 생성
- [ ] `app/login/page.tsx` 신규 생성
- [ ] `app/api/auth/login/route.ts` 신규 생성
- [ ] `app/api/auth/logout/route.ts` 신규 생성 (선택)
- [ ] `src/config.ts`에 환경변수 2개 추가
- [ ] `.env.example`에 환경변수 2개 추가
- [ ] 테스트: `tests/unit/auth.test.ts` (서명·검증 순수함수)

### 3.2 금지되는 변경

- ❌ RAG 파이프라인·usecase·adapter·domain 로직 수정
- ❌ law-verifier V1~V6 변경
- ❌ 개인 계정·이메일·이름 수집 (단일 공유 패스코드만)
- ❌ 회계사 식별자를 로그에 기록 (CLAUDE.md §7)
- ❌ 신규 npm 의존성 추가 (Next.js 내장만 사용)
- ❌ 기존 검색 UI(`app/page.tsx`·components) 레이아웃 변경

---

## 4. Strategy (구현 힌트)

1. **세션 토큰 설계**: 쿠키에 패스코드 평문 저장 금지. `HMAC-SHA256(SESSION_SECRET, "beta-valid")` 서명값을 쿠키로 저장. 미들웨어는 이 서명을 재계산해 일치 검증
2. **패스코드 검증**(`/api/auth/login`, Node 런타임): `crypto.timingSafeEqual`로 `BETA_ACCESS_CODE`와 상수시간 비교(타이밍 공격 방지) → 성공 시 서명 쿠키 발급
3. **쿠키 속성**: `httpOnly`·`secure`(프로덕션)·`sameSite=lax`·`maxAge`(예: 30일)·`path=/`
4. **미들웨어**(Edge 런타임): Web Crypto(`crypto.subtle`)로 쿠키 서명 검증. 예외 경로 화이트리스트 = `/login`, `/api/auth/login`, `/_next/*`, 정적자원, favicon
5. **로그인 페이지**: 패스코드 입력 → POST → 성공 시 원래 목적지(또는 `/`)로 이동, 실패 시 "패스코드가 올바르지 않습니다" 표시
6. **환경변수 4곳 동기화**: `config.ts` + `.env.example` + `.env.local`(회계사) + Vercel 환경변수

---

## 5. Acceptance Criteria (완료 조건)

1. [ ] 쿠키 없는 상태로 `/` 접속 → `/login`으로 리다이렉트
2. [ ] 잘못된 패스코드 입력 → 거부 메시지, 쿠키 미발급
3. [ ] 올바른 패스코드 입력 → 메인 검색 화면 진입, 새로고침해도 유지
4. [ ] `/api/answer` 등 API도 쿠키 없으면 401/리다이렉트로 차단
5. [ ] 쿠키에 패스코드 평문이 저장되지 않음 (서명값만)
6. [ ] 환경변수 누락 시 Fail-fast (config 검증)
7. [ ] 패스코드·시크릿이 로그·에러 메시지·클라이언트 번들에 노출되지 않음
8. [ ] 기존 검색·답변·임팩트맵 기능이 게이트 통과 후 정상 동작
9. [ ] 정적자원(`/_next/*`)은 게이트 없이 로드(스타일 깨짐 방지)

---

## 6. Verification (검증 단계)

1. `.env.local`에 `BETA_ACCESS_CODE`·`SESSION_SECRET` 설정 후 `npm run dev`
2. 시크릿 창에서 `http://localhost:3000` 접속 → `/login`으로 튕기는지 확인
3. 틀린 패스코드 입력 → 거부 확인
4. 맞는 패스코드 입력 → 검색 화면 진입 확인
5. 새로고침 → 로그인 유지 확인
6. 브라우저 개발자도구 → Application → Cookies에서 평문 패스코드 없음 확인
7. 쿠키 삭제 후 새로고침 → 다시 `/login`으로 차단 확인
8. "부가가치세" 검색 → 게이트 통과 후 답변 정상 생성 확인

---

## 7. Risks / Notes

- **SSOT §11.3 충돌 해석**: §11.3 보류 목록에 "사용자 계정·로그인"이 있으나, 본 티켓은 **개인 계정이 아닌 단일 공유 패스코드 차단막**으로 개인정보(이메일·이름) 미수집 → 보류 항목의 취지(개인정보 회피·MVP 축소)와 충돌하지 않음. 단, 문서 정합을 위해 **SSOT §1.3 배포 환경 또는 §11.3에 "베타 접근 제어(단일 패스코드, 계정 아님)" 한 줄 명시 권장** — 별도 승인 사항
- Edge 런타임은 Node `crypto` 미지원 → 미들웨어는 반드시 Web Crypto(`crypto.subtle`) 사용
- 단일 공유 패스코드라 **개인별 접근 기록 불가** (베타 의도된 한계). 대규모 전환 시 Clerk 등으로 교체
- 패스코드 유출 시 전원 재발급 필요 → `BETA_ACCESS_CODE` 교체 + `SESSION_SECRET` 교체(기존 쿠키 전부 무효화)

---

## 8. AI Implementation Instructions

### 8.1 코딩 전 제출할 것 (이 티켓과 함께 제시됨)
- [x] 기능 추가 동기 (§1)
- [x] 영향 파일 목록 (§2.1)
- [x] 구현 계획 (§4)
→ **회계사 승인 후 코딩 시작**

### 8.2 코딩 후 제출할 것
- [ ] 변경 파일 목록 / 변경 요약 / 검증 결과(PASS/FAIL) / 위험 / 리포트 경로

---

## 9. Related Tickets

- 선행: TAX-052~055 (Phase 5 완결 — 실사용 투입 전제)
- 후속: (대규모 전환 시) 계정·로그인 도입 티켓 — SSOT §11.3 해제 승인 필요
- 참조: CLAUDE.md §7(개인정보·시크릿), SSOT §1.3·§11.3

---

## 10. Report Link

Report: `docs/reports/TAX-056_report.md` (미작성)

---

**작성자**: Claude (회계사 승인 대기)
**작성일**: 2026-06-10
**최종 수정일**: 2026-06-10
