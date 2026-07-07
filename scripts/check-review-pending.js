/**
 * 코드 리뷰 미해결 점검 스크립트 — PreToolUse Hook(Bash)에서 실행
 * 배경: harness-review 하네스는 docs/code-reviews/{티켓}/R{n}_verdict.md 에 판정을 남긴다.
 *       마지막 판정이 FAIL인 티켓이 있는데 그 티켓 코드를 커밋하려 하면, 아직
 *       품질 게이트를 통과하지 못한 코드가 섞여 들어갈 수 있으므로 경고한다.
 *
 * 동작: git commit 실행 직전, docs/code-reviews 하위 각 티켓 폴더의 최신 라운드 verdict를 읽어
 *       "판정: FAIL"이 남아 있으면 stderr로 경고만 출력(차단하지 않음).
 *       리뷰 폴더가 없거나 모든 티켓이 PASS면 조용히 통과.
 *
 * 입력: CLAUDE_TOOL_INPUT 환경변수 (JSON 문자열, { command: string } 형태)
 * 출력: 경고 시 stderr 메시지, 항상 exit(0) — 비차단(non-blocking)
 *       (check-roadmap-sync.js와 동일한 안전망 패턴)
 */

const fs = require('fs');
const path = require('path');

const rawInput = process.env.CLAUDE_TOOL_INPUT || '';

let command = '';
try {
  const parsed = JSON.parse(rawInput);
  command = parsed.command || '';
} catch {
  command = rawInput;
}

// git commit 명령이 아니면 점검 대상 아님
if (!/\bgit\s+commit\b/.test(command)) {
  process.exit(0);
}

const reviewsRoot = path.join(process.cwd(), 'docs', 'code-reviews');

if (!fs.existsSync(reviewsRoot)) {
  process.exit(0);
}

/**
 * 한 티켓 폴더에서 가장 높은 라운드의 verdict 파일 경로를 반환한다.
 * @param {string} ticketDir - 티켓 폴더 절대 경로
 * @returns {string|null} 최신 verdict 파일 경로 (없으면 null)
 */
function latestVerdict(ticketDir) {
  let files;
  try {
    files = fs.readdirSync(ticketDir);
  } catch {
    return null;
  }
  // R{숫자}_verdict.md 중 라운드 번호가 가장 큰 것
  const verdicts = files
    .map((f) => {
      const m = /^R(\d+)_verdict\.md$/.exec(f);
      return m ? { file: f, round: Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.round - a.round);
  return verdicts.length ? path.join(ticketDir, verdicts[0].file) : null;
}

const failedTickets = [];

let ticketDirs;
try {
  ticketDirs = fs.readdirSync(reviewsRoot, { withFileTypes: true });
} catch {
  process.exit(0);
}

for (const entry of ticketDirs) {
  if (!entry.isDirectory()) continue;
  const ticketDir = path.join(reviewsRoot, entry.name);
  const verdictPath = latestVerdict(ticketDir);
  if (!verdictPath) continue;
  let content = '';
  try {
    content = fs.readFileSync(verdictPath, 'utf8');
  } catch {
    continue;
  }
  // "## 판정: FAIL" 형태를 검출 (PASS면 통과)
  if (/##\s*판정:\s*FAIL/.test(content)) {
    failedTickets.push(entry.name);
  }
}

if (failedTickets.length) {
  process.stderr.write(
    '[코드 리뷰 미해결 경고] 아래 티켓의 최신 품질 판정이 FAIL입니다: ' +
      failedTickets.join(', ') +
      '. harness-review 루프를 통과(PASS)하지 못한 수정이 커밋에 섞여 있지 않은지 ' +
      '확인해 주세요 (차단하지 않음 — 무관한 커밋이라면 무시해도 됩니다).\n'
  );
}

process.exit(0);
