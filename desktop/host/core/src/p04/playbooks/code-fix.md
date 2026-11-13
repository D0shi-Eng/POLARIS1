---
id: polaris.playbook.code-fix
name: Code fix
description: Reproduce a bug, make the smallest fix, and prove it with the project's tests.
version: 1.0.0
publisher: POLARIS
license: Apache-2.0
when_to_use: the user asks to review code, fix a bug or make failing tests pass
required_tools: polaris.workspace.read, polaris.workspace.write, polaris.execution.python
---
# Code fix

1. List the project files and read the ones the problem points to. Do not change anything yet.
2. Reproduce: run the failing test or the command that shows the bug, and keep its output.
3. Find the cause in the code and say it in one sentence before editing.
4. Make the smallest change that fixes the cause. Do not reformat unrelated code.
5. Run the same test again, then the whole test suite. A fix counts only when the output shows the tests passing.
6. Reply with the cause, the files changed, and the test output summary (passed/failed counts). If tests still fail, say so.
