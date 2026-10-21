import type { Elements, EngineInterface, RenderElement } from 'claude-code'

import type { ConveyCandidates as Candidates, ConveyEntry as Entry, ConveyInput, ConveyPromptTemplate } from '../types'
import { PANE, enter, fill, pick, readForm, retry, selectPromptTemplate, toggleError } from './actions'
import { allowsEmpty, waitingFor } from './promptTemplate'

/** The elements of a surface that has text fields and selects. */
export type FormElements = Extract<Elements[keyof Elements], { Input: unknown; Select: unknown }>

/**
 * What every part of the form draws from. $ is not in it: a mod passes $ only as
 * itself, so the parts that act take it as their first argument.
 */
type Ctx = {
  el: FormElements
  columns: number
  entries: Entry[]
  path: string
  promptTemplate: ConveyPromptTemplate
  current: Record<string, string>
  loaded: Record<string, Candidates>
}

/** The keys the form's elements are drawn under, which the focus moves between. */
const keys = {
  field: (name: string) => name,
  retry: (name: string) => `retry:${name}`,
  error: (name: string) => `error:${name}`,
  chooser: 'promptTemplate',
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
function focusKey({ current, loaded }: Ctx, name: string, input: ConveyInput): string | null {
  if (input.type === 'textarea' || 'values' in input.candidates) return keys.field(name)
  if (waitingFor(input, current).length > 0) return null
  const state = loaded[name]
  if (!state || state.status === 'loading') return null
  return state.status === 'error' || state.values.length === 0 ? keys.retry(name) : keys.field(name)
}

/** The next element that can take the focus after an input, or the Fill prompt button. */
function nextKey(ctx: Ctx, name: string) {
  const inputs = Object.entries(ctx.promptTemplate.inputs)
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
        key={keys.field(name)}
        placeholder={`Enter ${name}…`}
        value={current[name] ?? ''}
        submitLabel="next"
        onInput={text => void enter($, name, text)}
        onSubmit={text => {
          void enter($, name, text)
          void $.ui.focus({ requestId: PANE, key: nextKey(ctx, name) })
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

/** Which prompt template is chosen, above the rounded card of the inputs it asks for. */
function Chooser($: EngineInterface, ctx: Ctx) {
  const { entries, path, promptTemplate, el: { Text, Select } } = ctx
  if (entries.length <= 1) return <Text weight="bold">{promptTemplate.name}</Text>
  return Field(
    ctx,
    'prompt template',
    false,
    <Select
      key={keys.chooser}
      options={entries.map(entry => ({ value: entry.path, label: entry.promptTemplate.name }))}
      value={path}
      onSelect={choice => void selectPromptTemplate($, choice)}
    />,
  )
}

/** The form pane: the chooser, the card of inputs, and the Fill prompt button. */
export async function Form($: EngineInterface, el: FormElements, columns: number) {
  const { Box, Text, Button } = el
  const { entries, path, current, loaded } = await readForm($)
  const promptTemplate = entries.find(entry => entry.path === path)?.promptTemplate
  if (!path || !promptTemplate) return <Text dimColor>No prompt template selected. Run /convey.</Text>

  const ctx: Ctx = { el, columns, entries, path, promptTemplate, current, loaded }
  return (
    <Box flexDirection="column">
      {Chooser($, ctx)}
      <Box flexDirection="column" gap={1} borderStyle="round" paddingX={1}>
        {Object.entries(promptTemplate.inputs).map(([name, input]) =>
          Field(ctx, name, !allowsEmpty(input), Control($, ctx, name, input), Boolean(ctx.current[name]?.trim())),
        )}
      </Box>
      <Button key={keys.fill} label="Fill prompt" variant="primary" onPress={() => void fill($)} />
    </Box>
  )
}
