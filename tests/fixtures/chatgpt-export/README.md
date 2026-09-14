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
