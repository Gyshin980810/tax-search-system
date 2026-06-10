/**
 * E2E 시나리오 G-1: 소득세법 기본공제
 * 정상 PASS 답변이 화면에 올바르게 렌더링되는지 검증한다.
 */
import { test, expect } from '@playwright/test'
import { DISCLAIMER } from '../../src/domain/disclaimer'

const MOCK_ANSWER = {
  rawQuestion: '근로소득이 있는 거주자의 종합소득세 계산 시 본인 기본공제 금액은 얼마인가요?',
  citations: [
    {
      taxLaw: {
        lawName: '소득세법',
        articleNumber: '제50조 제1항 제1호',
        articleTitle: '기본공제',
        content: '제50조(기본공제) ①거주자에 대해서는 다음 각 호의 어느 하나에 해당하는 사람의 수에 150만원을 곱하여 계산한 금액을 해당 과세기간의 종합소득금액에서 공제한다.',
        revisionDate: '2023-12-31',
        enforcementDate: '2024-01-01',
        sourceUrl: 'https://www.law.go.kr/법령/소득세법',
        trustTier: 'T1',
      },
      label: '🟢직접근거',
      excerpt: '다음 각 호의 어느 하나에 해당하는 사람의 수에 150만원을 곱하여 계산한 금액을 해당 과세기간의 종합소득금액에서 공제한다.',
      temporalLabel: '[현행]',
    },
  ],
  summary: '근로소득이 있는 거주자의 본인 기본공제 금액은 150만원입니다.',
  temporalLabel: '[현행]',
  disclaimer: DISCLAIMER,
  verificationResult: {
    status: 'PASS',
    checks: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true },
    failReasons: [],
  },
  generatedAt: new Date().toISOString(),
}

test('G-1: PASS 답변 — 인용·시점라벨·면책고지 모두 표시', async ({ page }) => {
  // API 응답 모킹
  await page.route('**/api/answer', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ANSWER) })
  })

  await page.goto('/')

  // 질문 입력 및 검색
  await page.getByTestId('question-input').fill('근로소득이 있는 거주자의 종합소득세 계산 시 본인 기본공제 금액은 얼마인가요?')
  await page.getByTestId('submit-btn').click()

  // 🟢직접근거 라벨 표시 확인
  await expect(page.getByTestId('label-badge').first()).toContainText('🟢직접근거')

  // 시점 라벨 확인
  await expect(page.getByTestId('temporal-label')).toContainText('[현행]')

  // 면책 고지 확인
  await expect(page.getByTestId('disclaimer')).toBeVisible()

  // PENDING 경고 미표시 확인
  await expect(page.getByTestId('pending-warning')).not.toBeVisible()

  // E-VERIFY-FAIL 메시지 미표시 확인
  await expect(page.getByTestId('verify-fail-message')).not.toBeVisible()
})
