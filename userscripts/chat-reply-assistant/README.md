# Chat Reply Assistant

在 Instagram／Messenger 的聊天頁讀取已載入的文字，用自己的 API key（BYOK）或本機 OpenAI-compatible proxy 產生三個回覆建議。可加上 Jev 的情緒／意圖提示，選中建議後複製或填入輸入框，傳送仍由你操作。

- **狀態**：v0.1 實驗性。DOM 擷取、瀏覽器與 userscript manager 的實際驗證範圍見 [VALIDATION.md](./VALIDATION.md)；尚不能承諾每個帳號的 Instagram／Messenger 版面都相容。
- **目標網站**：[Instagram Direct](https://www.instagram.com/direct/inbox/)、[Messenger](https://www.messenger.com/)、[Facebook Messages](https://www.facebook.com/messages/)，包含一對一與群組聊天。
- **安裝**：[點這裡安裝](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chat-reply-assistant/chat-reply-assistant.user.js)（需先裝好 Tampermonkey / Violentmonkey）
- **原始碼**：[`chat-reply-assistant.user.js`](./chat-reply-assistant.user.js)
- **研究**：[RESEARCH.md](./RESEARCH.md) — API、相關專案、可行性與未驗證的假設。

也可在 manager 的匯入功能選取本機 `chat-reply-assistant.user.js`。上方 Install URL 需要這次變更先發布到 GitHub `main` 才能使用；本次實作沒有自動 push。

## 它做了什麼

- 在頁面提供浮動面板，顯示捕捉到的聊天上下文及三個回覆建議。
- 區分自己與其他參與者的文字；群組預設針對整段討論，也可指定主要回覆對象。辨識不可靠時應先檢查上下文，不要把參與者名稱當成可靠的帳號識別。
- 支援全域自訂 system prompt，以及覆寫全域設定的個別聊天 prompt。例如：「用繁體中文，短句，不使用句尾標點，不加 emoji」。
- 主回覆模型使用 OpenAI-compatible Chat Completions；Jev 是獨立、預設關閉的文字判斷服務。
- 預設手動產生，可為目前聊天另外開啟自動產生。生成內容不會自動傳送。

它只讀取瀏覽器已載入的文字，不取得平台的完整聊天歷史、不操作私人 API，也不做截圖、OCR、語音轉文字或圖片理解。頁面尚未載入的舊訊息，需要你自行捲動載入。

## 使用方式

1. 安裝腳本後，開啟一個 Instagram／Messenger 對話，再打開 Chat Reply Assistant 面板。
2. 在設定中選擇 provider 預設值或填入完整 endpoint、模型名稱與 API key。模型名稱必須是帳號或本機 proxy 實際提供的名稱。
3. 檢查擷取的訊息、參與者與主要回覆對象，調整全域或目前聊天的 prompt。
4. 手動產生三個建議；需要時修改 prompt 後再產生。
5. 複製選中的建議，或填入聊天輸入框。輸入框已有草稿時，必須明確選擇附加，避免默默覆蓋原文。檢查內容後自行傳送。

每次請求預設最多使用最近 **50 則訊息、20,000 字元**；這兩個上限可設定，字元數不是 token 數。先查看面板中的上下文，確認最近訊息沒有漏掉。

### 主回覆模型

endpoint 欄位填入**完整 Chat Completions URL**；腳本不會自動補上 `/v1` 或 `/chat/completions`。

| 設定 | endpoint 範例 | key 與 model |
| --- | --- | --- |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | Gemini API key；填入可用的 Gemini model ID |
| LiteLLM | `http://localhost:4000/chat/completions` | proxy 要求的 key（若有）；填入 LiteLLM 設定中的 model alias |
| copilot-proxy（rezrov） | `http://localhost:3001/v1/chat/completions` | 先在本機完成 proxy／Copilot CLI 登入；填入 proxy 提供的 model ID |
| 其他 OpenAI-compatible 服務 | 服務實際的完整 endpoint | 依該服務要求設定 |

Gemini 使用 Google 官方的 [OpenAI compatibility API](https://ai.google.dev/gemini-api/docs/openai)。LiteLLM 的部署可能使用 `/chat/completions` 或 `/v1/chat/completions`，請以自己的 [proxy 設定](https://docs.litellm.ai/docs/proxy/quick_start)為準。`copilot-proxy` 在這裡指 [rezrov/copilot-proxy](https://github.com/rezrov/copilot-proxy)，其他同名或類似專案可能使用不同 port。

本機 proxy 需要先由你安裝、啟動並完成 upstream 認證。腳本只呼叫它的 HTTP API，不安裝 proxy、不讀取 CLI token，也不把瀏覽器登入 cookie 當成 API key。是否能使用 subscription，取決於 proxy、upstream 帳號與支援方式；有訂閱不表示任意 API 都可用或用量無限。GitHub 的 [Copilot SDK 用量文件](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing)另列 session 的用量與額度介面。

**OpenCode server 不能直接填入這個欄位**：它使用 session/message API，需要額外 bridge。這項工作記錄在 [OpenCode bridge 研究](../../backlog/chat-reply-assistant-opencode-bridge.md)。

### 遠端自訂 endpoint 與連線權限

metadata 預設只列 `generativelanguage.googleapis.com`、`api.typesafe.ai`、`localhost`、`127.0.0.1`。自訂遠端服務時，在安裝的腳本 metadata 加入該服務的 hostname，然後依 manager 提示授權。例如：

```js
// @connect      llm.example.com
```

不要加通用的 `@connect *`。也不要把 URL、path 或 API key 寫進 `@connect`；它是 host 連線權限。若 endpoint 會重新導向到另一個 host，也需要檢查實際目的地與 manager 的授權。詳細語義見 [Tampermonkey](https://www.tampermonkey.net/documentation.php#meta:connect) 與 [Violentmonkey](https://violentmonkey.github.io/api/metadata-block/#connect) 文件。更新腳本時，留意自訂 metadata 是否仍被保留。

### 可選 Jev 提示

Jev 預設關閉。啟用時填入獨立的 TypeSafe API key，model 預設為 `jev-latest`；官方 endpoint 為 `https://api.typesafe.ai/v1/systemone`。這不是一般的 Chat Completions endpoint，也不是主回覆模型的替代品。[官方 API](https://docs.typesafe.ai/api)

Jev 把聊天文字轉成有界的語氣／意圖判斷，再提供給回覆模型作為補充。結果是對文字線索的推測；不能當成對方真實情緒、人格或喜歡你的機率。中文、混合語言和反諷尤其需要自行核對，官方說明英文是目前表現最好的語言。[模型與語言支援](https://docs.typesafe.ai/models)

Jev 失敗時會退回只用主回覆模型；主模型失敗則顯示錯誤，不會自行切換到其他外部 provider。

### 自動產生

自動產生是**每個聊天個別啟用**的選項；首次開啟聊天、重新整理或建立初始訊息快照時，不會把既有訊息當成新訊息發出請求。

只有分頁可見、面板開啟、能確認位於最新訊息尾端，且辨識到新收到的訊息時才會觸發。連續訊息等待 3 秒後合併，兩次自動請求至少間隔 30 秒，同時最多一個生成流程。切到背景、關閉面板、往上查看歷史、身分辨識不明或請求錯誤時會暫停／停止排程；錯誤後需由你處理設定並重新啟用自動產生。

此開關只自動取得建議，不會按 Enter、不會點擊傳送，也不會取代你正在寫的草稿。

## 資料存放與傳送

| 資料 | 存放／用途 |
| --- | --- |
| API key、endpoint、model、全域 prompt | userscript manager 的 GM storage；不是寫入網站的 localStorage，也不是加密保管庫 |
| 個別聊天 prompt、自動產生設定 | GM storage，以站點與穩定的 thread 路由 ID／URL 區分，不用顯示名稱共用設定 |
| 擷取的聊天文字與候選回覆 | 分頁記憶體；每個聊天最多保留 500 則，最多保留最近使用的 5 個聊天 |
| 發給模型的內容 | 選定的近期文字上下文、prompt 與必要的回覆對象資訊；啟用 Jev 時，相關文字也會送到 TypeSafe |

重新整理／關閉分頁，或超出聊天記憶體上限被淘汰後，先前累積的內容會消失。腳本不是聊天備份工具。使用本機 proxy 只表示第一站在本機；proxy 是否再送到雲端，由它的 upstream 設定決定。

## 已知限制

- Instagram／Messenger 的 DOM、語系、實驗版面、虛擬化訊息列表與 rich-text 輸入框會改變；帳號間可能不同。擷取成功、正確判別發話者、填入成功都需要真實站點分別驗證。
- 只能累積已載入內容；舊訊息重載、相同文字、編輯、收回、引用回覆與系統事件可能影響去重和順序。請以面板中的上下文核對。
- 群組中未辨識的發話者會降低建議品質；這不等於已理解每位參與者的背景、關係或完整歷史。
- 只產生文字建議；不解析附件內容，不自動捲動抓取完整歷史，不自動傳送。
- 跨域、本機 HTTP、manager 權限與 proxy 認證行為不能由普通頁面的 `fetch` 測試或 GM shim 證明，請查看 [驗證紀錄](./VALIDATION.md)。Safari Userscripts、手機 App 與原生桌面 App 不在本版相容性承諾內。
- 自訂 prompt 可以描述習慣，但不保證每次都遵守；完整學習個人口吻留待 [後續研究](../../backlog/chat-reply-assistant-voice-style.md)。
