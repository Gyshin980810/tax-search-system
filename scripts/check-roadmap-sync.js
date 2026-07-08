/**
 * ROADMAP 동기화 점검 스크립트 — PreToolUse Hook(Bash)에서 실행
 * 배경: TAX-6B-9~37(28개 티켓)이 완료됐지만 ROADMAP.md에 장기간 반영되지 않은
 *       사고가 있었음(2026-07-06 발견·정정). 재발 방지용 기계적 체크.
 *
 * 동작: git commit 실행 직전, 스테이징된 파일에 docs/reports/*.md 추가·수정이
 *       있는데 ROADMAP.md가 함께 스테이징되지 않았으면 경고만 출력(차단 없음).
 *       PRD.md는 "새 FR 신설 여부" 같은 판단이 필요해 이 훅의 대상이 아님
 *       (주기적 /sync-docs 스킬로 사람이 트리거).
 *
 * 입력: CLAUDE_TOOL_INPUT 환경변수 (JSON 문자열, { command: string } 형태)
 * 출력: 경고 시 stderr 메시지, 항상 exit(0) — 비차단(non-blocking)
 */

const { execSync } = require('child_process');

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

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return out.split('\n').map((f) => f.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const staged = getStagedFiles();
const hasNewReport = staged.some((f) => /^docs\/reports\/.*\.md$/.test(f));
const hasRoadmapChange = staged.some((f) => f === 'ROADMAP.md');

if (hasNewReport && !hasRoadmapChange) {
  process.stderr.write(
    '[ROADMAP 동기화 경고] docs/reports/ 변경이 커밋에 포함되어 있으나 ' +
    'ROADMAP.md는 함께 스테이징되지 않았습니다. ' +
    'CLAUDE.md §10에 따라 티켓 완료 시 ROADMAP.md §3 현재 상태 표도 갱신해 주세요 ' +
    '(차단하지 않음 — 의도적으로 문서 없이 커밋하는 경우라면 무시해도 됩니다).\n'
  );
}

process.exit(0);
