import { PiiDetectedError } from '../domain/errors'

/**
 * PII 검사용 정규화 — 전각숫자·공백·구분자를 제거해 우회 시도를 차단합니다.
 * 원본 keyword는 변경하지 않으며, 검사 전용 사본에만 적용합니다.
 */
function normalizeForPii(s: string): string {
  return s
    .normalize('NFKC')                          // 전각·아라비아-인디아 숫자 → ASCII
    .replace(/[\s\-_./·／（）()\[\]]/g, '')     // 흔한 구분자 제거
}

/**
 * PII 패턴 정의 — 정규화된 문자열에 적용 (CLAUDE.md §7)
 * 외국인등록번호(7번째 자리 5~8)까지 포함합니다.
 */
const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: '주민·외국인등록번호',
    // 7번째 자리가 1~8 (내국인 1~4, 외국인 5~8)
    pattern: /(?<!\d)\d{6}[1-8]\d{6}(?!\d)/,
  },
  {
    name: '사업자등록번호',
    // 앞뒤로 다른 숫자 없이 10자리 단독
    pattern: /(?<!\d)\d{10}(?!\d)/,
  },
]

/**
 * 검색 키워드에서 PII 패턴을 감지합니다.
 * 공백·전각숫자·구분자로 우회한 입력도 차단합니다.
 *
 * @param keyword - 검사할 검색어 (원문 그대로 전달)
 * @throws {PiiDetectedError} PII 패턴이 감지된 경우
 */
export function detectPii(keyword: string): void {
  const normalized = normalizeForPii(keyword)
  for (const { name, pattern } of PII_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new PiiDetectedError()
    }
    void name
  }
}
