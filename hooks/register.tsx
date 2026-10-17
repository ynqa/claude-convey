import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'convey', description: 'Fill a workflow form' })
    return next(e)
  })

  on('command.run', { command: 'convey' }, async ($, e) => {
    return { text: `convey: hello (args: ${JSON.stringify(e.args)})` }
  })
}
