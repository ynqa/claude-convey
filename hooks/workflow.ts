import Mustache from './vendor/mustache/mustache.mjs'

export type Input =
  | { name: string; type: 'select'; allowEmpty: boolean; values: string[] }
  | { name: string; type: 'textarea'; allowEmpty: boolean }

export type Workflow = {
  name: string
  inputs: Input[]
  template: string
}

/**
 * Renders a Mustache template with the values under `inputs`
 * (`{{ inputs.<name> }}`). Unset inputs render as empty strings and nothing
 * is HTML-escaped, since the output is Markdown for a prompt.
 */
export function render(template: string, values: Record<string, string>): string {
  return Mustache.render(template, { inputs: values }, {}, { escape: text => text })
}

/** The names of inputs with `allow_empty: false` that have no value. */
export function missingRequired(workflow: Workflow, values: Record<string, string>): string[] {
  return workflow.inputs
    .filter(input => !input.allowEmpty && (values[input.name] ?? '').trim() === '')
    .map(input => input.name)
}
