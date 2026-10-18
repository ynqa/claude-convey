// Names carry the Convey prefix: inside `declare module 'claude-code'` a bare
// name resolves to Claude Code's own types first (it has a `Selection`, for one).

/** One entry of `inputs` in a workflow YAML. `allow_empty` defaults to true. */
export type ConveyInput =
  | { type: 'select'; allow_empty?: boolean; candidates: { values: string[] } }
  | { type: 'textarea'; allow_empty?: boolean }

/** A workflow YAML file, in convey's format. */
export type ConveyWorkflow = {
  name: string
  /** Input definitions by name, in the order the file lists them. */
  inputs: Record<string, ConveyInput>
  output: { template: string }
}

/** A file that parsed as a workflow. */
export type ConveyEntry = { path: string; workflow: ConveyWorkflow }

declare module 'claude-code' {
  interface PluginState {
    convey: {
      /** The workflows found by the last `/convey`. */
      workflows: ConveyEntry[]
      /** The path of the workflow the form shows. */
      selected: string | null
      /** Values entered in the form, by input name. */
      values: Record<string, string>
    }
  }
}
