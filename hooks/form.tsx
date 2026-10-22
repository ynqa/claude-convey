import type { Elements, EngineInterface, RenderElement } from 'claude-code'

import type { ConveyCandidates as Candidates, ConveyEntry as Entry, ConveyInput, ConveyTemplate } from '../types'
import { PANE, chooseTemplate, enter, fill, pick, readForm, retry, submit, toggleError } from './actions'
import { allowsEmpty, missingRequired, waitingFor } from './template'

/** The elements of a surface that has text fields and selects. */
export type FormElements = Extract<Elements[keyof Elements], { Input: unknown; Select: unknown }>

/**
 * What every part of the form draws from. $ is not in it: a mod passes $ only as
 * itself, so the parts that act take it as their first argument.
 *
 * `el` and `columns` come from the render event; the rest is read from the
 * state by `readForm`. The examples are kubernetes-investigation right after
 * `kind-kind` is picked as the context, while its namespaces still load.
 */
type Ctx = {
  /**
   * The elements this surface draws with, as `$.ui.resolve(e)` gave them
   * (terminal, desktop or vscode; mobile has no text fields and never gets here).
   * Each is a function that makes an element: `const { Box, Text } = ctx.el`.
   */
  el: FormElements
  /**
   * How many columns the pane's body has, `e.props.bodyColumns`; `76`, say.
   * Decides whether a failed select's first error line fits or gets ▸ / ▾.
   */
  columns: number
  /**
   * Every file `/convey` parsed as a template, in file name order; files
   * that did not parse are not here. Two or more draw the chooser, one its name.
   *
   * @example
   * [
   *   { path: '.claude/convey/git-commit-review.yaml', template: { name: 'git-commit-review', … } },
   *   { path: '.claude/convey/kubernetes-investigation.yaml', template: { name: 'kubernetes-investigation', … } },
   * ]
   */
  entries: Entry[]
  /**
   * The path of the chosen entry, the chooser's value:
   * `'.claude/convey/kubernetes-investigation.yaml'`.
   */
  path: string
  /**
   * The chosen entry's template. Its inputs keep the file's order, which
   * is the order of the fields; `{{ … }}` in a command's args is still unrendered
   * here, `commandArgv` fills it in just before the command runs.
   *
   * @example
   * {
   *   name: 'kubernetes-investigation',
   *   inputs: {
   *     context: { type: 'select', candidates: { command: { program: 'kubectl', args: ['config', 'get-contexts', '-o', 'name'] } } },
   *     namespace: { type: 'select', depends_on: ['context'], candidates: { command: { program: 'kubectl', args: ['--context', '{{ inputs.context }}', …] } } },
   *     resource_kind: { type: 'select', candidates: { values: ['pod', 'deployment', …] } },
   *     resource: { type: 'select', depends_on: ['context', 'namespace', 'resource_kind'], candidates: { command: … } },
   *     request: { type: 'textarea', allow_empty: false },
   *   },
   *   output: { template: '# Kubernetes investigation\n\n## Target\n…' },
   * }
   */
  template: ConveyTemplate
  /**
   * What the person has typed or picked so far, by input name: `{ context: 'kind-kind' }`.
   * An input not given a value has no key (a cleared text field may stay as `''`),
   * and picking a select again drops the keys of the inputs that depend on it.
   * The ✓ / ○ marks, the controls' values and "waiting for …" all read it.
   */
  current: Record<string, string>
  /**
   * The candidates of each command-backed select, by input name. A select with
   * fixed values (resource_kind) is never here; one still waiting for its
   * dependencies (resource) or not yet started has no key.
   *
   * @example
   * {
   *   context: { status: 'ready', values: ['kind-kind', 'kind-kube-inference-sandbox'] },
   *   namespace: { status: 'loading' },
   * }
   */
  loaded: Record<string, Candidates>
  /**
   * How many times Enter was pressed in each text field: `{ request: 1 }`. It
   * goes into the field's key, so a field emptied by Enter is drawn anew.
   */
  submitted: Record<string, number>
}

