/**
 * SearchBar 단위 테스트 (TAX-6B-3)
 *
 * 최근 검색어 저장·드롭다운, PII 인라인 거부 검증.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchBar } from '../../app/components/SearchBar'

const RECENT_KEY = 'tax-recent-queries'

describe('SearchBar — 최근 검색어 + PII 마스킹 (TAX-6B-3)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ─── 기본 제출 ───────────────────────────────────────────────────────────
  it('정상 질문 제출 시 onSubmit이 호출된다', () => {
    const onSubmit = vi.fn()
    render(<SearchBar onSubmit={onSubmit} loading={false} />)

    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '부가가치세 면세 대상' },
    })
    fireEvent.submit(screen.getByTestId('question-input').closest('form')!)

    expect(onSubmit).toHaveBeenCalledWith('부가가치세 면세 대상', undefined)
  })

  it('2자 미만 질문은 onSubmit을 호출하지 않는다', () => {
    const onSubmit = vi.fn()
    render(<SearchBar onSubmit={onSubmit} loading={false} />)

    fireEvent.change(screen.getByTestId('question-input'), { target: { value: '세' } })
    fireEvent.submit(screen.getByTestId('question-input').closest('form')!)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  // ─── PII 거부 ────────────────────────────────────────────────────────────
  it('주민번호 입력 시 pii-error를 표시하고 onSubmit을 호출하지 않는다', () => {
    const onSubmit = vi.fn()
    render(<SearchBar onSubmit={onSubmit} loading={false} />)

    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '800101-1234567 세금' },
    })
    fireEvent.submit(screen.getByTestId('question-input').closest('form')!)

    expect(screen.getByTestId('pii-error')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('사업자번호 입력 시에도 pii-error를 표시한다', () => {
    const onSubmit = vi.fn()
    render(<SearchBar onSubmit={onSubmit} loading={false} />)

    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '123-45-67890 법인세' },
    })
    fireEvent.submit(screen.getByTestId('question-input').closest('form')!)

    expect(screen.getByTestId('pii-error')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('pii-error는 입력 변경 시 사라진다', () => {
    const onSubmit = vi.fn()
    render(<SearchBar onSubmit={onSubmit} loading={false} />)

    const input = screen.getByTestId('question-input')

    // PII 입력 → 에러 표시
    fireEvent.change(input, { target: { value: '800101-1234567' } })
    fireEvent.submit(input.closest('form')!)
    expect(screen.getByTestId('pii-error')).toBeTruthy()

    // 정상 입력으로 변경 → 에러 사라짐
    fireEvent.change(input, { target: { value: '부가세 신고' } })
    expect(screen.queryByTestId('pii-error')).toBeNull()
  })

  // ─── localStorage 저장 ───────────────────────────────────────────────────
  it('정상 검색어를 localStorage에 저장한다', () => {
    const onSubmit = vi.fn()
    render(<SearchBar onSubmit={onSubmit} loading={false} />)

    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '법인세 납부 기한' },
    })
    fireEvent.submit(screen.getByTestId('question-input').closest('form')!)

    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
    expect(stored).toContain('법인세 납부 기한')
  })

  it('휴대폰 번호를 마스킹하여 저장한다', () => {
    const onSubmit = vi.fn()
    render(<SearchBar onSubmit={onSubmit} loading={false} />)

    fireEvent.change(screen.getByTestId('question-input'), {
      target: { value: '010-1234-5678 양도소득세' },
    })
    fireEvent.submit(screen.getByTestId('question-input').closest('form')!)

    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
    // 마스킹된 형태로 저장 (원본 번호 미포함)
    expect(stored[0]).toContain('****')
    expect(stored[0]).not.toContain('1234-5678')
    // onSubmit에는 원문(마스킹 전) 전달
    expect(onSubmit).toHaveBeenCalledWith('010-1234-5678 양도소득세', undefined)
  })

  // ─── 최근 검색어 드롭다운 ────────────────────────────────────────────────
  it('저장된 검색어가 있으면 포커스 시 드롭다운을 표시한다', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['부가세 면세']))
    render(<SearchBar onSubmit={vi.fn()} loading={false} />)

    fireEvent.focus(screen.getByTestId('question-input'))

    expect(screen.getByTestId('recent-dropdown')).toBeTruthy()
    expect(screen.getByText('부가세 면세')).toBeTruthy()
  })

  it('저장된 검색어가 없으면 드롭다운을 표시하지 않는다', () => {
    render(<SearchBar onSubmit={vi.fn()} loading={false} />)

    fireEvent.focus(screen.getByTestId('question-input'))

    expect(screen.queryByTestId('recent-dropdown')).toBeNull()
  })

  it('최대 5개까지만 저장한다', () => {
    const onSubmit = vi.fn()
    render(<SearchBar onSubmit={onSubmit} loading={false} />)

    const queries = ['질문1', '질문2', '질문3', '질문4', '질문5', '질문6']
    for (const q of queries) {
      fireEvent.change(screen.getByTestId('question-input'), { target: { value: q } })
      fireEvent.submit(screen.getByTestId('question-input').closest('form')!)
    }

    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
    expect(stored).toHaveLength(5)
    expect(stored[0]).toBe('질문6') // 최신이 맨 앞
    expect(stored).not.toContain('질문1') // 가장 오래된 것은 제거
  })

  // ─── 접근성·단축키 (TAX-6B-5) ────────────────────────────────────────────
  it('폼에 aria-label="세법 검색"이 있다', () => {
    render(<SearchBar onSubmit={vi.fn()} loading={false} />)
    const form = screen.getByRole('form', { name: '세법 검색' })
    expect(form).toBeTruthy()
  })

  it('입력란에 role="combobox"가 있다', () => {
    render(<SearchBar onSubmit={vi.fn()} loading={false} />)
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('Escape 키 입력 시 드롭다운이 닫힌다', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['부가세']))
    render(<SearchBar onSubmit={vi.fn()} loading={false} />)

    const input = screen.getByTestId('question-input')
    fireEvent.focus(input)
    expect(screen.getByTestId('recent-dropdown')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('recent-dropdown')).toBeNull()
  })

  it('Ctrl+K 단축키로 입력란에 포커스된다', () => {
    render(<SearchBar onSubmit={vi.fn()} loading={false} />)
    const input = screen.getByTestId('question-input')

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    expect(document.activeElement).toBe(input)
  })
})
