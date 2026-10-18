import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { missingRequired, render, type Workflow } from './workflow'

const PANE = 'convey'

// A hard-coded workflow for now; a later step loads it from YAML.
const WORKFLOW: Workflow = {
  name: 'incident-summary',
  inputs: [
    { name: 'environment', type: 'select', allowEmpty: true, values: ['development', 'staging', 'production'] },
    { name: 'request', type: 'textarea', allowEmpty: false },
  ],
  template: `# Incident request

- Environment: \`{{ inputs.environment }}\`

{{ inputs.request }}`,
}

const values = atom({ plugin: 'convey', key: 'values' } as const, {})
const missing = atom({ plugin: 'convey', key: 'missing' } as const, [])

async function setValue($: EngineInterface, name: string, value: string) {
  await update($, values, current => ({ ...current, [name]: value }))
  await update($, missing, names => names.filter(missingName => missingName !== name))
}

async function fill($: EngineInterface) {
  const current = await read($, values)
  const empty = missingRequired(WORKFLOW, current)
  if (empty.length > 0) {
    await update($, missing, () => empty)
    return
  }
  await $.prompt.fill({ text: render(WORKFLOW.template, current), mode: 'replace' })
  await update($, values, () => ({}))
  await $.ui.close({ id: PANE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'convey', description: 'Fill a workflow form' })
    return next(e)
  })

  on('command.run', { command: 'convey' }, async $ => {
    await $.ui.open({ id: PANE, title: 'convey', focus: true, closeOnEscape: true })
    return { text: 'convey: opened' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    if (!('Input' in elements) || !('Select' in elements)) {
      const { Text } = elements
      return <Text dimColor>convey needs a surface with text fields.</Text>
    }
    const { Box, Text, Button, Input, Select } = elements
    const current = await read($, values)
    const empty = await read($, missing)

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{WORKFLOW.name}</Text>
        {WORKFLOW.inputs.map(input => {
          const label = input.allowEmpty ? input.name : `${input.name} *`
          return input.type === 'select' ? (
            <Select
              key={input.name}
              label={label}
              options={input.values.map(value => ({ value }))}
              value={current[input.name]}
              onSelect={value => void setValue($, input.name, value)}
            />
          ) : (
            <Input
              key={input.name}
              label={label}
              value={current[input.name] ?? ''}
              onInput={text => void setValue($, input.name, text)}
              onSubmit={text => void setValue($, input.name, text)}
            />
          )
        })}
        {empty.length > 0 && <Text color="error">Required: {empty.join(', ')}</Text>}
        <Button key="fill" label="Fill prompt" variant="primary" onPress={() => void fill($)} />
      </Box>
    )
  })
}
