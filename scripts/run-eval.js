/**
 * TAX-005 Eval Harness — pass^k=100% 골든셋 평가
 *
 * 사용법:
 *   node scripts/run-eval.js                  전체 골든셋 평가 (k=3)
 *   node scripts/run-eval.js --dry-run        구조 검증만 (실제 API 호출 없음)
 *   node scripts/run-eval.js --case G1        특정 케이스만 실행
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLog } = require('./logger');

const BASELINE_PATH = path.join(__dirname, '../eval/baseline.json');
const GOLDEN_SET_DIR = path.join(__dirname, '../eval/golden-set');
const REPORTS_DIR = path.join(__dirname, '../eval/reports');

function loadBaseline() {
  const raw = fs.readFileSync(BASELINE_PATH, 'utf-8');
  return JSON.parse(raw);
}

function loadGoldenCases() {
  const files = fs.readdirSync(GOLDEN_SET_DIR).filter(f => f.endsWith('.md'));
  const cases = {};
  for (const file of files) {
    const caseId = file.replace('.md', '').split('_')[0];
    const content = fs.readFileSync(path.join(GOLDEN_SET_DIR, file), 'utf-8');
    cases[caseId] = content;
  }
  return cases;
}

/**
 * 개별 케이스 실행 결과를 시뮬레이션하는 함수.
 * 실제 시스템 연동 전에는 구조 검증만 수행.
 * M3 마일스톤(실제 API 연동) 이후 이 함수에 실제 파이프라인 호출 추가.
 *
 * @param {string} caseId - 케이스 ID (예: "G1")
 * @param {object} caseSpec - baseline.json의 케이스 명세
 * @param {boolean} dryRun - true면 구조 검증만
 * @returns {{ passed: boolean, details: object }}
 */
function runCase(caseId, caseSpec, dryRun) {
  if (dryRun) {
    // 구조 검증: 케이스 명세 필드 존재 여부만 확인
    const required = ['question', 'expected_laws', 'expected_labels', 'expected_v5'];
    const missing = required.filter(k => !(k in caseSpec));
    if (missing.length > 0) {
      return { passed: false, details: { error: `명세 누락 필드: ${missing.join(', ')}` } };
    }
    return { passed: true, details: { mode: 'dry-run', caseId } };
  }

  // 실제 파이프라인 호출 (M3 이후 구현)
  // TODO: tax-planner → tax-searcher → tax-generator → law-verifier 파이프라인 호출
  // 현재는 "미구현" 상태를 반환 (pass^k 측정 불가)
  return {
    passed: false,
    details: {
      error: '실제 파이프라인 미구현 — M3 API 연동 이후 활성화',
      caseId,
    },
  };
}

/**
 * pass^k 계산: k번 모두 성공한 케이스 비율
 * pass@k(한 번이라도 성공)와 다름 — 일관성 보장을 위해 pass^k 사용
 */
function calculatePassK(results, k) {
  const caseIds = Object.keys(results);
  let allPassCount = 0;

  for (const caseId of caseIds) {
    const runs = results[caseId];
    const allPassed = runs.length === k && runs.every(r => r.passed);
    if (allPassed) allPassCount++;
  }

  return allPassCount / caseIds.length;
}

function writeReport(sessionId, baseline, results, passK) {
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(REPORTS_DIR, `${date}_eval.md`);

  const lines = [
    `# Eval Report — ${date}`,
    ``,
    `## 메타데이터`,
    ``,
    `| 항목 | 값 |`,
    `|---|---|`,
    `| 세션 ID | ${sessionId} |`,
    `| pass^k 설정 | k=${baseline.pass_k}, target=${baseline.target} |`,
    `| 실행 케이스 수 | ${Object.keys(results).length} |`,
    `| pass^k 결과 | ${(passK * 100).toFixed(1)}% |`,
    `| 합격 여부 | ${passK >= baseline.threshold ? '✅ PASS' : '❌ FAIL'} |`,
    ``,
    `## 케이스별 결과`,
    ``,
    `| 케이스 | k=1 | k=2 | k=3 | pass^3 |`,
    `|---|---|---|---|---|`,
  ];

  for (const [caseId, runs] of Object.entries(results)) {
    const runResults = runs.map(r => (r.passed ? '✅' : '❌')).join(' | ');
    const allPassed = runs.every(r => r.passed) ? '✅' : '❌';
    lines.push(`| ${caseId} | ${runResults} | ${allPassed} |`);
  }

  lines.push(``);
  lines.push(`## 실패 케이스 상세`);
  lines.push(``);

  let hasFailure = false;
  for (const [caseId, runs] of Object.entries(results)) {
    for (let i = 0; i < runs.length; i++) {
      if (!runs[i].passed) {
        hasFailure = true;
        lines.push(`### ${caseId} — Run ${i + 1}`);
        lines.push('');
        lines.push('```json');
        lines.push(JSON.stringify(runs[i].details, null, 2));
        lines.push('```');
        lines.push('');
      }
    }
  }

  if (!hasFailure) {
    lines.push('(실패 케이스 없음)');
  }

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
  return reportPath;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetCase = args.find(a => a.startsWith('--case='))?.split('=')[1];

  process.stderr.write('[eval] 세법 검색 시스템 Eval Harness 시작\n');

  const baseline = loadBaseline();
  const goldenCases = loadGoldenCases();
  const k = baseline.pass_k;

  const casesToRun = targetCase
    ? { [targetCase]: baseline.cases[targetCase] }
    : baseline.cases;

  if (!Object.keys(casesToRun).every(id => id in baseline.cases)) {
    process.stderr.write('[eval] 오류: 존재하지 않는 케이스 ID\n');
    process.exit(1);
  }

  const sessionId = crypto.randomBytes(4).toString('hex');
  const results = {};

  for (const [caseId, caseSpec] of Object.entries(casesToRun)) {
    results[caseId] = [];
    process.stderr.write(`[eval] ${caseId} 실행 중 (${k}회 반복)...\n`);

    for (let i = 0; i < k; i++) {
      const result = runCase(caseId, caseSpec, dryRun);
      results[caseId].push(result);

      // 각 실행 결과를 Observability 로그로 저장 (TAX-009)
      const verificationResult = result.passed
        ? { V1: 'PASS', V2: 'PASS', V3: 'PASS', V4: 'PASS', V5: 'PASS', V6: 'PASS', retry_count: 0, final_status: 'PASS' }
        : { V1: 'N/A', V2: 'N/A', V3: 'N/A', V4: 'N/A', V5: 'N/A', V6: 'N/A', retry_count: 0, final_status: 'FAIL', ...result.details };
      createLog(sessionId, 'verifier', caseSpec.question, 'eval-harness', verificationResult, caseSpec.expected_labels || []);
    }
  }

  const passK = calculatePassK(results, k);
  const reportPath = writeReport(sessionId, baseline, results, passK);

  process.stderr.write(`[eval] 결과: pass^${k} = ${(passK * 100).toFixed(1)}%\n`);
  process.stderr.write(`[eval] 리포트: ${reportPath}\n`);

  if (passK < baseline.threshold) {
    process.stderr.write('[eval] ❌ FAIL — 합격선 미달. 위 실패 케이스를 확인하세요.\n');
    process.exit(1);
  }

  process.stderr.write('[eval] ✅ PASS — pass^k 합격선 통과\n');
  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`[eval] 치명적 오류: ${err.message}\n`);
  process.exit(1);
});
