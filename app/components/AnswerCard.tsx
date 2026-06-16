'use client'
import { useState, useEffect } from 'react'
import type { LabeledAnswer } from '@/domain/LabeledAnswer'
import type { CitationLabel } from '@/domain/Citation'
import type { TaxLaw } from '@/domain/TaxLaw'
import { CitationCopy } from './CitationCopy'
import { ImpactMapPanel } from './ImpactMapPanel'
import { isBookmarked, addBookmark, removeBookmark } from '@/utils/bookmarkStore'

// 부칙·경과조치 citation 판별 (TAX-6B-2, FR-17)
//  TAX-6B-1 buchikToTaxLaw가 articleTitle='부칙' + trustTier='T2'로 산출한 자료를 식별한다.
//  본법령 조문과 시각적으로 구분해 신·구법 적용 경계(경과조치)임을 회계사에게 알린다.
function isAddendum(taxLaw: TaxLaw): boolean {
  return taxLaw.articleTitle === '부칙' && taxLaw.trustTier === 'T2'
}

interface AnswerCardProps {
  answer: LabeledAnswer
}

const LABEL_STYLES: Record<CitationLabel, string> = {
  '🟢직접근거': 'bg-green-100 text-green-800 border-green-200',
  '🟡유사사례': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  '⚪참고자료': 'bg-gray-100 text-gray-700 border-gray-200',
  '⚫폐지':     'bg-gray-800 text-white border-gray-900',
}

// 라벨 툴팁 — 마우스오버 시 의미 설명 (TAX-6B-5)
const LABEL_TITLES: Record<CitationLabel, string> = {
  '🟢직접근거': '직접 근거: 검색된 조문이 이 사안에 직접 적용됩니다',
  '🟡유사사례': '유사 사례: 논리적으로 유사하나 사실관계가 다를 수 있습니다. 단정 적용 금지',
  '⚪참고자료': '참고 자료: 관련 쟁점을 다루나 직접 적용이 어렵습니다',
  '⚫폐지':     '폐지된 조문: 현재는 효력이 없습니다. 폐지 시점을 반드시 확인하세요',
}

const TIER_STYLES: Record<string, string> = {
  T1: 'bg-blue-100 text-blue-800',
  T2: 'bg-indigo-100 text-indigo-800',
  T3: 'bg-purple-100 text-purple-800',
  T4: 'bg-pink-100 text-pink-800',
}

// Tier 툴팁 — Trust Tier 의미 설명 (TAX-6B-5)
const TIER_TITLES: Record<string, string> = {
  T1: 'T1: 법률·시행령·시행규칙 본문 (최우선 근거)',
  T2: 'T2: 법령 부칙·경과조치 (시점 경계 근거)',
  T3: 'T3: 국세청 예규·해석례·심판례 (유사 사례)',
  T4: 'T4: 대법원·헌법재판소 판례 (참고)',
}

// 자료유형 배지 — 법령/판례/해석례/심판례를 한눈에 구분 (TAX-015)
const SOURCE_TYPE_STYLES: Record<string, string> = {
  '법령':   'bg-slate-100 text-slate-700 border-slate-200',
  '판례':   'bg-pink-50 text-pink-700 border-pink-200',
  '해석례': 'bg-purple-50 text-purple-700 border-purple-200',
  '심판례': 'bg-amber-50 text-amber-700 border-amber-200',
}

// 자료유형별 일자 표기 문구 — 판례=선고일, 심판례=결정일 (TAX-016A)
//  해석례는 출처별로 필드가 달라 구분: 법제처(expc)=회신일자→'회신일', 국세청(ntsCgmExpc)=해석일자→'해석일' (TAX-016B)
function dateLabel(sourceType: string, issuingBody?: string): string {
  if (sourceType === '해석례') return issuingBody === '국세청' ? '해석일' : '회신일'
  if (sourceType === '심판례') return '결정일'
  return '선고일' // 판례
}

