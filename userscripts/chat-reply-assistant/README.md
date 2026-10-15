# Chat Reply Assistant

在 Instagram／Messenger／Gemini 輸入框附近提供回覆工具列，以 BYOK 或本機 proxy 產生回覆。預設由你複製、填入或選擇送出；也可另外手動啟動有倒數與輪數設定的自動回覆。Jev 的上下文篩選、情緒提示與候選選擇各有獨立用途。

- **狀態**：v0.3 實驗性。實際驗證範圍見 [VALIDATION.md](./VALIDATION.md)，尚不能承諾每個帳號的 Instagram／Messenger 版面都相容。
- **目標網站**：[Instagram Direct](https://www.instagram.com/direct/inbox/)、[Messenger](https://www.messenger.com/)、[Facebook Messages](https://www.facebook.com/messages/)，包含一對一與群組聊天；另支援 [Gemini Web](https://gemini.google.com/app) 的文字對話。
- **安裝**：[安裝腳本](https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chat-reply-assistant/chat-reply-assistant.user.js)（需 Tampermonkey／Violentmonkey）。也可在 manager 匯入本機檔案。
- **原始碼**：[`chat-reply-assistant.user.js`](./chat-reply-assistant.user.js)
- **研究**：[RESEARCH.md](./RESEARCH.md) — API、相關專案、設計依據與未驗證的假設。

安裝 URL 需要這次變更先發布到 GitHub `main` 才會提供新版；本次實作沒有自動 push。

## 使用方式

1. 開啟對話，在輸入框附近點「設定」。新設定優先使用本機 **Copilot API（4141）**；先啟動後端，再填入它的 model。也可切換 Gemini BYOK 或其他 provider。本機 proxy 可免 client key。
2. 點「取得模型」，在模型欄選取或輸入 model ID。尚未選模型也能先儲存設定或取得清單。
3. 需要確認生成可用時，點「測試模型」。它會送出固定短文字，可能產生 API 費用或訂閱用量；不包含聊天、圖片或 Jev 請求。
4. 點「選取上下文」，檢查發言者、文字與主要回覆對象，勾選要提供的訊息；圖片需另外勾選。可修改本分頁中的文字與身分判定。
5. 產生建議後，可複製、填入草稿，或明確點「填入並送出」。已有草稿時使用「接續既有草稿」或複製，不會默默覆蓋。自動回覆另見下節，儲存偏好不會自動啟動它。

若網站未提供可核對的對話身分，腳本可能先暫停並顯示「使用目前聊天室」；核對標題與上下文後再確認。

支援全域 system prompt，以及個別聊天覆寫，例如「用繁體中文 短句 不使用句尾標點 不加 emoji」。這是口吻指示，並非自動學習你的完整說話方式。

## 上下文與圖片選取

預設使用近期 **50 則訊息、20,000 字元**，上限可調。字元數不是 token 數。選取後若超過訊息、字元或圖片上限，腳本會要求縮減選取或調整設定，不會默默刪掉已選內容再送出。

- 可逐則勾選、全選／全不選訊息；文字、發言者名稱與自己／他人的判定都可修正。這些修改不會寫回網站聊天。
- 開啟選取視窗時，畫面中的快照固定，自動生成暫停；背景仍累積已載入訊息。完成選取後恢復跟隨近期文字，**新圖片不會自動勾選**。
- 群組預設回覆整段討論，也可指定主要對象。沒有姓名時，可在設定指定自己的訊息位於左側或右側，輔助判定自己／他人；畫面會標示辨識來源，這不等於已確認帳號身分。
- 只累積目前分頁已載入的內容。更早的訊息需要自行捲動載入；不使用平台私人 API、不自動捲完整歷史，也不做截圖或 OCR。

圖片只有在訊息已選取、圖片另行勾選，且你確認該主模型與 proxy 支援圖片輸入時，才會附加給主回覆模型。每次最多 **4 張**；每張來源最多 **12 MiB**，支援 JPEG／PNG／WebP，長邊縮至最多 **1600 px** 並轉成 JPEG，轉換後合計最多 **8 MiB**。

以上圖片功能用於 Meta 聊天；**Gemini adapter 在 v0.3 先支援文字**，不讀取或上傳 Gemini 對話中的圖片／檔案。

來源目前限支援的 Instagram／Facebook CDN、同源 blob，以及受限的內嵌圖片。下載或解碼失敗會停止此次生成並顯示原因，不會悄悄省略已勾選圖片。影片、語音、貼圖與未選圖片只提供「存在附件／內容未提供」的提示，不聲稱已理解其內容。

## 模型連線與測試

endpoint 填入**完整 Chat Completions URL**；腳本不會替它補上 `/v1` 或 `/chat/completions`。

| 連線預設 | endpoint | Key 與 model |
| --- | --- | --- |
| Copilot API · ericc-ch（4141，新的預設） | `http://localhost:4141/v1/chat/completions` | 先完成本機 [copilot-api](https://github.com/ericc-ch/copilot-api) 登入 |
| Gemini BYOK | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | [Gemini API key](https://aistudio.google.com/apikey)，搭配帳號可用的 model ID |
| LiteLLM（4000） | `http://localhost:4000/chat/completions` | proxy 要求的 key（若有），以及設定中的 model alias |
| Copilot SDK Proxy · rezrov（3001） | `http://localhost:3001/v1/chat/completions` | 先完成 [copilot-proxy](https://github.com/rezrov/copilot-proxy)／Copilot CLI 登入 |
| 自訂 OpenAI-compatible | 服務實際的完整 endpoint | 依該服務要求設定 |

尚未安裝後端時，可依 [copilot-api README](https://github.com/ericc-ch/copilot-api) 啟動：

```sh
npx copilot-api@latest start --port 4141
```

`start` 會在需要時處理 GitHub 登入；不要把 GitHub 登入 token 貼到腳本的 client API key 欄位。這是非 GitHub 官方支援的 reverse-engineered 專案，接口與可用性可能變動。此預設不會覆蓋既有使用者選好的 provider／endpoint／model／key。

4141 與 3001 是兩個不同專案的預設 port，可以依自己的部署修改。Gemini 使用 Google 官方 [OpenAI compatibility API](https://ai.google.dev/gemini-api/docs/openai)；LiteLLM 路徑以自己的 [proxy 設定](https://docs.litellm.ai/docs/proxy/quick_start)為準。

「取得模型」只做 GET，不執行生成。模型清單可能是 proxy 快取，取得成功不等於已驗證額度、生成或圖片能力。原先手動輸入的 model 會保留，不會自動改成第一個候選。

模型清單 URL 預設把完整 endpoint 結尾的 `/chat/completions` 換成 `/models`，保留前面的部署路徑與 query。例如 `/team-a/v1/chat/completions` 對應 `/team-a/v1/models`。無法推導或服務使用其他路徑時，填入進階欄位；清單 URL 必須與主 endpoint 同源。

各連線預設分開保存 endpoint、model、key 與圖片設定；切換服務不會把一組 key 複製給另一組。變更 endpoint 的 origin 或 API base path 時，不會沿用舊 key。升級 v0.1／v0.2 時保留既有設定；新預設只套用尚未設定的安裝，不會復原以前已被覆蓋的 key。

本機 proxy 需要自行安裝、啟動並完成 upstream 認證。腳本不安裝 proxy、不讀取 CLI token，也不把網站登入 cookie 當 API key。是否能使用 subscription 取決於 proxy 與帳號，不保證任意 API 可用或用量無限。[Copilot SDK 用量文件](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing)

**OpenCode server 不能直接作為 Chat Completions endpoint**；它使用 session/message API，需要額外 bridge，記錄於 [後續研究](../../backlog/chat-reply-assistant-opencode-bridge.md)。

### 連線權限

metadata 列出 Gemini、TypeSafe、Vercel AI Gateway、loopback，以及圖片所需的 `cdninstagram.com`／`fbcdn.net`。自訂遠端服務時，在安裝的腳本 metadata 加入該 hostname，並依 manager 提示授權，例如：

```js
// @connect      llm.example.com
```

不要把完整 URL、path 或 API key 寫入 `@connect`。更新腳本時留意自訂 metadata 是否仍保留。Tampermonkey 的 host 授權包含重新導向檢查；Violentmonkey 的行為不能直接假設與它相同，實際證據見 [VALIDATION.md](./VALIDATION.md)。[Tampermonkey 文件](https://www.tampermonkey.net/documentation.php?q=connect)、[Violentmonkey API](https://violentmonkey.github.io/api/gm/)

## Jev 的三個用途

Jev 不產生建議文字；主 LLM 負責生成。以下用途彼此獨立，關閉情緒提示不代表停用上下文篩選或自動候選選擇。兩個服務入口分開保存 key 與 model：

| Jev 服務 | endpoint | 預設 model／key |
| --- | --- | --- |
| TypeSafe | `https://api.typesafe.ai/v1/systemone` | `jev-latest`；[TypeSafe key](https://console.typesafe.ai/keys) |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` | `typesafe-ai/jev`；AI Gateway key，設定中提供取得連結 |

Vercel 使用官方 TypeSafe-compatible route，請填 Gateway key；不是把 TypeSafe key 直接複製到 Gateway 欄位。[TypeSafe API](https://docs.typesafe.ai/api)、[Vercel TypeSafe API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)

Jev 收到哪些文字取決於用途：情緒提示使用目前選取，上下文篩選可分析較廣的候選池，候選選擇另包含 LLM 產生的回覆。各用途只附附件存在的提示，**不接收圖片內容**。結果是不確定的文字推論，不等於對方真實情緒、人格或喜歡你的機率。中文、混合語言與反諷需要自行評估。[模型與語言支援](https://docs.typesafe.ai/models)

- **情緒／意圖提示**：原本的可選補充訊號。失敗時可顯示暫不可用，繼續用一般 LLM 生成。
- **挑選上下文**：另行啟用。Jev 可分析比最終選取更廣的已載入候選，最多 **100 則、28 KiB 完整請求**。手動明確排除的訊息不會交給 Jev。最新對方 turn、前一段本人訊息、手動保留／附圖的訊息與已知引用來源會保留；其餘按相關性和最終上限挑選。
- **選擇自動回覆候選**：在「三個候選，由 Jev 選擇」策略中，判斷首選、相關性與是否虛構事實。沒有合適候選、結果不明或格式錯誤時，停止自動送出，交由你處理。

上下文篩選失敗時保留原人工選取供草稿使用，並停止自動 run；候選判斷失敗也會停止自動送出。兩者不會套用情緒提示的降級方式，擅自把所有歷史或任一候選送出。這些分數是操作上的判斷門檻，不代表情緒或回覆正確率。主模型失敗也不會自行切換外部 provider。

## 自動生成與自動回覆

「自動生成」只取得建議；開啟後進入聊天室，最新對方訊息穩定且可辨識時就會生成，不必再等下一則或手動按產生。自己的新訊息只更新上下文，不觸發新建議。

**「開始自動回覆」才會啟用送出**。舊版自動生成偏好不會被轉成自動送出權限。每次進入聊天或重新整理後，都需要重新手動開始 run，儲存偏好不會啟動它。

自動回覆預設每次最多 **10 則**，每則有 **10 秒倒數**。可修改次數、選擇不設輪數上限，或把倒數設為 `0` 立即送出；倒數期間也可點「立即送出」或「停止自動回覆」。立即模式仍檢查對話、訊息、草稿、生成狀態與送出條件。

| 自動策略 | 流程 | Jev 需求 |
| --- | --- | --- |
| 三個候選，由 Jev 選擇 | 主 LLM 產生三個候選，Jev 選出達門檻的回覆後才進入倒數 | 需要可用 Jev key；低把握、`none`、失敗或格式錯誤均停止自動送出 |
| LLM 單一回覆 | 主 LLM 直接產生一個候選，再進入倒數 | 不需要 Jev 候選選擇；若另外開啟上下文篩選／情緒提示，仍會呼叫 Jev |

run 等待新的對方 turn，不會因歷史重掛、自己的訊息或串流中的每個字反覆生成。分頁須在前景、回覆區展開、對話已確認且選取有效。編輯草稿／上下文、開啟設定、切換對話／帳號、失去可確認的網站狀態或發生錯誤時，會停止或取消待送候選。每輪資料更新都要重新檢查，不能把過期建議接著送出。

原生 Send 每次只點一次，必須觀察到新的本人訊息回顯及草稿清空才視為已送出；結果不明時**停止且不重試**，避免重複發送。已選圖片仍可能隨之後的生成送給主模型，直到取消選取。

### Gemini 開場與往返

Gemini Web 是聊天對象；Copilot API／BYOK 是替你產生候選的後端，兩者各自使用其帳號／服務用量。Gemini `/app` 空白新對話可依「開場目標」產生破冰訊息，留空時自然打招呼並提出容易延伸的問題。只有確認新 user turn 已送出後，才把這次 run 接到網站分配的新對話 ID。

一般對話只在 Gemini 完成新的回答後接續；有停止生成按鈕、busy 訊號或完成狀態未知時，不會搶先送出。`/share/<id>` 只能讀取，不能填入或送出。沒有新對方訊息時的自由續話，以及 Grok／Character.ai，仍是 [後續工作](../../TODO.md)。

## 資料存放與傳送

| 資料 | 存放／用途 |
| --- | --- |
| 各 provider 的 key、endpoint、model、口吻與圖片設定 | userscript manager 的 GM storage；不是網站 localStorage，也不是加密保管庫 |
| 個別聊天 prompt、篩選／倒數／策略／輪數偏好 | GM storage，以站點與穩定 thread 路由／可辨識帳號區分；不儲存已啟動的 run |
| 自動 run、倒數、待送候選、回合去重 | 分頁記憶體；重新整理後不自動恢復送出 |
| 已載入訊息、附件 URL、勾選、文字修正與候選回覆 | 分頁記憶體；最多 5 個聊天，每聊天最多 500 則訊息 |
| 下載與轉換的圖片 | 當次請求使用，不寫入 GM storage；只傳給主回覆模型 |
| 主模型請求 | 所選文字、口吻、回覆對象、可選 Jev 訊號，以及明確勾選的圖片 |
| Jev 請求 | 依功能傳送候選文字、回覆對象、附件存在資訊或 LLM 回覆候選；明確排除的訊息及圖片 bytes 不傳送 |

重新整理、關閉分頁或超過快取上限後，累積內容與手動修正會消失。腳本不是聊天備份工具。本機 proxy 只表示第一站在本機；是否再送到雲端，由 upstream 設定決定。

## 已知限制

- DOM、語系、虛擬化列表及 rich-text 輸入框會改變。v0.3 維持保守的 DOM fallback，但畫面截圖不能證實真實的訊息列、ARIA 或附件屬性；合成 fixture 通過也不能替代登入後的 DOM 與 manager 驗證。
- 收回、編輯、引用回覆、重複短訊息與舊訊息重掛可能影響去重和順序；請以選取視窗核對。順序待確認的舊段落預設不選取；若手動選入這些舊段落，自動回覆會暫停，最新可信訊息仍可在有效選取下使用。
- 模型清單通常沒有圖片能力資訊；只有你確認並啟用後才允許圖片請求，proxy 仍可能拒絕該格式。
- 不分析影片／語音、不做 OCR、不取得完整歷史。Safari Userscripts、手機 App 與原生桌面 App 不在本版相容性承諾內。
- 自訂 prompt 不保證每次都遵守；完整學習個人口吻留待 [後續研究](../../backlog/chat-reply-assistant-voice-style.md)。

## 後續方向

- [自我續話與自由續聊](../../backlog/chat-reply-assistant-freeform.md)
- [Grok／Character.ai adapters](../../backlog/chat-reply-assistant-ai-platforms.md)
- [更多網站後再抽出共用 adapter library](../../backlog/chat-reply-assistant-adapter-library.md)
