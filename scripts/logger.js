/**
 * TAX-009 Observability 로그 스키마
 * CLAUDE.md §7: PII는 SHA-256 해시로 마스킹 후 저장
 *
 * 사용법:
 *   const { createLog } = require('./logger');
 *   createLog(sessionId, 'verifier', query, 'claude-opus-4-7', verificationResult, labels);
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOGS_DIR = path.join(__dirname, '../logs');

// check-pii.js와 동일한 PII 패턴 (재사용)
const PII_PATTERNS = [
  { pattern: /\d{6}-[1-4]\d{6}/g },  // 주민등록번호
  { pattern: /\d{3}-\d{2}-\d{5}/g }, // 사업자등록번호
];

/**
 * KST(+09:00) ISO 8601 타임스탬프 반환
 * @returns {string}
 */
function toKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 19) + '+09:00';
}

/**
 * 쿼리에서 PII를 SHA-256 해시 앞 8자리로 치환
 * @param {string} query
 * @returns {string}
 */
function maskPii(query) {
  let masked = String(query);
  for (const { pattern } of PII_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const hash = crypto.createHash('sha256').update(match).digest('hex').slice(0, 8);
      return `[MASKED:${hash}]`;
    });
  }
  return masked;
}

/**
 * SHA-256 해시 (64자 hex)
 * @param {string} input
 * @returns {string}
 */
function sha256(input) {
  return crypto.createHash('sha256').update(String(input), 'utf-8').digest('hex');
}

/**
 * RAG 검증 로그 생성 및 파일 저장
 *
 * @param {string} sessionId - 세션 UUID (run-eval.js의 sessionId와 공유)
 * @param {'planner'|'searcher'|'generator'|'verifier'} phase - RAG 단계
 * @param {string} query - 원본 쿼리 (PII 자동 마스킹 후 해시로 저장)
 * @param {string} modelUsed - 사용된 모델 ID
 * @param {object|null} verificationResult - V1~V6 검증 결과 (verifier 단계 외 null 가능)
 * @param {string[]} labelsApplied - 적용된 시점·Trust Tier 라벨 목록
 * @returns {{ logPath: string, logEntry: object }}
 */
function createLog(sessionId, phase, query, modelUsed, verificationResult, labelsApplied) {
  const maskedQuery = maskPii(query);

  const logEntry = {
    timestamp: toKST(),
    session_id: sessionId,
    phase,
    input_query_hash: sha256(maskedQuery),
    model_used: modelUsed,
    verification: verificationResult
      ? {
          V1: verificationResult.V1 || 'N/A',
          V2: verificationResult.V2 || 'N/A',
          V3: verificationResult.V3 || 'N/A',
          V4: verificationResult.V4 || 'N/A',
          V5: verificationResult.V5 || 'N/A',
          V6: verificationResult.V6 || 'N/A',
          retry_count: verificationResult.retry_count ?? 0,
          final_status: verificationResult.final_status || 'N/A',
        }
      : null,
    trust_tier_distribution: verificationResult?.trust_tier_distribution ?? null,
    labels_applied: labelsApplied || [],
  };

  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  // KST 기준 파일명 생성
  const kst = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toISOString().slice(0, 10);
  const timeStr = kst.toISOString().slice(11, 19).replace(/:/g, '-');
  const logPath = path.join(LOGS_DIR, `${dateStr}_${timeStr}.json`);

  fs.writeFileSync(logPath, JSON.stringify(logEntry, null, 2), 'utf-8');

  return { logPath, logEntry };
}

module.exports = { createLog, maskPii, sha256 };
