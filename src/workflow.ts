export function parseWorkflow(text: string): any {
  const trimmed = text.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\s*```$/, '')
  const data = JSON.parse(trimmed)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a ComfyUI workflow object.')
  if (Array.isArray(data.nodes)) return data
  if (data.workflow && Array.isArray(data.workflow.nodes)) return data.workflow
  if (data.prompt && typeof data.prompt === 'object') return parseWorkflow(JSON.stringify(data.prompt))
  if (Object.values(data).some((v: any) => v && typeof v.class_type === 'string' && v.inputs)) return data
  throw new Error('This JSON is not a ComfyUI workflow or API prompt.')
}
export function graphs(data: any): any[] { return [data, ...(data.definitions?.subgraphs ?? []).flatMap((g: any) => graphs(g))] }
export function filename(name: string): string {
  return (name.split(/[\\/]/).pop() || 'workflow').replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/\.json$/i, '') + '.json'
}
export function mergeExtra(original: any, current: any): any {
  if (!original) return current
  const result = { ...original, ...current }
  if (current.nodes) {
    const old = new Map((original.nodes ?? []).map((n: any) => [String(n.id), n]))
    result.nodes = current.nodes.map((n: any) => ({ ...(old.get(String(n.id)) as any ?? {}), ...n }))
  }
  // Preserve arbitrary graph metadata without restoring deleted nodes/connections.
  result.extra = { ...(original.extra ?? {}), ...(current.extra ?? {}) }
  if (current.definitions?.subgraphs) {
    const old = new Map((original.definitions?.subgraphs ?? []).map((g: any) => [g.id, g]))
    result.definitions = { ...(original.definitions ?? {}), ...current.definitions,
      subgraphs: current.definitions.subgraphs.map((g: any) => mergeExtra(old.get(g.id), g)) }
  }
  return result
}
