/**
 * E2E 시나리오 G-5: PII 감지 오류
 * 주민번호가 포함된 질문 시 서버가 E-PII-DETECTED를 반환하고 UI에 오류 메시지가 표시되는지 검증한다.
 */
import { test, expect } from '@playwright/test'

test('G-5: PII 감지 — 일반 오류 메시지 표시, 답변 미노출', async ({ page }) => {
  await page.route('**/api/answer', (route) => {
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'E-PII-DETECTED',
        message: '개인정보(주민번호 등)가 포함된 질문은 처리할 수 없습니다. 개인정보를 제거하고 다시 시도해 주세요.',
      }),
    })
  })

  await page.goto('/')

  // 주민번호 포함 질문 (실제로는 검색창이 전송을 막지 않음 — 서버에서 거부)
  await page.getByTestId('question-input').fill('800101-1234567 이 사람의 세금 신고')
  await page.getByTestId('submit-btn').click()

  // 일반 오류 메시지 표시 (빨간 박스)
  const errorMsg = page.locator('[class*="text-red-700"]')
  await expect(errorMsg).toBeVisible()
  await expect(errorMsg).toContainText('개인정보')

  // E-VERIFY-FAIL 전용 박스는 미표시
  await expect(page.getByTestId('verify-fail-message')).not.toBeVisible()

  // 답변 미표시
  await expect(page.getByTestId('disclaimer')).not.toBeVisible()
})
