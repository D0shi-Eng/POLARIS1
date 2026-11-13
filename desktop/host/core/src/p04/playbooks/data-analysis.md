---
id: polaris.playbook.data-analysis
name: Data analysis
description: Analyse a CSV or spreadsheet with Python, report measured numbers and charts.
version: 1.0.0
publisher: POLARIS
license: Apache-2.0
when_to_use: the user attaches data or asks for totals, trends, comparisons or a chart
required_tools: polaris.execution.python, polaris.workspace.read
---
# Data analysis

1. Read the file first: column names, row count, types, missing values, and five sample rows. Print them with Python; do not guess the shape.
2. State the question as a computation (for example: total sales by month, 2025 only).
3. Clean only what blocks the computation, and print what you changed (rows dropped, values converted).
4. Compute with Python in the sandbox and print the exact results. Every number in your reply must come from printed output.
5. If a chart helps, save it as PNG under `outputs/` or put it in a spreadsheet with `create_spreadsheet`.
6. Reply with the method in one line, the key numbers, the files you produced, and any limitation of the data.
