# Chat Reply Assistant：可行性與相關研究

查閱日期：2026-09-24～2026-09-25。本文記錄設計依據與來源；API 文件、專案 README 和原始碼可支持接口或設計選擇，不能代替本腳本的真實站點測試。實際測試結果另見 [VALIDATION.md](./VALIDATION.md)。

## 結論與 v0.3 邊界

目前流程是「已載入 DOM → 使用者選取訊息與可選圖片 → 文字上下文／可選 Jev 判斷 → 主 LLM 回覆候選 → 使用者操作或手動啟動的自動回覆」。主要不確定性在 Instagram／Messenger 的訊息與輸入框擷取，模型接口本身已有文件可依循。

v0.3 採用單檔 userscript、DOM adapter、GM storage 與 `GM_xmlhttpRequest`。回覆工具列放在 composer 附近；上下文選取與設定使用對話框。只累積目前分頁載入的訊息，最多 5 個聊天、每聊天 500 則；不持久保存聊天文字、附件 URL 或圖片，不掃描未開啟的 inbox、不下載完整歷史、不使用私人 API 或 OCR；送出必須來自明確操作或另外手動啟動的 run。

新設定預設使用本機 ericc-ch/copilot-api（4141），既有設定仍保留選好的 provider、key 與 model。自動生成建議與自動回覆送出是不同權限；自動回覆每次需手動開始，預設 10 則、10 秒倒數，可另選立即或無輪數上限。single-flight、對方 turn 去重、草稿／路由／帳號檢查與未知送出不重試，屬於產品與實作邊界，不是平台 DOM 穩定性的保證。

## Jev：適合補充判斷，回覆由 LLM 生成

### 官方接口

