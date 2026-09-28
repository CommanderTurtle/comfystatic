import { describe, expect, test } from 'bun:test'
import { parseWorkflow, graphs, filename, mergeExtra } from '../src/workflow'
import { coreNodes } from '../src/core-nodes'

describe('workflow JSON', () => {
  test('accepts workflow JSON and fenced clipboard content', () => {
    expect(parseWorkflow('```json\n{"nodes":[],"version":0.4}\n```').nodes).toEqual([])
    expect(parseWorkflow('{"workflow":{"nodes":[]}}')).toEqual({ nodes: [] })
  })
  test('accepts native API prompt envelopes', () => {
    expect(parseWorkflow('{"prompt":{"1":{"class_type":"KSampler","inputs":{}}}}')['1'].class_type).toBe('KSampler')
  })
  test('rejects unrelated and invalid JSON', () => {
    for (const text of ['null', '[]', '{}', 'hello']) expect(() => parseWorkflow(text)).toThrow()
  })
  test('preserves extra metadata without resurrecting deleted nodes or links', () => {
    const original = { custom: 12, nodes: [{ id: 1, custom: 'kept', widgets_values: ['old'] }, { id: 2 }], links: [[1]], extra: { vendor: true } }
    const current = { nodes: [{ id: 1, widgets_values: ['edited'] }], links: [], extra: { ds: {} } }
    const result = mergeExtra(original, current)
    expect(result.nodes).toEqual([{ id: 1, custom: 'kept', widgets_values: ['edited'] }])
    expect(result.links).toEqual([])
    expect(result.extra).toEqual({ vendor: true, ds: {} })
    expect(original.nodes[0]?.widgets_values).toEqual(['old'])
  })
  test('handles subgraphs without restoring removed definitions', () => {
    const original = { definitions: { subgraphs: [{ id: 'a', custom: 3, nodes: [] }, { id: 'b' }] } }
    const current = { definitions: { subgraphs: [{ id: 'a', nodes: [{ id: 2 }] }] } }
    expect(mergeExtra(original, current).definitions.subgraphs).toEqual([{ id: 'a', custom: 3, nodes: [{ id: 2 }], extra: {} }])
    expect(graphs({ nodes: [], definitions: current.definitions })).toHaveLength(2)
  })
  test('sanitizes browser download filenames', () => {
    expect(filename('workflows/a/b.json')).toBe('b.json')
    expect(filename('C:\\a\\my:file.JSON')).toBe('my_file.json')
  })
  test('starter definitions have ordered inputs and matching outputs', () => {
    for (const [name, def] of Object.entries(coreNodes)) {
      expect(def.name).toBe(name)
      expect(def.input_order.required).toEqual(Object.keys(def.input.required))
      expect(def.output).toHaveLength(def.output_is_list.length)
    }
  })
})
