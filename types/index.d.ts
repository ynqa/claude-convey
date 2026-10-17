/** The values entered in the form, keyed by input name. */
export type ConveyValues = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    convey: { values: ConveyValues }
  }
}
