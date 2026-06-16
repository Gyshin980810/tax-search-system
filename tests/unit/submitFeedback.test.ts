import { describe, it, expect, vi } from 'vitest'
import { submitFeedback } from '@/usecases/submitFeedback'
import { PiiDetectedError } from '@/domain/errors'
import type { IOpsLogPort, OpsFeedbackEntry } from '@/ports/opsLogPort'

/** recordQuery·recordFeedback을 spy로 갖춘 가짜 Port */
function makeOpsLog(): IOpsLogPort {
  return {
    recordQuery: vi.fn().mockResolvedValue(undefined),
    recordFeedback: vi.fn().mockResolvedValue(undefined),
    listFeedback: vi.fn().mockResolvedValue([]),
  }
}

/** recordFeedback에 전달된 첫 인자(엔트리)를 꺼내는 헬퍼 */
function firstEntry(opsLog: IOpsLogPort): OpsFeedbackEntry {
  return (opsLog.recordFeedback as ReturnType<typeof vi.fn>).mock.calls[0][0]
}

describe('submitFeedback (TAX-030-B, FR-24)', () => {
  it('정상 입력 시 recordFeedback을 1회 호출한다', async () => {
    const opsLog = makeOpsLog()
    await submitFeedback(opsLog, '부가가치세 면세 대상', '결론이 반대입니다', ['법령'])

    expect(opsLog.recordFeedback).toHaveBeenCalledTimes(1)
    const entry = firstEntry(opsLog)
    expect(entry.queryNorm).toBe('부가가치세 면세 대상')
    expect(entry.reason).toBe('결론이 반대입니다')
    expect(entry.sourceTypes).toEqual(['법령'])
    expect(entry.queryHash).toHaveLength(16) // SHA-256 앞 16자
  })

  it('질문·사유의 휴대폰·이메일을 마스킹해 전달한다', async () => {
    const opsLog = makeOpsLog()
    await submitFeedback(
      opsLog,
      '010-1234-5678 문의',
      'user@example.com 으로 회신주세요',
      [],
    )

    const entry = firstEntry(opsLog)
    expect(entry.queryNorm).toContain('010-****-5678')
    expect(entry.reason).toContain('us***@example.com')
  })

  it('reason이 undefined면 빈 문자열로 저장한다', async () => {
    const opsLog = makeOpsLog()
    await submitFeedback(opsLog, '질문입니다', undefined, [])

    expect(firstEntry(opsLog).reason).toBe('')
  })

  it('질문에 주민번호가 있으면 PiiDetectedError를 throw하고 적재하지 않는다', async () => {
    const opsLog = makeOpsLog()
    await expect(
      submitFeedback(opsLog, '내 주민번호 900101-1234567 관련 질문', '', []),
    ).rejects.toBeInstanceOf(PiiDetectedError)
    expect(opsLog.recordFeedback).not.toHaveBeenCalled()
  })

  it('사유에 사업자번호가 있어도 거부한다', async () => {
    const opsLog = makeOpsLog()
    await expect(
      submitFeedback(opsLog, '정상 질문', '사업자번호 1234567890', []),
    ).rejects.toBeInstanceOf(PiiDetectedError)
    expect(opsLog.recordFeedback).not.toHaveBeenCalled()
  })

  it('적재 실패를 fail-soft 없이 전파한다 (신고는 결과 피드백이 필요)', async () => {
    const opsLog = makeOpsLog()
    ;(opsLog.recordFeedback as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('db down'),
    )
    await expect(submitFeedback(opsLog, '질문', '', [])).rejects.toThrow('db down')
  })
})
