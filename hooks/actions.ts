import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ConveyCandidates as Candidates, ConveyCommand as Command, ConveyEntry as Entry } from '../types'
import {
  commandArgv,
  decodeCandidates,
  dependenciesOf,
  dependentsOf,
  initialValues,
  missingRequired,
  parseTemplate,
  render,
  renderPreview,
  waitingFor,
} from './template'

export const PANE = 'convey'
export const PREVIEW_PANE = 'convey-preview'
export const DEFAULT_DIR = '.claude/convey'

const templates = atom({ plugin: 'convey', key: 'templates' } as const, [])
const selected = atom({ plugin: 'convey', key: 'selected' } as const, null)
const values = atom({ plugin: 'convey', key: 'values' } as const, {})
const candidates = atom({ plugin: 'convey', key: 'candidates' } as const, {})
const submits = atom({ plugin: 'convey', key: 'submits' } as const, {})

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Reads `target` (a file, or a directory whose files are each tried) and keeps
 * what parses as a template; the rest is reported as skipped.
 */
export async function loadTemplates($: EngineInterface, target: string) {
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
      entries.push({ path, template: parseTemplate(await $.fs.read(path)) })
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

// A function declaration, not a const: $ is followed past an import only into these.
export async function selectedEntry($: EngineInterface) {
  const path = await read($, selected)
  return (await read($, templates)).find(entry => entry.path === path)
}

/**
 * Loads one command-backed select with the current values. The result is kept
 * only while the same template is shown and the values the command ran with
 * are still the current ones, so a slow command cannot overwrite a newer form.
 *
 * Once kept, `initial` (the input's default) is picked if the input has no value
 * and the candidates hold it, and then whatever depends on it loads, as after a pick.
 */
async function loadCandidates(
  $: EngineInterface,
  path: string,
  name: string,
  command: Command,
  dependsOn: string[],
  initial: string | undefined,
) {
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
  // Set on each try of the update, so it ends up telling whether the written one kept the result.
  let isKept = false
  await update($, candidates, loaded => {
    isKept = loaded[name]?.status === 'loading'
    return isKept ? { ...loaded, [name]: result } : loaded
  })
  if (!isKept || result.status !== 'ready' || initial === undefined || !result.values.includes(initial)) return
  if ((await read($, selected)) !== path || (await read($, values))[name]) return
  await update($, values, entered => (entered[name] ? entered : { ...entered, [name]: initial }))
  await loadReadyCandidates($)
}

/** Starts every command-backed select whose dependencies have values and whose candidates are not loaded. */
async function loadReadyCandidates($: EngineInterface) {
  const entry = await selectedEntry($)
  if (!entry) return
  const current = await read($, values)
  const loaded = await read($, candidates)
  for (const [name, input] of Object.entries(entry.template.inputs)) {
    if (input.type !== 'select' || !('command' in input.candidates) || loaded[name]) continue
    if (waitingFor(input, current).length > 0) continue
    void loadCandidates($, entry.path, name, input.candidates.command, dependenciesOf(input), input.default)
  }
}

/** Keeps the templates `/convey` found and shows the first one's form. */
export async function showTemplates($: EngineInterface, entries: Entry[]) {
  await update($, templates, () => entries)
  if (entries[0]) await selectTemplate($, entries[0].path)
}

/** What the form pane draws from. The state is read here, in the file that declares it. */
export async function readForm($: EngineInterface) {
  return {
    entries: await read($, templates),
    path: await read($, selected),
    current: await read($, values),
    loaded: await read($, candidates),
    submitted: await read($, submits),
  }
}

/**
 * The preview of the chosen template with the current values, as runs whose
 * inputs still to fill are marked `‹name›` (see renderPreview), or null when none is chosen.
 */
export async function previewText($: EngineInterface) {
  const entry = await selectedEntry($)
  return entry ? renderPreview(entry.template, await read($, values)) : null
}

/**
 * Shows a template's form, starting at its defaults, and loads its command candidates
 * (whose own defaults are picked as they load).
 */
export async function selectTemplate($: EngineInterface, path: string) {
  await update($, selected, () => path)
  const entry = await selectedEntry($)
  await update($, values, () => (entry ? initialValues(entry.template) : {}))
  await update($, candidates, () => ({}))
  await update($, submits, () => ({}))
  await loadReadyCandidates($)
}

/** The preview tab's title, which names the template it shows. */
export const previewTitle = (name: string) => `preview: ${name}`

/**
 * Switches the form to another template from the chooser. An open preview
 * tab is retitled (opening an open id only retitles it); a closed one stays closed.
 */
export async function chooseTemplate($: EngineInterface, path: string) {
  await selectTemplate($, path)
  const entry = await selectedEntry($)
  if (!entry) return
  if ((await $.ui.panes()).some(pane => pane.id === PREVIEW_PANE)) {
    await $.ui.open({ id: PREVIEW_PANE, title: previewTitle(entry.template.name) })
  }
}

/** Saves what is typed into a text field. */
export async function enter($: EngineInterface, name: string, text: string) {
  await update($, values, entered => ({ ...entered, [name]: text }))
}

/**
 * Saves a text field's value on Enter and counts the press. The surface empties
 * a field on Enter, and an unchanged value would not draw it again, so the count
 * goes into the field's key (see form.tsx), drawing a new field with the value.
 */
export async function submit($: EngineInterface, name: string, text: string) {
  await enter($, name, text)
  await update($, submits, counted => ({ ...counted, [name]: (counted[name] ?? 0) + 1 }))
}

/** Saves a select's value, clears every input that depends on it, and loads what can now load. */
export async function pick($: EngineInterface, name: string, value: string) {
  const entry = await selectedEntry($)
  if (!entry) return
  const dependents = dependentsOf(entry.template, name)
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
export async function retry($: EngineInterface, name: string) {
  await update($, candidates, loaded => {
    const next = { ...loaded }
    delete next[name]
    return next
  })
  await loadReadyCandidates($)
}

/** Shows a failed select's whole error, or only its first line again. */
export async function toggleError($: EngineInterface, name: string) {
  await update($, candidates, loaded => {
    const state = loaded[name]
    if (state?.status !== 'error') return loaded
    return { ...loaded, [name]: { ...state, isExpanded: !state.isExpanded } }
  })
}

export async function fill($: EngineInterface) {
  const entry = await selectedEntry($)
  if (!entry) return
  const current = await read($, values)
  const missing = missingRequired(entry.template, current)
  if (missing.length > 0) {
    $.ui.toast(`Required: ${missing.join(', ')}`)
    return
  }
  await $.prompt.fill({ text: render(entry.template, current), mode: 'replace' })
  await update($, values, () => ({}))
  await $.ui.close({ id: PANE })
  // The plugin's own $.ui.close skips its own ui.close hook, so the preview goes here
  // too; caught, as in that hook, since the prompt is already filled by now.
  await $.ui.close({ id: PREVIEW_PANE }).catch(() => {})
}
