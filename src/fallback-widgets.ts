// Workflow hints, not invented /object_info definitions. Only pair positional
// values with saved names when the workflow provides a complete correspondence.
export function fallbackWidgets(raw: any) {
  const values = raw.widgets_values ?? []
  const slots = (raw.inputs ?? []).filter((input: any) => typeof input.widget?.name === 'string')
  const named = !Array.isArray(values) || slots.length === values.length
  return Object.entries(values).map(([key, value], index) => {
    const slot = Array.isArray(values) && named ? slots[index] : slots.find((input: any) => input.widget.name === key)
    const name = Array.isArray(values) ? slot?.widget.name ?? `value ${index + 1}` : key
    const type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'toggle' : 'text'
    const multiline = typeof value === 'string' && (/multiline/i.test(raw.type ?? '') || /[\r\n]/.test(value))
    return { name, type, value, multiline, slot }
  })
}
export function fallbackWidgetSpec(value: unknown, multiline: boolean) {
  return [typeof value === 'number' ? (Number.isInteger(value) ? 'INT' : 'FLOAT') : typeof value === 'boolean' ? 'BOOLEAN' : 'STRING',
    { default: value, ...(multiline ? { multiline: true } : {}) }]
}
export function subgraphTypes(data: any): Set<string> {
  const types = new Set<string>()
  const visit = (graph: any) => {
    for (const subgraph of graph.definitions?.subgraphs ?? []) {
      if (typeof subgraph.id === 'string') types.add(subgraph.id)
      visit(subgraph)
    }
  }
  visit(data)
  return types
}
