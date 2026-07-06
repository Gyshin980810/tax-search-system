import { NextResponse } from 'next/server'
import { NationalTaxLawAdapter } from '@/adapters/nationalTaxLaw'
import { OpenAIQueryRewriterAdapter } from '@/adapters/llmQueryRewriter'
import { OpenAIAnswerGeneratorAdapter } from '@/adapters/llmAnswerGenerator'
import { VoyageEmbeddingAdapter } from '@/adapters/embedding'
import { PgVectorSearchAdapter } from '@/adapters/vectorSearch'
import { PgCitationGraphAdapter } from '@/adapters/citationGraph'
import { LawVerifierAdapter } from '@/adapters/lawVerifier'
import { PgOpsLogAdapter, NullOpsLogAdapter } from '@/adapters/opsLog'
import { generateAnswer } from '@/usecases/generateAnswer'
import { FallbackSearchPort } from '@/usecases/searchWithFallback'
import { AppError } from '@/domain/errors'
import { config } from '@/config'
import type { TemporalContext } from '@/domain/TemporalContext'
import type { ISearchPort } from '@/ports/taxLawSearchPort'

export const dynamic = 'force-dynamic'

/**
 * POST /api/answer
 * Body: { question: string, targetDate?: string (YYYY-MM-DD) }
 *
 * RAG 5단계 파이프라인 진입점 — 계층 역할: 요청 검증 + 어댑터 주입 + 응답 매핑
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

  const { question, targetDate } = body as { question?: unknown; targetDate?: unknown }

  if (typeof question !== 'string' || question.trim().length < 2) {
    return NextResponse.json(
      { error: 'MISSING_QUESTION', message: '질문(question)은 2자 이상 입력해 주세요.' },
      { status: 400 },
    )
  }
  if (question.trim().length > 500) {
    return NextResponse.json(
      { error: 'QUESTION_TOO_LONG', message: '질문은 최대 500자까지 입력 가능합니다.' },
      { status: 400 },
    )
  }
  if (/[\u0000-\u001F\u007F]/.test(question)) {
    return NextResponse.json(
      { error: 'INVALID_QUESTION', message: '허용되지 않는 문자가 포함되어 있습니다.' },
      { status: 400 },
    )
  }

  const now = new Date()
  const temporal: TemporalContext = targetDate && typeof targetDate === 'string'
    ? { requestedAt: now, targetDate: new Date(targetDate), explicit: true }
    : { requestedAt: now, explicit: false }

  try {
    // 공유 어댑터 — DB·임베딩·벡터검색은 여러 곳에서 쓰므로 1회만 생성(Pool 중복 방지).
    // 임베딩은 voyage-4(1024차원)로 전환(TAX-6B-15). 답변 생성은 여전히 GPT-4o-mini(OpenAI).
    const embeddingPort = new VoyageEmbeddingAdapter(config.voyageApiKey)
    const vectorSearchPort = config.databaseUrl
      ? new PgVectorSearchAdapter(config.databaseUrl)
      : undefined
    // 인용 그래프(citation_edges) 조회 — DATABASE_URL 있을 때만 주입 (TAX-6B-32).
    // 없거나 조회 실패 시 generateAnswer가 그래프 없이 기존 참고 목록을 구성한다(graceful degrade).
    const citationGraphPort = config.databaseUrl
      ? new PgCitationGraphAdapter(config.databaseUrl)
      : undefined

    // DATABASE_URL이 있으면 3단계 fallback 활성화, 없으면 직접 매칭만 사용 (TAX-026-B)
    const directPort = new NationalTaxLawAdapter()
    const searchPort: ISearchPort = vectorSearchPort
      ? new FallbackSearchPort(directPort, embeddingPort, vectorSearchPort)
      : directPort

    // 운영 쿼리 로그 어댑터 주입 (TAX-030-A) — DATABASE_URL 있으면 Neon 적재, 없으면 no-op
    const opsLog = config.databaseUrl
      ? new PgOpsLogAdapter(config.databaseUrl)
      : new NullOpsLogAdapter()

    const result = await generateAnswer(
      new OpenAIQueryRewriterAdapter(),
      searchPort,
      new OpenAIAnswerGeneratorAdapter(),
      new LawVerifierAdapter(),
      question.trim(),
      temporal,
      opsLog,
      // 참고 목록 의미(벡터) 재정렬용 임베딩 어댑터 (TAX-6B-12 방향 C).
      // voyage-4 임베딩(VOYAGE_API_KEY)을 사용한다. 실패 시 generateAnswer가 글자 점수로 자동 복귀.
      embeddingPort,
      // 판례 코퍼스(pgvector) 라이브 검색용 — DATABASE_URL 있을 때만 주입 (TAX-6B-14).
      // 없거나 실패 시 generateAnswer가 판례 경로를 조용히 건너뛴다(graceful degrade).
      vectorSearchPort,
      // 인용 그래프(citation_edges) 조회용 — 참고 목록 1-hop 확장·피인용 부스트 (TAX-6B-32).
      citationGraphPort,
    )

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof AppError) {
      const statusMap: Record<string, number> = {
        'E-PII-DETECTED':     400,
        'E-API-TIMEOUT':      503,
        'E-API-UNAVAILABLE':  503,
        'E-LLM-TIMEOUT':      503,
        'E-LLM-UNAVAILABLE':  503,
        'E-VERIFY-FAIL':      500,
        'INTERNAL_ERROR':     500,
      }
      const status = statusMap[err.code] ?? 500
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      )
    }

    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
}
