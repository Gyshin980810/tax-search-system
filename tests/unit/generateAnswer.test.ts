import { describe, it, expect, vi } from 'vitest'
import { generateAnswer } from '@/usecases/generateAnswer'
import { PiiDetectedError, ApiTimeoutError, LlmUnavailableError, AppError } from '@/domain/errors'
import { DISCLAIMER } from '@/domain/disclaimer'
import type { IQueryRewriterPort } from '@/ports/llmQueryRewriterPort'
import type { ISearchPort } from '@/ports/taxLawSearchPort'
import type { IAnswerGeneratorPort } from '@/ports/llmAnswerGeneratorPort'
import type { ILawVerifierPort } from '@/ports/lawVerifierPort'
import type { IOpsLogPort } from '@/ports/opsLogPort'
import type { IEmbeddingPort } from '@/ports/embeddingPort'
import type { SearchQuery } from '@/domain/SearchQuery'
import type { SearchResult } from '@/domain/SearchResult'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'
import type { TemporalContext } from '@/domain/TemporalContext'
import type { VerificationResult } from '@/domain/VerificationResult'
import type { TaxLaw } from '@/domain/TaxLaw'
import type { SearchResult as SearchResultType } from '@/domain/SearchResult'

// ─── 픽스처 ──────────────────────────────────────────────────────────────────

const MOCK_TEMPORAL: TemporalContext = {
  requestedAt: new Date('2026-05-15'),
  explicit: false,
}

const MOCK_QUERY: SearchQuery = { keyword: '부가가치세 면세', requestedAt: new Date() }

const MOCK_SEARCH_RESULT: SearchResult = {
  items: [
    {
      sourceType: '법령',
      lawName: '부가가치세법',
      articleNumber: '제26조',
      articleTitle: '면세',
      content: '제26조(면세) 다음 각 호의 재화 또는 용역의 공급에 대하여는 면세한다.',
      revisionDate: '2026-01-01',
      enforcementDate: '2026-01-01',
      sourceUrl: 'https://www.law.go.kr/test',
      trustTier: 'T1',
    },
  ],
  totalCount: 1,
}

const MOCK_LABELED_ANSWER: LabeledAnswer = {
  rawQuestion: '부가가치세 면세 대상이 무엇인가요?',
  citations: [],
  summary: '부가가치세 면세 대상입니다.',
  disclaimer: DISCLAIMER,
  temporalLabel: '[현행]',
  verificationResult: { status: 'PENDING', checks: { v1: false, v2: false, v3: false, v4: false, v5: false, v6: false }, failReasons: [] },
  generatedAt: new Date(),
}

const PASS_RESULT: VerificationResult = {
  status: 'PASS',
  checks: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true },
  failReasons: [],
}

const FAIL_V1_RESULT: VerificationResult = {
  status: 'FAIL',
  checks: { v1: false, v2: true, v3: true, v4: true, v5: true, v6: true },
  failReasons: ['V1: 인용 조문이 검색 결과에 없음'],
}

const FAIL_V2_RESULT: VerificationResult = {
  status: 'FAIL',
  checks: { v1: true, v2: false, v3: true, v4: true, v5: true, v6: true },
  failReasons: ['V2: 발췌가 원문과 불일치'],
}

// V5(면책)만 단독 실패 — 자동 부착으로 해결되어야 하는 케이스 (BUG-001)
const FAIL_V5_RESULT: VerificationResult = {
  status: 'FAIL',
  checks: { v1: true, v2: true, v3: true, v4: true, v5: false, v6: true },
  failReasons: ['V5: 면책 고지 미부착'],
}

// V2 + V5 동시 실패 — V5는 자동 부착, V2만 재생성 대상이어야 하는 케이스
const FAIL_V2_V5_RESULT: VerificationResult = {
  status: 'FAIL',
  checks: { v1: true, v2: false, v3: true, v4: true, v5: false, v6: true },
  failReasons: ['V2: 발췌가 원문과 불일치', 'V5: 면책 고지 미부착'],
}

