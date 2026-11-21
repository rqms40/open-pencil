import { describe, expect, test } from 'bun:test'

import type { Element } from '@xmldom/xmldom'

import { createSVGNodes, renderNodesToSVG } from '@open-pencil/core/io/formats/svg'
import { SceneGraph } from '@open-pencil/scene-graph'
import { expectDefined } from '@open-pencil/test-support/assert'

import { parseSVGDocument } from '#core/io/formats/svg/document'

/**
 * The clip from issue #2274: a 20×20 window over a red rect that starts at x=10 and is 35 wide.
 * Only their intersection should be red.
 */
const CLIPPED = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><defs><clipPath id="window"><rect width="20" height="20"/></clipPath></defs><rect width="60" height="30" fill="#ffffff"/><g clip-path="url(#window)"><rect x="10" width="35" height="20" fill="#ff0000"/></g></svg>`

const WINDOW_PATH = 'M0 0L20 0L20 20L0 20L0 0Z'
const RED_PATH = 'M0 0L35 0L35 20L0 20L0 0Z'

function elements(root: Element): Element[] {
  const found: Element[] = []
  const walk = (element: Element) => {
    found.push(element)
    for (const child of element.childNodes) {
      if (child.nodeType === 1) walk(child as Element)
    }
  }
  walk(root)
  return found
}

function ancestors(element: Element): Element[] {
  const found: Element[] = []
  let current = element.parentNode
  while (current && current.nodeType === 1) {
    found.push(current as Element)
    current = current.parentNode
  }
  return found
}

function inside(element: Element, tag: string): boolean {
  return (
    element.localName === tag || ancestors(element).some((ancestor) => ancestor.localName === tag)
  )
}

describe('SVG export of an imported clipPath', () => {
  test('clips the artwork to the clip and does not paint the clip shape', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const frame = expectDefined(createSVGNodes(graph, pageId, CLIPPED), 'imported frame')
    const svg = expectDefined(
      renderNodesToSVG(graph, pageId, [frame.id], {
        useAbsoluteBounds: true,
        xmlDeclaration: false
      }),
      'SVG output'
    )
    const doc = expectDefined(parseSVGDocument(svg), 'parsed SVG')
    const all = elements(expectDefined(doc.documentElement, 'svg root'))

    const painted = all.filter((element) => !inside(element, 'defs'))
    expect(painted.map((element) => element.getAttribute('d'))).not.toContain(WINDOW_PATH)
    expect(
      painted.some((element) => element.getAttribute('fill')?.toLowerCase() === '#000000')
    ).toBe(false)

    const red = expectDefined(
      painted.find((element) => element.getAttribute('d') === RED_PATH),
      'red rectangle'
    )
    expect(
      ancestors(red).some((ancestor) => ancestor.getAttribute('transform') === 'translate(10, 0)')
    ).toBe(true)

    const referenced = ancestors(red).flatMap((ancestor) => {
      const ref = ancestor.getAttribute('clip-path') ?? ancestor.getAttribute('mask')
      const id = ref ? /^url\(#([^)]+)\)$/.exec(ref)?.[1] : undefined
      const clip = id ? all.find((element) => element.getAttribute('id') === id) : undefined
      return clip ? [clip] : []
    })
    const windowClip = referenced.find(
      (clip) =>
        (clip.localName === 'clipPath' || clip.localName === 'mask') &&
        elements(clip).some((element) => element.getAttribute('d') === WINDOW_PATH)
    )
    expect(windowClip?.localName).toBe('clipPath')
  })
})
