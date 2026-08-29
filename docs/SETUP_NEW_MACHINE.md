# 새 컴퓨터 개발환경 세팅 가이드

> 이 저장소를 새 PC에서 이어서 작업하기 위한 절차서.
> 작성일: 2026-08-30

---

## 0. 전체 그림 — 무엇이 어디서 오는가

설정은 **세 갈래**로 나뉜다. 이걸 구분하는 게 핵심이다.

| 구분 | 어디에 있나 | 새 PC에서 얻는 법 |
|---|---|---|
| **① 저장소에 들어있는 것** | `.claude/agents/`, `.claude/skills/`, `.claude/settings.json`, `docs/` | `git clone` 하면 **자동으로 딸려온다** |
| **② 내 컴퓨터에만 있는 것** | `~/.claude/` (전역 지침·메모리·단축키) | **수동 복사 필요** (§2) |
| **③ 절대 복사하면 안 되는 것** | `.env.local`(API 키), `~/.claude/.credentials.json`(로그인 토큰) | 새로 발급·재로그인 (§3) |

> 비유하자면 — ①은 이삿짐 트럭에 이미 실려 있고, ②는 손가방에 따로 챙겨야 하고,
> ③은 새 집에서 새로 만들어야 하는 열쇠다.

---

## 1. 저장소 받기 (①)

```bash
# 1) 원하는 위치로 이동 (예시)
cd ~/WorkSpace

# 2) 클론
git clone https://github.com/Gyshin980810/tax-search-system.git
cd tax-search-system

# 3) 작업 중인 브랜치 목록 확인
git branch -a

# 4) LR 티켓 정비 브랜치로 이동 (2026-08-30 기준 최신 작업)
git checkout docs/lr-ticket-revision

# 5) 의존성 설치
npm install
```

이 시점에 **이미 들어와 있는 것들**:

- `.claude/agents/` — law-verifier·tax-planner·code-evaluator 등 서브에이전트 14개
- `.claude/skills/` — tax-search·trust-tier·harness-review 등 스킬 6개
- `.claude/settings.json` — 프로젝트 권한 설정
- `docs/` — SSOT·PRD·티켓·리포트 전부
- `CLAUDE.md` — 프로젝트 행동 지침

> ⚠️ `.claude/settings.local.json`은 `.gitignore`에 있어 따라오지 않는다.
> 개인 권한 설정이라 새 PC에서 필요할 때 다시 만들면 된다.

---

## 2. 전역 설정 복사하기 (②)

### 2.1 기존 PC에서 백업 만들기

기존 컴퓨터에서 아래 스크립트를 실행하면 옮길 것만 골라 담아준다.
(이미 실행했다면 바탕화면의 `claude-settings-backup` 폴더가 그것이다)

```bash
bash scripts/backup-claude-settings.sh
# → ~/Desktop/claude-settings-backup/ 생성 (약 370KB)
```

담기는 것:

| 항목 | 내용 |
|---|---|
| `CLAUDE.md` | 전역 지침 (코딩 스타일·언어 규칙·명령어) |
| `settings.json` | 모델(opus)·권한·상태줄·플러그인·한국어 설정 |
| `keybindings.json` | 단축키 (shift+enter 줄바꿈 등) |
| `statusline-command.sh` | 상태줄 스크립트 |
| `agents/` | 전역 서브에이전트 |
| `output-styles/` | 출력 스타일 (beginner) |
| **`projects/*/memory/`** | **누적 메모리 53개 — 가장 중요** |

### 2.2 새 PC로 옮기기

USB·클라우드(구글 드라이브 등)로 `claude-settings-backup` 폴더를 통째로 옮긴다.

### 2.3 새 PC에서 복원

```bash
# 백업 폴더가 바탕화면에 있다고 가정
BACKUP=~/Desktop/claude-settings-backup

# 설정 파일들
cp "$BACKUP/CLAUDE.md"             ~/.claude/
cp "$BACKUP/settings.json"         ~/.claude/
cp "$BACKUP/keybindings.json"      ~/.claude/
cp "$BACKUP/statusline-command.sh" ~/.claude/

# 폴더들
mkdir -p ~/.claude/agents ~/.claude/output-styles
cp -r "$BACKUP/agents/."        ~/.claude/agents/
cp -r "$BACKUP/output-styles/." ~/.claude/output-styles/
```