function makeStubs(verifyResult: VerificationResult = PASS_RESULT) {
  const queryRewriter: IQueryRewriterPort = {
    rewrite: vi.fn().mockResolvedValue([MOCK_QUERY]),
  }
  const searchPort: ISearchPort = {
    search: vi.fn().mockResolvedValue(MOCK_SEARCH_RESULT),
  }
  const answerGenerator: IAnswerGeneratorPort = {
    generate: vi.fn().mockResolvedValue(MOCK_LABELED_ANSWER),
  }
  const verifier: ILawVerifierPort = {
    verify: vi.fn().mockResolvedValue(verifyResult),
  }
  return { queryRewriter, searchPort, answerGenerator, verifier }
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('generateAnswer Usecase', () => {

  describe('정상 흐름', () => {
    it('5단계 파이프라인을 순서대로 호출한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier,
        '부가가치세 면세 대상이 무엇인가요?', MOCK_TEMPORAL,
      )

      expect(queryRewriter.rewrite).toHaveBeenCalledOnce()
      expect(searchPort.search).toHaveBeenCalledWith(MOCK_QUERY)
      expect(answerGenerator.generate).toHaveBeenCalledWith(
        MOCK_SEARCH_RESULT.items,
        '부가가치세 면세 대상이 무엇인가요?',
        MOCK_TEMPORAL,
      )
      expect(verifier.verify).toHaveBeenCalledOnce()
      expect(result.verificationResult.status).toBe('PASS')
    })

    it('첫 번째 쿼리만 검색에 사용한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      const multipleQueries = [MOCK_QUERY, { keyword: '면세', requestedAt: new Date() }]
      vi.mocked(queryRewriter.rewrite).mockResolvedValue(multipleQueries)

      await generateAnswer(queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL)

      expect(searchPort.search).toHaveBeenCalledWith(multipleQueries[0])
      expect(searchPort.search).toHaveBeenCalledTimes(1)
    })

    it('검증 PASS 시 verificationResult.status가 PASS인 답변을 반환한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs(PASS_RESULT)

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      expect(result.verificationResult.status).toBe('PASS')
      expect(verifier.verify).toHaveBeenCalledTimes(1)
    })
  })

  describe('참고 목록 분리 (TAX-015B)', () => {
    // 본문 있는 법령 — citable(LLM·검증 전달 대상)
    const LAW_WITH_BODY: TaxLaw = {
      sourceType: '법령',
      lawName: '부가가치세법',
      articleNumber: '제26조',
      articleTitle: '면세',
      content: '제26조(면세) 다음 각 호의 재화 또는 용역의 공급에 대하여는 면세한다.',
      revisionDate: '2026-01-01',
      enforcementDate: '2026-01-01',
      sourceUrl: 'https://www.law.go.kr/law',
      trustTier: 'T1',
    }
    // 본문 없는 판례(국세 출처) — references(참고 목록 대상)
    const PREC_NO_BODY: TaxLaw = {
      sourceType: '판례',
      lawName: '인천지방법원-2025-구단-50403',
      articleNumber: '',
      articleTitle: '양도소득세 과세 적법',
      content: '',
      revisionDate: '2026-04-14',
      enforcementDate: '',
      sourceUrl: 'https://www.law.go.kr/precInfoP.do?precSeq=618619',
      trustTier: 'T4',
      caseNumber: '인천지방법원-2025-구단-50403',
      issuingBody: '국세법령정보시스템',
      decisionDate: '2026-04-14',
    }
    // 본문 없는 법령 — 비정상 데이터이므로 citable·references 어느 쪽에도 못 들어가고 드롭
    const LAW_NO_BODY: TaxLaw = { ...LAW_WITH_BODY, content: '', articleNumber: '제99조' }

    /**
     * 지정한 items를 반환하도록 searchPort를 교체한 스텁 묶음.
     * TAX-6B-10 엄격 컷오프 도입 후, 참고 목록 노출을 보려면 검색어가 픽스처와 관련돼야 한다.
     * 픽스처 사건명이 모두 "양도소득세 …"이므로 검색어도 '양도소득세'로 맞춘다.
     */
    function makeStubsWithSearch(items: TaxLaw[]) {
      const stubs = makeStubs(PASS_RESULT)
      const searchResult: SearchResultType = { items, totalCount: items.length }
      vi.mocked(stubs.searchPort.search).mockResolvedValue(searchResult)
      vi.mocked(stubs.queryRewriter.rewrite).mockResolvedValue([
        { keyword: '양도소득세', requestedAt: new Date() },
      ])
      return stubs
    }

    it('본문 없는 비법령 자료는 references로 분리되고 LLM·검증에는 전달되지 않는다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWithSearch([LAW_WITH_BODY, PREC_NO_BODY])

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      // LLM·검증에는 본문 있는 자료(citable)만 전달 — 본문 없는 판례 제외
      expect(answerGenerator.generate).toHaveBeenCalledWith([LAW_WITH_BODY], '질문', MOCK_TEMPORAL)
      expect(verifier.verify).toHaveBeenCalledWith(MOCK_LABELED_ANSWER, [LAW_WITH_BODY])
      // 본문 없는 판례는 참고 목록(references)으로만 노출
      expect(result.references).toEqual([PREC_NO_BODY])
    })

    it('본문 없는 법령은 references에도 포함되지 않고 드롭된다(비정상 데이터)', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWithSearch([LAW_WITH_BODY, LAW_NO_BODY])

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      expect(answerGenerator.generate).toHaveBeenCalledWith([LAW_WITH_BODY], '질문', MOCK_TEMPORAL)
      // 본문 없는 법령은 참고 목록 대상이 아니므로 references는 비어 있음
      expect(result.references).toEqual([])
    })

    it('참고 목록은 최대 10건(MAX_REFERENCES)으로 제한된다', async () => {
      // 본문 없는 판례 12건(선고일 다르게) → references는 상위 10건만
      const twelveRefs: TaxLaw[] = Array.from({ length: 12 }, (_, i) => ({
        ...PREC_NO_BODY,
        lawName: `참고판례-${i + 1}`,
        caseNumber: `case-${i + 1}`,
        decisionDate: `2026-01-${String(i + 1).padStart(2, '0')}`, // 01-01 ~ 01-12
      }))
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWithSearch([LAW_WITH_BODY, ...twelveRefs])

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      expect(result.references).toHaveLength(10)
      // 모두 '양도소득세' 사건명 매칭 → 점수 동점 → 선고일 최신순 상위 10건. 가장 오래된 01·02일자는 잘림
      expect(result.references?.[0].caseNumber).toBe('case-12')
      expect(result.references?.map((r) => r.caseNumber)).not.toContain('case-1')
      expect(result.references?.map((r) => r.caseNumber)).not.toContain('case-2')
    })

    it('참고 대상이 없으면 references는 빈 배열이다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWithSearch([LAW_WITH_BODY])

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      expect(result.references).toEqual([])
    })
  })

  describe('참고 목록 관련도 정렬 (TAX-015C)', () => {
    const LAW_WITH_BODY: TaxLaw = {
      sourceType: '법령',
      lawName: '소득세법',
      articleNumber: '제89조',
      articleTitle: '비과세 양도소득',
      content: '제89조(비과세 양도소득) 다음 각 호의 소득에 대하여는 양도소득세를 과세하지 아니한다.',
      revisionDate: '2026-01-01',
      enforcementDate: '2026-01-01',
      sourceUrl: 'https://www.law.go.kr/law',
      trustTier: 'T1',
    }
    /** 본문 없는 판례(참고자료) 픽스처 헬퍼 — 사건명·사건번호·선고일만 다르게 */
    function makeRef(articleTitle: string, caseNumber: string, decisionDate: string): TaxLaw {
      return {
        sourceType: '판례',
        lawName: caseNumber,
        articleNumber: '',
        articleTitle,
        content: '',
        revisionDate: decisionDate,
        enforcementDate: '',
        sourceUrl: `https://www.law.go.kr/precInfoP.do?precSeq=${caseNumber}`,
        trustTier: 'T4',
        caseNumber,
        issuingBody: '국세법령정보시스템',
        decisionDate,
      }
    }

    /** 지정 items·검색어로 스텁 구성 */
    function makeStubsWith(items: TaxLaw[], keyword: string) {
      const stubs = makeStubs(PASS_RESULT)
      const searchResult: SearchResultType = { items, totalCount: items.length }
      vi.mocked(stubs.searchPort.search).mockResolvedValue(searchResult)
      vi.mocked(stubs.queryRewriter.rewrite).mockResolvedValue([
        { keyword, requestedAt: new Date() },
      ])
      return stubs
    }

    it('관련도 점수가 최신성보다 우선한다 (TAX-015C → TAX-6B-10 가중치 반영)', async () => {
      // 약매칭: 사건명 무매칭 + 본문에 '양도소득세'(1점), 더 최신(2026)
      const refWeak: TaxLaw = {
        ...makeRef('취득세 경정청구 거부처분 취소', '2026두1', '2026-01-01'),
        content: '주문\n재결요지 — 양도소득세 부과는 정당하다.',
      }
      // 강매칭: 사건명에 '양도소득세'(2점), 더 오래됨(2020)
      const refStrong = makeRef('양도소득세 부과처분 취소', '2020누1', '2020-01-01')
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWith([LAW_WITH_BODY, refWeak, refStrong], '양도소득세')

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '양도소득세 비과세 질문', MOCK_TEMPORAL,
      )

      // 사건명 매칭(2점)이 본문 매칭(1점)·최신성보다 우선
      expect(result.references?.map((r) => r.caseNumber)).toEqual(['2020누1', '2026두1'])
    })

    it('관련도가 같으면 선고일 최신순으로 보조 정렬된다', async () => {
      const refOld = makeRef('양도소득세 A 사건', 'old1', '2020-01-01')
      const refNew = makeRef('양도소득세 B 사건', 'new1', '2026-01-01')
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWith([LAW_WITH_BODY, refOld, refNew], '양도소득세')

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '양도소득세 질문', MOCK_TEMPORAL,
      )

      // 둘 다 점수 1 → 선고일 최신순(new1이 위)
      expect(result.references?.map((r) => r.caseNumber)).toEqual(['new1', 'old1'])
    })

    it('검색어가 어디에도 없으면(전부 점수 0) 참고 목록에서 제외된다 — 엄격 컷오프 (TAX-6B-10)', async () => {
      const refA = makeRef('취득세 부과처분', 'a1', '2020-01-01')
      const refB = makeRef('법인세 경정청구', 'b1', '2026-01-01')
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWith([LAW_WITH_BODY, refA, refB], '양도소득세')

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '양도소득세 질문', MOCK_TEMPORAL,
      )

      // 모두 무관(점수 0) → 빈 배열("무관한 건 빼라", 회계사 결정 2026-06-17)
      expect(result.references).toEqual([])
    })

    it('검색어가 본문(content)에만 있어도 참고 목록에 포함된다 — 본문 신호 (TAX-6B-10)', async () => {
      // 사건명엔 검색어 없음, 본문에만 '가지급금' 포함 → 본문 매칭(1점)으로 노출
      const refBodyOnly: TaxLaw = {
        ...makeRef('법인세 부과처분 취소', 'body1', '2026-01-01'),
        sourceType: '심판례',
        trustTier: 'T3',
        issuingBody: '조세심판원',
        content: '주문\n재결요지 — 가지급금 인정이자 익금산입은 정당하다.',
      }
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWith([LAW_WITH_BODY, refBodyOnly], '가지급금')

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '가지급금 질문', MOCK_TEMPORAL,
      )

      expect(result.references?.map((r) => r.caseNumber)).toEqual(['body1'])
    })

    it('사건명 매칭(2점)이 본문 매칭(1점)보다 위로 정렬된다 — 가중치 (TAX-6B-10)', async () => {
      // titleHit: 사건명에 '가지급금'(2점) / bodyHit: 본문에만 '가지급금'(1점)
      const titleHit: TaxLaw = {
        ...makeRef('가지급금 인정이자 부과처분', 'title1', '2020-01-01'),
        sourceType: '심판례', trustTier: 'T3', issuingBody: '조세심판원',
        content: '주문\n재결요지 — 청구를 기각한다.',
      }
      const bodyHit: TaxLaw = {
        ...makeRef('법인세 부과처분 취소', 'body1', '2026-01-01'),
        sourceType: '심판례', trustTier: 'T3', issuingBody: '조세심판원',
        content: '주문\n재결요지 — 가지급금 인정이자는 정당하다.',
      }
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWith([LAW_WITH_BODY, bodyHit, titleHit], '가지급금')

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '가지급금 질문', MOCK_TEMPORAL,
      )

      // 사건명 매칭(2점)이 더 오래됐어도, 본문 매칭(1점)보다 위
      expect(result.references?.map((r) => r.caseNumber)).toEqual(['title1', 'body1'])
    })

    it('불용어("관련")만으로는 점수가 오르지 않는다 — 불용어 제거 (TAX-6B-10)', async () => {
      // 검색어 토큰 중 '관련'은 불용어 → 제거. 사건명에 '관련'만 있고 핵심어는 없으면 컷오프
      const onlyStopword = makeRef('관련 사건', 'stop1', '2026-01-01')
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWith([LAW_WITH_BODY, onlyStopword], '양도소득세 관련')

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '양도소득세 관련 질문', MOCK_TEMPORAL,
      )

      // '관련'은 불용어로 제거되고 '양도소득세'는 미포함 → 점수 0 → 빈 배열
      expect(result.references).toEqual([])
    })

    // ─── TAX-6B-12 방향 C: 의미(벡터) 재정렬 ──────────────────────────────
    /** 의미 임베딩 스텁 — '양도'가 들어간 텍스트는 [1,0], 아니면 [0,1] (표기변이 의미매칭 모사) */
    function makeEmbedStub(): IEmbeddingPort {
      const vecFor = (t: string): number[] => (t.includes('양도') ? [1, 0] : [0, 1])
      return {
        embed: vi.fn(async (t: string) => vecFor(t)),
        embedBatch: vi.fn(async (texts: string[]) => texts.map(vecFor)),
      }
    }

    it('글자는 안 겹쳐도 의미가 가까우면 참고 목록에 살린다 — 표기변이 구제 (TAX-6B-12)', async () => {
      // 사건명 "양도세"는 검색어 "양도소득세"와 글자가 안 겹쳐 글자 0점이지만, 의미로는 가깝다
      const variant = makeRef('양도세 비과세 해당 여부', 'var1', '2026-01-01')
      const unrelated = makeRef('취득세 부과처분 취소', 'unrel1', '2026-01-01')
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWith([LAW_WITH_BODY, variant, unrelated], '양도소득세')

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier,
        '양도소득세 1세대 1주택', MOCK_TEMPORAL, undefined, makeEmbedStub(),
      )

      // 의미가 가까운 '양도세' 후보만 구제, 무관한 '취득세'는 의미도 0 → 탈락
      expect(result.references?.map((r) => r.caseNumber)).toEqual(['var1'])
    })

    it('embeddingPort 미주입이면 글자 점수만 사용한다 — 폴백 (TAX-6B-12)', async () => {
      // 위와 동일 후보지만 임베딩 없음 → 글자 0점 '양도세'는 컷오프 탈락
      const variant = makeRef('양도세 비과세 해당 여부', 'var1', '2026-01-01')
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWith([LAW_WITH_BODY, variant], '양도소득세')

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '양도소득세 1세대 1주택', MOCK_TEMPORAL,
      )

      expect(result.references).toEqual([])
    })

    it('임베딩 호출 실패 시 글자 점수로 복귀한다 — graceful degrade (TAX-6B-12)', async () => {
      const variant = makeRef('양도세 비과세 해당 여부', 'var1', '2026-01-01')   // 글자 0
      const strong = makeRef('양도소득세 부과처분 취소', 'strong1', '2020-01-01') // 글자 2
      const failingEmbed: IEmbeddingPort = {
        embed: vi.fn(async () => { throw new Error('embedding API down') }),
        embedBatch: vi.fn(async () => { throw new Error('embedding API down') }),
      }
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWith([LAW_WITH_BODY, variant, strong], '양도소득세')

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier,
        '양도소득세 1세대 1주택', MOCK_TEMPORAL, undefined, failingEmbed,
      )

      // 임베딩 실패 → 글자 점수만: 글자 매칭되는 'strong1'만, 글자 0 'var1'은 탈락
      expect(result.references?.map((r) => r.caseNumber)).toEqual(['strong1'])
    })
  })

  describe('참고 목록 — 인용 안 된 자료 노출 (TAX-015D)', () => {
    const LAW_WITH_BODY: TaxLaw = {
      sourceType: '법령',
      lawName: '소득세법',
      articleNumber: '제89조',
      articleTitle: '비과세 양도소득',
      content: '제89조(비과세 양도소득) 다음 각 호의 소득에 대하여는 양도소득세를 과세하지 아니한다.',
      revisionDate: '2026-01-01',
      enforcementDate: '2026-01-01',
      sourceUrl: 'https://www.law.go.kr/law',
      trustTier: 'T1',
    }
    // 본문 있는 법령해석례(citable로 LLM 전달되지만 인용 여부는 답변에 따라 다름)
    const EXPC_WITH_BODY: TaxLaw = {
      sourceType: '해석례',
      lawName: '법제처 12-0368',
      articleNumber: '',
      articleTitle: '양도소득세 비과세 대상 여부',
      content: '질의요지\n회답\n이유 — 비과세 요건을 충족한다.',
      revisionDate: '2026-02-20',
      enforcementDate: '',
      sourceUrl: 'https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=313499',
      trustTier: 'T3',
      caseNumber: '12-0368',
      issuingBody: '법제처',
      decisionDate: '2026-02-20',
    }

    function makeStubsWithSearch(items: TaxLaw[]) {
      const stubs = makeStubs(PASS_RESULT)
      const searchResult: SearchResultType = { items, totalCount: items.length }
      vi.mocked(stubs.searchPort.search).mockResolvedValue(searchResult)
      // TAX-6B-10 컷오프: EXPC 사건명("양도소득세 …")과 매칭되도록 검색어 지정
      vi.mocked(stubs.queryRewriter.rewrite).mockResolvedValue([
        { keyword: '양도소득세', requestedAt: new Date() },
      ])
      return stubs
    }

    it('검색됐지만 인용되지 않은 본문 있는 비법령(해석례)은 참고 목록에 노출된다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWithSearch([LAW_WITH_BODY, EXPC_WITH_BODY])
      // generate는 MOCK_LABELED_ANSWER(citations: [])를 반환 → 해석례 미인용

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      // 본문 있는 해석례는 citable로 LLM에 전달됨
      expect(answerGenerator.generate).toHaveBeenCalledWith(
        [LAW_WITH_BODY, EXPC_WITH_BODY], '질문', MOCK_TEMPORAL,
      )
      // 인용되지 않았으므로 참고 목록에 노출
      expect(result.references?.map((r) => r.caseNumber)).toEqual(['12-0368'])
    })

    it('인용된 비법령은 참고 목록에 중복 노출되지 않는다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } =
        makeStubsWithSearch([LAW_WITH_BODY, EXPC_WITH_BODY])
      // generate가 해석례를 인용한 답변을 반환
      vi.mocked(answerGenerator.generate).mockResolvedValue({
        ...MOCK_LABELED_ANSWER,
        citations: [
          {
            taxLaw: EXPC_WITH_BODY,
            label: '🟡유사사례',
            excerpt: '비과세 요건을 충족한다.',
            temporalLabel: '[현행]',
          },
        ],
      })

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      // 인용된 해석례는 참고 목록에서 제외 → 빈 배열
      expect(result.references).toEqual([])
    })
  })

  describe('재시도 정책 — V1 실패(출처 없음)', () => {
    it('V1 실패 시 재검색 1회를 수행한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      // 첫 검증: V1 FAIL → 재시도 후 PASS
      vi.mocked(verifier.verify)
        .mockResolvedValueOnce(FAIL_V1_RESULT)
        .mockResolvedValueOnce(PASS_RESULT)

      await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      // 재검색: search 2회 호출
      expect(searchPort.search).toHaveBeenCalledTimes(2)
      // 재생성: generate 2회 호출
      expect(answerGenerator.generate).toHaveBeenCalledTimes(2)
      // 검증: 2회 호출
      expect(verifier.verify).toHaveBeenCalledTimes(2)
    })

    it('V1 실패 후 재시도에서 PASS 시 정상 반환한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      vi.mocked(verifier.verify)
        .mockResolvedValueOnce(FAIL_V1_RESULT)
        .mockResolvedValueOnce(PASS_RESULT)

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      expect(result.verificationResult.status).toBe('PASS')
    })
  })

  describe('재시도 정책 — V2~V6 실패(재생성)', () => {
    it('V2 실패 시 재검색 없이 재생성 1회만 수행한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      vi.mocked(verifier.verify)
        .mockResolvedValueOnce(FAIL_V2_RESULT)
        .mockResolvedValueOnce(PASS_RESULT)

      await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      // 재검색 없음: search 1회만
      expect(searchPort.search).toHaveBeenCalledTimes(1)
      // 재생성: generate 2회
      expect(answerGenerator.generate).toHaveBeenCalledTimes(2)
      expect(verifier.verify).toHaveBeenCalledTimes(2)
    })
  })

  describe('V5 면책 고지 자동 부착 (BUG-001)', () => {
    // generate가 면책 고지 빈 답변을 내놓는 상황을 재현
    const EMPTY_DISCLAIMER_ANSWER: LabeledAnswer = { ...MOCK_LABELED_ANSWER, disclaimer: '' }

    it('V5 단독 실패 시 재생성 없이 DISCLAIMER를 자동 부착하고 PASS 반환한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      vi.mocked(answerGenerator.generate).mockResolvedValue(EMPTY_DISCLAIMER_ANSWER)
      // 1차: V5만 FAIL → 자동 부착 후 2차: PASS
      vi.mocked(verifier.verify)
        .mockResolvedValueOnce(FAIL_V5_RESULT)
        .mockResolvedValueOnce(PASS_RESULT)

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      // 핵심: 재생성 없음 — generate는 최초 1회만 호출
      expect(answerGenerator.generate).toHaveBeenCalledTimes(1)
      // 재검색도 없음 — search 1회만
      expect(searchPort.search).toHaveBeenCalledTimes(1)
      // 1차 검증 + 자동 부착 후 재검증 = 2회
      expect(verifier.verify).toHaveBeenCalledTimes(2)
      // 결과: PASS + DISCLAIMER 주입 확인
      expect(result.verificationResult.status).toBe('PASS')
      expect(result.disclaimer).toBe(DISCLAIMER)
    })

    it('V5+V2 동시 실패 시 V5는 자동 부착으로 선처리하고 V2만 재생성 1회한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      vi.mocked(answerGenerator.generate).mockResolvedValue(EMPTY_DISCLAIMER_ANSWER)
      // 1차: V2+V5 FAIL → 자동 부착 → 2차: V2만 FAIL → 재생성 → 3차: PASS
      vi.mocked(verifier.verify)
        .mockResolvedValueOnce(FAIL_V2_V5_RESULT)
        .mockResolvedValueOnce(FAIL_V2_RESULT)
        .mockResolvedValueOnce(PASS_RESULT)

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      // 최초 생성 1회 + V2 재생성 1회 = 2회 (V5 자동 부착은 generate를 부르지 않음)
      expect(answerGenerator.generate).toHaveBeenCalledTimes(2)
      // V2는 재검색 대상 아님 → search 1회
      expect(searchPort.search).toHaveBeenCalledTimes(1)
      // 1차 + 자동 부착 후 + 재생성 후 = 3회
      expect(verifier.verify).toHaveBeenCalledTimes(3)
      expect(result.verificationResult.status).toBe('PASS')
    })

    it('자동 부착 후에도 V2가 FAIL이면 E-VERIFY-FAIL을 던진다 (V5 탓 폐기 아님)', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      vi.mocked(answerGenerator.generate).mockResolvedValue(EMPTY_DISCLAIMER_ANSWER)
      // 1차: V2+V5 FAIL → 자동 부착 → 2차: V2 FAIL → 재생성 → 3차: V2 끝내 FAIL
      vi.mocked(verifier.verify)
        .mockResolvedValueOnce(FAIL_V2_V5_RESULT)
        .mockResolvedValueOnce(FAIL_V2_RESULT)
        .mockResolvedValueOnce(FAIL_V2_RESULT)

      const err = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      ).catch((e) => e)

      expect(err).toBeInstanceOf(AppError)
      expect(err.code).toBe('E-VERIFY-FAIL')
    })
  })

  describe('재시도 후에도 FAIL — E-VERIFY-FAIL', () => {
    it('V1 재시도 후에도 FAIL이면 E-VERIFY-FAIL AppError를 던진다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      vi.mocked(verifier.verify)
        .mockResolvedValueOnce(FAIL_V1_RESULT)
        .mockResolvedValueOnce(FAIL_V1_RESULT)

      const err = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      ).catch((e) => e)

      expect(err).toBeInstanceOf(AppError)
      expect(err.code).toBe('E-VERIFY-FAIL')
    })

    it('V2 재시도 후에도 FAIL이면 E-VERIFY-FAIL AppError를 던진다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      vi.mocked(verifier.verify)
        .mockResolvedValueOnce(FAIL_V2_RESULT)
        .mockResolvedValueOnce(FAIL_V2_RESULT)

      const err = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      ).catch((e) => e)

      expect(err).toBeInstanceOf(AppError)
      expect(err.code).toBe('E-VERIFY-FAIL')
    })
  })

  describe('PII 차단', () => {
    it('주민번호가 포함된 질문은 PiiDetectedError를 던진다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()

      await expect(
        generateAnswer(queryRewriter, searchPort, answerGenerator, verifier, '800101-1234567', MOCK_TEMPORAL),
      ).rejects.toBeInstanceOf(PiiDetectedError)

      // PII 감지 시 LLM 호출 없음
      expect(queryRewriter.rewrite).not.toHaveBeenCalled()
    })
  })

  describe('V3 라벨 적정성 진단 마커 부착 (TAX-042D Stage 4 풀세트 보강 E·F·G)', () => {
    // T3 심판례 — V3가 허용하지 않는 🟢직접근거 라벨을 의도적으로 붙여 위험 방향(LABEL_MISMATCH)을
    // 재현한다. lawVerifier의 V3 PASS/FAIL 판정과 독립이며 본 테스트는 운영 로그 진단 신호만 검증한다.
    const T3_TRIBUNAL: TaxLaw = {
      sourceType: '심판례',
      lawName: '조세심판원 조심 2020부1558',
      articleNumber: '',
      articleTitle: '쟁점농지 양도소득세 과세처분의 당부',
      content: '심판청구를 기각한다.',
      revisionDate: '2020-06-16',
      enforcementDate: '',
      sourceUrl: 'https://www.law.go.kr/test',
      trustTier: 'T3',
      caseNumber: '조심 2020부1558',
      issuingBody: '조세심판원',
      decisionDate: '2020-06-16',
    }

    it('T3+🟢직접근거 답변은 diagnostics.verifyMarker=LABEL_MISMATCH로 표시된다 (위험 방향)', async () => {
      // verifier는 PASS로 모킹해 재시도 분기를 회피한다. 본 테스트는 진단 마커만 검증.
      // (실제 운영에서는 V3 FAIL → 재생성 → E-VERIFY-FAIL 경로로 차단됨)
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs(PASS_RESULT)
      vi.mocked(answerGenerator.generate).mockResolvedValue({
        ...MOCK_LABELED_ANSWER,
        citations: [
          {
            taxLaw: T3_TRIBUNAL,
            label: '🟢직접근거',
            excerpt: '심판청구를 기각한다',
            temporalLabel: '[결정: 2020.06.16]',
          },
        ],
      })

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '농지 양도세 심판례', MOCK_TEMPORAL,
      )

      // T3에는 🟢직접근거가 허용되지 않으므로 tierMapping=fail. 안전 방향(T1·T2→⚪) 아님 → LABEL_MISMATCH.
      expect(result.diagnostics?.verifyMarker).toBe('LABEL_MISMATCH')
      expect(result.diagnostics?.tierMatchGrade).toBe('mismatch')
      expect(result.diagnostics?.v3Groups.tierMapping).toBe('fail')
      expect(result.diagnostics?.v3Groups.labelEnum).toBe('pass')
    })
  })

  describe('에러 전파', () => {
    it('검색 Port에서 ApiTimeoutError 발생 시 그대로 전파된다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      vi.mocked(searchPort.search).mockRejectedValue(new ApiTimeoutError())

      await expect(
        generateAnswer(queryRewriter, searchPort, answerGenerator, verifier, '부가가치세', MOCK_TEMPORAL),
      ).rejects.toBeInstanceOf(ApiTimeoutError)
    })

    it('AnswerGenerator에서 LlmUnavailableError 발생 시 그대로 전파된다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      vi.mocked(answerGenerator.generate).mockRejectedValue(new LlmUnavailableError())

      await expect(
        generateAnswer(queryRewriter, searchPort, answerGenerator, verifier, '부가가치세', MOCK_TEMPORAL),
      ).rejects.toBeInstanceOf(LlmUnavailableError)
    })
  })

  describe('운영 쿼리 로그 수집 (TAX-030-A, FR-23)', () => {
    /** recordQuery를 spy로 감싼 가짜 운영 로그 포트 (recordFeedback은 TAX-030-B 확장분 — no-op) */
    function makeOpsLog(): IOpsLogPort & { recordQuery: ReturnType<typeof vi.fn> } {
      return {
        recordQuery: vi.fn().mockResolvedValue(undefined),
        recordFeedback: vi.fn().mockResolvedValue(undefined),
        listFeedback: vi.fn().mockResolvedValue([]),
      }
    }

    it('성공 경로에서 recordQuery를 1회 호출하고 verifyStatus=PASS로 기록한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs(PASS_RESULT)
      const opsLog = makeOpsLog()

      await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL, opsLog,
      )

      expect(opsLog.recordQuery).toHaveBeenCalledTimes(1)
      const entry = opsLog.recordQuery.mock.calls[0][0]
      expect(entry.verifyStatus).toBe('PASS')
      expect(entry.failedChecks).toEqual([])
      expect(entry.sourceTypes).toEqual(['법령']) // MOCK_SEARCH_RESULT는 법령 1건
      expect(entry.queryHash).toHaveLength(16)
      expect(typeof entry.latencyMs).toBe('number')
    })

    it('E-VERIFY-FAIL 경로에서도 verifyStatus=FAIL·failedChecks를 기록한 뒤 throw한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs()
      // V1 재시도 후에도 FAIL → E-VERIFY-FAIL
      vi.mocked(verifier.verify)
        .mockResolvedValueOnce(FAIL_V1_RESULT)
        .mockResolvedValueOnce(FAIL_V1_RESULT)
      const opsLog = makeOpsLog()

      const err = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL, opsLog,
      ).catch((e) => e)

      expect(err).toBeInstanceOf(AppError)
      expect(err.code).toBe('E-VERIFY-FAIL')
      // 실패 경로도 메타데이터를 남긴다
      expect(opsLog.recordQuery).toHaveBeenCalledTimes(1)
      const entry = opsLog.recordQuery.mock.calls[0][0]
      expect(entry.verifyStatus).toBe('FAIL')
      expect(entry.failedChecks).toContain('v1')
    })

    it('fail-soft: recordQuery가 reject해도 정상 답변을 반환한다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs(PASS_RESULT)
      const opsLog: IOpsLogPort = {
        recordQuery: vi.fn().mockRejectedValue(new Error('DB down')),
        recordFeedback: vi.fn().mockResolvedValue(undefined),
        listFeedback: vi.fn().mockResolvedValue([]),
      }

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL, opsLog,
      )

      // 로그 적재 실패가 답변 생성을 막지 않는다
      expect(result.verificationResult.status).toBe('PASS')
    })

    it('query_norm에 휴대폰·이메일이 마스킹되어 기록된다', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs(PASS_RESULT)
      const opsLog = makeOpsLog()

      await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier,
        '010-1234-5678 user@example.com 문의', MOCK_TEMPORAL, opsLog,
      )

      const entry = opsLog.recordQuery.mock.calls[0][0]
      expect(entry.queryNorm).toContain('010-****-5678')
      expect(entry.queryNorm).toContain('us***@example.com')
      expect(entry.queryNorm).not.toContain('1234-5678') // 원본 휴대폰 노출 금지
    })

    it('opsLog 미주입(undefined) 시에도 정상 동작한다(하위 호환)', async () => {
      const { queryRewriter, searchPort, answerGenerator, verifier } = makeStubs(PASS_RESULT)

      const result = await generateAnswer(
        queryRewriter, searchPort, answerGenerator, verifier, '질문', MOCK_TEMPORAL,
      )

      expect(result.verificationResult.status).toBe('PASS')
    })
  })
})
