# convey template reference

## Fields

A template is a YAML mapping with exactly these fields. Anything else, at any
level, is rejected as `unknown field in <where>: <key>`.

| Field | Required | Checks |
| --- | --- | --- |
| `name` | yes | a non-empty string; the name shown in the template chooser and the preview tab |
| `inputs` | yes | a mapping with at least one input, keyed by input name; the form lists them in this order |
| `output.template` | yes | a non-empty string, rendered with Mustache into the prompt |

### An input

| Field | Applies to | Checks |
| --- | --- | --- |
| `type` | both | `select` or `textarea` |
| `allow_empty` | both | `true` or `false`, default `true`; `false` makes the input required (a yellow ` *`, and Fill refuses while it is empty or blank) |
| `description` | both | a non-empty string, optional; shown dim under the input's title to say what to enter, and never put in the prompt |
| `placeholder` | textarea only | a non-empty string, the dim hint shown while the field is empty (default `Enter <name>…`); never a value and never in the prompt; a select with it is an error |
| `default` | both | a string, optional and not Mustache; the value the input starts with each time the form opens, which Fill inserts if left unchanged. With `candidates.values` it must be one of them; with `candidates.command` it is picked when the candidates load, if it is among them and nothing is picked yet, and otherwise the input stays empty |
| `candidates` | select only | a mapping with exactly one of `values` or `command`; a textarea with it is an error |
| `candidates.values` | select | a non-empty list of strings |
| `candidates.command.program` | select | a non-empty string |
| `candidates.command.args` | select | a list of strings, optional |
| `depends_on` | select only | a list of names of select inputs listed before this one; a textarea with it is an error |

## Command candidates

- The command runs **without a shell**: `program` is the executable and each of
  `args` is one argument as is. There are no pipes, `&&`, redirects, globs, `~`
  or `$VAR`. To filter, use the program's own options (`--format`, `-o
  jsonpath=…`, `--sort`), not `| grep`.
- `program` and every arg are Mustache templates over the values:
  `"{{ inputs.context }}"`. An arg that renders empty is dropped, so a section
  can leave an option out: `"{{#inputs.ns}}--namespace={{ inputs.ns }}{{/inputs.ns}}"`.
- Each non-empty line of stdout, trimmed, is one candidate, and the whole line
  is the value put in the prompt. A non-zero exit, or more than 30 seconds,
  shows as an error with a Retry button.
- A command with `depends_on` waits ("waiting for …") until every dependency
  has a value, and picking a dependency again clears it and runs it again, as
  it does for anything depending on it in turn. List every input a command's
  args use in its `depends_on`.
- Quote args that YAML would read as another type: `"20"`, `"true"`, and any arg
  holding `{{`, `: ` or a leading `-`… that YAML might misread is safest quoted.
  Single quotes keep backslashes as written, so an arg such as a format string
  with `\n` in it reaches the program unchanged; single braces in it are not
  Mustache, which reads only `{{ }}`.
- Make each line exactly the value the prompt needs. When a command prints more
  than that (a `kind/` prefix, a header row, extra columns), use the program's
  own output options to print only the value, rather than leaving the extra text
  in every candidate.

## Output template

- `{{ inputs.<name> }}` is the value, unescaped; an input with no value renders
  as an empty string.
- `{{#inputs.<name>}}…{{/inputs.<name>}}` renders its content only when the input
  has a value; `{{^inputs.<name>}}…{{/inputs.<name>}}` only when it has none. Use
  these for optional inputs, so the prompt has no empty `- Commit: ` line.
- The rendered text replaces what is in the prompt box when Fill is pressed.
  Write it as the prompt itself: Markdown headings and lists read well.