export function AnswerCard({ answer }: AnswerCardProps) {
  const [bookmarked, setBookmarked] = useState(false)

  useEffect(() => {
    setBookmarked(isBookmarked(answer.rawQuestion))
  }, [answer.rawQuestion])

  function toggleBookmark() {
    if (bookmarked) {
      removeBookmark(answer.rawQuestion)
    } else {
      addBookmark({
        rawQuestion: answer.rawQuestion,
        summary: answer.summary,
        temporalLabel: answer.temporalLabel,
      })
    }
    setBookmarked(!bookmarked)
  }

  // 노출 게이트는 화이트리스트(BUG-005 — M-7) — `status === 'PASS'`만 본문 노출.
  // PENDING(검증 미수행)은 기존 경고 유지, 그 외(FAIL 등)는 노출 불가 안내.
  // 정확성 우선 원칙(CLAUDE.md §0)상 게이트는 화이트리스트가 안전 기본값.
  const status = answer.verificationResult.status

  // PENDING 상태: 내부 테스트 전용 경고 표시, 인용 목록은 숨김 (CLAUDE.md §0)
  if (status === 'PENDING') {
    return (
      <div
        data-testid="pending-warning"
        className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-4 space-y-1"
      >
        <p className="font-semibold">⚠️ 검증 대기 중 (내부 테스트 전용)</p>
        <p>
          law-verifier(M3) 연결 전 상태입니다. 이 답변은 회계사에게 노출하지 마세요.
          원문을 직접 확인하시기 바랍니다.
        </p>
      </div>
    )
  }

  // PASS가 아닌 상태(FAIL 등): 회계사 노출 차단 — 본문 전부 미렌더 (BUG-005 — M-7)
  //  현재 경로상 generateAnswer가 FAIL을 throw해 도달하지 않지만, 방어 게이트로 유지.
  if (status !== 'PASS') {
    return (
      <div
        data-testid="not-exposable"
        className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-4 space-y-1"
      >
        <p className="font-semibold">⛔ 노출 불가 — 검증을 완료하지 못한 답변입니다</p>
        <p>
          law-verifier 검증을 통과하지 못해 회계사에게 노출할 수 없습니다.
          질문을 다시 시도하시거나 국세청·담당 세무사에게 직접 문의해 주세요.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 요약 + 시점 라벨 */}
      <div className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <p className="font-medium text-gray-500 text-xs">요약</p>
          {/* 즐겨찾기 토글 버튼 (TAX-6B-4, FR-12) */}
          <button
            type="button"
            onClick={toggleBookmark}
            data-testid="bookmark-btn"
            aria-label={bookmarked ? '즐겨찾기 제거' : '즐겨찾기 추가'}
            className="text-base text-gray-400 hover:text-yellow-500 transition-colors"
          >
            {bookmarked ? '⭐' : '☆'}
          </button>
        </div>
        <p>{answer.summary}</p>
        <p
          data-testid="temporal-label"
          className="mt-1 text-xs text-gray-400"
        >
          {answer.temporalLabel}
        </p>
      </div>

      {answer.citations.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">직접 근거를 찾지 못했습니다.</p>
      )}

      {/* 인용 목록 */}
      {answer.citations.map((citation, idx) => {
        // 부칙·경과조치는 좌측 보더로 강조해 본법령 조문과 구분 (TAX-6B-2)
        const addendum = isAddendum(citation.taxLaw)
        return (
        <div
          key={idx}
          role="article"
          aria-label={`인용 ${idx + 1}: ${citation.taxLaw.lawName}${citation.taxLaw.articleNumber ? ' ' + citation.taxLaw.articleNumber : ''}`}
          className={`bg-white border border-gray-200 rounded-lg p-4 space-y-2 ${addendum ? 'border-l-4 border-l-indigo-400' : ''}`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {/* 경과조치 배지 — 부칙 citation에만 노출 (TAX-6B-2, FR-17) */}
            {addendum && (
              <span
                data-testid="addendum-badge"
                className="text-xs font-medium border rounded px-2 py-0.5 bg-indigo-100 text-indigo-800 border-indigo-200"
              >
                ⏱경과조치
              </span>
            )}
            <span
              data-testid="source-type-badge"
              className={`text-xs font-medium border rounded px-2 py-0.5 ${SOURCE_TYPE_STYLES[citation.taxLaw.sourceType] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}
            >
              {citation.taxLaw.sourceType}
            </span>
            <span
              data-testid="label-badge"
              title={LABEL_TITLES[citation.label]}
              className={`text-xs font-medium border rounded px-2 py-0.5 cursor-help ${LABEL_STYLES[citation.label]}`}
            >
              {citation.label}
            </span>
            <span
              title={TIER_TITLES[citation.taxLaw.trustTier]}
              className={`text-xs font-mono rounded px-1.5 py-0.5 cursor-help ${TIER_STYLES[citation.taxLaw.trustTier] ?? 'bg-gray-100 text-gray-600'}`}
            >
              {citation.taxLaw.trustTier}
            </span>
            <span className="text-xs text-gray-500">{citation.temporalLabel}</span>
          </div>

          <p className="text-sm font-semibold text-gray-800">
            {citation.taxLaw.lawName}
            {citation.taxLaw.articleNumber && ` ${citation.taxLaw.articleNumber}`}
            {citation.taxLaw.articleTitle && (
              <span className="font-normal text-gray-600"> ({citation.taxLaw.articleTitle})</span>
            )}
          </p>

          {/* 비법령(판례·해석례 등) 메타: 생산기관·일자 — 자료유형별 문구 (TAX-015, TAX-016A) */}
          {citation.taxLaw.sourceType !== '법령' && citation.taxLaw.decisionDate && (
            <p data-testid="decision-date" className="text-xs text-gray-500">
              {citation.taxLaw.issuingBody ? `${citation.taxLaw.issuingBody} · ` : ''}
              {dateLabel(citation.taxLaw.sourceType, citation.taxLaw.issuingBody)} {citation.taxLaw.decisionDate}
            </p>
          )}

          <blockquote className="text-sm text-gray-700 bg-gray-50 border-l-4 border-gray-300 pl-3 py-2 rounded-r">
            {citation.excerpt}
          </blockquote>

          <div className="flex items-center justify-between">
            <a
              href={citation.taxLaw.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              원문 보기 →
            </a>
            <CitationCopy citation={citation} />
          </div>

          {/* TAX-034: 심판례 관계 그래프 버튼 — caseNumber 있을 때만 노출 */}
          {citation.taxLaw.sourceType === '심판례' && citation.taxLaw.caseNumber && (
            <ImpactMapPanel caseNumber={citation.taxLaw.caseNumber} />
          )}
        </div>
        )
      })}

      {/* 관련 참고자료 — 본문 미제공 판례 등. 발췌 없이 메타·원문 링크만 (TAX-015B) */}
      {answer.references && answer.references.length > 0 && (
        <div
          data-testid="reference-list"
          className="bg-white border border-gray-200 rounded-lg p-4 space-y-3"
        >
          <p className="text-xs font-medium text-gray-500">
            관련 참고자료 (본문은 원문에서 확인)
          </p>
          {answer.references.map((ref, idx) => (
            <div
              key={idx}
              className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0 space-y-1"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs font-medium border rounded px-2 py-0.5 ${SOURCE_TYPE_STYLES[ref.sourceType] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}
                >
                  {ref.sourceType}
                </span>
                <span className="text-xs font-medium border rounded px-2 py-0.5 bg-gray-100 text-gray-700 border-gray-200">
                  ⚪참고자료
                </span>
                <span className={`text-xs font-mono rounded px-1.5 py-0.5 ${TIER_STYLES[ref.trustTier] ?? 'bg-gray-100 text-gray-600'}`}>
                  {ref.trustTier}
                </span>
              </div>

              <p className="text-sm font-semibold text-gray-800">
                {ref.lawName}
                {ref.articleTitle && (
                  <span className="font-normal text-gray-600"> ({ref.articleTitle})</span>
                )}
              </p>

              {ref.decisionDate && (
                <p className="text-xs text-gray-500">
                  {ref.issuingBody ? `${ref.issuingBody} · ` : ''}
                  {dateLabel(ref.sourceType, ref.issuingBody)} {ref.decisionDate}
                </p>
              )}

              <a
                href={ref.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                원문 보기 →
              </a>
            </div>
          ))}
          <p className="text-xs text-gray-400 pt-1">
            ※ 참고자료는 발췌 인용 없이 제목·원문 링크만 제공합니다. 원문에서 직접 확인해 주세요.
          </p>
        </div>
      )}

      {/* 면책 고지 */}
      <div
        data-testid="disclaimer"
        className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-4 py-3 leading-relaxed"
      >
        {answer.disclaimer}
      </div>
    </div>
  )
}
