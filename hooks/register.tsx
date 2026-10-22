import type { Register } from 'claude-code'

import {
  DEFAULT_DIR,
  PANE,
  PREVIEW_PANE,
  loadTemplates,
  message,
  previewTitle,
  showTemplates,
} from './actions'
import { Form } from './form'
import { Preview } from './preview'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'convey',
      description: `Fill a template (default: ${DEFAULT_DIR})`,
    })
    return next(e)
  })

  on('command.run', { command: 'convey' }, async ($, e) => {
    const target = e.args.trim() || DEFAULT_DIR
    let loaded: Awaited<ReturnType<typeof loadTemplates>>
    try {
      loaded = await loadTemplates($, target)
    } catch (error) {
      return { text: `cannot read ${target}: ${message(error)}` }
    }
    const { entries, skipped } = loaded
    const notes = skipped.map(reason => `\n  skipped ${reason}`).join('')
    const [first] = entries
    if (!first) return { text: `no templates in ${target}${notes}` }

    await showTemplates($, entries)
    // Tabs in the order convey, preview; only the form asks for the focus.
    await $.ui.open({ id: PANE, title: 'convey', focus: true, closeOnEscape: true })
    await $.ui.open({ id: PREVIEW_PANE, title: previewTitle(first.template.name) })
    // The engine heads a command's reply with the plugin's name, so it is not repeated here.
    return { text: `${entries.length} template(s) from ${target}${notes}` }
  })

  // When the person closes the form (Esc, the close mark), take the preview down with it.
  // Whatever goes wrong here, the close itself goes ahead: the preview's close is
  // caught, and should the hook still fail, its catch passes the close on (next is
  // replay-safe there, so a close already made is not made again).
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) await $.ui.close({ id: PREVIEW_PANE }).catch(() => {})
    return closed
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PREVIEW_PANE }, async ($, e) => Preview($, $.ui.resolve(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    // A surface without text fields and selects (today only mobile; terminal, desktop
    // and vscode carry both) cannot draw the form, so the pane says so in one dim line
    // instead of failing. The check also narrows elements to FormElements for Form.
    if (!('Input' in elements) || !('Select' in elements)) {
      const { Text } = elements
      return <Text dimColor>convey needs a surface with text fields.</Text>
    }
    return Form($, elements, e.props.bodyColumns)
  })
}
