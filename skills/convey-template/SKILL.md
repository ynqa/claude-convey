---
name: convey-template
description: Write or fix a template for the convey plugin's /convey form, a YAML file under .claude/convey that turns picked and typed values into a prompt. Use when the person asks to create, change or debug a convey template, a /convey form, or a file in .claude/convey, or when /convey reports a template as skipped.
---

# Writing a convey template

A convey template is a YAML file under `.claude/convey/` (the default folder of
`/convey`). `/convey` shows its `inputs` as a form, the person picks or types
each value, and Fill renders `output.template` with those values into the prompt
box. The point is that the person decides values an agent should not guess (the
cluster, the branch, the commit), so a good template asks for exactly those.

## Steps

1. **Ask what the prompt is for**, and which values the person wants to choose
   each time rather than leave to you. Each such value is one input. Ask where
   its choices come from: a fixed list, or a command whose output lists them.
2. **Try every candidate command in Bash first**, with real values for the
   inputs it depends on. It must print one candidate per line and exit 0; fix
   it until it does (`-o name`, `--format=…`, a jsonpath with `{"\n"}`). It runs
   without a shell, so no pipes, `&&`, globs or `$VAR` (see reference.md).
3. **Start from `skeleton.yaml`** in this skill's folder: copy it to
   `.claude/convey/<name>.yaml` and fill it in, deleting the inputs not needed.
   Keep the inputs in the order the person should fill them; an input that
   `depends_on` another comes after it.
4. **Check it with `/convey .claude/convey/<name>.yaml`** (ask the person to run
   it). A file that does not parse is reported as `skipped <path>: <reason>`;
   fix that reason and run it again. Once the form opens, the preview tab shows
   the rendered prompt with what is still to fill marked `‹name›`.

## Rules that differ from convey

These templates are convey's YAML format, read by this plugin's own parser.
Where it is stricter or different, follow it:

- Only `name`, `inputs` and `output.template` exist; **any other field is an
  error** (no `description`, `default`, `placeholder`, `multiselect`).
- Conditionals are **Mustache sections**, `{{#inputs.x}}…{{/inputs.x}}` (shown
  when `x` has a value) and `{{^inputs.x}}…{{/inputs.x}}` (when it has none),
  not `{{#if}}`.
- `depends_on` may name **only select inputs listed earlier**, never a textarea.
- Nothing is HTML-escaped; values go into the prompt exactly as entered.

reference.md lists every field with its checks, and the rules for command
candidates and the output template.
