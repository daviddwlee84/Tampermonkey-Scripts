# Chat Reply Assistant：可行性與相關研究

查閱日期：2026-09-24。本文記錄設計依據與來源；API 文件、專案 README 和原始碼可支持接口或設計選擇，不能代替本腳本的真實站點測試。實際測試結果另見 [VALIDATION.md](./VALIDATION.md)。

## 結論與 v0.1 邊界

可行的最小流程是「已載入 DOM 文字 → 帶發話者的上下文 → 可選 Jev 判斷 → LLM 三個回覆 → 使用者複製／填入／傳送」。主要不確定性在 Instagram／Messenger 的訊息與輸入框擷取，模型接口本身已有文件可依循。

v0.1 採用單檔 userscript、DOM adapter、GM storage 與 `GM_xmlhttpRequest`。只累積目前分頁看過的訊息，最多 5 個聊天、每聊天 500 則；不持久保存聊天文字、不掃描未開啟的 inbox、不下載完整歷史、不使用私人 API、OCR 或自動傳送。

預設手動產生；每個聊天可另開自動產生，並要求分頁可見、面板開啟、最新訊息尾端已知。3 秒 debounce、30 秒 cooldown、single-flight 與錯誤後暫停控制請求頻率。首次快照只建立基準。這些是產品與實作邊界，不是對平台 DOM 穩定性的保證。

## Jev：適合補充判斷，回覆由 LLM 生成

### 官方接口

