---
id: polaris.playbook.word-document
name: Word document
description: Write a structured, readable Word (.docx) document and verify it.
version: 1.0.0
publisher: POLARIS
license: Apache-2.0
when_to_use: the user wants a document, letter, summary, plan or report they can open in Microsoft Word
required_tools: polaris.artifact.document
---
# Word document

1. Decide the reader and the purpose; pick a title that says what the document is.
2. Structure: title, a short opening paragraph, 2–6 headed sections, and a closing section (next steps or conclusion). Keep paragraphs under six lines; use bullet lists for parallel items and a table for comparisons.
3. Write in the user's language. For Arabic, write right-to-left text naturally; keep numbers and product names as the user wrote them.
4. Create the file with `create_document` under `outputs/`, with a short file name that describes the content.
5. Re-open it with `read_file` and check that every section you planned is present and that nothing is cut off.
6. Reply with the file name and a 2–3 line description of what is inside.
