// Names carry the Convey prefix: inside `declare module 'claude-code'` a bare
// name resolves to Claude Code's own types first (it has a `Selection`, for one).

/**
 * A local program whose stdout lines become the candidates. Run without a
 * shell; `program` and each of `args` are Mustache templates over `inputs`.
 */
export type ConveyCommand = { program: string; args?: string[] }

/** One entry of `inputs` in a prompt template YAML. `allow_empty` defaults to true. */
export type ConveyInput =
  | {
      type: 'select'
      allow_empty?: boolean
      /** Earlier select inputs whose values the command's templates use. */
      depends_on?: string[]
      candidates: { values: string[] } | { command: ConveyCommand }
    }
  | { type: 'textarea'; allow_empty?: boolean }

/** A prompt template YAML file, in convey's format. */
export type ConveyPromptTemplate = {
  name: string
  /** Input definitions by name, in the order the file lists them. */
  inputs: Record<string, ConveyInput>
  output: { template: string }
}

/** A file that parsed as a prompt template. */
export type ConveyEntry = { path: string; promptTemplate: ConveyPromptTemplate }

/** The candidates a command-backed select has loaded so far. */
export type ConveyCandidates =
  | { status: 'loading' }
  | { status: 'ready'; values: string[] }
  | { status: 'error'; error: string; isExpanded?: boolean }

declare module 'claude-code' {
  interface PluginState {
    convey: {
      /** The prompt templates found by the last `/convey`. */
      promptTemplates: ConveyEntry[]
      /** The path of the prompt template the form shows. */
      selected: string | null
      /** Values entered in the form, by input name. */
      values: Record<string, string>
      /** Candidates of command-backed selects, by input name. */
      candidates: Record<string, ConveyCandidates>
    }
  }
}
