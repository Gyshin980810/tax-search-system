/**
 * E2E 시나리오 G-3: PENDING 상태 차단
 * verificationResult.status === 'PENDING'인 답변은 회계사에게 노출되지 않아야 한다.
 * 대신 "검증 대기 중" 경고만 표시된다.
 */
import { test, expect } from '@playwright/test'
import { DISCLAIMER } from '../../src/domain/disclaimer'

const PENDING_ANSWER = {
  rawQuestion: '법인세 손금 범위가 어떻게 되나요?',
  citations: [],
  summary: '법인세 손금에 대한 내용입니다.',
  temporalLabel: '[현행]',
  disclaimer: DISCLAIMER,
  verificationResult: {
    status: 'PENDING',
    checks: { v1: false, v2: false, v3: false, v4: false, v5: false, v6: false },
    failReasons: [],
  },
  generatedAt: new Date().toISOString(),
}

test('G-3: PENDING 답변 — 검증 대기 경고 표시, 인용·요약 미노출', async ({ page }) => {
  await page.route('**/api/answer', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PENDING_ANSWER) })
  })

  await page.goto('/')

  await page.getByTestId('question-input').fill('법인세 손금 범위가 어떻게 되나요?')
  await page.getByTestId('submit-btn').click()

  // "검증 대기 중" 경고 표시
  await expect(page.getByTestId('pending-warning')).toBeVisible()
  await expect(page.getByTestId('pending-warning')).toContainText('검증 대기 중')

  // 면책 고지 및 인용 미표시 (PENDING 차단)
  await expect(page.getByTestId('disclaimer')).not.toBeVisible()
  await expect(page.getByTestId('label-badge')).not.toBeVisible()
  await expect(page.getByTestId('temporal-label')).not.toBeVisible()
})
