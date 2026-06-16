import { describe, it, expect } from 'vitest'
import { NullOpsLogAdapter } from '@/adapters/opsLog'
import type { OpsQueryLogEntry, OpsFeedbackEntry } from '@/ports/opsLogPort'

describe('NullOpsLogAdapter (TAX-030-A)', () => {
  it('recordQuery가 no-op로 안전하게 resolve한다', async () => {
    const adapter = new NullOpsLogAdapter()
    const entry: OpsQueryLogEntry = {
      queryNorm: '부가가치세 면세 대상',
      queryHash: 'a1b2c3d4e5f60718',
      matchStage: 'direct',
      sourceTypes: ['법령'],
      verifyStatus: 'PASS',
      failedChecks: [],
      latencyMs: 12,
    }

    // 예외 없이 undefined로 resolve해야 한다 (수집 비활성 환경 fallback)
    await expect(adapter.recordQuery(entry)).resolves.toBeUndefined()
  })

  it('recordFeedback이 no-op로 안전하게 resolve한다 (TAX-030-B)', async () => {
    const adapter = new NullOpsLogAdapter()
    const entry: OpsFeedbackEntry = {
      queryHash: 'a1b2c3d4e5f60718',
      queryNorm: '부가가치세 면세 대상',
      reason: '결론이 반대입니다',
      sourceTypes: ['법령'],
    }

    await expect(adapter.recordFeedback(entry)).resolves.toBeUndefined()
  })
})
