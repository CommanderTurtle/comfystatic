import { expect, test } from 'bun:test'
import { fallbackWidgets, subgraphTypes } from '../src/fallback-widgets'

test('preserves names used by promoted subgraph widgets, including multiline text', () => {
  const widgets = fallbackWidgets({ type: 'PrimitiveStringMultiline', inputs: [{ name: 'value', type: 'STRING', widget: { name: 'value' } }], widgets_values: ['a one-paragraph prompt'] })
  expect(widgets[0]?.name).toBe('value')
  expect(widgets[0]?.multiline).toBe(true)
  const controls = fallbackWidgets({ inputs: ['prompt', 'max_length', 'seed'].map(name => ({ name, widget: { name } })), widgets_values: ['text', 726, 42] })
  expect(controls.map(widget => widget.name)).toEqual(['prompt', 'max_length', 'seed'])
  expect(controls.map(widget => widget.value)).toEqual(['text', 726, 42])
})
test('does not guess positional names when hidden control values make the mapping ambiguous', () => {
  const widgets = fallbackWidgets({ inputs: [{ widget: { name: 'seed' } }], widgets_values: [1, 'randomize'] })
  expect(widgets.map(widget => widget.name)).toEqual(['value 1', 'value 2'])
  expect(widgets.every(widget => widget.slot === undefined)).toBe(true)
})
test('supports keyed values and excludes nested native subgraph definitions from fallback registration', () => {
  expect(fallbackWidgets({ widgets_values: { text: 'a\nb' } })[0]?.name).toBe('text')
  expect(fallbackWidgets({ widgets_values: { text: 'a\nb' } })[0]?.multiline).toBe(true)
  expect([...subgraphTypes({ definitions: { subgraphs: [{ id: 'outer', definitions: { subgraphs: [{ id: 'inner' }] } }] } })]).toEqual(['outer', 'inner'])
})
