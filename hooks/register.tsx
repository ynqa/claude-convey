import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ConveyEntry as Entry } from '../types'
import { allowsEmpty, missingRequired, parseWorkflow, render } from './workflow'

const PANE = 'convey'
const DEFAULT_DIR = '.claude/convey'

const workflows = atom({ plugin: 'convey', key: 'workflows' } as const, [])
const selected = atom({ plugin: 'convey', key: 'selected' } as const, null)
const values = atom({ plugin: 'convey', key: 'values' } as const, {})

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

/** Shows a workflow's form, starting empty. */
async function selectWorkflow($: EngineInterface, path: string) {
  await update($, selected, () => path)
  await update($, values, () => ({}))
}

async function fill($: EngineInterface) {
  const path = await read($, selected)
  const entry = (await read($, workflows)).find(candidate => candidate.path === path)
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
    const workflow = entries.find(entry => entry.path === path)?.workflow
    if (!workflow) return <Text dimColor>No workflow selected. Run /convey.</Text>

    return (
      <Box flexDirection="column" gap={1}>
        {entries.length > 1 ? (
          <Select
            key="workflow"
            label="workflow"
            options={entries.map(entry => ({ value: entry.path, label: entry.workflow.name }))}
            value={path ?? undefined}
            onSelect={choice => void selectWorkflow($, choice)}
          />
        ) : (
          <Text bold>{workflow.name}</Text>
        )}
        {Object.entries(workflow.inputs).map(([name, input]) => {
          const label = allowsEmpty(input) ? name : `${name} *`
          const setValue = (value: string) => void update($, values, entered => ({ ...entered, [name]: value }))
          return input.type === 'select' ? (
            <Select
              key={name}
              label={label}
              options={input.candidates.values.map(value => ({ value }))}
              value={current[name]}
              onSelect={setValue}
            />
          ) : (
            <Input key={name} label={label} value={current[name] ?? ''} onInput={setValue} onSubmit={setValue} />
          )
        })}
        <Button key="fill" label="Fill prompt" variant="primary" onPress={() => void fill($)} />
      </Box>
    )
  })
}