TypeSafe 是 Jev 模型的官方來源。`thejevai.com`、`jevai.org` 等近似名稱網站不是本腳本的預設 endpoint；本版只接官方 TypeSafe API。[TypeSafe 介紹](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

請求欄位為 `state`、`model`、`questions`。`state` 可放文字或結構化聊天記錄；每個 question 指定 `type`、`instructions` 與需要的 `criteria`，答案以同一 question key 回傳。[官方 API reference](https://docs.typesafe.ai/api)

| primitive | 適用情境               | 回傳重點                                         |
| --------- | ---------------------- | ------------------------------------------------ |
| `choice`  | 有限選項的語氣／意圖   | `choice`、各選項 `probabilities`、`confidence`   |
| `score`   | 有序且具文字描述的程度 | `score`、`legend`、`probabilities`、`confidence` |
| `noul`    | 單一 yes/no 判斷       | `noul`，沒有獨立 `confidence` 欄位               |

同一次請求可對共享 state 提出多個獨立問題。設計時應把情緒、意圖、是否需要溫和回應拆開，不把數個不同判斷塞進一題。加入「不明確／證據不足」選項，避免強迫模型替一句「嗯」選定強烈情緒。[官方 primitives](https://docs.typesafe.ai/primitives)

`jev-latest` 查閱時對應 `jev-1.13.0`；只接受文字，包括物件／陣列中的結構化文字，不接受圖片、音訊或影片。上下文上限包含所有問題，不能只計算聊天 state。英文是主要訓練語言，官方要求對其他語言自行測試。[Models](https://docs.typesafe.ai/models)

### 如何呈現與降級

將結果標為「文字線索／可能語氣」，讓使用者看到不確定性；主 LLM 收到的是可忽略的輔助推論。`confidence` 是答案分佈的摘要，不代表對方內心狀態的測量，也不是「喜歡你的機率」。不同 primitive 的數值不能直接共用同一閾值。[Confidence](https://docs.typesafe.ai/confidence)

API 文件列出 401、422、429、529；後兩種建議退避。此互動式 optional 步驟採失敗降級，避免整個回覆流程卡住，不在使用者不知情時換 provider。[錯誤語義](https://docs.typesafe.ai/api#errors)

Jev 官方已列出的限制包含過度字面理解、間接推理、無關上下文與對抗性文字。它不擅長生成文字；型別正確不代表判斷正確。聊天文字要當資料，不能讓裡面的指令取得 system prompt 或執行能力。[Jev 1.13 限制](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

尚未做 live Jev 呼叫，因此沒有本專案的中文情緒準確率、延遲或成本測量。候選判斷規則、門檻與 UI 文案都需要使用經同意、去識別的實例另行評估。

## 主回覆模型與本機 proxy

主接口選用非串流 OpenAI-compatible Chat Completions，設定直接保存**完整 endpoint**。這能避免某些 proxy 使用 `/chat/completions`、另一些使用 `/v1/chat/completions` 時被自動拼接錯誤。model 是使用者可編輯的必要欄位，不能把文件範例模型當永久可用的預設承諾。

| 來源                                                                        | 已由文件確認                                                                                      | 本腳本的結論                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) | Google 提供 `/v1beta/openai/chat/completions`，Bearer Gemini key                                  | 可用同一 Chat Completions adapter；不必引入 SDK                          |
| [LiteLLM CLI quick start](https://docs.litellm.ai/docs/proxy/quick_start)   | OpenAI-compatible gateway，model alias 與 upstream 可設定，常用 port 4000                         | 本機預設值是 `http://localhost:4000/chat/completions`，完整 URL 仍可修改 |
| [rezrov/copilot-proxy](https://github.com/rezrov/copilot-proxy)             | 以 Copilot CLI SDK 提供本機 `/v1/chat/completions`、`/v1/models`，預設 port 3001；MIT             | 可用 HTTP adapter；proxy 自己負責 CLI 認證與可用模型                     |
| [ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api)             | 另一個透過 Copilot 提供 API 的社群專案；MIT                                                       | 與 rezrov 專案不同；不可混用 port、認證或相容性說明，不列為 v0.1 預設值  |
| [OpenCode server](https://opencode.ai/docs/server/)                         | `opencode serve` 預設 port 4096；建立 session 後送入 `/session/:id/message`；可設 HTTP Basic 認證 | 不是 Chat Completions API；需要獨立 bridge，留到 backlog                 |

本機 proxy 可以接使用者已具備權限的服務，但 LiteLLM 本身不會把一般聊天網站訂閱自動變成 API。Copilot SDK 有自己的模型、token／credit／額度介面；訂閱可用性與計費應以帳號及當時官方文件為準，不能承諾無限使用。[GitHub SDK 用量文件](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing)

本次沒有登入任何 CLI、啟動 proxy 或消耗 provider 配額。上表證明接口形狀，尚未證明每個服務與本 userscript 的端到端相容性。

## Userscript 網路、資料與聊天擷取

- `GM_xmlhttpRequest` 加上明確 `@connect` 是預定的跨域路徑。預設只允許 Gemini、TypeSafe 與 loopback host；其他遠端服務由使用者新增特定 host。`@connect` 管理初始與重新導向 host 的授權，不能只靠頁面內 `fetch` 的結果推論。[Tampermonkey](https://www.tampermonkey.net/documentation.php#meta:connect)、[Violentmonkey](https://violentmonkey.github.io/api/metadata-block/#connect)
- key 與設定放 GM storage；聊天文字只留在分頁 RAM。GM storage 不是加密保管庫。設定索引用站點與穩定的 thread ID／URL，避免兩個同名對象共用 prompt 或自動產生開關。
- 預設只送最近 50 則、最多 20,000 字元，兩者可調。這是本專案的資料量控制，不等同模型 token 上限。附件只保留 DOM 裡可讀到的文字資訊，不推測附件內容。
- DOM adapter 必須限制在目前對話，排除 inbox 預覽、側欄、腳本面板、系統提示與輸入中的草稿；用訊息 ID／結構／位置訊號辨識發話者，無可靠訊號時保留未知。
- SPA 換對話時，需要隔離上下文、取消或忽略前一對話的回應；虛擬化列表重掛與往上捲動不能觸發「新收到訊息」。群組預設整段討論，指定參與者只改變回覆目標，不刪掉其他人的上下文。
- 填入 React／rich-text composer 的 DOM，不代表網站狀態已接受內容；需從頁面讀回並驗證。自動傳送沒有納入本版。

最後四點是 adapter 的設計要求，需要 synthetic fixture 和真實站點兩種證據。fixture／GM shim 可以檢查解析、race 與請求內容，不能證明網站 DOM、真 manager sandbox、跨域或 localhost 行為。具體證據與未測項目集中在 [VALIDATION.md](./VALIDATION.md)。

## 相關專案與授權

以下只作架構、互動與接口參考；沒有安裝或以真實聊天測試它們，也沒有將 README 的支援宣稱當成本腳本已支援。

| 專案                                                                                  | 值得參考的部分                                                                 | 適用邊界／授權                                                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [zandy700/Jev-Assistant](https://github.com/zandy700/Jev-Assistant)                   | 開啟中的聊天、Jev 判斷、三個候選、填入或複製；包含 browser 方案                | 各平台讀取途徑不同；閱讀原始碼時應固定版本。MIT                                                                      |
| [jev-chat/jev-chat-windows](https://github.com/jev-chat/jev-chat-windows)             | Jev intent → generative LLM → Jev ranking，三個候選，傳送保持手動              | Windows WeChat／本機 OCR，不能推論瀏覽器 DOM 相容。GitHub 未識別為標準 SPDX license，重用前需讀 LICENSE              |
| [NadirAliOfficial/mindscribe-ai](https://github.com/NadirAliOfficial/mindscribe-ai)   | BYOK Chrome extension、聊天上下文、tone 設定；README 列 Instagram 與 Messenger | 未做真站點驗證；不是 userscript。MIT                                                                                 |
| [Open Chat Archiver](https://github.com/tyhallcsu/messages-saver-open-source)         | Messenger／Facebook DOM 擷取、MutationObserver 與隨捲動累積                    | MIT；`sender\|text\|timestamp` 去重可能吞掉相同短訊息，首次看到的順序也不等於聊天順序，本版另行實作合併              |
| [Ekko adapter notes](https://github.com/useekko/ekko-core/blob/main/docs/ADAPTERS.md) | Instagram／Messenger pane、composer、thread route 與群組辨識的失敗情境         | Client GPL-3.0、server AGPL-3.0；僅參考設計與公開文件，沒有複製其程式碼，也未將其自述 live verification 當作本版證據 |
| [solrac149/typesafelicious](https://github.com/solrac149/typesafelicious)             | 同次判斷 intent／emotion／urgency／intensity；unclear 與競爭情緒的 UI          | 顯示門檻是 heuristic，不能照搬成準確率。查閱時 GitHub 未標示 license，不視為已授權重用                               |
| [FerryCorleone/crush-monitor](https://github.com/FerryCorleone/crush-monitor)         | 中文 emotion／intent 設計、文字匯入與回覆評分                                  | 手動文字輸入，沒有即時 DOM 擷取；好感分數不是機率。MIT                                                               |

文件與 API 引用不代表取得專案程式碼的重用授權。未明確確認 LICENSE 的專案，只參考其概念；若之後複製程式碼，要先確認當時的 license、保留必要 notices 並記錄來源。

## 後續研究

- [完整模擬個人口吻](../../backlog/chat-reply-assistant-voice-style.md)：先評估使用者選定範例與可編輯 style profile，不在 v0.1 默默建立長期聊天資料庫。
- [OpenCode bridge](../../backlog/chat-reply-assistant-opencode-bridge.md)：把 session/message 協定轉換成純文字回覆服務，處理認證、工具權限與 session 隔離。
- 真站點 DOM 樣本、TM／VM 跨域、localhost、帳號語系與群組辨識是目前版本的驗證工作，記在 [VALIDATION.md](./VALIDATION.md)，不把它們混入 future feature backlog。