### 2.4 ⚠️ 메모리 복원 — 폴더 이름을 바꿔야 할 수 있다

**가장 실수하기 쉬운 지점이다.**

메모리 폴더 이름은 **프로젝트 경로를 그대로 인코딩**한 것이다.

```
C--Users-sfami-WorkSpace-tax-search-system
 ↑ 이건 C:\Users\sfami\WorkSpace\tax-search-system 를 뜻한다
   (콜론·역슬래시를 하이픈으로 바꾼 형태)
```

따라서 새 PC의 **윈도우 계정명이나 폴더 위치가 다르면 이름이 달라진다.**

| 새 PC 프로젝트 경로 | 폴더 이름 |
|---|---|
| `C:\Users\sfami\WorkSpace\tax-search-system` | `C--Users-sfami-WorkSpace-tax-search-system` (동일 — 그대로 복사) |
| `C:\Users\gyuho\WorkSpace\tax-search-system` | `C--Users-gyuho-WorkSpace-tax-search-system` (**이름 변경 필요**) |
| `D:\dev\tax-search-system` | `D--dev-tax-search-system` (**이름 변경 필요**) |

**경로가 같은 경우** (권장 — 새 PC도 같은 계정명·같은 위치로 맞추면 가장 편하다):

```bash
mkdir -p ~/.claude/projects
cp -r "$BACKUP/projects/." ~/.claude/projects/
```

**경로가 다른 경우**:

```bash
# 1) 새 이름을 확인한다 — Claude Code를 한 번 실행하면 폴더가 자동 생성된다
ls ~/.claude/projects/

# 2) 백업의 memory 폴더 내용만 새 이름 폴더로 복사
NEW=~/.claude/projects/<자동생성된_새_폴더명>
mkdir -p "$NEW/memory"
cp -r "$BACKUP/projects/C--Users-sfami-WorkSpace-tax-search-system/memory/." "$NEW/memory/"
```

복원 확인:

```bash
ls ~/.claude/projects/*/memory/ | wc -l   # 50 이상 나오면 성공
```

---

## 3. 새로 만들어야 하는 것 (③)

### 3.1 Claude Code 로그인

```bash
# Claude Code 설치 후
claude
# 실행되면 /login 입력 → 브라우저 인증
```

> `~/.claude/.credentials.json`은 **복사하지 말 것.**
> 인증 토큰이라 유출 위험이 있고, 재로그인이 더 안전하고 빠르다.

### 3.2 환경변수 파일 만들기

`.env.local`은 `.gitignore`에 있어 저장소에 없다. 새로 만들어야 한다.

```bash
cp .env.example .env.local
# 그 다음 편집기로 열어 값을 채운다
```

필요한 키 4개 (`CLAUDE.md` §7.1 기준):

| 환경변수 | 용도 | 어디서 얻나 |
|---|---|---|
| `NATIONAL_TAX_API_KEY` | 국세법령정보시스템 API | 기존 PC의 `.env.local`에서 복사하거나 재발급 |
| `OPENAI_API_KEY` | GPT-4o-mini (쿼리 변환·답변 생성) | platform.openai.com |
| `VOYAGE_API_KEY` | voyage-4 임베딩 (의미 검색) | voyageai.com |
| `DATABASE_URL` | Neon pgvector (판례·심판례·해석례 28만건) | Neon 대시보드 |

> 💡 **DATABASE_URL이 중요하다.** 벡터 DB는 클라우드(Neon)에 있으므로
> 이 값만 맞으면 새 PC에서도 28만건 코퍼스를 **그대로** 쓸 수 있다.
> 데이터를 다시 적재할 필요가 없다.

> ⚠️ API 키를 옮길 때 채팅·이메일에 붙여넣지 말 것. USB나 비밀번호 관리자를 쓴다.

