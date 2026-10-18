import { describe, expect, test } from 'claude-code/testing'

import type { ConveyPromptTemplate as PromptTemplate } from '../types'
import {
  commandArgv,
  decodeCandidates,
  dependentsOf,
  missingRequired,
  parsePromptTemplate,
  render,
  waitingFor,
} from '../hooks/promptTemplate'

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

const PROMPT_TEMPLATE: PromptTemplate = {
  name: 'test',
  inputs: {
    environment: { type: 'select', candidates: { values: ['staging'] } },
    request: { type: 'textarea', allow_empty: false },
  },
  output: { template: 'Env {{ inputs.environment }}: {{inputs.request}}' },
}

describe('parsePromptTemplate', () => {
  test('keeps the YAML shape and the order of inputs', async () => {
    const promptTemplate = parsePromptTemplate(SOURCE)
    expect(promptTemplate).toEqual({
      name: 'incident-summary',
      inputs: {
        environment: { type: 'select', candidates: { values: ['development', 'staging', 'production'] } },
        request: { type: 'textarea', allow_empty: false },
      },
      output: { template: '- Environment: `{{ inputs.environment }}`\n\n{{ inputs.request }}\n' },
    })
    expect(Object.keys(promptTemplate.inputs)).toEqual(['environment', 'request'])
  })

  test('rejects fields it does not know', async () => {
    expect(() => parsePromptTemplate(SOURCE.replace('allow_empty: false', 'allow_emtpy: false'))).toThrow(
      'unknown field in input request: allow_emtpy',
    )
  })

  test('rejects a select without candidate values', async () => {
    const source = 'name: x\ninputs:\n  a:\n    type: select\noutput:\n  template: t\n'
    expect(() => parsePromptTemplate(source)).toThrow('select input a requires candidates')
  })

  test('reports YAML syntax errors', async () => {
    expect(() => parsePromptTemplate('name: [unclosed')).toThrow()
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
    expect(parsePromptTemplate(source).inputs.branch).toEqual({
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
    expect(() => parsePromptTemplate(source)).toThrow('candidates of a need exactly one of values or command')
  })
})

describe('depends_on', () => {
  const CHAIN = `name: chain
inputs:
  context:
    type: select
    candidates:
      command:
        program: kubectl
        args: [config, get-contexts, -o, name]
  kind:
    type: select
    candidates:
      values: [pod, service]
  namespace:
    type: select
    depends_on: [context]
    candidates:
      command:
        program: kubectl
        args: [--context, "{{ inputs.context }}", get, namespaces]
  resource:
    type: select
    depends_on: [namespace, kind]
    candidates:
      command:
        program: kubectl
        args: [get, "{{ inputs.kind }}", "{{#inputs.namespace}}--namespace={{ inputs.namespace }}{{/inputs.namespace}}"]
output:
  template: t
`

  test('lists dependents transitively, in file order', async () => {
    const promptTemplate = parsePromptTemplate(CHAIN)
    expect(dependentsOf(promptTemplate, 'context')).toEqual(['namespace', 'resource'])
    expect(dependentsOf(promptTemplate, 'kind')).toEqual(['resource'])
    expect(dependentsOf(promptTemplate, 'resource')).toEqual([])
  })

  test('waits until every dependency has a value', async () => {
    const resource = parsePromptTemplate(CHAIN).inputs.resource!
    expect(waitingFor(resource, {})).toEqual(['namespace', 'kind'])
    expect(waitingFor(resource, { namespace: 'payments', kind: 'pod' })).toEqual([])
  })

  test('rejects a dependency on a later input or a textarea', async () => {
    const later = 'name: x\ninputs:\n  a:\n    type: select\n    depends_on: [b]\n    candidates:\n      values: [1]\n  b:\n    type: select\n    candidates:\n      values: [1]\noutput:\n  template: t\n'
    expect(() => parsePromptTemplate(later)).toThrow('input a can depend only on an earlier select input, not b')
    const textarea = 'name: x\ninputs:\n  a:\n    type: textarea\n  b:\n    type: select\n    depends_on: [a]\n    candidates:\n      values: [1]\noutput:\n  template: t\n'
    expect(() => parsePromptTemplate(textarea)).toThrow('input b can depend only on an earlier select input, not a')
  })
})

describe('commandArgv', () => {
  const command = {
    program: 'kubectl',
    args: ['get', '{{ inputs.kind }}', '{{#inputs.namespace}}--namespace={{ inputs.namespace }}{{/inputs.namespace}}'],
  }

  test('renders each argument with the values', async () => {
    expect(commandArgv(command, { kind: 'pod', namespace: 'a&b' })).toEqual([
      'kubectl',
      'get',
      'pod',
      '--namespace=a&b',
    ])
  })

  test('drops arguments that render empty', async () => {
    expect(commandArgv(command, { kind: 'pod' })).toEqual(['kubectl', 'get', 'pod'])
  })
})

describe('decodeCandidates', () => {
  test('keeps each non-empty line, trimmed', async () => {
    expect(decodeCandidates('main\n  feature/x  \n\n')).toEqual(['main', 'feature/x'])
  })
})

describe('render', () => {
  test('reads values under inputs without escaping them', async () => {
    expect(render(PROMPT_TEMPLATE, { environment: 'staging', request: 'a < b & c' })).toBe('Env staging: a < b & c')
  })

  test('renders unset inputs as empty strings', async () => {
    expect(render(PROMPT_TEMPLATE, {})).toBe('Env : ')
  })
})

describe('missingRequired', () => {
  test('lists required inputs that are empty or blank', async () => {
    expect(missingRequired(PROMPT_TEMPLATE, {})).toEqual(['request'])
    expect(missingRequired(PROMPT_TEMPLATE, { request: '  ' })).toEqual(['request'])
  })

  test('treats inputs without allow_empty as optional', async () => {
    expect(missingRequired(PROMPT_TEMPLATE, { request: 'check it' })).toEqual([])
  })
})
