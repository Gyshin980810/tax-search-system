import 'server-only'
import { generateObject } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import { config } from '../config'
import type { IQueryRewriterPort } from '../ports/llmQueryRewriterPort'
import type { SearchQuery } from '../domain/SearchQuery'
import type { TemporalContext } from '../domain/TemporalContext'
import { LlmTimeoutError, LlmUnavailableError } from '../domain/errors'
import { lookupArticleHints } from '../domain/articleNumberHints'
import { enforceAxisCombination } from './queryAxisGuard'

/**
 * LLM API 응답 타임아웃 (25초)
 *
 * PRD §7.1 누적 P95 < 15초·PRD §13 E-LLM-TIMEOUT 30초와 정합.
 * 25초 = (P95 합격선 15s) + 안전 마진 10s, PRD §13 한도 내.
 * TAX-029 측정에서 쿼리 변환 Max=10.01s(타임아웃에 박힘) 발견되어 TAX-040으로 대칭 상향.
 */
const LLM_TIMEOUT_MS = 25_000

/**
 * 외부 검색 쿼리 cap (TAX-049 옵션 A).
 *
 * 사전 매칭 N개 + LLM (3-N)개 = 합산 ≤3 유지. 단 LLM은 최소 1개 보장.
 * 사전 쿼리는 어댑터에서 비법령 검색을 스킵(T1 정확 추출만)하므로
 * 결과 누적 폭증 위험 없음. 호출 수도 기존 LLM 단독 3개와 거의 동일.
 */
const MAX_LLM_QUERIES = 3

const SYSTEM_PROMPT = `당신은 대한민국 세법 전문 검색 보조 시스템입니다.
회계사가 자연어로 질문한 세법 쟁점을 국세법령정보시스템 API 검색에 적합한 키워드로 변환합니다.

규칙:
1. 법령명, 조문 제목, 세법 용어를 중심으로 키워드를 추출합니다.
2. 최대 3개의 검색 쿼리를 생성합니다 (핵심 → 확장 순서).
3. 각 키워드는 10자 이내로 간결하게 작성합니다.
4. 일반 생활 언어가 아닌 세법 공식 용어를 사용합니다.
5. 개인정보(주민번호, 사업자번호 등)는 절대 포함하지 않습니다.

[TAX-042G — 법리축 + 사실축 결합 규칙]
6. 모든 검색 키워드는 **법리축 + 사실축**을 결합합니다.
   - 법리축: 어떤 법령인가 (예: "법인세법", "소득세법", "부가가치세법", "시행령")
   - 사실축: 어떤 쟁점·행위·항목인가 (예: "손비", "접대비", "기부금", "양도소득", "세무조정")
7. ❌ 금지: 법리축 단독 (검색 결과 200건 이상 dump되어 LLM 입력 윈도우 초과 위험)
   - 잘못된 예: "법인세법", "소득세법", "부가가치세법", "법인세 시행령", "시행령"
8. ✅ 권장: 법리축과 사실축을 공백으로 결합
   - 좋은 예: "법인세법 손비", "법인세법 시행령 접대비", "양도소득세 비과세 1세대1주택",
              "부가가치세 면세 의료용역", "상속세 가산세"
9. 회계사 질문 자체가 광범위해 사실축이 없으면 법리축 단독도 허용합니다 (정확성 > 편의성).`

const querySchema = z.object({
  queries: z.array(
    z.object({
      keyword: z.string().min(1).max(100),
    }),
  ).min(1).max(3),
})

/**
 * GPT-4o-mini 기반 쿼리 변환 Adapter (SSOT §3.3 [1]단계)
 *
 * 회계사의 자연어 질문을 세법 검색 키워드로 변환합니다.
 * 타임아웃·에러는 LlmTimeoutError / LlmUnavailableError로 변환합니다.
 */
export class OpenAIQueryRewriterAdapter implements IQueryRewriterPort {
  async rewrite(question: string, temporal: TemporalContext): Promise<SearchQuery[]> {
    const userPrompt = temporal.explicit && temporal.targetDate
      ? `질문: ${question}\n기준 시점: ${temporal.targetDate.toISOString().slice(0, 10)}`
      : `질문: ${question}`

    const controller = new AbortController()
    const timerId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

    try {
      const openai = createOpenAI({ apiKey: config.openaiApiKey })
      const { object } = await generateObject({
        model: openai('gpt-4o-mini'),
        schema: querySchema,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        abortSignal: controller.signal,
      })

      const queries: SearchQuery[] = object.queries.map(q => ({
        keyword: q.keyword.trim(),
        requestedAt: temporal.requestedAt,
        ...(temporal.targetDate ? { targetDate: temporal.targetDate } : {}),
      }))
      // TAX-042G: 광범위 키워드 거버넌스 — LLM이 한 단어로 반환한 경우
      // 질문에서 사실축 토큰을 추출해 자동 부착. 후처리는 SearchQuery.keyword
      // 문자열에만 영향(TaxLaw·답변·시점 라벨 무영향, PII 재오염 없음).
      const llmQueries = enforceAxisCombination(queries, question)
      // TAX-049: 조문번호 매핑 사전(보조) — LLM이 생성 못하는 "제70조" 류
      // 조문번호를 결정론적으로 prepend해 외부 API 정확매칭 트리거.
      // 미커버 질문은 빈 배열 반환 → LLM 결과만으로 fallback(회귀 없음).
      const rawHintQueries = lookupArticleHints(question, temporal.requestedAt)
      const hintQueries = temporal.targetDate
        ? rawHintQueries.map(q => ({ ...q, targetDate: temporal.targetDate }))
        : rawHintQueries
      // 사전 N개 매칭 시 LLM 결과는 (3-N)개로 줄여 외부 검색 총 호출 ≤3 유지.
      // LLM 최소 1개는 보장(사전 매칭이 회계사 질문 전체 의도를 다 잡지 못할 수 있음).
      const llmCap = Math.max(MAX_LLM_QUERIES - hintQueries.length, 1)
      const trimmedLlm = llmQueries.slice(0, llmCap)
      const merged: SearchQuery[] = []
      const seen = new Set<string>()
      for (const q of [...hintQueries, ...trimmedLlm]) {
        // 같은 keyword라도 articleNumberHint가 다르면 다른 쿼리(예: 같은 법령 다른 조문).
        const key = `${q.keyword}|${q.articleNumberHint ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(q)
      }
      return merged
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new LlmTimeoutError()
      if (err instanceof LlmTimeoutError) throw err
      throw new LlmUnavailableError(err)
    } finally {
      clearTimeout(timerId)
    }
  }
}
