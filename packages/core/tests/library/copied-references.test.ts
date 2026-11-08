import { describe, expect, test } from 'bun:test'

import {
  createLibraryRevision,
  materializeLibraryAsset,
  updateLibraryDefinitions
} from '@open-pencil/core/library'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { applyComponentPropertyValue } from '@open-pencil/scene-graph/components'
import { expectDefined } from '@open-pencil/test-support/assert'

/** A library whose button swaps its icon through an instance-swap property. */
function libraryWithIconProperty() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const star = graph.createNode('COMPONENT', page.id, { name: 'Star', componentKey: 'star' })
  const heart = graph.createNode('COMPONENT', page.id, { name: 'Heart', componentKey: 'heart' })
  const button = graph.createNode('COMPONENT', page.id, {
    name: 'Button',
    componentKey: 'button',
    componentPropertyDefinitions: [
      { id: 'icon', name: 'Icon', type: 'INSTANCE_SWAP', defaultValue: star.id }
    ]
  })
  const icon = graph.createInstance(star.id, button.id)
  if (!icon) throw new Error('Expected the icon instance')
  graph.updateNode(icon.id, {
    componentPropertyReferences: [{ propertyId: 'icon', field: 'INSTANCE_SWAP' }]
  })
  const card = graph.createNode('COMPONENT', page.id, { name: 'Card', componentKey: 'card' })
  const cardButton = graph.createInstance(button.id, card.id)
  if (!cardButton) throw new Error('Expected the card button')
  const property = graph.getNode(button.id)?.componentPropertyDefinitions[0]
  if (!property) throw new Error('Expected the icon property')
  applyComponentPropertyValue(graph, cardButton.id, property, heart.id)
  return graph
}

const named = (graph: SceneGraph, id: string | undefined) => (id ? graph.getNode(id)?.name : null)

describe('references between copied library layers', () => {
  test('point instance-swap properties at the copied components', async () => {
    const revision = await createLibraryRevision({
      libraryId: 'design-system',
      name: 'Design system',
      graph: libraryWithIconProperty()
    })
    const stored = revision.graph
    const button = [...stored.getAllNodes()].find((node) => node.componentKey === 'button')
    const cardButton = [...stored.getAllNodes()].find(
      (node) => node.type === 'INSTANCE' && node.name === 'Button'
    )
    expect(named(stored, button?.componentPropertyDefinitions[0]?.defaultValue)).toBe('Star')
    expect(named(stored, cardButton?.componentPropertyAssignments.icon)).toBe('Heart')

    const consumer = new SceneGraph()
    const { componentId } = materializeLibraryAsset(consumer, revision, 'card')
    const inserted = consumer.getChildren(componentId)[0]
    const definition = consumer.getNode(inserted?.componentId ?? '')
      ?.componentPropertyDefinitions[0]
    expect(named(consumer, definition?.defaultValue)).toBe('Star')
    expect(named(consumer, inserted?.componentPropertyAssignments.icon)).toBe('Heart')
  })

  test('points a text link at the copied layer, not a revision-only id', async () => {
    const source = new SceneGraph()
    const page = source.getPages()[0]
    const card = source.createNode('COMPONENT', page.id, { name: 'Card', componentKey: 'card' })
    const target = source.createNode('FRAME', card.id, { name: 'Target' })
    const label = source.createNode('TEXT', card.id, {
      name: 'Label',
      text: 'See',
      styleRuns: [{ start: 0, length: 3, style: { hyperlink: { type: 'NODE', value: target.id } } }]
    })
    const publish = (previousRevisionId?: string) =>
      createLibraryRevision({
        libraryId: 'design-system',
        name: 'Design system',
        graph: source,
        previousRevisionId
      })
    const cardIn = (graph: SceneGraph) =>
      expectDefined(
        [...graph.getAllNodes()].find((node) => node.componentKey === 'card'),
        'card'
      )
    const child = (graph: SceneGraph, parent: SceneNode, name: string) =>
      expectDefined(
        graph.getChildren(parent.id).find((node) => node.name === name),
        name
      )
    const linkOf = (text: SceneNode) =>
      expectDefined(text.styleRuns[0]?.style.hyperlink, 'text link')

    const revision = await publish()
    const revisionCard = cardIn(revision.graph)
    const revisionTarget = child(revision.graph, revisionCard, 'Target')
    const revisionLabel = child(revision.graph, revisionCard, 'Label')
    expect(linkOf(revisionLabel)).toEqual({ type: 'NODE', value: revisionTarget.id })
    expect(linkOf(revisionLabel).value).not.toBe(target.id)

    const consumer = new SceneGraph()
    const { componentId } = materializeLibraryAsset(consumer, revision, 'card')
    const insertedCard = expectDefined(consumer.getNode(componentId), 'inserted card')
    const insertedTarget = child(consumer, insertedCard, 'Target')
    const insertedLabel = child(consumer, insertedCard, 'Label')
    expect(linkOf(insertedLabel)).toEqual({ type: 'NODE', value: insertedTarget.id })
    expect(linkOf(insertedLabel).value).not.toBe(revisionTarget.id)
    expect(consumer.getNode(revisionTarget.id)).toBeUndefined()

    source.updateNode(label.id, { text: 'Saw' })
    const next = await publish(revision.manifest.revisionId)
    updateLibraryDefinitions(consumer, next)
    const nextCard = cardIn(next.graph)
    const nextTarget = child(next.graph, nextCard, 'Target')
    const updatedCard = expectDefined(consumer.getNode(componentId), 'updated card')
    const updatedTarget = child(consumer, updatedCard, 'Target')
    const updatedLabel = child(consumer, updatedCard, 'Label')
    expect(updatedLabel.text).toBe('Saw')
    expect(linkOf(updatedLabel)).toEqual({ type: 'NODE', value: updatedTarget.id })
    expect(linkOf(updatedLabel).value).not.toBe(nextTarget.id)
    expect(updatedTarget.id).toBe(insertedTarget.id)
  })
})
