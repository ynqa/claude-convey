import type { Register } from 'claude-code'

import { DEFAULT_DIR, PANE, PREVIEW_PANE, loadPromptTemplates, message, showPromptTemplates } from './actions'
import { Form } from './form'
import { Preview } from './preview'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'convey',
      description: `Fill a prompt template (default: ${DEFAULT_DIR})`,
    })
    return next(e)
  })

  on('command.run', { command: 'convey' }, async ($, e) => {
    const target = e.args.trim() || DEFAULT_DIR
    let loaded: Awaited<ReturnType<typeof loadPromptTemplates>>
    try {
      loaded = await loadPromptTemplates($, target)
    } catch (error) {
      return { text: `convey: cannot read ${target}: ${message(error)}` }
    }
    const { entries, skipped } = loaded
    const notes = skipped.map(reason => `\n  skipped ${reason}`).join('')
    if (entries.length === 0) return { text: `convey: no prompt templates in ${target}${notes}` }

    await showPromptTemplates($, entries)
    // Tabs in the order convey, preview; only the form asks for the focus.
    await $.ui.open({ id: PANE, title: 'convey', focus: true, closeOnEscape: true })
    await $.ui.open({ id: PREVIEW_PANE, title: 'preview' })
    return { text: `convey: ${entries.length} prompt template(s) from ${target}${notes}` }
  })

  // When the person closes the form (Esc, the close mark), take the preview down with it.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) await $.ui.close({ id: PREVIEW_PANE })
    return closed
  })

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
