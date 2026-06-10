/**
 * 시점 모호 표현 차단 스크립트 — UserPromptSubmit Hook에서 실행
 * CLAUDE.md §6.2: 모호한 시점 표현 감지 시 시점 확인 요청
 * TAX-002 §4: "예전|이전 법|옛날|전에는|바뀌기 전" 패턴 감지
 *
 * 입력: stdin으로 사용자 프롬프트 JSON 또는 환경변수 CLAUDE_USER_PROMPT
 * 출력: 패턴 매칭 시 stderr + exit(1), 정상 시 exit(0)
 *
 * 주의: hook 명령어에 패턴 매칭을 직접 넣을 수 없으므로 별도 스크립트로 분리
 *       (Claude Code matcher는 도구명 패턴만 지원)
 */

// 시점 모호 패턴 정의 (TAX-002 §4 참조)
// 단어 경계와 공백 변형까지 허용
const VAGUE_TIME_PATTERNS = [
  /예전/,
  /이전\s*법/,
  /옛날/,
  /전에는/,
  /바뀌기\s*전/,
];

/**
 * stdin에서 데이터를 읽습니다.
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    // stdin이 비어 있을 때 1초 후 빈 문자열 반환
    setTimeout(() => resolve(data.trim()), 1000);
  });
}

/**
 * 입력 텍스트에서 사용자 프롬프트를 추출합니다.
 * Claude Code는 stdin으로 JSON을 보내거나 환경변수로 전달할 수 있습니다.
 * @param {string} raw
 * @returns {string}
 */
function extractPrompt(raw) {
  // 1. stdin이 JSON 형식이면 prompt/input 필드 추출
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed.prompt || parsed.input || parsed.user_prompt || raw;
    } catch {
      // JSON이 아니면 원본 그대로
      return raw;
    }
  }

  // 2. 환경변수 fallback
  return process.env.CLAUDE_USER_PROMPT || '';
}

/**
 * 시점 모호 패턴 검사
 * @param {string} text
 * @returns {{ detected: boolean, pattern: string | null }}
 */
function checkVagueTime(text) {
  for (const pattern of VAGUE_TIME_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { detected: true, pattern: match[0] };
    }
  }
  return { detected: false, pattern: null };
}

async function main() {
  const raw = await readStdin();
  const prompt = extractPrompt(raw);

  // 빈 입력이면 검사 생략 (정상 통과)
  if (!prompt) {
    process.exit(0);
  }

  const result = checkVagueTime(prompt);

  if (result.detected) {
    process.stderr.write(
      `[시점 확인 필요] 시점이 모호합니다 (감지된 표현: "${result.pattern}"). ` +
      `정확한 적용 시점(YYYY.MM.DD)을 알려주세요. ` +
      `세법은 매년 개정되므로 시점이 다르면 적용 조문이 달라집니다.\n`
    );
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  // 스크립트 오류 시 차단하지 않고 통과 (사용자 입력을 막지 않기 위함)
  process.stderr.write(`[check-time-reference 오류] ${err.message}\n`);
  process.exit(0);
});
