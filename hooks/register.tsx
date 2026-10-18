import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  ConveyCandidates as Candidates,
  ConveyCommand as Command,
  ConveyEntry as Entry,
  ConveyInput,
} from '../types'
import {
  allowsEmpty,
  commandArgv,
  decodeCandidates,
  dependenciesOf,
  dependentsOf,
  missingRequired,
  parseWorkflow,
  render,
  waitingFor,
} from './workflow'

const PANE = 'convey'
const DEFAULT_DIR = '.claude/convey'

const workflows = atom({ plugin: 'convey', key: 'workflows' } as const, [])
const selected = atom({ plugin: 'convey', key: 'selected' } as const, null)
const values = atom({ plugin: 'convey', key: 'values' } as const, {})
const candidates = atom({ plugin: 'convey', key: 'candidates' } as const, {})

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Reads `target` (a file, or a directory whose files are each tried) and keeps
 * what parses as a workflow; the rest is reported as skipped.
 */
async function loadWorkflows($: EngineInterface, target: string) {
  const paths: string[] = []
  if ((await $.fs.stat(target)).kind === 'dir') {
    const dir = target.replace(/\/+$/, '')
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind === 'file' && !entry.name.startsWith('.')) paths.push(`${dir}/${entry.name}`)
    }
    paths.sort()
  } else {
    paths.push(target)
  }

  const entries: Entry[] = []
  const skipped: string[] = []
  for (const path of paths) {
    try {
      entries.push({ path, workflow: parseWorkflow(await $.fs.read(path)) })
    } catch (error) {
      skipped.push(`${path}: ${message(error)}`)
    }
  }
  return { entries, skipped }
}

/** Runs a candidate command; a non-zero exit is an error carrying its stderr. */
async function runCommand($: EngineInterface, argv: string[]): Promise<Candidates> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: 30_000 })
    if (exitCode !== 0) return { status: 'error', error: `${argv[0]} exited with ${exitCode}: ${stderr.trim()}` }
    return { status: 'ready', values: decodeCandidates(stdout) }
  } catch (error) {
    return { status: 'error', error: message(error) }
  }
}

const selectedEntry = async ($: EngineInterface) => {
  const path = await read($, selected)
  return (await read($, workflows)).find(entry => entry.path === path)
}

/**
 * Loads one command-backed select with the current values. The result is kept
 * only while the same workflow is shown and the values the command ran with
 * are still the current ones, so a slow command cannot overwrite a newer form.
 */
async function loadCandidates($: EngineInterface, path: string, name: string, command: Command, dependsOn: string[]) {
  const current = await read($, values)
  const ranWith = JSON.stringify(dependsOn.map(dependency => current[dependency]))
  const loading: Candidates = { status: 'loading' }
  await update($, candidates, loaded => ({ ...loaded, [name]: loading }))

  let result: Candidates
  try {
    result = await runCommand($, commandArgv(command, current))
  } catch (error) {
    result = { status: 'error', error: message(error) }
  }

  if ((await read($, selected)) !== path) return
  const now = await read($, values)
  if (JSON.stringify(dependsOn.map(dependency => now[dependency])) !== ranWith) return
  await update($, candidates, loaded => (loaded[name]?.status === 'loading' ? { ...loaded, [name]: result } : loaded))
}

/** Starts every command-backed select whose dependencies have values and whose candidates are not loaded. */
async function loadReadyCandidates($: EngineInterface) {
  const entry = await selectedEntry($)
  if (!entry) return
  const current = await read($, values)
  const loaded = await read($, candidates)
  for (const [name, input] of Object.entries(entry.workflow.inputs)) {
    if (input.type !== 'select' || !('command' in input.candidates) || loaded[name]) continue
    if (waitingFor(input, current).length > 0) continue
    void loadCandidates($, entry.path, name, input.candidates.command, dependenciesOf(input))
  }
}

/** Shows a workflow's form, starting empty, and loads its command candidates. */
async function selectWorkflow($: EngineInterface, path: string) {
  await update($, selected, () => path)
  await update($, values, () => ({}))
  await update($, candidates, () => ({}))
  await loadReadyCandidates($)
}

/** Saves a select's value, clears every input that depends on it, and loads what can now load. */
async function pick($: EngineInterface, name: string, value: string) {
  const entry = await selectedEntry($)
  if (!entry) return
  const dependents = dependentsOf(entry.workflow, name)
  await update($, values, entered => {
    const next = { ...entered, [name]: value }
    for (const dependent of dependents) delete next[dependent]
    return next
  })
  await update($, candidates, loaded => {
    const next = { ...loaded }
    for (const dependent of dependents) delete next[dependent]
    return next
  })
  await loadReadyCandidates($)
}

