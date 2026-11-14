import { describe, expect, test } from 'bun:test'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { createLinter } from '@open-pencil/core/lint'
import { SceneGraph } from '@open-pencil/scene-graph'
import { getNodeOrThrow } from '@open-pencil/test-support/assert'

async function render(jsx: string) {
  const graph = new SceneGraph()
  const [node] = await renderJSX(graph, jsx)
  return { graph, node: getNodeOrThrow(graph, node.id) }
}

describe('design JSX layer names', () => {
  test('stores a numeric name as text and lint still runs', async () => {
    const { graph, node } = await render('<Frame name={9} w={10} h={10} />')

    expect(node.name).toBe('9')
    const linted = createLinter({ preset: 'recommended' }).lintGraph(graph)
    expect(linted.messages.some((message) => message.nodeId === node.id)).toBe(true)
  })

  test('stores zero, which is a name, as "0"', async () => {
    const { node } = await render('<Frame name={0} w={10} h={10} />')
    expect(node.name).toBe('0')
  })

  test('stores an icon label written as a number as the layer name', async () => {
    const { node } = await render(
      '<svg label={9} w={10} h={10} viewBox="0 0 10 10"><path d="M0 0 L10 10" /></svg>'
    )
    expect(node.name).toBe('9')
  })
})
