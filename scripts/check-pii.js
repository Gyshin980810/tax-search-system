/**
 * PII(개인정보) 차단 스크립트 — PreToolUse Hook에서 실행
 * CLAUDE.md §7: 주민번호·사업자번호 포함 쿼리 차단
 *
 * 입력: CLAUDE_TOOL_INPUT 환경변수 (JSON 문자열)
 * 출력: PII 감지 시 stderr + exit(1), 정상 시 exit(0)
 */

// PII 패턴 정의
const PII_PATTERNS = [
  {
    name: '주민등록번호',
    // 앞 6자리(생년월일) - 성별코드(1~4) + 뒷 6자리
    pattern: /\d{6}-[1-4]\d{6}/,
  },
  {
    name: '사업자등록번호',
    // 3자리-2자리-5자리 형식
    pattern: /\d{3}-\d{2}-\d{5}/,
  },
];

/**
 * 입력 문자열에서 PII 패턴을 검사합니다.
 * @param {string} input - 검사할 문자열
 * @returns {{ detected: boolean, type: string | null }}
 */
function checkPii(input) {
  for (const { name, pattern } of PII_PATTERNS) {
    if (pattern.test(input)) {
      return { detected: true, type: name };
    }
  }
  return { detected: false, type: null };
}

// 메인 실행
const rawInput = process.env.CLAUDE_TOOL_INPUT || '';

let inputText = rawInput;

// JSON 형식인 경우 텍스트 필드 추출
try {
  const parsed = JSON.parse(rawInput);
  // 중첩 객체도 포함하여 전체 JSON을 문자열로 검사
  inputText = JSON.stringify(parsed);
} catch {
  // JSON 파싱 실패 시 원본 문자열 그대로 검사
}

const result = checkPii(inputText);

if (result.detected) {
  process.stderr.write(
    `[PII 차단] ${result.type} 패턴이 감지되었습니다. ` +
    `개인정보가 포함된 쿼리는 외부 API로 전달할 수 없습니다. ` +
    `주민번호·사업자번호를 제거한 후 다시 시도해 주세요.\n`
  );
  process.exit(1);
}

process.exit(0);
