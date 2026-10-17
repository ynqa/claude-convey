import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ConveyValues } from '../types'

const PANE = 'convey'

// A hard-coded workflow for now; later steps load it from YAML.
const ENVIRONMENTS = ['development', 'staging', 'production']
const compose = (values: ConveyValues) =>
  `# Incident request

- Environment: \`${values.environment ?? ''}\`

${values.request ?? ''}`

const values = atom({ plugin: 'convey', key: 'values' } as const, {})

const setValue = ($: EngineInterface, name: string, value: string) =>
  update($, values, current => ({ ...current, [name]: value }))

async function fill($: EngineInterface) {
  await $.prompt.fill({ text: compose(await read($, values)), mode: 'replace' })
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

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>incident-summary</Text>
        <Select
          key="environment"
          label="environment"
          options={ENVIRONMENTS.map(value => ({ value }))}
          value={current.environment}
          onSelect={value => void setValue($, 'environment', value)}
        />
        <Input
          key="request"
          label="request"
          value={current.request ?? ''}
          onInput={text => void setValue($, 'request', text)}
          onSubmit={text => void setValue($, 'request', text)}
        />
        <Button key="fill" label="Fill prompt" variant="primary" onPress={() => void fill($)} />
      </Box>
    )
  })
}