TypeSafe 是 Jev 模型的官方來源。`thejevai.com`、`jevai.org` 等近似名稱網站不是本腳本的預設 endpoint；本版提供官方 TypeSafe API 與 Vercel 的 TypeSafe-compatible 入口。[TypeSafe 介紹](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

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

### Vercel AI Gateway 入口

官方文件提供 `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` 與 `GET https://ai-gateway.vercel.sh/typesafe/v1/models`。使用 Bearer AI Gateway key，範例 model 為 `typesafe-ai/jev`；`state`、`questions` 與 `answers` 延續 TypeSafe 格式。因此本版共用同一份 `choice`／`noul` 解析，但分開保存 TypeSafe 與 Gateway 的 key、model。[Vercel TypeSafe API](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)

Vercel 另外提供新的 `/v1/evaluate` 介面；其 `boolean` 問題型別不能直接當成本版 TypeSafe-compatible `noul` 的 wire format。本版使用相容入口，不引入額外 SDK。[Vercel evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation)

Jev 本身不接收圖片。即使使用者勾選圖片，Jev 的 state 也只有所選文字與「有附件、未提供內容」的資訊；圖片 bytes 只交給主回覆模型，避免把附件存在誤當成已分析圖片。

### 如何呈現與降級

將結果標為「文字線索／可能語氣」，讓使用者看到不確定性；主 LLM 收到的是可忽略的輔助推論。`confidence` 是答案分佈的摘要，不代表對方內心狀態的測量，也不是「喜歡你的機率」。不同 primitive 的數值不能直接共用同一閾值。[Confidence](https://docs.typesafe.ai/confidence)

API 文件列出 401、422、429、529；後兩種建議退避。此互動式 optional 步驟採失敗降級，避免整個回覆流程卡住，不在使用者不知情時換 provider。[錯誤語義](https://docs.typesafe.ai/api#errors)

Jev 官方已列出的限制包含過度字面理解、間接推理、無關上下文與對抗性文字。它不擅長生成文字；型別正確不代表判斷正確。聊天文字要當資料，不能讓裡面的指令取得 system prompt 或執行能力。[Jev 1.13 限制](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

本專案沒有中文情緒準確率、延遲或成本的實測結論。候選判斷規則、門檻與 UI 文案仍需以經同意、去識別的實例評估；API mock 的成功／降級測試只驗證流程，實際呼叫證據見 [VALIDATION.md](./VALIDATION.md)。

## Jev 上下文篩選與自動候選選擇

v0.3 將 Jev 用途分開：情緒提示仍是可降級的補充；上下文篩選獨立啟用；自動回覆策略可選三候選加 Jev，或主 LLM 單一候選。關閉情緒提示不會暗中關閉另外兩種判斷。

上下文篩選的候選池最多 100 則、完整 JSON 請求最多 28 KiB，可能比最終交給回覆模型的選取更廣。人工排除先於序列化；最新對方 turn、前一段本人訊息、人工保留／附圖訊息與已知引用父訊息為必要上下文。必要資料超限時要求手動縮減，而非隱藏刪除。可選訊息依 `noul` 判斷與最終訊息／字元限制挑選，再恢復原本順序。

Jev 篩選失敗時保留原人工選取作為草稿來源，停止自動 run；不改為送出全部歷史。選取視窗開啟時仍固定快照，人工排除與修正優先於 AI 選取。

三候選策略另用 `choice` 選首選或 `none`，並分別檢查相關性及是否加入沒有根據的事實、經驗或承諾。首選機率、相關性及事實一致性都需達 0.8，且回傳型別、完整 ID 集合與機率分布須有效。這些是保守的工程門檻，沒有實測支持把它們解讀成正確率。選不出、低把握或服務失敗時停止自動送出；單一候選策略不呼叫這一步。

## 主回覆模型與本機 proxy

主接口選用非串流 OpenAI-compatible Chat Completions，設定直接保存**完整 endpoint**。這能避免某些 proxy 使用 `/chat/completions`、另一些使用 `/v1/chat/completions` 時被自動拼接錯誤。model 可手動輸入或透過模型清單選取；可以先留空保存設定，但生成前必須指定。文件範例模型不是永久可用的預設承諾。

| 來源                                                                        | 已由文件確認                                                                                      | 本腳本的結論                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) | Google 提供 `/v1beta/openai/chat/completions`，Bearer Gemini key                                  | 可用同一 Chat Completions adapter；不必引入 SDK                           |
| [LiteLLM CLI quick start](https://docs.litellm.ai/docs/proxy/quick_start)   | OpenAI-compatible gateway，model alias 與 upstream 可設定，常用 port 4000                         | 本機預設值是 `http://localhost:4000/chat/completions`，完整 URL 仍可修改  |
| [rezrov/copilot-proxy](https://github.com/rezrov/copilot-proxy)             | 以 Copilot CLI SDK 提供本機 `/v1/chat/completions`、`/v1/models`，預設 port 3001；MIT             | 可用 HTTP adapter；proxy 自己負責 CLI 認證與可用模型                      |
| [ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api)             | 提供 `/v1/chat/completions`、`/v1/models`，預設 port 4141；社群 reverse-engineered 專案；MIT      | v0.3 新設定優先採用 4141；既有 provider 保留，不與 rezrov（3001）混用說明 |
| [OpenCode server](https://opencode.ai/docs/server/)                         | `opencode serve` 預設 port 4096；建立 session 後送入 `/session/:id/message`；可設 HTTP Basic 認證 | 不是 Chat Completions API；需要獨立 bridge，留到 backlog                  |

本機 proxy 可以接使用者已具備權限的服務，但 LiteLLM 本身不會把一般聊天網站訂閱自動變成 API。Copilot SDK 有自己的模型、token／credit／額度介面；訂閱可用性與計費應以帳號及當時官方文件為準，不能承諾無限使用。[GitHub SDK 用量文件](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing)

上表支持接口形狀，不能證明每個服務與本 userscript 的端到端相容性。模型 GET、固定文字診斷、mock 或真實 manager 的證據需分開記錄，見 [VALIDATION.md](./VALIDATION.md)。

### 模型清單、連線診斷與設定遷移

Gemini 官方相容 API 提供 `GET /v1beta/openai/models`，使用 Bearer Gemini key。兩個 Copilot proxy 都有 `/v1/models`；ericc 也提供不含 `/v1` 的別名。其清單回傳 `data[]` 與 model ID，ericc 額外提供 `display_name`，rezrov 可附加 context／token limits。兩者公開清單沒有可通用判斷圖片能力的欄位。[Gemini list models](https://ai.google.dev/gemini-api/docs/openai#list-models)、[ericc models route](https://github.com/ericc-ch/copilot-api/blob/master/src/routes/models/route.ts)、[ericc route registration](https://github.com/ericc-ch/copilot-api/blob/master/src/server.ts)、[rezrov source](https://github.com/rezrov/copilot-proxy/blob/master/index.js)

因此「取得模型」只發 GET，允許尚未保存的 endpoint/key 與空白 model；選取清單不默默替換既有 model。清單可能來自快取，成功只能表示這個清單路徑有回應，不能證明當前額度、生成能力或圖片支援。「測試模型」另送固定短文字，明示可能使用額度，完全不附目前聊天、圖片、口吻或 Jev。

模型清單位址只替換 endpoint 結尾的 `/chat/completions`，保留部署前綴與 query；其他路徑要求使用者明確提供同源清單 URL，不猜測站點根目錄。請求取消、切換 provider 或修改欄位後，舊診斷結果不可回填新設定。

目前仍保留原 GM storage key，以資料的 `version` 遷移設定；各 provider profile 保存獨立 key。舊 `copilot` 根據原本 loopback 4141／3001 endpoint 分流，其他位址保留為 custom，不覆寫使用者 URL/model。key 不跨 origin 或 API base path 沿用；TypeSafe 與 Vercel 憑證也分開。

### 選取、圖片與凍結快照

選取視窗可逐則修正文字與發話者、勾選訊息與圖片。視窗開啟時固定一份訊息快照，背景繼續累積新文字但不改動畫面排序，自動生成暫停。關閉後恢復近期文字更新，新增圖片維持未選狀態。群組指定回覆對象不代表將其他人的話視為該對象發言。

Meta 聊天圖片採明確 opt-in；未選圖片及影片／語音／貼圖只保留附件存在提示。選取超過資料量上限時直接要求調整，不隱藏截斷後繼續呼叫。只有確認主模型與代理支援圖片的 profile 才允許附圖；本版使用 Chat Completions 的 `image_url` content part，傳入轉換後的 data URL，並以訊息順序與發話者資訊對應圖片。

每次最多四張 JPEG／PNG／WebP；來源每張最多 12 MiB，長邊縮到最多 1600 px 並轉為 JPEG，輸出合計最多 8 MiB。只下載支援的 Meta CDN、同源 blob 或受限的 data URL；不附主模型 key 至圖片來源。下載、解碼、格式或大小檢查失敗即停止生成，不改為忽略圖片。圖片請求與模型請求共用可取消的工作生命週期。

這些是本專案的資源與資料傳送限制，不能證明所有模型的多模態接口或特定圖片都可接受。

## Gemini adapter 與自動回覆狀態

AI 網站先做 Gemini：repo 的 [Gemini exporter](../gemini-export-markdown/gemini-export-markdown.user.js) 已有 native user／model DOM 與雜訊清理；[YouTube Gemini Summary](../youtube-gemini-summary/youtube-gemini-summary.user.js) 已有 Quill composer、附件草稿檢查與一次點擊的經驗。v0.3 只重用 DOM 概念，不引入 exporter 的 RPC 攔截、`unsafeWindow` 或網站私有 API。

`/app` 可辨識空白新對話，`/app/<id>` 是已建立對話，`/share/<id>` 僅供讀取。生成狀態為 `idle / streaming / unknown`；停止回答／busy 訊號優先，完成工具列與可辨識 native composer 才構成 idle 證據。沒有 Stop 按鈕或文字暫時不變，都不能單獨證明已完成。Gemini 本版只處理文字。

每次原生 Send 只 click 一次，不以 Enter 作重試；需要新增且符合預期的 user turn 與 composer 清空，才能回報 submitted。只有這個證據成立，空白 `/app` 才能接到新分配的 `/app/<id>`。點擊後取消、換到其他對話或逾時，都回報 unknown 並停止後續送出。

自動生成開啟時，進入聊天室後可直接處理已穩定的最新對方 turn；同一 turn 不因無關 DOM mutation 重複觸發，自己的訊息只更新上下文。自動送出 run 仍需另外手動開始，reload／route／帳號變更後不會恢復舊倒數。候選在倒數期間仍綁定上下文、選取、草稿、對話與 run 的版本；新訊息、使用者編輯或生成狀態變更會取消舊候選。立即模式只省略倒數，不省略這些檢查。

空白 Gemini 的開場是明確例外：可以依使用者目標產生破冰訊息，並計入本次 run；它不是「沒有對方回覆也一直自我續話」的模式。後者另記 [freeform 研究](../../backlog/chat-reply-assistant-freeform.md)。

v0.3 使用同檔 Meta／Gemini registry，保留零建置、raw URL 可安裝的交付方式。更多網站與實際重用需求出現後，再評估 [共用 adapter library](../../backlog/chat-reply-assistant-adapter-library.md)，不在這次導入 broad `@require` 或第三方 adapter framework。

## Userscript 網路、資料與聊天擷取

- `GM_xmlhttpRequest` 加上明確 `@connect` 是預定的跨域路徑。預設列出 Gemini、TypeSafe、Vercel AI Gateway、loopback 與所需的 Meta CDN host，其他遠端服務由使用者新增特定 host。Tampermonkey 文件描述初始與重新導向 host 的授權；Violentmonkey 的具體 enforcement 不應假定與它相同，也不能從頁面內 `fetch` 推論 GM 請求行為。[Tampermonkey](https://www.tampermonkey.net/documentation.php?q=connect)、[Violentmonkey](https://violentmonkey.github.io/api/gm/)
- key 與設定放 GM storage；聊天文字只留在分頁 RAM。GM storage 不是加密保管庫。設定索引用站點與穩定的 thread ID／URL，避免兩個同名對象共用 prompt 或自動產生開關。
- 預設選取最近 50 則、最多 20,000 字元，兩者可調；手動選取超限時阻擋生成。這不等同模型 token 上限。只有明確勾選的圖片可以送到主模型，其他附件不推測內容。
- DOM adapter 必須限制在目前對話，排除 inbox 預覽、側欄、腳本面板、系統提示與輸入中的草稿；用訊息 ID／結構／位置訊號辨識發話者，無可靠訊號時保留未知。
- SPA 換對話時，需要隔離上下文、取消或忽略前一對話的回應；虛擬化列表重掛與往上捲動不能觸發「新收到訊息」。群組預設整段討論，指定參與者只改變回覆目標，不刪掉其他人的上下文。
- 填入 React／rich-text composer 的 DOM，不代表網站狀態已接受內容；需從頁面讀回並驗證。明確要求送出時，仍需新的本人訊息回顯與輸入框清空來確認；無法確認即停止，不重試。

這些是 adapter 的設計要求，需要 synthetic fixture 和真實站點兩種證據。v0.3 延續沒有規整訊息列時的 DOM fallback，以及可存取性標籤與媒體資訊的處理；使用者提供的畫面截圖並非 raw DOM 驗證，不能據此確認特定 selector 或私有欄位。fixture／GM shim 可以檢查解析、race 與請求內容，不能證明網站 DOM、真 manager sandbox、跨域或 localhost 行為。具體證據與未測項目集中在 [VALIDATION.md](./VALIDATION.md)。

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

- [完整模擬個人口吻](../../backlog/chat-reply-assistant-voice-style.md)：先評估使用者選定範例與可編輯 style profile，不在目前版本默默建立長期聊天資料庫。
- [OpenCode bridge](../../backlog/chat-reply-assistant-opencode-bridge.md)：把 session/message 協定轉換成純文字回覆服務，處理認證、工具權限與 session 隔離。
- 真站點 DOM 樣本、TM／VM 跨域、localhost、帳號語系與群組辨識是目前版本的驗證工作，記在 [VALIDATION.md](./VALIDATION.md)，不把它們混入 future feature backlog。

- [自我續話與自由續聊](../../backlog/chat-reply-assistant-freeform.md)：區別沒有新對方 turn 的續話與目前 Gemini 破冰／往返流程。
- [Grok／Character.ai](../../backlog/chat-reply-assistant-ai-platforms.md)：先取得當前 DOM 與串流、草稿、送出確認證據。
- [共用 adapter library](../../backlog/chat-reply-assistant-adapter-library.md)：更多網站成熟後再評估抽離，並檢查實際重用需求。
