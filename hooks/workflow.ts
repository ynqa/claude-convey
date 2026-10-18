import type { ConveyInput as Input, ConveyWorkflow as Workflow } from '../types'
import { load } from './vendor/js-yaml/js-yaml.mjs'
import Mustache from './vendor/mustache/mustache.mjs'

type YamlMap = Record<string, unknown>

const isMap = (value: unknown): value is YamlMap =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

/** Rejects fields this version does not understand, as convey does. */
function onlyFields(map: YamlMap, fields: string[], where: string) {
  for (const key of Object.keys(map)) {
    if (!fields.includes(key)) throw new Error(`unknown field in ${where}: ${key}`)
  }
}

function checkInput(name: string, input: unknown): asserts input is Input {
  if (!isMap(input)) throw new Error(`input ${name} must be a mapping`)
  onlyFields(input, ['type', 'allow_empty', 'candidates'], `input ${name}`)
  if (input.allow_empty !== undefined && typeof input.allow_empty !== 'boolean') {
    throw new Error(`allow_empty of ${name} must be true or false`)
  }

  if (input.type === 'textarea') {
    if (input.candidates !== undefined) throw new Error(`textarea input ${name} cannot define candidates`)
    return
  }
  if (input.type !== 'select') throw new Error(`input ${name} must have type select or textarea`)

  const candidates = input.candidates
  if (!isMap(candidates)) throw new Error(`select input ${name} requires candidates`)
  onlyFields(candidates, ['values'], `candidates of ${name}`)
  if (!isStringList(candidates.values) || candidates.values.length === 0) {
    throw new Error(`candidates.values of ${name} must be a non-empty list of strings`)
  }
}

/** Parses a workflow YAML file and checks it against convey's rules. */
export function parseWorkflow(source: string): Workflow {
  const workflow = load(source)
  if (!isMap(workflow)) throw new Error('a workflow must be a mapping')
  onlyFields(workflow, ['name', 'inputs', 'output'], 'the workflow')

  if (typeof workflow.name !== 'string' || workflow.name.trim() === '') throw new Error('name must not be empty')

  const inputs = workflow.inputs
  if (!isMap(inputs) || Object.keys(inputs).length === 0) {
    throw new Error('inputs must be a mapping with at least one input')
  }
  for (const [name, input] of Object.entries(inputs)) checkInput(name, input)

  const output = workflow.output
  if (!isMap(output)) throw new Error('output must be a mapping')
  onlyFields(output, ['template'], 'output')
  if (typeof output.template !== 'string' || output.template.trim() === '') {
    throw new Error('output.template must not be empty')
  }

  return workflow as Workflow
}

export const allowsEmpty = (input: Input) => input.allow_empty ?? true

/**
 * Renders `output.template` as Mustache with the values under `inputs`
 * (`{{ inputs.<name> }}`). Unset inputs render as empty strings and nothing
 * is HTML-escaped, since the output is Markdown for a prompt.
 */
export function render(workflow: Workflow, values: Record<string, string>): string {
  return Mustache.render(workflow.output.template, { inputs: values }, {}, { escape: text => text })
}

/** The names of inputs with `allow_empty: false` that have no value. */
export function missingRequired(workflow: Workflow, values: Record<string, string>): string[] {
  return Object.entries(workflow.inputs)
    .filter(([name, input]) => !allowsEmpty(input) && (values[name] ?? '').trim() === '')
    .map(([name]) => name)
}
