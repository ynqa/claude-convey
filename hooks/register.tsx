import type { Register } from 'claude-code'

const PANE = 'convey'

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
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold>convey</Text>
        <Text dimColor>The form will be drawn here. Press Esc to close.</Text>
      </Box>
    )
  })
}
