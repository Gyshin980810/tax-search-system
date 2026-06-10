/**
 * TAX-033: mermaid 코드 생성기 단위 테스트
 *
 * ImpactMap → mermaid graph LR 코드 변환 검증.
 * 외부 API 의존 없음 — 순수 함수 테스트.
 */
import { describe, it, expect } from 'vitest'
import { buildMermaid, safeNodeId } from '@/domain/mermaid'
import type { ImpactMap } from '@/domain/ImpactMap'

// ──────────────────────────────────────────────────
// safeNodeId
// ──────────────────────────────────────────────────

describe('safeNodeId — mermaid 노드 ID 생성', () => {
  it('같은 입력은 항상 같은 ID를 반환한다 (결정적)', () => {
    expect(safeNodeId('law', '소득세법 제104조')).toBe(
      safeNodeId('law', '소득세법 제104조'),
    )
  })

  it('다른 텍스트는 다른 ID를 반환한다', () => {
    const a = safeNodeId('law', '소득세법 제104조')
    const b = safeNodeId('law', '소득세법 제105조')
    expect(a).not.toBe(b)
  })

  it('다른 접두사는 다른 ID를 반환한다', () => {
    const a = safeNodeId('law', '소득세법')
    const b = safeNodeId('tri', '소득세법')
    expect(a).not.toBe(b)
  })

  it('접두사_16진수 형식을 반환한다', () => {
    const id = safeNodeId('tri', '조심2011서1540')
    expect(id).toMatch(/^tri_[0-9a-f]{8}$/)
  })

  it('법령명 노드도 law_ 접두사로 생성된다', () => {
    const id = safeNodeId('law', '「조세특례제한법」 제69조')
    expect(id.startsWith('law_')).toBe(true)
  })
})

// ──────────────────────────────────────────────────
// buildMermaid
// ──────────────────────────────────────────────────

/** 테스트용 기본 ImpactMap 픽스처 */
const BASE_MAP: ImpactMap = {
  centerId: 'tri_center01',
  caseNumber: '조심2011서1540',
  caseName: '양도소득세 부과처분 취소청구',
  taxType: '양도소득세',
  decisionDate: '2012-03-15',
  agency: '조세심판원',
  nodes: [
    {
      id: 'tri_center01',
      label: '조심2011서1540',
      type: 'tribunal',
      trustTier: 'T3',
      sourceUrl: 'https://example.com/tri/1',
    },
    {
      id: 'law_abc12345',
      label: '「조세특례제한법」 제69조',
      type: 'law_article',
      trustTier: 'T1',
      lawName: '조세특례제한법',
      articleRef: '제69조',
    },
  ],
  edges: [
    {
      fromId: 'tri_center01',
      toId: 'law_abc12345',
      relation: '관련법령',
      label: '관련법령',
    },
  ],
}

describe('buildMermaid — ImpactMap 시각화', () => {
  it('"graph LR" 헤더로 시작한다', () => {
    const result = buildMermaid(BASE_MAP)
    expect(result.startsWith('graph LR')).toBe(true)
  })

  it('모든 노드 ID가 출력에 포함된다', () => {
    const result = buildMermaid(BASE_MAP)
    expect(result).toContain('tri_center01')
    expect(result).toContain('law_abc12345')
  })

  it('심판례 노드는 둥근 사각형 (([...])) 형태를 사용한다', () => {
    const result = buildMermaid(BASE_MAP)
    // (["라벨"]) 형태 확인
    expect(result).toContain('tri_center01(["')
  })

  it('법령 조문 노드는 기본 사각형 ([...]) 형태를 사용한다', () => {
    const result = buildMermaid(BASE_MAP)
    expect(result).toContain('law_abc12345["')
  })

  it('관련법령 엣지는 실선 화살표 (-->)를 사용한다', () => {
    const result = buildMermaid(BASE_MAP)
    expect(result).toContain('-->')
    expect(result).not.toContain('-.->') // 실선이지 점선이 아님
  })

  it('참조결정 엣지는 점선 화살표 (-.->) 를 사용한다', () => {
    const mapWithRef: ImpactMap = {
      ...BASE_MAP,
      nodes: [
        BASE_MAP.nodes[0],
        {
          id: 'tri_ref99',
          label: '조심2013중3738',
          type: 'tribunal_ref',
          trustTier: 'T3',
        },
      ],
      edges: [
        {
          fromId: 'tri_center01',
          toId: 'tri_ref99',
          relation: '참조결정',
          label: '참조결정',
        },
      ],
    }
    const result = buildMermaid(mapWithRef)
    expect(result).toContain('-.->')
    expect(result).not.toContain('-->') // 점선이지 실선이 아님
  })

  it('노드·엣지가 없으면 "graph LR"만 반환한다', () => {
    const emptyMap: ImpactMap = {
      ...BASE_MAP,
      nodes: [],
      edges: [],
    }
    expect(buildMermaid(emptyMap)).toBe('graph LR')
  })

  it('라벨에서 「」가 제거된다 (mermaid 안전화)', () => {
    const result = buildMermaid(BASE_MAP)
    expect(result).not.toContain('「')
    expect(result).not.toContain('」')
  })

  it('라벨에 【】가 있으면 ()로 변환된다', () => {
    const mapWithTitle: ImpactMap = {
      ...BASE_MAP,
      nodes: [
        BASE_MAP.nodes[0],
        {
          id: 'law_titled',
          label: '「법인세법」 제3조 【실질과세】',
          type: 'law_article',
          trustTier: 'T1',
        },
      ],
      edges: [],
    }
    const result = buildMermaid(mapWithTitle)
    expect(result).toContain('(실질과세)')
    expect(result).not.toContain('【')
    expect(result).not.toContain('】')
  })

  it('관련법령과 참조결정이 함께 있는 복합 맵을 처리한다', () => {
    const complexMap: ImpactMap = {
      ...BASE_MAP,
      nodes: [
        BASE_MAP.nodes[0],
        BASE_MAP.nodes[1],
        {
          id: 'tri_ref_a',
          label: '조심2013중3738',
          type: 'tribunal_ref',
          trustTier: 'T3',
        },
      ],
      edges: [
        {
          fromId: 'tri_center01',
          toId: 'law_abc12345',
          relation: '관련법령',
          label: '관련법령',
        },
        {
          fromId: 'tri_center01',
          toId: 'tri_ref_a',
          relation: '참조결정',
          label: '참조결정',
        },
      ],
    }
    const result = buildMermaid(complexMap)
    expect(result).toContain('-->')   // 관련법령 실선
    expect(result).toContain('-.->')  // 참조결정 점선
  })
})
