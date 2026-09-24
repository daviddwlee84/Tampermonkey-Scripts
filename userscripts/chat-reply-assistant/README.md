# Chat Reply Assistant

在 Instagram／Messenger 輸入框附近提供回覆工具列，從已載入的聊天中選取文字與圖片，用自己的 API key（BYOK）或本機 OpenAI-compatible proxy 產生三個回覆建議。可加上 Jev 的文字語氣／意圖提示；複製或填入建議後，仍由你手動傳送。

- **狀態**：v0.2 實驗性。實際驗證範圍見 [VALIDATION.md](./VALIDATION.md)，尚不能承諾每個帳號的 Instagram／Messenger 版面都相容。
- **目標網站**：[Instagram Direct](https://www.instagram.com/direct/inbox/)、[Messenger](https://www.messenger.com/)、[Facebook Messages](https://www.facebook.com/messages/)，包含一對一與群組聊天。
- **安裝**：[安裝腳本](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chat-reply-assistant/chat-reply-assistant.user.js)（需 Tampermonkey／Violentmonkey）。也可在 manager 匯入本機檔案。
- **原始碼**：[`chat-reply-assistant.user.js`](./chat-reply-assistant.user.js)
- **研究**：[RESEARCH.md](./RESEARCH.md) — API、相關專案、設計依據與未驗證的假設。

安裝 URL 需要這次變更先發布到 GitHub `main` 才會提供新版；本次實作沒有自動 push。

## 使用方式

1. 開啟一個對話，在輸入框附近點「設定」。選擇連線預設，填入完整 endpoint 與該服務的 key；本機 proxy 可免 key。
2. 點「取得模型」，在模型欄選取或輸入 model ID。尚未選模型也能先儲存設定或取得清單。
3. 需要確認生成可用時，點「測試模型」。它會送出固定短文字，可能產生 API 費用或訂閱用量；不包含聊天、圖片或 Jev 請求。
4. 點「選取上下文」，檢查發言者、文字與主要回覆對象，勾選要提供的訊息；圖片需另外勾選。可修改本分頁中的文字與身分判定。
5. 產生三個建議後，複製或填入聊天輸入框。已有草稿時，只能明確選擇「接續既有草稿」或複製，避免覆蓋原文。檢查後自行傳送。

支援全域 system prompt，以及個別聊天覆寫，例如「用繁體中文 短句 不使用句尾標點 不加 emoji」。這是口吻指示，並非自動學習你的完整說話方式。

## 上下文與圖片選取

預設使用近期 **50 則訊息、20,000 字元**，上限可調。字元數不是 token 數。選取後若超過訊息、字元或圖片上限，腳本會要求縮減選取或調整設定，不會默默刪掉已選內容再送出。

- 可逐則勾選、全選／全不選訊息；文字、發言者名稱與自己／他人的判定都可修正。這些修改不會寫回網站聊天。
- 開啟選取視窗時，畫面中的快照固定，自動生成暫停；背景仍累積已載入訊息。完成選取後恢復跟隨近期文字，**新圖片不會自動勾選**。
- 群組預設回覆整段討論，也可指定主要對象。無法辨識的發言者會保留警示，不根據訊息靠左或靠右就當作可靠身分。
- 只累積目前分頁已載入的內容。更早的訊息需要自行捲動載入；不使用平台私人 API、不自動捲完整歷史，也不做截圖或 OCR。

圖片只有在訊息已選取、圖片另行勾選，且你確認該主模型與 proxy 支援圖片輸入時，才會附加給主回覆模型。每次最多 **4 張**；每張來源最多 **12 MiB**，支援 JPEG／PNG／WebP，長邊縮至最多 **1600 px** 並轉成 JPEG，轉換後合計最多 **8 MiB**。

來源目前限支援的 Instagram／Facebook CDN、同源 blob，以及受限的內嵌圖片。下載或解碼失敗會停止此次生成並顯示原因，不會悄悄省略已勾選圖片。影片、語音、貼圖與未選圖片只提供「存在附件／內容未提供」的提示，不聲稱已理解其內容。

## 模型連線與測試

endpoint 填入**完整 Chat Completions URL**；腳本不會替它補上 `/v1` 或 `/chat/completions`。

| 連線預設 | endpoint | Key 與 model |
| --- | --- | --- |
| Gemini BYOK | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | [Gemini API key](https://aistudio.google.com/apikey)，搭配帳號可用的 model ID |
| LiteLLM（4000） | `http://localhost:4000/chat/completions` | proxy 要求的 key（若有），以及設定中的 model alias |
| Copilot API · ericc-ch（4141） | `http://localhost:4141/v1/chat/completions` | 先完成本機 [copilot-api](https://github.com/ericc-ch/copilot-api) 登入 |
| Copilot SDK Proxy · rezrov（3001） | `http://localhost:3001/v1/chat/completions` | 先完成 [copilot-proxy](https://github.com/rezrov/copilot-proxy)／Copilot CLI 登入 |
| 自訂 OpenAI-compatible | 服務實際的完整 endpoint | 依該服務要求設定 |

4141 與 3001 是兩個不同專案的預設 port，可以依自己的部署修改。Gemini 使用 Google 官方 [OpenAI compatibility API](https://ai.google.dev/gemini-api/docs/openai)；LiteLLM 路徑以自己的 [proxy 設定](https://docs.litellm.ai/docs/proxy/quick_start)為準。

「取得模型」只做 GET，不執行生成。模型清單可能是 proxy 快取，取得成功不等於已驗證額度、生成或圖片能力。原先手動輸入的 model 會保留，不會自動改成第一個候選。

模型清單 URL 預設把完整 endpoint 結尾的 `/chat/completions` 換成 `/models`，保留前面的部署路徑與 query。例如 `/team-a/v1/chat/completions` 對應 `/team-a/v1/models`。無法推導或服務使用其他路徑時，填入進階欄位；清單 URL 必須與主 endpoint 同源。

各連線預設分開保存 endpoint、model、key 與圖片設定；切換服務不會把一組 key 複製給另一組。變更 endpoint 的 origin 或 API base path 時，不會沿用舊 key。升級 v0.1 時保留既有設定，將它移入對應的 profile；不會復原以前已被覆蓋的 key。

本機 proxy 需要自行安裝、啟動並完成 upstream 認證。腳本不安裝 proxy、不讀取 CLI token，也不把網站登入 cookie 當 API key。是否能使用 subscription 取決於 proxy 與帳號，不保證任意 API 可用或用量無限。[Copilot SDK 用量文件](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing)

**OpenCode server 不能直接作為 Chat Completions endpoint**；它使用 session/message API，需要額外 bridge，記錄於 [後續研究](../../backlog/chat-reply-assistant-opencode-bridge.md)。

### 連線權限

metadata 列出 Gemini、TypeSafe、Vercel AI Gateway、loopback，以及圖片所需的 `cdninstagram.com`／`fbcdn.net`。自訂遠端服務時，在安裝的腳本 metadata 加入該 hostname，並依 manager 提示授權，例如：

```js
// @connect      llm.example.com
```

不要把完整 URL、path 或 API key 寫入 `@connect`。更新腳本時留意自訂 metadata 是否仍保留。Tampermonkey 的 host 授權包含重新導向檢查；Violentmonkey 的行為不能直接假設與它相同，實際證據見 [VALIDATION.md](./VALIDATION.md)。[Tampermonkey 文件](https://www.tampermonkey.net/documentation.php?q=connect)、[Violentmonkey API](https://violentmonkey.github.io/api/gm/)

## 可選 Jev 提示

Jev 預設關閉，用來提供文字語氣／意圖的補充訊號，不負責產生建議文字。兩個入口分開保存 key 與 model：

| Jev 服務 | endpoint | 預設 model／key |
| --- | --- | --- |
| TypeSafe | `https://api.typesafe.ai/v1/systemone` | `jev-latest`；[TypeSafe key](https://console.typesafe.ai/keys) |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` | `typesafe-ai/jev`；AI Gateway key，設定中提供取得連結 |

Vercel 使用官方 TypeSafe-compatible route，請填 Gateway key；不是把 TypeSafe key 直接複製到 Gateway 欄位。[TypeSafe API](https://docs.typesafe.ai/api)、[Vercel TypeSafe API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)

Jev 只收到所選文字與附件存在的提示，**不接收圖片內容**。結果是不確定的文字推論，不等於對方真實情緒、人格或喜歡你的機率。中文、混合語言與反諷需要自行評估。[模型與語言支援](https://docs.typesafe.ai/models)

Jev 失敗時，會顯示補充訊號暫不可用，繼續用一般 LLM 生成；主模型失敗則顯示錯誤，不會自行換成其他外部 provider。

## 自動產生

自動產生是**每個聊天個別啟用**的選項。首次進入、重新整理、返回最新訊息或建立初始快照時，只建立基準，不會重播舊訊息。

只有分頁可見、回覆區展開、能確認位於最新訊息尾端、選取有效且收到新對方訊息時才觸發。連續訊息等待 3 秒後合併，兩次自動請求至少間隔 30 秒，同時最多一個生成流程。往上查看歷史、開啟上下文選取、身分不明、選取超限或請求錯誤時會暫停。錯誤後須處理設定並重新切換開關。

這只自動取得建議，不會按 Enter、點擊傳送或取代你正在寫的草稿。已選圖片在之後的生成中仍可能附加，直到取消選取。

## 資料存放與傳送

| 資料 | 存放／用途 |
| --- | --- |
| 各 provider 的 key、endpoint、model、口吻與圖片設定 | userscript manager 的 GM storage；不是網站 localStorage，也不是加密保管庫 |
| 個別聊天 prompt、自動產生設定 | GM storage，以站點與穩定 thread 路由／可辨識帳號區分，不用顯示名稱共用設定 |
| 已載入訊息、附件 URL、勾選、文字修正與候選回覆 | 分頁記憶體；最多 5 個聊天，每聊天最多 500 則訊息 |
| 下載與轉換的圖片 | 當次請求使用，不寫入 GM storage；只傳給主回覆模型 |
| 主模型請求 | 所選文字、口吻、回覆對象、可選 Jev 訊號，以及明確勾選的圖片 |
| Jev 請求 | 所選文字、回覆對象與附件存在資訊，送到選定的 TypeSafe／Vercel 入口 |

重新整理、關閉分頁或超過快取上限後，累積內容與手動修正會消失。腳本不是聊天備份工具。本機 proxy 只表示第一站在本機；是否再送到雲端，由 upstream 設定決定。

## 已知限制

- DOM、語系、虛擬化列表及 rich-text 輸入框會改變。v0.2 有較保守的 DOM fallback，但畫面截圖不能證實真實的訊息列、ARIA 或附件屬性；合成 fixture 通過也不能替代登入後的 DOM 與 manager 驗證。
- 收回、編輯、引用回覆、重複短訊息與舊訊息重掛可能影響去重和順序；請以選取視窗核對。順序無法確認時，自動生成會暫停。
- 模型清單通常沒有圖片能力資訊；只有你確認並啟用後才允許圖片請求，proxy 仍可能拒絕該格式。
- 不分析影片／語音、不做 OCR、不取得完整歷史，也不自動傳送。Safari Userscripts、手機 App 與原生桌面 App 不在本版相容性承諾內。
- 自訂 prompt 不保證每次都遵守；完整學習個人口吻留待 [後續研究](../../backlog/chat-reply-assistant-voice-style.md)。
