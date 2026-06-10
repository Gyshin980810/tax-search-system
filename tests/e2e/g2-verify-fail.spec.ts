/**
 * E2E 시나리오 G-2: 검증 실패 (E-VERIFY-FAIL)
 * 재시도 후에도 검증 실패 시 "확인 어려움" 안내가 표시되고 답변은 숨겨지는지 검증한다.
 */
import { test, expect } from '@playwright/test'

test('G-2: E-VERIFY-FAIL — "확인 어려움" 안내 표시, 답변 미노출', async ({ page }) => {
  await page.route('**/api/answer', (route) => {
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'E-VERIFY-FAIL',
        message: '답변 검증에 실패했습니다. 해당 질문은 직접 국세청 또는 담당 세무사에게 문의해 주세요.',
      }),
    })
  })

  await page.goto('/')

  await page.getByTestId('question-input').fill('부가가치세 면세 대상이 무엇인가요?')
  await page.getByTestId('submit-btn').click()

  // "확인 어려움" 박스 표시
  await expect(page.getByTestId('verify-fail-message')).toBeVisible()
  await expect(page.getByTestId('verify-fail-message')).toContainText('확인 어려움')

  // 답변(AnswerCard)은 렌더링되지 않아야 함
  await expect(page.getByTestId('disclaimer')).not.toBeVisible()
  await expect(page.getByTestId('label-badge')).not.toBeVisible()
})
