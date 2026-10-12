# ChatGPT 匯出的 Markdown 裡 code block 整段消失、只剩空行

**症狀**：`chatgpt-export-markdown` ≤ v1.4.0 匯出 GPT-6（Intelligent UI）回覆時，
「例如：」「如下：」之後只剩兩、三個空行，原本的 ` ```bash ` 等 code fence 不見了。
同一份輸出裡還混著 `<box>`、`<row>`、`<Cite ref="turn…"/>`、`<AsyncImage …/>` 原始標記。

**原因**（兩個獨立問題）：

1. `metadata.content_references` 出現新型別：

   ````json
   {
     "type": "client_defined_widget",
     "category": "code_block",
     "matched_text": "```jsx\n…\n```",
     "alt": null,
     "start_idx": 327,
     "end_idx": 476
   }
   ````

   `applyCitations` 把每個 ref 的 `matched_text` 換成 `alt`。`alt` 是 null 就換成空字串，
   於是整段 code 被刪掉。`parts[0]` 裡的 code 其實完好。

2. Intelligent UI 的 `content.parts[0]` 是 DIL JSX，不是 Markdown。降級好的版本放在
   `metadata.model_dil_v2.fallbackMarkdown`。

**解法**（v1.5.0，`shared/chatgpt-adapter.js`）：

- `applyCitations` 跳過 `client_defined_widget`。
- 有 `fallbackMarkdown` 時，`markdownOf()` 改用它，再解 `url`／`cite`／`entity`／`image_group` sentinel。
  這時不套用 `content_references`：它的 index 指向 `parts[0]`，不是 fallback。

**預防**：

- 換 sentinel 或 ref 前先問：這個 ref 的 `alt` 是不是可讀的替代文字？不是的話，保留原文。
- 遇到新的 `metadata.*` 欄位，先下載 **Download .json** 用 `jq` 看
  `.mapping[].message.metadata | keys`。不要只看匯出的 Markdown 猜。
- 回歸 fixture：`tests/fixtures/chatgpt-export/intelligent-ui.json`。
