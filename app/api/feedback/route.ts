import { NextResponse } from 'next/server'
import { PgOpsLogAdapter, NullOpsLogAdapter } from '@/adapters/opsLog'
import { submitFeedback } from '@/usecases/submitFeedback'
import { AppError } from '@/domain/errors'
import { config } from '@/config'

export const dynamic = 'force-dynamic'

/**
 * POST /api/feedback
 * Body: { question: string, reason?: string, sourceTypes?: string[] }
 *
 * 조용한 틀림 신고(👎) 진입점 — 계층 역할: 요청 검증 + 어댑터 주입 + 에러 매핑.
 * 실제 마스킹·해시·적재는 submitFeedback Usecase에 위임한다 (CLAUDE.md §4).
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    )
  }

  const { question, reason, sourceTypes } = body as {
    question?: unknown
    reason?: unknown
    sourceTypes?: unknown
  }

  // 신고 대상 질문은 필수 (답변이 존재했다는 의미)
  if (typeof question !== 'string' || question.trim().length < 2) {
    return NextResponse.json(
      { error: 'MISSING_QUESTION', message: '신고 대상 질문(question)이 필요합니다.' },
      { status: 400 },
    )
  }

  // 사유는 선택 입력 — 있으면 문자열·길이만 검증
  if (reason !== undefined && typeof reason !== 'string') {
    return NextResponse.json(
      { error: 'INVALID_REASON', message: '신고 사유(reason)는 문자열이어야 합니다.' },
      { status: 400 },
    )
  }
  if (typeof reason === 'string' && reason.length > 500) {
    return NextResponse.json(
      { error: 'REASON_TOO_LONG', message: '신고 사유는 최대 500자까지 입력 가능합니다.' },
      { status: 400 },
    )
  }

  // sourceTypes는 선택 — 문자열 배열만 허용, 없으면 빈 배열
  let normalizedSourceTypes: string[] = []
  if (sourceTypes !== undefined) {
    if (!Array.isArray(sourceTypes) || sourceTypes.some((s) => typeof s !== 'string')) {
      return NextResponse.json(
        { error: 'INVALID_SOURCE_TYPES', message: 'sourceTypes는 문자열 배열이어야 합니다.' },
        { status: 400 },
      )
    }
    normalizedSourceTypes = sourceTypes as string[]
  }

  try {
    // DATABASE_URL이 있으면 Neon 적재, 없으면 no-op (TAX-030-A 어댑터 재사용)
    const opsLog = config.databaseUrl
      ? new PgOpsLogAdapter(config.databaseUrl)
      : new NullOpsLogAdapter()

    await submitFeedback(opsLog, question.trim(), reason, normalizedSourceTypes)

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    if (err instanceof AppError) {
      // E-PII-DETECTED(주민·사업자번호) = 400, 그 외 = 500
      const status = err.code === 'E-PII-DETECTED' ? 400 : 500
      return NextResponse.json({ error: err.code, message: err.message }, { status })
    }

    // 적재 실패 등 — 신고는 fail-soft가 아니므로 실패를 알린다
    return NextResponse.json(
      { error: 'FEEDBACK_FAILED', message: '신고 접수에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
}
