Output tapes/demo.gif

Require claude

Set Shell "bash"
Set Theme "Dracula"
Set FontSize 18
Set Width 1400
Set Height 900

# Start Claude Code with this plugin, outside any other session's environment.
Hide
Type `clear && env -i HOME="$HOME" PATH="$PATH" TERM="$TERM" USER="$USER" LANG=en_US.UTF-8 DISABLE_AUTOUPDATER=1 claude --plugin-dir .` Enter
Sleep 8s
Show

# Open the form with the example templates.
Type@50ms "/convey examples" Sleep 500ms
Enter Sleep 3s

# Pick a branch; the commits of that branch load.
Tab Sleep 300ms
Tab Sleep 1500ms
Enter Sleep 2s

# Pick a commit.
Tab Sleep 2s
Down@300ms 2 Sleep 1s
Enter Sleep 1500ms

# Write the request; Enter moves on to Fill.
Tab Sleep 500ms
Type@50ms "Check this commit for bugs" Sleep 1s
Enter Sleep 1500ms

# Check the prompt in the preview tab before filling it in.
Ctrl+X Sleep 200ms
Tab Sleep 3500ms

# Back to the form: ctrl+x tab twice more, which leaves the focus on the
# template chooser, then Tab through branch, commit and request to Fill.
Ctrl+X Sleep 200ms
Tab Sleep 300ms
Ctrl+X Sleep 200ms
Tab Sleep 1500ms
Tab@400ms 5 Sleep 1s

# Fill puts the prompt in Claude Code's prompt box (it is not sent).
Enter Sleep 4s
