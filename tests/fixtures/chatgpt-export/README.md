# Multiple Deep Research fixture

`multiple-research.json` is a synthetic, minimized conversation graph modeled on
[the PRL shared conversation](https://chatgpt.com/share/6aa7981a-5b34-83ee-b1cc-1b0b3fc0b91b),
inspected on 2026-09-14 against exporter v1.3.0. Report prose and identifiers in
the fixture are synthetic; no full research report is checked in.

The original has two tool hosts with separate `widget_session_id` and
`report_message.id`, but both reports use plan ID
`plan-2026-09-14T02:00:00Z-prlmining`. The final report is serialized in
`metadata.chatgpt_sdk.widget_state`; `tool_response_metadata.venus_widget_state`
still contains the initial pending plan. Both reports exist in the selected
`linear_conversation` and its equivalent `mapping` parent chain.

The fixture retains those relationships and adds a synthetic unselected branch,
one citation, a whitespace source footnote, a table, and a code fence. The tests
modify copies to exercise repeated snapshots, missing IDs, and malformed states.

- Source payload SHA-256 (decoded JSON, UTF-8, indent 2, trailing newline):
  `be27b0e537401c95c5771eb75fba0dd6f961618acdeefe645b7cc071d302fb86`
- Fixture SHA-256:
  `5a38f8739d263abb96d64cd09e5bb057e81cbcf9087047d6a21aeef241186725`

The shared page can change or become unavailable. This fixture verifies the
observed data model; it is not evidence that live browser or manager behavior
has been tested by itself.

# Intelligent UI fixture

`intelligent-ui.json` is a minimized `/backend-api/conversation` payload modeled on a
GPT-6 Intelligent UI conversation (`6acc3fda-1f7c-83ec-95ad-546e1dce36e1`, exported raw on
2026-10-12 and inspected against exporter v1.4.0). The source payload is not checked in.

Observed in the source and kept here:

- `metadata.model_dil_v2` with `code`, `constants`, `appData.opGenui.componentResults`,
  `clientDefinedWidgets`, `fallbackMarkdown` and `fallbackMarkdownVersion: 1`.
  `content.parts[0]` holds DIL JSX (`<row>`, `<AsyncImage/>`, `<Link/>`, `<Cite/>`, `<Entity/>`).
- `fallbackMarkdown` sentinels of four kinds: `url`, `cite` (several refs), `entity`
  (JSON array) and `image_group` (JSON with `query`). `AsyncImage` results are reached through
  `"__resolutionId":__dilConstants["N"]` in `code`; Cite results carry `state.items[].ref_id`.
- `content_references` of type `client_defined_widget` / `category: "code_block"`, whose
  `matched_text` is a whole code fence and whose `alt` is `null`. v1.4.0 replaced it with an
  empty string and deleted the code.
- A user `image_asset_pointer` (`sediment://file_…`) with its `metadata.attachments` entry.

The component results, image and citation URLs are copied from the source. The message text,
DIL `code` excerpt and IDs are shortened or synthetic. Two cases are synthetic: the `cite`
ref resolvable only through `search_result_groups`, plus an unresolvable ref, and the
non-DIL assistant message carrying a code-block widget. The source did not contain them.

- Source payload SHA-256 (raw download as saved):
  `9ef200d9e087ce077b043eab64140246af1e23a7d2ada75a1d4ccc0eab43f0c8`
- Fixture SHA-256:
  `d1969edbcd1184d76e72859dcccf120ef20d9e392d16b10e021a6c798954635d`

This verifies the observed data model only. Image downloads were tested against mocked
endpoints, not a logged-in ChatGPT session.
