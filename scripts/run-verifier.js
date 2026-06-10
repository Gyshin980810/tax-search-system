/**
 * V1~V6 검증 트리거 스크립트 — PostToolUse / Stop Hook에서 실행
 * CLAUDE.md §6.4: law-verifier 에이전트 호출을 강제하여 검증 우회 차단
 *
 * 입력: stdin으로 검증 대상 답변 JSON
 * 출력: { V1~V6, final_status } JSON → stderr
 * 실패: process.exit(1)
 */

const { createHash } = require('crypto');

// --check-v5 플래그: Stop Hook에서 면책 고지만 별도 검증
const isCheckV5Only = process.argv.includes('--check-v5');

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
    // stdin이 비어있을 때 타임아웃 처리
    setTimeout(() => resolve(data.trim()), 1000);
  });
}

/**
 * 답변 텍스트에서 V5(면책 고지) 존재 여부를 검사합니다.
 * @param {string} answerText
 * @returns {'PASS' | 'FAIL'}
 */
function checkV5Disclaimer(answerText) {
  return answerText.includes('[면책 고지]') ? 'PASS' : 'FAIL';
}

/**
 * 검증 결과를 stderr로 출력합니다.
 * @param {object} result
 */
function outputResult(result) {
  process.stderr.write(JSON.stringify(result, null, 2) + '\n');
}

async function main() {
  const input = await readStdin();

  // 입력이 없으면 검증 불필요로 간주
  if (!input) {
    outputResult({
      status: 'SKIPPED',
      reason: '검증 대상 답변이 없습니다.',
    });
    process.exit(0);
  }

  let answer;
  try {
    answer = JSON.parse(input);
  } catch {
    // JSON이 아닌 경우 텍스트 그대로 사용
    answer = { text: input };
  }

  const answerText = answer.text || answer.answer || input;

  // --check-v5 모드: 면책 고지만 검증
  if (isCheckV5Only) {
    const v5Result = checkV5Disclaimer(answerText);

    if (v5Result === 'FAIL') {
      outputResult({
        V5: 'FAIL',
        message: '[V5 자동 조치] 면책 고지가 누락되었습니다. 답변 하단에 면책 고지를 부착하세요.',
        final_status: 'FAIL',
      });
      process.exit(1);
    }

    outputResult({ V5: 'PASS', final_status: 'PASS' });
    process.exit(0);
  }

  // 전체 V1~V6 검증 트리거
  // 실제 검증 로직은 law-verifier 에이전트가 수행하며,
  // 이 스크립트는 에이전트 호출 신호를 보내는 트리거 역할입니다.
  const sessionId = createHash('sha256')
    .update(answerText.slice(0, 100) + Date.now())
    .digest('hex')
    .slice(0, 16);

  outputResult({
    trigger: 'run-verifier',
    session_id: sessionId,
    target: 'law-verifier',
    message: 'law-verifier 에이전트에 V1~V6 검증을 요청합니다. 검증 통과 전 답변을 회계사에게 노출하지 마세요.',
    answer_length: answerText.length,
    timestamp: new Date().toISOString(),
  });

  // law-verifier 에이전트가 검증 후 결과를 반환하면 해당 결과로 판단
  // 트리거 단계에서는 성공(0)으로 종료하여 에이전트 호출을 허용
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[run-verifier 오류] ${err.message}\n`);
  process.exit(1);
});
