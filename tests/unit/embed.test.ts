import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { iterateLaws, parseArrayLine, sha256, STREAM_THRESHOLD_BYTES, truncateContent, withRetry } from '../../scripts/embed'
import type { TaxLaw } from '@/domain/TaxLaw'

const SAMPLE_LAW: TaxLaw = {
  sourceType: '심판례',
  lawName: '조세심판원 조심 2026중0001',
  articleNumber: '',
  articleTitle: '테스트 사건',
  content: '주문 원문 테스트',
  revisionDate: '2026-01-01',
  enforcementDate: '',
  sourceUrl: 'https://www.law.go.kr/allDeccSc.do?query=test',
  trustTier: 'T3',
  caseNumber: '조심 2026중0001',
  issuingBody: '조세심판원',
  decisionDate: '2026-01-01',
}

describe('parseArrayLine', () => {
  it('끝에 콤마가 붙은 객체 줄을 파싱한다', () => {
    const line = `${JSON.stringify(SAMPLE_LAW)},`
    expect(parseArrayLine(line)).toEqual(SAMPLE_LAW)
  })

  it('콤마 없는 마지막 객체 줄을 파싱한다', () => {
    const line = JSON.stringify(SAMPLE_LAW)
    expect(parseArrayLine(line)).toEqual(SAMPLE_LAW)
  })

  it('여는 대괄호 줄은 건너뛴다(null)', () => {
    expect(parseArrayLine('[')).toBeNull()
  })

  it('닫는 대괄호 줄은 건너뛴다(null)', () => {
    expect(parseArrayLine(']')).toBeNull()
  })

  it('빈 줄은 건너뛴다(null)', () => {
    expect(parseArrayLine('   ')).toBeNull()
  })
})

describe('truncateContent', () => {
  it('MAX_CONTENT_CHARS 이하 본문은 그대로 반환한다', () => {
    const content = '가'.repeat(100)
    expect(truncateContent(content)).toBe(content)
  })

  it('MAX_CONTENT_CHARS 초과 본문은 잘라내고 말줄임표를 붙인다', () => {
    const content = '가'.repeat(7000)
    const result = truncateContent(content)
    expect(result.endsWith('(…)')).toBe(true)
    expect(result.length).toBe(6000 + '(…)'.length)
  })
})

describe('sha256', () => {
  it('빈 문자열의 알려진 SHA-256 값을 반환한다', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('같은 입력은 같은 해시, 다른 입력은 다른 해시를 낸다', () => {
    expect(sha256('가')).toBe(sha256('가'))
    expect(sha256('가')).not.toBe(sha256('나'))
  })
})

describe('iterateLaws', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'embed-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('통째 파싱 모드(기본 임계값): 표준 pretty-print JSON 배열을 읽는다', async () => {
    const file = join(dir, 'small.json')
    const laws = [SAMPLE_LAW, { ...SAMPLE_LAW, caseNumber: '조심 2026중0002' }]
    writeFileSync(file, JSON.stringify(laws, null, 2) + '\n', 'utf-8')

    const result: TaxLaw[] = []
    for await (const law of iterateLaws(file)) result.push(law)

    expect(result).toEqual(laws)
  })

  it('줄 스트리밍 모드(임계값 0 강제): 한 줄 1객체 + 끝 콤마 형식을 읽는다', async () => {
    const file = join(dir, 'streamed.json')
    const laws = [SAMPLE_LAW, { ...SAMPLE_LAW, caseNumber: '조심 2026중0002' }]
    const lines = ['[', ...laws.map((l, i) => JSON.stringify(l) + (i < laws.length - 1 ? ',' : '')), ']']
    writeFileSync(file, lines.join('\n') + '\n', 'utf-8')

    const result: TaxLaw[] = []
    for await (const law of iterateLaws(file, 0)) result.push(law)

    expect(result).toEqual(laws)
  })

  it('기본 STREAM_THRESHOLD_BYTES는 약 0.5GiB이다', () => {
    expect(STREAM_THRESHOLD_BYTES).toBe(0.5 * 1024 * 1024 * 1024)
  })
})

describe('withRetry', () => {
  it('첫 시도에 성공하면 그대로 반환한다', async () => {
    const fn = async () => 'ok'
    expect(await withRetry(fn, 3, 0)).toBe('ok')
  })

  it('중간에 실패해도 재시도 안에서 성공하면 복구한다', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      if (calls < 2) throw new Error('일시적 연결 끊김')
      return 'recovered'
    }
    expect(await withRetry(fn, 3, 0)).toBe('recovered')
    expect(calls).toBe(2)
  })

  it('재시도 횟수를 다 채우면 마지막 오류를 던진다', async () => {
    const fn = async () => {
      throw new Error('영구 실패')
    }
    await expect(withRetry(fn, 2, 0)).rejects.toThrow('영구 실패')
  })
})
