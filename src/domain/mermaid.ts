/**
 * ImpactMap → mermaid graph LR 코드 생성기 (TAX-033)
 *
 * 노드 형태:
 *   - 심판례 (tribunal·tribunal_ref): ([ 라벨 ]) — 둥근 사각형
 *   - 법령 조문 (law_article): [ 라벨 ] — 기본 사각형
 *
 * 엣지 스타일:
 *   - 관련법령: --> (실선)
 *   - 참조결정: -.-> (점선)
 *
 * 주의:
 *   - 노드 ID는 영문+숫자+밑줄만 사용 (safeNodeId()로 생성)
 *   - 노드 라벨은 원문 그대로이나 mermaid 문법 이스케이프 처리 적용 (§6.1 준수)
 *     「」·【】·쌍따옴표·대괄호를 mermaid가 파싱 가능한 형태로 변환
 */

import type { ImpactMap } from './ImpactMap'

// ──────────────────────────────────────────────────
// 공개 함수
// ──────────────────────────────────────────────────

/**
 * ImpactMap을 mermaid graph LR 코드 문자열로 변환한다.
 *
 * @param map 심판례 관계 그래프
 * @returns mermaid 코드 문자열 (빈 노드·엣지인 경우 "graph LR"만 반환)
 */
export function buildMermaid(map: ImpactMap): string {
  const lines: string[] = ['graph LR']

  // 노드 정의
  for (const node of map.nodes) {
    const safeLabel = escapeLabel(node.label)
    if (node.type === 'tribunal' || node.type === 'tribunal_ref') {
      // 심판례 → 둥근 사각형 모양
      lines.push(`  ${node.id}(["${safeLabel}"])`)
    } else {
      // 법령 조문 → 기본 사각형
      lines.push(`  ${node.id}["${safeLabel}"]`)
    }
  }

  // 엣지 정의
  for (const edge of map.edges) {
    const safeLabel = escapeLabel(edge.label)
    if (edge.relation === '참조결정') {
      // 점선 화살표
      lines.push(`  ${edge.fromId} -.->"${safeLabel}" ${edge.toId}`)
    } else {
      // 실선 화살표
      lines.push(`  ${edge.fromId} -->"${safeLabel}" ${edge.toId}`)
    }
  }

  return lines.join('\n')
}

/**
 * 텍스트 기반 해시로 안전한 mermaid 노드 ID를 생성한다.
 *
 * mermaid는 노드 ID에 한글·특수문자(「」·【】·공백 등)를 허용하지 않는다.
 * 같은 입력은 항상 같은 ID를 반환 → 노드 중복 검사에 활용 가능.
 *
 * @param prefix 접두사 (예: 'law', 'tri', 'ref')
 * @param text 원문 텍스트 (법령 조문 또는 청구번호)
 * @returns 안전한 노드 ID (예: law_a1b2c3d4)
 */
export function safeNodeId(prefix: string, text: string): string {
  // djb2 해시 변형 — 가볍고 충돌 낮음
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  return `${prefix}_${hex}`
}

// ──────────────────────────────────────────────────
// 내부 유틸
// ──────────────────────────────────────────────────

/**
 * mermaid 노드 라벨의 특수문자를 이스케이프한다.
 *
 * mermaid가 파싱에 사용하는 문자를 안전한 대체 문자로 변환.
 * - 「」: 시각적으로 제거 (법령명은 그대로 남김)
 * - 【】: () 로 변환 (조문 제목 가독성 유지)
 * - 쌍따옴표: 작은따옴표로 변환
 * - [ ]: ( ) 로 변환 (mermaid가 [ ]를 노드 문법으로 해석)
 *
 * §6.1 원문 보존 원칙: 이 변환은 mermaid 렌더링을 위한 표현 조정이며,
 * 원본 rawText는 ImpactNode.label에 그대로 보존된다.
 *
 * @param text 원문 라벨
 * @returns mermaid 안전 문자열
 */
function escapeLabel(text: string): string {
  return text
    .replace(/「/g, '')    // 「 제거 (법령명 그대로)
    .replace(/」/g, '')    // 」 제거
    .replace(/【/g, '(')   // 【 → (
    .replace(/】/g, ')')   // 】 → )
    .replace(/"/g, "'")    // 쌍따옴표 → 작은따옴표
    .replace(/\[/g, '(')   // [ → (
    .replace(/\]/g, ')')   // ] → )
    .trim()
}
