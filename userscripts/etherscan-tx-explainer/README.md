# Etherscan Tx Explainer

在 Etherscan 系列瀏覽器的交易頁加上「AI 交易解讀」面板：收集頁面資料，再視設定補上 Etherscan API 的 receipt logs 與 trace RPC 的 call tree，交給 LLM 解釋交易意圖、資產流動與風險。沒有 API key 時也能「複製 prompt」或「送到 Gemini」。

- **狀態**：v0.1 實驗性。單元測試涵蓋純資料處理；DOM 擷取以 2024 年的 Etherscan 頁面快照驗證過，尚未在真實 Tampermonkey／Violentmonkey 安裝下逐站驗證。
- **目標網站**：`/tx/<hash>` 頁面，包含 [etherscan.io](https://etherscan.io/)、sepolia.etherscan.io、basescan.org、arbiscan.io、optimistic.etherscan.io、polygonscan.com、bscscan.com；另在 [Gemini Web](https://gemini.google.com/app) 負責填入交接的 prompt。
- **安裝**：[安裝腳本](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/etherscan-tx-explainer/etherscan-tx-explainer.user.js)（需 Tampermonkey／Violentmonkey）。
- **原始碼**：[`etherscan-tx-explainer.user.js`](./etherscan-tx-explainer.user.js)

## 使用方式

1. 開啟任一筆交易，Overview 分頁上方會出現「AI 交易解讀」面板。
2. **免設定**：點「複製 prompt」貼到任何聊天介面；或點「送到 Gemini」，腳本會開新分頁並填入 Gemini 輸入框，**不會自動送出**，確認後再自己按送出。prompt 同時放在剪貼簿當備援。
3. **直接在頁面上解釋**：點「設定」選擇 LLM 後端、按「取得模型」選 model，儲存後點「解釋」。結果依鏈與 tx hash 快取（最多 50 筆），再點「重新產生」才會重新呼叫。
4. 選單指令（manager 圖示）也有「解釋這筆交易」、「複製 prompt」、「設定」。

## 資料分層

| 層 | 需要 | 內容 |
| --- | --- | --- |
| 頁面 DOM | 無 | overview 每一列（From／To、Value、Fee、Transaction Action、ERC-20 轉帳等，數量已由瀏覽器換算 decimals）、地址標籤、raw／decoded input data |
| Etherscan API V2 | [Etherscan API key](https://etherscan.io/myapikey) | `eth_getTransactionByHash`、`eth_getTransactionReceipt`（logs，常見 event 加上 signature 提示）、`txlistinternal` |
| Trace | 支援 debug／trace 的 RPC URL | 先試 `debug_traceTransaction`（`callTracer`），失敗再試 `trace_transaction`；去掉 gas、截短 calldata，依 BFS 順序收進字數預算 |

- 一把 Etherscan V2 key 可查各鏈，`chainid` 由網址自動判斷；免費方案不一定涵蓋所有鏈，失敗時面板會顯示原因並退回頁面資料。
- Trace RPC URL 只對**一條鏈**有效；在 basescan 使用 mainnet 的 RPC 只會查不到。
- 「資料字數上限」（預設 60,000）控制送給模型的資料量；超過時 trace 與 logs 會截斷，prompt 內會標註 `truncated`／`omittedCalls`，並要求模型說明結論可能不完整。

## LLM 後端

| 連線預設 | endpoint | Key 與 model |
| --- | --- | --- |
| Copilot API · ericc-ch（4141，預設） | `http://localhost:4141/v1/chat/completions` | 先啟動本機 [copilot-api](https://github.com/ericc-ch/copilot-api)：`npx copilot-api@latest start --port 4141` |
| Copilot SDK Proxy · rezrov（3001） | `http://localhost:3001/v1/chat/completions` | 先完成 [copilot-proxy](https://github.com/rezrov/copilot-proxy)／Copilot CLI 登入 |
| LiteLLM（4000） | `http://localhost:4000/chat/completions` | proxy 要求的 key（若有）與 model alias |
| Gemini BYOK | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | [Gemini API key](https://aistudio.google.com/apikey) |
| OpenRouter BYOK | `https://openrouter.ai/api/v1/chat/completions` | [OpenRouter key](https://openrouter.ai/keys) |
| OpenAI BYOK | `https://api.openai.com/v1/chat/completions` | [OpenAI key](https://platform.openai.com/api-keys) |
| Anthropic Claude BYOK | `https://api.anthropic.com/v1/messages` | [Anthropic key](https://console.anthropic.com/settings/keys)；使用原生 Messages API，不經 OpenAI 相容層 |
| 自訂 OpenAI-compatible | 自填 | 自填 |

- copilot-api／copilot-proxy 是非 GitHub 官方的 reverse-engineered 專案，接口與可用性可能變動；不要把 GitHub 登入 token 貼進 API key 欄位。
- 各服務分開保存 endpoint、model 與 key。endpoint 換到不同 origin 或 API base path 時，沒有重新輸入的舊 key 會被清空，不會送到新服務。
- 「取得模型」只做 GET；「測試模型」會送一則固定短文字，可能產生少量費用。
- 自訂 endpoint 的網域不在 `@connect` 清單時，manager 會在第一次請求時詢問是否允許。

## 安全與隱私

- **key 存在 manager 的 GM storage，未加密**。同一個 manager 中的其他腳本無法讀取，但能讀取瀏覽器 profile 的程式可以。不要用權限過大的 key，並為 BYOK key 設定用量上限。
- **Trace RPC URL 本身就是 secret**（Alchemy、QuickNode 把 key 放在路徑裡），設定欄位以密碼方式顯示。
- **鏈上字串不可信**：token 名稱、地址標籤、input data、revert 訊息都可能由攻擊者寫入，例如偽裝成「請前往某網址領取空投」的指令。prompt 會把所有資料包在 `<tx_data>` 內並要求模型只當資料；模型回覆以純文字元素渲染，不執行 HTML，連結也只顯示文字、不可點擊。模型的判讀仍可能出錯，**不要只憑解讀結果簽署交易或授權**。
- 交易資料會送到你選的 LLM 後端；本機 proxy 只代表第一站在本機，之後是否送往雲端由 upstream 決定。

## 限制

- 不做模擬（fork／what-if），也不查 ABI；calldata 由模型自行判讀，複雜的 aggregator／MEV 交易在截斷後可能解讀不完整。
- DOM 擷取依賴 Etherscan 的 overview 版面（`#ContentPlaceHolder1_maintable` 內的 `col-md-3`／`col-md-9` 列）；改版時頁面層可能抓不到欄位，API 與 trace 層不受影響。
- Gemini 交接只填入不送出；Gemini 改版找不到輸入框時，改用剪貼簿手動貼上。

## 開發

```bash
npm run test:etherscan-tx-explainer   # CORE／PROVIDERS 區塊的單元測試
npm run check
```