/** Forgets a select's candidates and loads them again. */
async function retry($: EngineInterface, name: string) {
  await update($, candidates, loaded => {
    const next = { ...loaded }
    delete next[name]
    return next
  })
  await loadReadyCandidates($)
}

async function fill($: EngineInterface) {
  const entry = await selectedEntry($)
  if (!entry) return
  const current = await read($, values)
  const missing = missingRequired(entry.workflow, current)
  if (missing.length > 0) {
    $.ui.toast(`Required: ${missing.join(', ')}`)
    return
  }
  await $.prompt.fill({ text: render(entry.workflow, current), mode: 'replace' })
  await update($, values, () => ({}))
  await $.ui.close({ id: PANE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'convey',
      description: `Fill a workflow form (default: ${DEFAULT_DIR})`,
    })
    return next(e)
  })

  on('command.run', { command: 'convey' }, async ($, e) => {
    const target = e.args.trim() || DEFAULT_DIR
    let loaded: Awaited<ReturnType<typeof loadWorkflows>>
    try {
      loaded = await loadWorkflows($, target)
    } catch (error) {
      return { text: `convey: cannot read ${target}: ${message(error)}` }
    }
    const { entries, skipped } = loaded
    const notes = skipped.map(reason => `\n  skipped ${reason}`).join('')
    const [first] = entries
    if (!first) return { text: `convey: no workflows in ${target}${notes}` }

    await update($, workflows, () => entries)
    await selectWorkflow($, first.path)
    await $.ui.open({ id: PANE, title: 'convey', focus: true, closeOnEscape: true })
    return { text: `convey: ${entries.length} workflow(s) from ${target}${notes}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    if (!('Input' in elements) || !('Select' in elements)) {
      const { Text } = elements
      return <Text dimColor>convey needs a surface with text fields.</Text>
    }
    const { Box, Text, Button, Input, Select } = elements
    const entries = await read($, workflows)
    const path = await read($, selected)
    const current = await read($, values)
    const loaded = await read($, candidates)
    const workflow = entries.find(entry => entry.path === path)?.workflow
    if (!path || !workflow) return <Text dimColor>No workflow selected. Run /convey.</Text>

    /**
     * A field: its title on one line, in the accent color so it reads apart
     * from what is entered, and the control (or its loading state) indented below.
     */
    const field = (title: string, isRequired: boolean, control: ReturnType<typeof Text>) => (
      <Box flexDirection="column">
        <Box>
          <Text bold color="claude">
            {title}
          </Text>
          {isRequired && <Text color="warning"> *</Text>}
        </Box>
        <Box paddingLeft={2}>{control}</Box>
      </Box>
    )

    /** The control of one input: a text field, a select, or why its select cannot show yet. */
    const control = (name: string, input: ConveyInput) => {
      if (input.type === 'textarea') {
        const setText = (text: string) => void update($, values, entered => ({ ...entered, [name]: text }))
        return <Input key={name} value={current[name] ?? ''} onInput={setText} onSubmit={setText} />
      }

      let options: string[]
      if ('values' in input.candidates) {
        options = input.candidates.values
      } else {
        const waiting = waitingFor(input, current)
        const state = loaded[name]
        if (waiting.length > 0) return <Text dimColor>waiting for {waiting.join(', ')}</Text>
        if (!state || state.status === 'loading') return <Text dimColor>loading…</Text>
        if (state.status === 'error' || state.values.length === 0) {
          return (
            <Box gap={1}>
              <Text color="error">{state.status === 'error' ? state.error : 'no candidates'}</Text>
              <Button key={`retry:${name}`} label="Retry" onPress={() => void retry($, name)} />
            </Box>
          )
        }
        options = state.values
      }
      return (
        <Select
          key={name}
          options={options.map(value => ({ value }))}
          value={current[name]}
          onSelect={value => void pick($, name, value)}
        />
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {entries.length > 1 ? (
          field(
            'workflow',
            false,
            <Select
              key="workflow"
              options={entries.map(entry => ({ value: entry.path, label: entry.workflow.name }))}
              value={path}
              onSelect={choice => void selectWorkflow($, choice)}
            />,
          )
        ) : (
          <Text bold>{workflow.name}</Text>
        )}
        {Object.entries(workflow.inputs).map(([name, input]) =>
          field(name, !allowsEmpty(input), control(name, input)),
        )}
        <Button key="fill" label="Fill prompt" variant="primary" onPress={() => void fill($)} />
      </Box>
    )
  })
}
