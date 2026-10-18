import { describe, expect, test } from 'claude-code/testing'

import type { ConveyWorkflow as Workflow } from '../types'
import { decodeCandidates, missingRequired, parseWorkflow, render } from '../hooks/workflow'

const SOURCE = `name: incident-summary

inputs:
  environment:
    type: select
    candidates:
      values: [development, staging, production]

  request:
    type: textarea
    allow_empty: false

output:
  template: |
    - Environment: \`{{ inputs.environment }}\`

    {{ inputs.request }}
`

const WORKFLOW: Workflow = {
  name: 'test',
  inputs: {
    environment: { type: 'select', candidates: { values: ['staging'] } },
    request: { type: 'textarea', allow_empty: false },
  },
  output: { template: 'Env {{ inputs.environment }}: {{inputs.request}}' },
}

describe('parseWorkflow', () => {
  test('keeps the YAML shape and the order of inputs', async () => {
    const workflow = parseWorkflow(SOURCE)
    expect(workflow).toEqual({
      name: 'incident-summary',
      inputs: {
        environment: { type: 'select', candidates: { values: ['development', 'staging', 'production'] } },
        request: { type: 'textarea', allow_empty: false },
      },
      output: { template: '- Environment: `{{ inputs.environment }}`\n\n{{ inputs.request }}\n' },
    })
    expect(Object.keys(workflow.inputs)).toEqual(['environment', 'request'])
  })

  test('rejects fields it does not know', async () => {
    expect(() => parseWorkflow(SOURCE.replace('allow_empty: false', 'allow_emtpy: false'))).toThrow(
      'unknown field in input request: allow_emtpy',
    )
  })

  test('rejects a select without candidate values', async () => {
    const source = 'name: x\ninputs:\n  a:\n    type: select\noutput:\n  template: t\n'
    expect(() => parseWorkflow(source)).toThrow('select input a requires candidates')
  })

  test('reports YAML syntax errors', async () => {
    expect(() => parseWorkflow('name: [unclosed')).toThrow()
  })

  test('reads command candidates as written', async () => {
    const source = `name: x
inputs:
  branch:
    type: select
    candidates:
      command:
        program: git
        args: [branch, --format=%(refname:short)]
output:
  template: t
`
    expect(parseWorkflow(source).inputs.branch).toEqual({
      type: 'select',
      candidates: { command: { program: 'git', args: ['branch', '--format=%(refname:short)'] } },
    })
  })

  test('rejects candidates with both values and command', async () => {
    const source = `name: x
inputs:
  a:
    type: select
    candidates:
      values: [one]
      command:
        program: ls
output:
  template: t
`
    expect(() => parseWorkflow(source)).toThrow('candidates of a need exactly one of values or command')
  })
})

describe('decodeCandidates', () => {
  test('keeps each non-empty line, trimmed', async () => {
    expect(decodeCandidates('main\n  feature/x  \n\n')).toEqual(['main', 'feature/x'])
  })
})

describe('render', () => {
  test('reads values under inputs without escaping them', async () => {
    expect(render(WORKFLOW, { environment: 'staging', request: 'a < b & c' })).toBe('Env staging: a < b & c')
  })

  test('renders unset inputs as empty strings', async () => {
    expect(render(WORKFLOW, {})).toBe('Env : ')
  })
})

describe('missingRequired', () => {
  test('lists required inputs that are empty or blank', async () => {
    expect(missingRequired(WORKFLOW, {})).toEqual(['request'])
    expect(missingRequired(WORKFLOW, { request: '  ' })).toEqual(['request'])
  })

  test('treats inputs without allow_empty as optional', async () => {
    expect(missingRequired(WORKFLOW, { request: 'check it' })).toEqual([])
  })
})
