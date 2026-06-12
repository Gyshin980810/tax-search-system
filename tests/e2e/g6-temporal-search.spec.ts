/**
 * E2E 시나리오 G-6: 시점 검색 + E-TEMPORAL-AMBIGUOUS 모호성 경고
 *
 * G-6A: 시점 지정 검색 — targetDate 전달 → 답변 정상 표시 (적용 시점 라벨)
 * G-6B: 시점 미지정 + 모호 표현 → temporal-ambiguous-warning 노출, API 미호출
 */
import { test, expect } from '@playwright/test'
import { DISCLAIMER } from '../../src/domain/disclaimer'

const MOCK_TEMPORAL_ANSWER = {
  rawQuestion: '2020년 기준 소득세법 기본공제 금액은 얼마인가요?',
  citations: [
    {
      taxLaw: {
        sourceType: '법령',
        lawName: '소득세법',
        articleNumber: '제50조 제1항 제1호',
        articleTitle: '기본공제',
        content: '제50조(기본공제) ①거주자에 대해서는 다음 각 호의 어느 하나에 해당하는 사람의 수에 150만원을 곱하여 계산한 금액을 해당 과세기간의 종합소득금액에서 공제한다.',
        revisionDate: '2018-12-31',
        enforcementDate: '2019-01-01',
        sourceUrl: 'https://www.law.go.kr/법령/소득세법',
        trustTier: 'T1',
      },
      label: '🟢직접근거',
      excerpt: '다음 각 호의 어느 하나에 해당하는 사람의 수에 150만원을 곱하여 계산한 금액을 해당 과세기간의 종합소득금액에서 공제한다.',
      temporalLabel: '[적용 시점: 2019.01.01~2020.12.31]',
    },
  ],
  summary: '2020년 기준 소득세법 제50조에 따른 본인 기본공제 금액은 150만원입니다.',
  temporalLabel: '[적용 시점: 2020.01.01~2020.12.31]',
  disclaimer: DISCLAIMER,
  verificationResult: {
    status: 'PASS',
    checks: { v1: true, v2: true, v3: true, v4: true, v5: true, v6: true },
    failReasons: [],
  },
  generatedAt: new Date().toISOString(),
}

test('G-6A: 시점 지정 검색 — targetDate 전달·적용 시점 라벨 표시', async ({ page }) => {
  let sentTargetDate: string | undefined

  await page.route('**/api/answer', async (route) => {
    const reqBody = await route.request().postDataJSON() as { question?: string; targetDate?: string }
    sentTargetDate = reqBody.targetDate
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TEMPORAL_ANSWER),
    })
  })

  await page.goto('/')

  // 질문 입력
  await page.getByTestId('question-input').fill('소득세법 기본공제 금액은 얼마인가요?')

  // 시점 지정 (2020-12-31)
  await page.getByTestId('temporal-input').fill('2020-12-31')

  // 검색
  await page.getByTestId('submit-btn').click()

  // 답변 표시 대기
  await expect(page.getByTestId('label-badge').first()).toBeVisible()

  // targetDate가 API에 전달되었는지 확인
  expect(sentTargetDate).toBe('2020-12-31')

  // 적용 시점 라벨 확인
  await expect(page.getByTestId('temporal-label')).toContainText('적용 시점')

  // 모호성 경고 미표시 확인
  await expect(page.getByTestId('temporal-ambiguous-warning')).not.toBeVisible()
})

test('G-6B: 시점 모호 표현 + 날짜 미지정 → temporal-ambiguous-warning 노출, API 미호출', async ({ page }) => {
  let apiCalled = false

  await page.route('**/api/answer', (route) => {
    apiCalled = true
    route.continue()
  })

  await page.goto('/')

  // 모호한 시점 표현이 포함된 질문 입력 (구체적 연도 없음, 날짜 미지정)
  await page.getByTestId('question-input').fill('예전 소득세법에서 기본공제 금액은 얼마였나요?')

  // 검색 (시점 미지정)
  await page.getByTestId('submit-btn').click()

  // E-TEMPORAL-AMBIGUOUS 경고 노출 확인
  await expect(page.getByTestId('temporal-ambiguous-warning')).toBeVisible()
  await expect(page.getByTestId('temporal-ambiguous-warning')).toContainText('시점 확인 필요')

  // API 미호출 확인
  expect(apiCalled).toBe(false)

  // 답변·에러 미표시 확인
  await expect(page.getByTestId('disclaimer')).not.toBeVisible()
  await expect(page.getByTestId('verify-fail-message')).not.toBeVisible()
})
