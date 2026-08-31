const fs = require('fs')
const path = require('path')

// 저장소 위치가 바뀌어도 동작하도록 스크립트 기준 상대경로로 해석한다
// (옛 절대경로 C:/Users/sfami/WorkSpace/... 는 죽은 경로였음)
const OUT = path.join(__dirname, '..', 'app', 'components', 'CitationCopy.tsx')
const content = [
  "'use client'",
  "import { useState } from 'react'",
  "import type { Citation } from '@/domain/Citation'",
  "",
  "interface CitationCopyProps {",
  "  citation: Citation",
  "}",
  "",
  "export function CitationCopy({ citation }: CitationCopyProps) {",
  "  const [copied, setCopied] = useState(false)",
  "",
  "  async function handleCopy() {",
  "    const { taxLaw, excerpt, temporalLabel, label } = citation",
  "    const lines = [",
  "      '[' + taxLaw.lawName + ' ' + taxLaw.articleNumber + ']',",
  "      excerpt,",
  "      '\\uCD9C\\uCC98: ' + taxLaw.sourceUrl,",
  "      '\\uC2DC\\uC810: ' + temporalLabel,",
  "      '\\uC2E0\\uB8B0\\uB3C4: ' + taxLaw.trustTier + ' / \\uB77C\\uBCA8: ' + label,",
  "    ]",
  "    await navigator.clipboard.writeText(lines.join('\\n'))",
  "    setCopied(true)",
  "    setTimeout(() => setCopied(false), 2000)",
  "  }",
  "",
  "  return (",
  "    <button",
  "      onClick={handleCopy}",
  '      className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded px-2 py-1 transition-colors"',
  "    >",
  "      {copied ? '\\uBCF5\\uC0AC\\uB428 \\u2713' : '\\uC778\\uC6A9 \\uBCF5\\uC0AC'}",
  "    </button>",
  "  )",
  "}",
  "",
].join('\n')

fs.writeFileSync(
  OUT,
  content,
  'utf8',
)
console.log('CitationCopy.tsx written successfully')
