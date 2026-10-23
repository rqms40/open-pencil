import { colorToHex, contrastRatio } from '@open-pencil/scene-graph/color'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { defineRule } from '#core/lint/rule'
import type { LintNode, RuleContext } from '#core/lint/types'

/** WCAG AA: 4.5:1 for text, 3:1 for large text, which is 24px, or 18.66px when bold. */
const MIN_CONTRAST = 4.5
const MIN_LARGE_CONTRAST = 3
const LARGE_TEXT_PX = 24
const LARGE_BOLD_TEXT_PX = 18.66
const BOLD_WEIGHT = 700

type SolidColor = NonNullable<LintNode['fills'][number]['color']>

function minContrast(style: { fontSize: number; fontWeight: number }): number {
  const large =
    style.fontSize >= LARGE_TEXT_PX ||
    (style.fontSize >= LARGE_BOLD_TEXT_PX && style.fontWeight >= BOLD_WEIGHT)
  return large ? MIN_LARGE_CONTRAST : MIN_CONTRAST
}

/** The strictest threshold any stretch of the text needs. */
function requiredContrast(node: {
  fontSize: number
  textStyles?: { fontSize: number; fontWeight: number }[]
}): number {
  const styles = node.textStyles ?? [{ fontSize: node.fontSize, fontWeight: 0 }]
  return Math.max(...styles.map(minContrast))
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function covers(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  )
}

/** The first visible solid fill, used when no sibling covers the text. */
function ancestorFill(node: LintNode): SolidColor | undefined {
  return node.fills.find((fill) => fill.type === 'SOLID' && fill.visible && fill.color)?.color
}

/**
 * The nearest earlier sibling that paints one opaque solid across `box`. Earlier children are
 * behind later ones. A partial overlap, gradient, rotation, or translucent fill that meets the
 * box stays unresolved, so the caller keeps the ancestor fill.
 */
function siblingFill(
  parent: LintNode,
  node: LintNode,
  box: Rect,
  context: RuleContext
): SolidColor | undefined {
  const children = context.getChildren(parent)
  const index = children.findIndex((child) => child.id === node.id)
  for (let i = index - 1; i >= 0; i--) {
    const sibling = children.at(i)
    if (!sibling || !sibling.visible || sibling.opacity === 0 || sibling.type === 'TEXT') continue
    if (!overlaps(sibling, box)) continue
    if (sibling.rotation !== 0 || sibling.opacity !== 1) return undefined
    const top = sibling.fills.findLast((fill) => fill.visible)
    if (!top) continue
    if (top.type === 'SOLID' && top.opacity === 1 && top.color && covers(sibling, box)) {
      return top.color
    }
    return undefined
  }
  return undefined
}

/**
 * The fill behind the text. At each ancestor, a covering sibling painted below the layer wins
 * over that ancestor's own fill. The text's box moves into that ancestor's space on the way up.
 */
function backgroundOf(node: LintNode, context: RuleContext): SolidColor | undefined {
  let box: Rect = { x: node.x, y: node.y, width: node.width, height: node.height }
  let axisAligned = node.rotation === 0
  let current = node
  let parent = context.getParent(current)
  while (parent) {
    if (axisAligned) {
      const behind = siblingFill(parent, current, box, context)
      if (behind) return behind
    }
    const fill = ancestorFill(parent)
    if (fill) return fill
    if (parent.rotation !== 0) axisAligned = false
    box = { x: box.x + parent.x, y: box.y + parent.y, width: box.width, height: box.height }
    current = parent
    parent = context.getParent(parent)
  }
  return undefined
}

export default defineRule({
  meta: {
    id: 'color-contrast',
    category: 'accessibility',
    severity: 'error',
    description: 'Text must have sufficient contrast against its background'
  },
  match: ['TEXT'],
  check(node, context) {
    const textColor = node.fills.find((f) => f.type === 'SOLID' && f.visible && f.color)?.color
    if (textColor == null) return
    const background = backgroundOf(node, context)
    if (!background) return
    const ratio = contrastRatio(textColor, background)
    const minRatio = requiredContrast(node)
    if (ratio < minRatio)
      context.report({
        node,
        message: `Contrast ratio ${ratio.toFixed(2)}:1 is below WCAG AA`,
        suggest: 'Increase contrast between text and background',
        data: {
          ratio: Math.floor(ratio * 100) / 100,
          minRatio,
          foreground: colorToHex({ ...textColor, a: 1 }),
          background: colorToHex({ ...background, a: 1 })
        }
      })
  }
})
