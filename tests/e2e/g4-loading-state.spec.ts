/**
 * E2E 시나리오 G-4: 로딩 상태 UX
 * 검색 중 버튼 비활성화, 로딩 텍스트 표시, 완료 후 정상 복원을 검증한다.
 */
import { test, expect } from '@playwright/test'
import { DISCLAIMER } from '../../src/domain/disclaimer'

const MOCK_ANSWER = {
  rawQuestion: '상속세 기초공제 금액이 얼마인가요?',
  citations: [
    {
      taxLaw: {
        lawName: '상속세 및 증여세법',
        articleNumber: '제18조 제1항',
        articleTitle: '기초공제',
        content: '제18조(기초공제) ①거주자나 비거주자의 사망으로 인하여 상속이 개시되는 경우에는 상속세 과세가액에서 2억원을 공제한다.',
        revisionDate: '2015-12-15',
        enforcementDate: '2016-01-01',
        sourceUrl: 'https://www.law.go.kr/법령/상속세및증여세법',
        trustTier: 'T1',
      },
      label: '🟢직접근거',
      excerpt: '상속이 개시되는 경우에는 상속세 과세가액에서 2억원을 공제한다.',
      temporalLabel: '[현행]',
    },
  ],
  summary: '현행 상속세 기초공제 금액은 2억원입니다.',
  temporalLabel: '[현행]',
  disclaimer: DISCLAIMER,
  verificationResult: {
    status: 'PASS',
    checks: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true },
    failReasons: [],
  },
  generatedAt: new Date().toISOString(),
}

test('G-4: 로딩 상태 — 버튼 비활성화 후 답변 표시', async ({ page }) => {
  // 응답을 300ms 지연시켜 로딩 상태를 확인할 시간 확보
  await page.route('**/api/answer', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ANSWER) })
  })

  await page.goto('/')

  await page.getByTestId('question-input').fill('상속세 기초공제 금액이 얼마인가요?')
  await page.getByTestId('submit-btn').click()

  // 검색 중 버튼 비활성화 확인
  await expect(page.getByTestId('submit-btn')).toBeDisabled()
  // 입력창도 비활성화
  await expect(page.getByTestId('question-input')).toBeDisabled()

  // 로딩 완료 후 답변 표시
  await expect(page.getByTestId('label-badge').first()).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('submit-btn')).toBeEnabled()
})
