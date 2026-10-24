import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_DIR, targetOf } from '../hooks/actions'

describe('targetOf', () => {
  test('reads a path as written', async () => {
    expect(targetOf(' examples ')).toBe('examples')
    expect(targetOf('examples/git-commit-review.yaml')).toBe('examples/git-commit-review.yaml')
  })

  test('drops the @ a path picked from the typeahead starts with, and its quotes', async () => {
    expect(targetOf('@examples')).toBe('examples')
    expect(targetOf('@examples/')).toBe('examples/')
    expect(targetOf('@"my templates"')).toBe('my templates')
  })

  test('falls back to the default folder when no path is named', async () => {
    expect(targetOf('')).toBe(DEFAULT_DIR)
    expect(targetOf('  ')).toBe(DEFAULT_DIR)
    expect(targetOf('@')).toBe(DEFAULT_DIR)
  })
})
