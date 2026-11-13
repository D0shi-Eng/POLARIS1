---
id: polaris.playbook.research-report
name: Research report
description: Research a topic on the web and write a sourced report (Word or PDF).
version: 1.0.0
publisher: POLARIS
license: Apache-2.0
when_to_use: the user asks to research, look up, compare or summarise current information and deliver a report
required_tools: polaris.web.search, polaris.web.read_page
---
# Research report

1. Restate the question in one sentence and list the 2–4 facts the report must establish.
2. Search with `web_search` using specific queries (names, dates, numbers). Prefer primary sources: official sites, filings, standards, papers.
3. Open at least three distinct sources with `read_web_page`. Note for each: URL, publisher, date, and the exact claim it supports.
4. Separate what sources agree on from what only one source says, and say which is which in the report.
5. Write the report: title, summary (3–5 sentences), findings with an inline citation `[n]` after every factual sentence, open questions, and a numbered source list with URLs and access date.
6. Produce the file the user asked for (`create_document` for Word; a PDF if asked). Re-open it with `read_file` to check it before you reply.
7. In your reply, name the file and state any claim you could not verify. Never cite a page you did not open in this mission.
