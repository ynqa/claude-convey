import type { Elements, EngineInterface } from 'claude-code'

import { previewText } from './actions'

/**
 * The preview tab: the chosen template rendered with the current values, as the
 * plain text Fill puts in the prompt box (not Markdown, which cannot color a
 * part). Entered values are in the success color, as the form's ✓ marks, and
 * each input still to fill is `‹name›` in the warning color.
 */
export async function Preview($: EngineInterface, { Text }: Elements[keyof Elements]) {
  const parts = await previewText($)
  if (parts === null) return <Text dimColor>No template selected.</Text>
  return (
    <Text>
      {parts.map(part =>
        part.kind === 'text' ? part.text : <Text color={part.kind === 'filled' ? 'success' : 'warning'}>{part.text}</Text>,
      )}
    </Text>
  )
}
