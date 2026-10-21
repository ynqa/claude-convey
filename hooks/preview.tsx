import type { Elements, EngineInterface } from 'claude-code'

import { renderedPrompt } from './actions'

/** The preview tab: the chosen prompt template rendered with the current values. */
export async function Preview($: EngineInterface, { Markdown, Text }: Elements[keyof Elements]) {
  const text = await renderedPrompt($)
  if (text === null) return <Text dimColor>No prompt template selected.</Text>
  return <Markdown text={text.trimEnd()} />
}