/** The keys the form's elements are drawn under, which the focus moves between. */
const keys = {
  /** An input's field; a text field's also counts its Enter presses, after a `~`. */
  field: (name: string, submitted = 0) => (submitted === 0 ? name : `${name}~${submitted}`),
  retry: (name: string) => `retry:${name}`,
  error: (name: string) => `error:${name}`,
  chooser: 'template',
  fill: 'fill',
}

/**
 * A field: its title on one line, in the accent color so it reads apart
 * from what is entered, and the control (or its loading state) indented below.
 * An input's title carries a mark, ✓ once it has a value and ○ until then,
 * which also lines the title up with the control under it.
 */
function Field({ el: { Box, Text } }: Ctx, title: string, isRequired: boolean, control: RenderElement, isFilled?: boolean) {
  return (
    <Box flexDirection="column">
      <Box>
        {isFilled !== undefined &&
          (isFilled ? <Text color="success">✓ </Text> : <Text color="inactive">○ </Text>)}
        <Text weight="bold" color="claude">
          {title}
        </Text>
        {isRequired && <Text color="warning"> *</Text>}
      </Box>
      <Box paddingLeft={2}>{control}</Box>
    </Box>
  )
}

/**
 * The key of the element that takes the focus for an input, as drawn below:
 * its field, its Retry button, or none while it waits or loads.
 */
function focusKey({ current, loaded, submitted }: Ctx, name: string, input: ConveyInput): string | null {
  if (input.type === 'textarea') return keys.field(name, submitted[name])
  if ('values' in input.candidates) return keys.field(name)
  if (waitingFor(input, current).length > 0) return null
  const state = loaded[name]
  if (!state || state.status === 'loading') return null
  return state.status === 'error' || state.values.length === 0 ? keys.retry(name) : keys.field(name)
}

/** The next element that can take the focus after an input, or the Fill button. */
function nextKey(ctx: Ctx, name: string) {
  const inputs = Object.entries(ctx.template.inputs)
  const after = inputs.slice(inputs.findIndex(([inputName]) => inputName === name) + 1)
  for (const [inputName, input] of after) {
    const key = focusKey(ctx, inputName, input)
    if (key) return key
  }
  return keys.fill
}

/**
 * Why a command-backed select has nothing to pick, with a Retry button. A
 * command's stderr runs to many lines: one truncated line keeps Retry in view,
 * and ▸ / ▾ shows the whole of it or folds it again.
 */
function CandidateError($: EngineInterface, ctx: Ctx, name: string, state: Extract<Candidates, { status: 'error' | 'ready' }>) {
  const { Box, Text, Button } = ctx.el
  const retryButton = <Button key={keys.retry(name)} label="Retry" onPress={() => void retry($, name)} />
  if (state.status !== 'error') {
    return (
      <Box gap={1}>
        <Text color="error">no candidates</Text>
        {retryButton}
      </Box>
    )
  }
  const [firstLine = '', ...restLines] = state.error.trim().split('\n')
  const hasMore = restLines.length > 0 || firstLine.length > ctx.columns - 16
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {hasMore && (
          <Button
            key={keys.error(name)}
            label={state.isExpanded ? '▾' : '▸'}
            plain
            onPress={() => void toggleError($, name)}
          />
        )}
        <Box flexShrink={1} minWidth={0}>
          <Text color="error" wrap={state.isExpanded ? 'wrap' : 'truncate-end'}>
            {firstLine}
          </Text>
        </Box>
        {retryButton}
      </Box>
      {state.isExpanded && restLines.length > 0 && (
        <Box paddingLeft={hasMore ? 2 : 0}>
          <Text color="error">{restLines.join('\n')}</Text>
        </Box>
      )}
    </Box>
  )
}

