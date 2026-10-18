import { describe, expect, test } from 'claude-code/testing'

import { missingRequired, render, type Workflow } from '../hooks/workflow'

const WORKFLOW: Workflow = {
  name: 'test',
  inputs: [
    { name: 'environment', type: 'select', allowEmpty: true, values: ['staging'] },
    { name: 'request', type: 'textarea', allowEmpty: false },
  ],
  template: 'Env {{ inputs.environment }}: {{inputs.request}}',
}

describe('render', () => {
  test('reads values under inputs without escaping them', async () => {
    expect(render(WORKFLOW.template, { environment: 'staging', request: 'a < b & c' })).toBe(
      'Env staging: a < b & c',
    )
  })

  test('renders unset inputs as empty strings', async () => {
    expect(render(WORKFLOW.template, {})).toBe('Env : ')
  })
})

describe('missingRequired', () => {
  test('lists required inputs that are empty or blank', async () => {
    expect(missingRequired(WORKFLOW, {})).toEqual(['request'])
    expect(missingRequired(WORKFLOW, { request: '  ' })).toEqual(['request'])
  })

  test('ignores optional inputs', async () => {
    expect(missingRequired(WORKFLOW, { request: 'check it' })).toEqual([])
  })
})
