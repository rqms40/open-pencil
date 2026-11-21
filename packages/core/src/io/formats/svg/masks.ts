import type { SceneNode } from '@open-pencil/scene-graph'
import { isVisibleMask, maskRuns } from '@open-pencil/scene-graph/masks'
import { appendAll } from '@open-pencil/std/arrays'

import { nextDefId, type SVGExportContext } from './defs'
import { svgElement, type SVGNode } from './node'

/**
 * Shape elements a clipPath may contain. A group inside one is not a clip in SVG 1.1, and Chromium
 * drops it, so a mask's groups are flattened onto these shapes.
 */
const CLIP_SHAPES = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
  'line',
  'text'
])

/**
 * An outline mask SVG can draw as a clipPath: its shape, fully opaque. Opacity and a layer or
 * foreground blur soften what a mask keeps, and a clipPath is a hard edge, so those stay painted.
 */
function hardOutline(node: SceneNode): boolean {
  return (
    node.maskType === 'VECTOR' &&
    !(node.opacity < 1) &&
    !node.effects.some(
      (effect) =>
        effect.visible && (effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR')
    )
  )
}

function composeTransform(
  parent: string | undefined,
  own: string | number | undefined
): string | undefined {
  const local = typeof own === 'string' ? own : undefined
  if (parent && local) return `${parent} ${local}`
  return parent ?? local
}

/**
 * A shape in a clipPath, with the transforms of the groups above it and its winding as
 * `clip-rule`.
 */
function clipShape(node: SVGNode, transform: string | undefined): SVGNode {
  const attrs: SVGNode['attrs'] = { ...node.attrs }
  if (transform) attrs.transform = transform
  else delete attrs.transform
  if (attrs['fill-rule'] === 'evenodd') attrs['clip-rule'] = 'evenodd'
  return { tag: node.tag, attrs, children: node.children }
}

/** The shapes `node` draws, in the coordinate space of the clipPath that will hold them. */
function clipGeometry(node: SVGNode, parentTransform?: string): SVGNode[] {
  const transform = composeTransform(parentTransform, node.attrs.transform)
  if (CLIP_SHAPES.has(node.tag)) return [clipShape(node, transform)]
  const shapes: SVGNode[] = []
  for (const child of node.children) {
    if (typeof child !== 'string') appendAll(shapes, clipGeometry(child, transform))
  }
  return shapes
}

function appendRendered(
  target: SVGNode[],
  node: SceneNode | undefined,
  renderNode: (node: SceneNode) => SVGNode | null
): void {
  if (!node) return
  const rendered = renderNode(node)
  if (rendered) target.push(rendered)
}

/** The clipPath these outline masks form, or null when they draw no shape. */
function outlineClip(
  masks: readonly SceneNode[],
  ctx: SVGExportContext,
  renderNode: (node: SceneNode) => SVGNode | null
): string | null {
  const geometry: SVGNode[] = []
  for (const mask of masks) {
    const drawn = renderNode(mask)
    if (drawn) appendAll(geometry, clipGeometry(drawn))
  }
  if (geometry.length === 0) return null
  const id = nextDefId(ctx, 'clip')
  ctx.defs.push(svgElement('clipPath', { id }, geometry))
  return id
}

function appendMaskRun(
  rendered: SVGNode[],
  masks: readonly SceneNode[],
  masked: readonly SceneNode[],
  ctx: SVGExportContext,
  renderNode: (node: SceneNode) => SVGNode | null
): void {
  // A run with nothing after it draws nothing, as on the canvas.
  if (masked.length === 0) return
  if (!masks.every(hardOutline)) {
    for (const node of masks) appendRendered(rendered, node, renderNode)
    for (const node of masked) appendRendered(rendered, node, renderNode)
    return
  }
  const content: SVGNode[] = []
  for (const node of masked) appendRendered(content, node, renderNode)
  if (content.length === 0) return
  const clipId = outlineClip(masks, ctx, renderNode)
  if (!clipId) return
  rendered.push(svgElement('g', { 'clip-path': `url(#${clipId})` }, content))
}

/**
 * A container's children as SVG, bottom to top. A run of outline masks (`maskRuns`) clips the
 * siblings it masks and is not painted. A mask that is not an opaque outline is still painted.
 */
export function renderContainerChildren(
  children: readonly SceneNode[],
  ctx: SVGExportContext,
  renderNode: (node: SceneNode) => SVGNode | null
): SVGNode[] {
  const rendered: SVGNode[] = []
  const runs = maskRuns(children, isVisibleMask)
  let next = 0
  for (const run of runs) {
    for (; next < run.start; next++) appendRendered(rendered, children[next], renderNode)
    next = run.end
    appendMaskRun(
      rendered,
      children.slice(run.start, run.maskedStart),
      children.slice(run.maskedStart, run.end),
      ctx,
      renderNode
    )
  }
  for (; next < children.length; next++) appendRendered(rendered, children[next], renderNode)
  return rendered
}