/** The control of one input: a text field, a select, or why its select cannot show yet. */
function Control($: EngineInterface, ctx: Ctx, name: string, input: ConveyInput) {
  const { current, loaded, el: { Text, Input, Select } } = ctx
  if (input.type === 'textarea') {
    // The placeholder gives an empty field something to click; Enter moves on to the next field.
    return (
      <Input
        key={keys.field(name, ctx.submitted[name])}
        placeholder={`Enter ${name}…`}
        value={current[name] ?? ''}
        submitLabel="next"
        onInput={text => void enter($, name, text)}
        onSubmit={text => {
          void submit($, name, text)
          // A refused move leaves the focus where it is, which is fine here.
          $.ui.focus({ requestId: PANE, key: nextKey(ctx, name) }).catch(() => {})
        }}
      />
    )
  }

  let options: string[]
  if ('values' in input.candidates) {
    options = input.candidates.values
  } else {
    const waiting = waitingFor(input, current)
    const state = loaded[name]
    if (waiting.length > 0) return <Text dimColor>waiting for {waiting.join(', ')}</Text>
    if (!state || state.status === 'loading') return <Text dimColor>loading…</Text>
    if (state.status === 'error' || state.values.length === 0) return CandidateError($, ctx, name, state)
    options = state.values
  }
  return (
    <Select
      key={keys.field(name)}
      options={options.map(value => ({ value }))}
      value={current[name]}
      onSelect={value => void pick($, name, value)}
    />
  )
}

/**
 * Which template is chosen, above the rounded card of the inputs it asks for.
 * A header rather than a field: a small dim label beside the template, with no
 * accent title or mark, so it does not read as one of the inputs. The terminal
 * has one text size and ignores `caption`; the dim color sets it apart there.
 */
function Chooser($: EngineInterface, ctx: Ctx) {
  const { entries, path, template, el: { Box, Text, Select } } = ctx
  return (
    <Box gap={1}>
      <Text dimColor size="caption">
        template
      </Text>
      {entries.length <= 1 ? (
        <Text weight="bold">{template.name}</Text>
      ) : (
        <Select
          key={keys.chooser}
          options={entries.map(entry => ({ value: entry.path, label: entry.template.name }))}
          value={path}
          onSelect={choice => void chooseTemplate($, choice)}
        />
      )}
    </Box>
  )
}

/**
 * The Fill button, with the required inputs still empty beside it in the
 * warning color (the color of their ` *`), so what Fill would refuse shows
 * before it is pressed. Fill's own toast stays for a press made anyway.
 */
function FillRow($: EngineInterface, ctx: Ctx) {
  const { Box, Text, Button } = ctx.el
  const missing = missingRequired(ctx.template, ctx.current)
  return (
    <Box gap={2}>
      <Button key={keys.fill} label="Fill" variant="primary" onPress={() => void fill($)} />
      {missing.length > 0 && <Text color="warning">Required: {missing.join(', ')}</Text>}
    </Box>
  )
}

/** The form pane: the chooser, the card of inputs, and the Fill button. */
export async function Form($: EngineInterface, el: FormElements, columns: number) {
  const { Box, Text, Button } = el
  const { entries, path, current, loaded, submitted } = await readForm($)
  const template = entries.find(entry => entry.path === path)?.template
  if (!path || !template) return <Text dimColor>No template selected. Run /convey.</Text>

  const ctx: Ctx = { el, columns, entries, path, template, current, loaded, submitted }
  // A rule across the pane under its tab header (which the engine draws, so no
  // line goes between the tabs themselves), then a blank row between the rule,
  // the template chooser, the card of inputs and the Fill button.
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>{'─'.repeat(Math.max(1, columns))}</Text>
      {Chooser($, ctx)}
      <Box flexDirection="column" gap={1} borderStyle="round" paddingX={1}>
        {Object.entries(template.inputs).map(([name, input]) =>
          Field(ctx, name, !allowsEmpty(input), Control($, ctx, name, input), Boolean(ctx.current[name]?.trim())),
        )}
      </Box>
      {FillRow($, ctx)}
    </Box>
  )
}
