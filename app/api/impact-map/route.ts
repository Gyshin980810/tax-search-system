import { NextResponse } from 'next/server'
import { NationalTaxLawAdapter } from '@/adapters/nationalTaxLaw'
import { buildImpactMap } from '@/usecases/buildImpactMap'
import { AppError } from '@/domain/errors'

export const dynamic = 'force-dynamic'

/**
 * GET /api/impact-map?caseNo=청구번호
 *
 * 심판례 청구번호를 받아서 관계 그래프(ImpactMap + mermaid 코드)를 반환한다.
 *
 * 계층 역할: 요청 검증 + Usecase 호출 + 응답 매핑 (CLAUDE.md §4)
 * 이 Route는 비즈니스 로직을 포함하지 않습니다.
 *
 * 응답 예:
 * {
 *   "map": { "centerId": "tri_xxxx", "caseNumber": "조심2011서1540", ... },
 *   "mermaid": "graph LR\n  tri_xxxx([\"조심2011서1540\"])\n  ..."
 * }
 *
 * 에러 응답:
 * { "error": "MISSING_CASE_NO", "message": "..." }
 * { "error": "NOT_FOUND",       "message": "..." }
 * { "error": "E-PII-DETECTED",  "message": "..." }
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const caseNo = searchParams.get('caseNo')?.trim()

  // 입력 검증 — caseNo 필수·길이
  if (!caseNo || caseNo.length < 5) {
    return NextResponse.json(
      {
        error: 'MISSING_CASE_NO',
        message: '청구번호(caseNo)를 입력해 주세요. (예: 조심2011서1540)',
      },
      { status: 400 },
    )
  }
  if (caseNo.length > 60) {
    return NextResponse.json(
      { error: 'CASE_NO_TOO_LONG', message: '청구번호는 최대 60자까지 입력 가능합니다.' },
      { status: 400 },
    )
  }

  try {
    const adapter = new NationalTaxLawAdapter()
    const result = await buildImpactMap(adapter, caseNo)

    if (!result) {
      return NextResponse.json(
        {
          error: 'NOT_FOUND',
          message: `'${caseNo}' 에 해당하는 심판례를 찾지 못했습니다.`,
        },
        { status: 404 },
      )
    }

    return NextResponse.json(
      { map: result.map, mermaid: result.mermaid },
      { status: 200 },
    )
  } catch (err) {
    if (err instanceof AppError) {
      // 에러 코드별 HTTP 상태 매핑 (기존 /api/search 와 동일 규칙)
      const statusMap: Record<string, number> = {
        'E-PII-DETECTED':    400,
        'E-API-TIMEOUT':     503,
        'E-API-UNAVAILABLE': 503,
        'E-VERIFY-FAIL':     500,
        'INTERNAL_ERROR':    500,
      }
      const status = statusMap[err.code] ?? 500

      // API 키·스택트레이스 노출 금지 (CLAUDE.md §7)
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
