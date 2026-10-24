import { describe, expect, test } from 'claude-code/testing'

import type { ConveyTemplate as Template } from '../types'
import {
  commandArgv,
  decodeCandidates,
  dependentsOf,
  missingRequired,
  parseTemplate,
  render,
  renderPreview,
  waitingFor,
} from '../hooks/template'

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

const TEMPLATE: Template = {
  name: 'test',
  inputs: {
    environment: { type: 'select', candidates: { values: ['staging'] } },
    request: { type: 'textarea', allow_empty: false },
  },
  output: { template: 'Env {{ inputs.environment }}: {{inputs.request}}' },
}

describe('parseTemplate', () => {
  test('keeps the YAML shape and the order of inputs', async () => {
    const template = parseTemplate(SOURCE)
    expect(template).toEqual({
      name: 'incident-summary',
      inputs: {
        environment: { type: 'select', candidates: { values: ['development', 'staging', 'production'] } },
        request: { type: 'textarea', allow_empty: false },
      },
      output: { template: '- Environment: `{{ inputs.environment }}`\n\n{{ inputs.request }}\n' },
    })
    expect(Object.keys(template.inputs)).toEqual(['environment', 'request'])
  })

  test('rejects fields it does not know', async () => {
    expect(() => parseTemplate(SOURCE.replace('allow_empty: false', 'allow_emtpy: false'))).toThrow(
      'unknown field in input request: allow_emtpy',
    )
  })

  test('rejects a select without candidate values', async () => {
    const source = 'name: x\ninputs:\n  a:\n    type: select\noutput:\n  template: t\n'
    expect(() => parseTemplate(source)).toThrow('select input a requires candidates')
  })

  test('reports YAML syntax errors', async () => {
    expect(() => parseTemplate('name: [unclosed')).toThrow()
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
    expect(parseTemplate(source).inputs.branch).toEqual({
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
    expect(() => parseTemplate(source)).toThrow('candidates of a need exactly one of values or command')
  })
})

describe('description', () => {
  const source = (description: string) => `name: x
inputs:
  environment:
    type: select
    description: ${description}
    candidates:
      values: [staging]
  request:
    type: textarea
    description: ${description}
output:
  template: t
`

  test('is read on selects and textareas', async () => {
    const { inputs } = parseTemplate(source('Where it happened'))
    expect(inputs.environment?.description).toBe('Where it happened')
    expect(inputs.request?.description).toBe('Where it happened')
  })

  test('rejects a description that is not a string or is empty', async () => {
    expect(() => parseTemplate(source('[one, two]'))).toThrow('description of environment must be a non-empty string')
    expect(() => parseTemplate(source('42'))).toThrow('description of environment must be a non-empty string')
    expect(() => parseTemplate(source('""'))).toThrow('description of environment must be a non-empty string')
    expect(() => parseTemplate(source('" "'))).toThrow('description of environment must be a non-empty string')
  })
})

describe('placeholder', () => {
  const withInput = (input: string) => `name: x\ninputs:\n  a:\n${input}output:\n  template: t\n`

  test('reads a textarea placeholder', async () => {
    const source = withInput('    type: textarea\n    placeholder: What went wrong\n')
    expect(parseTemplate(source).inputs.a).toEqual({ type: 'textarea', placeholder: 'What went wrong' })
  })

  test('rejects a placeholder on a select', async () => {
    const source = withInput('    type: select\n    placeholder: Pick one\n    candidates:\n      values: [one]\n')
    expect(() => parseTemplate(source)).toThrow('select input a cannot define placeholder')
  })

  test('rejects a placeholder that is not a non-empty string', async () => {
    for (const value of ['""', '3', '[hint]', '']) {
      const source = withInput(`    type: textarea\n    placeholder: ${value}\n`)
      expect(() => parseTemplate(source)).toThrow('placeholder of a must be a non-empty string')
    }
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
    const template = parseTemplate(CHAIN)
    expect(dependentsOf(template, 'context')).toEqual(['namespace', 'resource'])
    expect(dependentsOf(template, 'kind')).toEqual(['resource'])
    expect(dependentsOf(template, 'resource')).toEqual([])
  })

  test('waits until every dependency has a value', async () => {
    const resource = parseTemplate(CHAIN).inputs.resource!
    expect(waitingFor(resource, {})).toEqual(['namespace', 'kind'])
    expect(waitingFor(resource, { namespace: 'payments', kind: 'pod' })).toEqual([])
  })

  test('rejects a dependency on a later input or a textarea', async () => {
    const later = 'name: x\ninputs:\n  a:\n    type: select\n    depends_on: [b]\n    candidates:\n      values: [1]\n  b:\n    type: select\n    candidates:\n      values: [1]\noutput:\n  template: t\n'
    expect(() => parseTemplate(later)).toThrow('input a can depend only on an earlier select input, not b')
    const textarea = 'name: x\ninputs:\n  a:\n    type: textarea\n  b:\n    type: select\n    depends_on: [a]\n    candidates:\n      values: [1]\noutput:\n  template: t\n'
    expect(() => parseTemplate(textarea)).toThrow('input b can depend only on an earlier select input, not a')
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
    expect(render(TEMPLATE, { environment: 'staging', request: 'a < b & c' })).toBe('Env staging: a < b & c')
  })

  test('renders unset inputs as empty strings', async () => {
    expect(render(TEMPLATE, {})).toBe('Env : ')
  })
})

describe('renderPreview', () => {
  test('makes each input a part of its own, marked when unset or blank', async () => {
    expect(renderPreview(TEMPLATE, { environment: 'staging', request: '  ' })).toEqual([
      { kind: 'text', text: 'Env ' },
      { kind: 'filled', name: 'environment', text: 'staging' },
      { kind: 'text', text: ': ' },
      { kind: 'missing', name: 'request', text: '‹request›' },
    ])
  })

  test('joins back into what render gives once filled, even with ‹ › in a value', async () => {
    const values = { environment: 'staging', request: 'a ‹b›\nc' }
    const parts = renderPreview(TEMPLATE, values)
    expect(parts.map(part => part.kind)).toEqual(['text', 'filled', 'text', 'filled'])
    expect(parts.map(part => part.text).join('')).toBe(render(TEMPLATE, values))
  })
})

describe('missingRequired', () => {
  test('lists required inputs that are empty or blank', async () => {
    expect(missingRequired(TEMPLATE, {})).toEqual(['request'])
    expect(missingRequired(TEMPLATE, { request: '  ' })).toEqual(['request'])
  })

  test('treats inputs without allow_empty as optional', async () => {
    expect(missingRequired(TEMPLATE, { request: 'check it' })).toEqual([])
  })
})
