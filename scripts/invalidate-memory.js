/**
 * TAX-008 Memory 법령 개정 대응 — 무효화 트리거 CLI
 *
 * 사용법:
 *   node scripts/invalidate-memory.js --trigger=개정공포일 --law-id=법인세법_제19조
 *   node scripts/invalidate-memory.js --trigger=폐지라벨 --law-id=소득세법_제89조
 *   node scripts/invalidate-memory.js --trigger=연도전환
 *   node scripts/invalidate-memory.js --help
 *
 * 출력: JSON { trigger, law_id, affected_laws: [], timestamp }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ~/.claude/projects/ — 메모리 파일 저장 위치
const MEMORY_BASE = path.join(os.homedir(), '.claude', 'projects');
const VALID_TRIGGERS = ['개정공포일', '폐지라벨', '연도전환'];

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const triggerArg = args.find(a => a.startsWith('--trigger='));
  const lawIdArg = args.find(a => a.startsWith('--law-id='));

  return {
    trigger: triggerArg ? triggerArg.split('=').slice(1).join('=') : undefined,
    lawId: lawIdArg ? lawIdArg.split('=').slice(1).join('=') : undefined,
  };
}

function printHelp() {
  process.stdout.write(
    [
      '사용법: node scripts/invalidate-memory.js [옵션]',
      '',
      '옵션:',
      '  --trigger=<트리거>    무효화 트리거 종류 (필수)',
      '                        - 개정공포일  : 특정 조문 즉시 만료 표시',
      '                        - 폐지라벨   : [현행]→[폐지] 변경된 조문 만료 표시',
      '                        - 연도전환   : 전체 [현행] 라벨 재검증 목록 출력',
      '  --law-id=<조문ID>     대상 조문 ID (개정공포일·폐지라벨 트리거 필수)',
      '  --help, -h            이 도움말 출력',
      '',
      '예시:',
      '  node scripts/invalidate-memory.js --trigger=개정공포일 --law-id=법인세법_제19조',
      '  node scripts/invalidate-memory.js --trigger=폐지라벨 --law-id=소득세법_제89조',
      '  node scripts/invalidate-memory.js --trigger=연도전환',
      '',
      '출력: JSON { trigger, law_id, affected_laws: [], timestamp }',
    ].join('\n') + '\n'
  );
}

/**
 * 디렉토리를 재귀 탐색하여 조건에 맞는 .md 파일 경로 수집
 * @param {string} dir
 * @param {(content: string, filePath: string) => boolean} predicate
 * @returns {string[]}
 */
function findMarkdownFiles(dir, predicate) {
  const found = [];

  if (!fs.existsSync(dir)) {
    return found;
  }

  function scan(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (predicate(content, fullPath)) {
            found.push(fullPath);
          }
        } catch {
          // 읽기 실패 시 무시
        }
      }
    }
  }

  scan(dir);
  return found;
}

/**
 * T1/T2: 캐시 파일에 만료 표시 추가
 * @param {string} filePath
 * @param {string} lawId
 * @param {string} trigger
 * @returns {boolean} 새로 표시됐으면 true, 이미 표시됐으면 false
 */
function markExpired(filePath, lawId, trigger) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    if (content.includes('[만료됨]')) {
      return false;
    }

    const expiredMark =
      `\n\n> ⚠️ [만료됨] 조문 \`${lawId}\` — 트리거: ${trigger}` +
      ` — ${new Date().toISOString()}\n`;

    fs.writeFileSync(filePath, content + expiredMark, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function main() {
  const { trigger, lawId } = parseArgs();

  if (!trigger) {
    process.stderr.write('[오류] --trigger 옵션이 필요합니다. --help로 사용법을 확인하세요.\n');
    process.exit(1);
  }

  if (!VALID_TRIGGERS.includes(trigger)) {
    process.stderr.write(
      `[오류] 유효하지 않은 트리거: "${trigger}". 유효한 값: ${VALID_TRIGGERS.join(', ')}\n`
    );
    process.exit(1);
  }

  if ((trigger === '개정공포일' || trigger === '폐지라벨') && !lawId) {
    process.stderr.write(
      `[오류] "${trigger}" 트리거는 --law-id 옵션이 필요합니다.\n`
    );
    process.exit(1);
  }

  const timestamp = new Date().toISOString();
  const affectedLaws = [];

  if (trigger === '개정공포일' || trigger === '폐지라벨') {
    process.stderr.write(`[invalidate-memory] 조문 "${lawId}" 캐시 탐색 중...\n`);

    const targets = findMarkdownFiles(
      MEMORY_BASE,
      (content) => content.includes(lawId)
    );

    for (const filePath of targets) {
      const marked = markExpired(filePath, lawId, trigger);
      const action = marked ? '만료표시' : '이미만료';
      affectedLaws.push({ law_id: lawId, file_path: filePath, action });
      process.stderr.write(`[invalidate-memory] ${action}: ${filePath}\n`);
    }

    if (targets.length === 0) {
      process.stderr.write(`[invalidate-memory] "${lawId}" 관련 캐시 파일 없음\n`);
    }

  } else if (trigger === '연도전환') {
    process.stderr.write('[invalidate-memory] 전체 [현행] 라벨 스캔 중...\n');

    const currentFiles = findMarkdownFiles(
      MEMORY_BASE,
      (content) => content.includes('[현행]')
    );

    for (const filePath of currentFiles) {
      affectedLaws.push({ file_path: filePath, action: '재검증_필요' });
      process.stderr.write(`[invalidate-memory] 재검증 대상: ${filePath}\n`);
    }

    process.stderr.write(
      `[invalidate-memory] 연도전환 완료: ${currentFiles.length}개 파일 재검증 필요\n`
    );
  }

  const result = {
    trigger,
    law_id: lawId || null,
    affected_laws: affectedLaws,
    timestamp,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
