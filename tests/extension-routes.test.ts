import { expect, test } from 'bun:test'
import { extensionRoutes } from '../src/extension-routes'

test('native and packager-rebased extension routes retain the Comfy API contract', () => {
  for (const base of ['https://example.test/', 'https://example.test/comfy/']) {
    expect(extensionRoutes(['/extensions/comfystatic/editor.js'], base)).toEqual(['/extensions/comfystatic/editor.js'])
    expect(extensionRoutes(['../extensions/comfystatic/editor.js'], base)).toEqual(['/extensions/comfystatic/editor.js'])
  }
  expect(extensionRoutes(['/comfy/extensions/custom/editor.js?v=1'], 'https://example.test/comfy/')).toEqual(['/extensions/custom/editor.js?v=1'])
  expect(() => extensionRoutes(['https://other.test/extension.js'], 'https://example.test/')).toThrow()
})
