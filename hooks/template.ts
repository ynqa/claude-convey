import type { ConveyCommand as Command, ConveyInput as Input, ConveyTemplate as Template } from '../types'
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

/** `earlierSelects` are the select inputs listed before this one. */
function checkInput(name: string, input: unknown, earlierSelects: string[]): asserts input is Input {
  if (!isMap(input)) throw new Error(`input ${name} must be a mapping`)
  onlyFields(input, ['type', 'allow_empty', 'depends_on', 'candidates'], `input ${name}`)
  if (input.allow_empty !== undefined && typeof input.allow_empty !== 'boolean') {
    throw new Error(`allow_empty of ${name} must be true or false`)
  }

  if (input.type === 'textarea') {
    if (input.candidates !== undefined) throw new Error(`textarea input ${name} cannot define candidates`)
    if (input.depends_on !== undefined) throw new Error(`textarea input ${name} cannot define depends_on`)
    return
  }
  if (input.type !== 'select') throw new Error(`input ${name} must have type select or textarea`)

  if (input.depends_on !== undefined) {
    if (!isStringList(input.depends_on)) throw new Error(`depends_on of ${name} must be a list of input names`)
    for (const dependency of input.depends_on) {
      // Textareas are saved on every keystroke, so depending on one would rerun the command per key.
      if (!earlierSelects.includes(dependency)) {
        throw new Error(`input ${name} can depend only on an earlier select input, not ${dependency}`)
      }
    }
  }

  const candidates = input.candidates
  if (!isMap(candidates)) throw new Error(`select input ${name} requires candidates`)
  onlyFields(candidates, ['values', 'command'], `candidates of ${name}`)
  if ((candidates.values === undefined) === (candidates.command === undefined)) {
    throw new Error(`candidates of ${name} need exactly one of values or command`)
  }

  if (candidates.values !== undefined) {
    if (!isStringList(candidates.values) || candidates.values.length === 0) {
      throw new Error(`candidates.values of ${name} must be a non-empty list of strings`)
    }
    return
  }

  const command = candidates.command
  if (!isMap(command)) throw new Error(`candidates.command of ${name} must be a mapping`)
  onlyFields(command, ['program', 'args'], `candidates.command of ${name}`)
  if (typeof command.program !== 'string' || command.program.trim() === '') {
    throw new Error(`candidates.command.program of ${name} must not be empty`)
  }
  if (command.args !== undefined && !isStringList(command.args)) {
    throw new Error(`candidates.command.args of ${name} must be a list of strings`)
  }
}

/** Each non-empty line of a command's stdout, trimmed, is one candidate. */
export function decodeCandidates(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
}

/** Parses a template YAML file and checks it against convey's rules. */
export function parseTemplate(source: string): Template {
  const template = load(source)
  if (!isMap(template)) throw new Error('a template must be a mapping')
  onlyFields(template, ['name', 'inputs', 'output'], 'the template')

  if (typeof template.name !== 'string' || template.name.trim() === '') throw new Error('name must not be empty')

  const inputs = template.inputs
  if (!isMap(inputs) || Object.keys(inputs).length === 0) {
    throw new Error('inputs must be a mapping with at least one input')
  }
  const selects: string[] = []
  for (const [name, input] of Object.entries(inputs)) {
    checkInput(name, input, selects)
    if (input.type === 'select') selects.push(name)
  }

  const output = template.output
  if (!isMap(output)) throw new Error('output must be a mapping')
  onlyFields(output, ['template'], 'output')
  if (typeof output.template !== 'string' || output.template.trim() === '') {
    throw new Error('output.template must not be empty')
  }

  return template as Template
}

export const allowsEmpty = (input: Input) => input.allow_empty ?? true

export const dependenciesOf = (input: Input) => (input.type === 'select' ? (input.depends_on ?? []) : [])

/**
 * Renders a Mustache template with the values under `inputs`
 * (`{{ inputs.<name> }}`). Unset inputs render as empty strings and nothing
 * is HTML-escaped: the output is Markdown for a prompt, or command arguments.
 */
function renderText(source: string, values: Record<string, string>): string {
  return Mustache.render(source, { inputs: values }, {}, { escape: text => text })
}

/** Renders `output.template`. */
export function render(template: Template, values: Record<string, string>): string {
  return renderText(template.output.template, values)
}

/**
 * A run of the preview: the template's own text, an entered value (`filled`), or
 * the `‹name›` mark of an input still to fill (`missing`).
 */
export type PreviewPart =
  | { kind: 'text'; text: string }
  | { kind: 'filled' | 'missing'; name: string; text: string }

// Private use characters wrap each input while rendering (START name SEP value END,
// the value empty when missing), so every input's run is found again exactly, even
// when an entered value itself holds ‹ or ›.
const START = '\uE000'
const SEP = '\uE001'
const END = '\uE002'
const WRAPPED = new RegExp(`${START}([^${SEP}]*)${SEP}([^${END}]*)${END}`, 'g')

/**
 * Renders `output.template` for the preview, as runs: each input is a part of its
 * own, its value when filled and `‹name›` when unset or blank, so the preview can
 * color both. Trailing whitespace is dropped. Only the preview uses it; Fill puts
 * `render`'s text, without marks, in the prompt box.
 */
export function renderPreview(template: Template, values: Record<string, string>): PreviewPart[] {
  const shown = { ...values }
  for (const name of Object.keys(template.inputs)) {
    const value = values[name] ?? ''
    shown[name] = `${START}${name}${SEP}${value.trim() === '' ? '' : value}${END}`
  }
  const rendered = renderText(template.output.template, shown).trimEnd()

  const parts: PreviewPart[] = []
  let at = 0
  for (const match of rendered.matchAll(WRAPPED)) {
    const [whole, name = '', value = ''] = match
    if (match.index > at) parts.push({ kind: 'text', text: rendered.slice(at, match.index) })
    parts.push(value === '' ? { kind: 'missing', name, text: `‹${name}›` } : { kind: 'filled', name, text: value })
    at = match.index + whole.length
  }
  if (at < rendered.length) parts.push({ kind: 'text', text: rendered.slice(at) })
  return parts
}

/**
 * The argument vector of a candidate command, each part rendered with the
 * values. Arguments that render empty are dropped, so a Mustache section can
 * leave an option out (`{{#inputs.ns}}--namespace={{ inputs.ns }}{{/inputs.ns}}`).
 */
export function commandArgv(command: Command, values: Record<string, string>): string[] {
  const program = renderText(command.program, values)
  if (program.trim() === '') throw new Error(`program ${JSON.stringify(command.program)} rendered empty`)
  const args = (command.args ?? []).map(arg => renderText(arg, values)).filter(arg => arg !== '')
  return [program, ...args]
}

/** The dependencies of `input` that have no value yet. */
export function waitingFor(input: Input, values: Record<string, string>): string[] {
  return dependenciesOf(input).filter(dependency => !values[dependency])
}

/** The inputs that depend on `changed`, directly or through another input, in file order. */
export function dependentsOf(template: Template, changed: string): string[] {
  const affected = new Set([changed])
  for (const [name, input] of Object.entries(template.inputs)) {
    if (dependenciesOf(input).some(dependency => affected.has(dependency))) affected.add(name)
  }
  affected.delete(changed)
  return [...affected]
}

/** The names of inputs with `allow_empty: false` that have no value. */
export function missingRequired(template: Template, values: Record<string, string>): string[] {
  return Object.entries(template.inputs)
    .filter(([name, input]) => !allowsEmpty(input) && (values[name] ?? '').trim() === '')
    .map(([name]) => name)
}