### 3.3 개발 도구

| 도구 | 버전 | 확인 |
|---|---|---|
| Node.js | v24.14.1 | `node -v` |
| npm | 11.11.0 | `npm -v` |
| Git | 2.53.0 | `git --version` |
| Claude Code | 최신 | `npm i -g @anthropic-ai/claude-code` |

---

## 4. 동작 확인 체크리스트

순서대로 실행해 전부 통과하면 이전 완료다.

```bash
# [1] 의존성·타입
npm run typecheck        # 0 에러
npm run lint             # 0 에러

# [2] 테스트 (유료 호출 없음)
npm run test             # 전체 GREEN

# [3] 벡터 DB 연결 (DATABASE_URL 필요)
npm run smoke:vector     # 판례·심판례 조회 성공

# [4] 개발 서버
npm run dev              # localhost:3000 접속
```

Claude Code 쪽 확인:

- [ ] `claude` 실행 시 한국어로 응답하는가 (전역 `settings.json`의 `language`)
- [ ] 모델이 opus인가 (`/status`로 확인)
- [ ] 이전 메모리를 기억하는가 — "지금까지 뭐 하고 있었지?" 물어보면
      LR 트랙·사례 중심 전환을 알고 있어야 한다
- [ ] `/tax-search` 등 프로젝트 스킬이 목록에 뜨는가

---

## 5. 자주 겪는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| Claude가 이전 작업을 전혀 모른다 | 메모리 폴더 이름이 경로와 안 맞음 | §2.4 재확인. `ls ~/.claude/projects/`로 실제 생성된 이름 확인 |
| 스킬·에이전트가 안 보인다 | 프로젝트 루트가 아닌 곳에서 실행 | `cd tax-search-system` 후 `claude` 실행 |
| `npm run smoke:vector` 실패 | `DATABASE_URL` 없음·오타 | `.env.local` 확인. Neon 대시보드에서 연결 문자열 재복사 |
| 영어로 대답한다 | 전역 `settings.json` 미복사 | §2.3 재실행 |
| 응답이 느리거나 모델이 다르다 | `settings.json`의 `model`·`effortLevel` 미반영 | 파일 복사 후 Claude Code 재시작 |

---

## 6. 두 컴퓨터를 계속 병행해 쓸 때

### 6.1 코드·문서 — git으로 동기화

```bash
# 작업 시작 전 항상
git pull

# 작업 후
git add <파일>
git commit -m "메시지"
git push
```

### 6.2 메모리 — 자동 동기화되지 않는다

`~/.claude/projects/*/memory/`는 git 밖에 있어 **자동으로 공유되지 않는다.**
한쪽에서 쌓인 메모리는 다른 쪽이 모른다.

선택지:

| 방법 | 장점 | 단점 |
|---|---|---|
| **주기적 수동 복사** (§2의 스크립트 재실행) | 단순하고 안전 | 잊어버리기 쉬움 |
| 클라우드 폴더에 심볼릭 링크 | 자동 동기화 | 충돌 시 꼬일 수 있음 |
| 중요한 결정은 `docs/`에 문서로 남기기 | git으로 자동 공유, 사람도 읽음 | 메모리만큼 자동 반영은 아님 |

> 권장: **세 번째를 기본으로 하고**, 큰 작업 전후에 첫 번째를 병행한다.
> 이 프로젝트는 이미 `docs/reports/`·`docs/tickets/`에 기록을 남기는 규칙(CLAUDE.md §9-9)이
> 있어서, 그 규칙만 지키면 메모리가 없어도 맥락이 대부분 복원된다.

---

## 7. 참고

- `CLAUDE.md` — 프로젝트 행동 지침 (§7.1 환경변수 목록)
- `docs/SSOT.md` — 아키텍처 강제 규칙
- `docs/review/LR_TICKET_REVISION_CHANGELOG_AND_REVIEW_REQUEST.md` — 최근 작업 맥락
- `scripts/backup-claude-settings.sh` — 설정 백업 스크립트

---

**작성자**: Claude
**작성일**: 2026-08-30
