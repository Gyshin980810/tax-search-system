'use client'
import { useState } from 'react'
import type { Citation } from '@/domain/Citation'

interface CitationCopyProps {
  citation: Citation
}

export function CitationCopy({ citation }: CitationCopyProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const { taxLaw, excerpt, temporalLabel, label } = citation
    // \uC790\uB8CC\uC720\uD615\uBCC4 \uBA38\uB9AC\uB9D0 \u2014 \uBC95\uB839\uC740 \uC870\uBB38\uBC88\uD638, \uBE44\uBC95\uB839(\uD310\uB840 \uB4F1)\uC740 \uC120\uACE0\uC77C (TAX-015)
    const head =
      taxLaw.sourceType === '\uBC95\uB839'
        ? '[' + taxLaw.lawName + ' ' + taxLaw.articleNumber + ']'
        : '[' + taxLaw.lawName + (taxLaw.decisionDate ? ' ' + taxLaw.decisionDate : '') + ']'
    const lines = [
      head,
      excerpt,
      '\uCD9C\uCC98: ' + taxLaw.sourceUrl,
      '\uC2DC\uC810: ' + temporalLabel,
      '\uC2E0\uB8B0\uB3C4: ' + taxLaw.trustTier + ' / \uB77C\uBCA8: ' + label,
    ]
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded px-2 py-1 transition-colors"
    >
      {copied ? '\uBCF5\uC0AC\uB428 \u2713' : '\uC778\uC6A9 \uBCF5\uC0AC'}
    </button>
  )
}
