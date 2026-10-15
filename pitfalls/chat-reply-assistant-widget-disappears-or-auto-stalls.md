# 切換聊天室後工具列消失，或新訊息一直不觸發自動生成

**症狀關鍵字**：Chat Reply Assistant、SPA、工具列消失、widget disappears、auto stalls、同名聊天室、fallback title、shared message、ambiguous、peer display name、metadata 更新。
**首次發現**：2026-09。
**影響範圍**：Chat Reply Assistant v0.1／v0.2 的聊天室綁定與自動生成判斷；新 adapter 也可能重現相同設計錯誤。
**狀態**：已於 v0.3 修正。實際瀏覽器、manager 與站點驗證範圍以 [VALIDATION.md](../userscripts/chat-reply-assistant/VALIDATION.md) 為準；這不是尚待實作的 TODO。

## 症狀與重現條件

通常沒有 exception 或終端錯誤，而是控制器一直停在等待／暫停狀態：

1. 在同一 SPA 分頁由聊天 A 切換到 B，URL 已改變，原生輸入框仍可見，工具列卻消失或永遠無法使用。
2. A、B 沒有可核對的 DOM 對話 ID，使用相同 fallback 標題；或者兩邊剛好都有「好」等短訊息、共同群組成員或其他少量重疊內容。
3. 向上捲動載入過舊訊息後，即使回到最新、已辨識出新的對方訊息，自動生成仍一直暫停。
4. 泡泡位置足以區分自己／他人，但 DOM 沒有顯示對方姓名；畫面能擷取文字，自動生成卻不觸發。

另有相反方向的危險：為了消除等待，直接把 URL 的 conversation ID 填入 snapshot 的 `identity`，或把標題變更當成原生身分證據。這會讓舊 DOM 在路由先更新時被綁到新聊天室。

## 原因

### 1. 把弱訊號設成永久否決條件

舊判斷可簡化為：

```js
if (
  newSnapshot.title === retiredSnapshot.title ||
  newSnapshot.messages.some((message) => previousMessageIds.has(messageIdentity(message)))
) {
  return; // 永遠不接受新聊天室
}
```

相同 fallback 標題可能永遠不變，任一共同訊息也不代表整個畫面仍屬於舊聊天。即使新的有序訊息視窗已經穩定，這個條件仍永久拒絕它。若 UI 掛載又依賴「已可信地擷取訊息」，使用者連診斷與確認入口都看不到。

### 2. 把局部歷史不確定性鎖成整段聊天的永久狀態

例如 `current.ambiguous ||= result.ambiguous` 配合「只要 ambiguous 就不自動生成」。一次無重疊的虛擬化視窗、舊訊息重掛或排序無法對齊，就會讓後續完全可信的新尾段一起失效。

### 3. 混淆訊息角色與顯示姓名

要求每則他人訊息都必須有 `sender`／display name，會擋住沒有姓名但能確認方向的訊息。「不知道對方叫什麼」與「不知道這是自己還是他人」不是同一種不確定性。名稱缺失可以顯示「其他人」；最新待回覆 turn 的角色仍須可辨識。

### 4. 把 metadata 變化當成新的訊息或換對話證據

同一則原生訊息可能晚一點才出現作者名稱／ID，sender source 也可能從位置推論升級成原生標籤；圖片 CDN 的簽章 URL 會刷新。這些變更應更新預覽與可用媒體資料，不應產生新的 turn、重新追加同一則訊息或把它當成新聊天室。

## 修正方式

- **分開定位畫面與判定綁定可信度。** `locateSurface` 先找可用的原生輸入區，讓工具列、診斷與必要的確認入口保持可見；只有綁定就緒後才把內容併入該聊天室歷史，並開放生成／送出。找到 composer 本身不等於已確認對話。
- **使用有期限、可人工確認的綁定流程。** 區分 `settling`、`needs-confirmation` 與 `ready`，比較完整的有序訊息視窗，不再用同一 fallback 標題或任一共同訊息作永久否決。仍是舊畫面時等待，無法自動確認時顯示明確確認入口。
- **原生身分證據必須真的來自 DOM。** URL 只表示目前要求的路由；標題也是提示，單獨改標題不能證明訊息已切換。沒有原生對話識別碼就回報 `identity: null`，不能用 route ID 冒充。Gemini adapter 有專門回歸測試檢查這點。
- **把不確定性限定在舊段落。** 無法對齊的歷史標記為 `orderUncertain`，保留供人工查看、預設不納入自動選取；最新可信視窗可以繼續工作。只有目前選取包含這些舊段落，或最新 turn 本身不可信時，才阻擋自動回覆。
- **保留角色、姓名與辨識來源的區別。** 原生方向／角色優先；位置推論要標示來源並遵守使用者的左右設定。名稱可缺失，真正未知的最新角色不能假裝成 `other`。早期未知姓名或有標記的未知角色，不應把整個聊天永久封鎖。
- **分開內容身分與 metadata 刷新。** 同一原生訊息更新 sender 或媒體 URL 時，保留 UID、人工排除、文字修正與圖片勾選；可更新 view signature，但不能當成新的 appended 訊息或路由身分證據。

這些修正不代表改成看到任何新節點就接受；錯誤的處理方式包括移除所有可信度檢查、把 URL 當 DOM ID，以及在送出結果未知時重試。

## 回歸測試與驗證

```sh
npm run test:chat-reply-assistant
```

- [歷史與綁定測試](../tests/chat-reply-assistant-history.test.mjs)：相同 fallback 標題、少量重疊、只改標題、UID 重用、metadata 刷新、舊段落與快取上限。
- [控制器測試](../tests/chat-reply-assistant-automation.test.mjs)：換聊天時保留工具列並等待新 DOM、進入穩定來訊後只生成一次、自己的新訊息不觸發續說，以及倒數中收到新內容時丟棄舊候選。
- [Meta adapter 測試](../tests/chat-reply-assistant-meta.test.mjs)：匿名左右角色、空聊天室定位、原生語義優先、草稿與單次 Send 確認。
- [Gemini adapter 測試](../tests/chat-reply-assistant-gemini.test.mjs)：URL ID 不冒充 DOM 身分、未知生成狀態、草稿更新、route handoff 與點擊後不重試。
- [匿名診斷測試](../tests/chat-reply-assistant-diagnostics.test.mjs)：可匯出結構問題，不帶聊天本文、帳號、URL、DOM ID、key 或輸入值。

fixtures 驗證可控條件下的狀態機與 DOM 規則；真 manager 的安裝／執行通過也不等於所有登入帳號的實頁 DOM 都通過。不要把其中一種證據擴張成其他層的相容性承諾。

## 相關文件

- [設計與研究依據](../userscripts/chat-reply-assistant/RESEARCH.md)
- [驗證紀錄與未測邊界](../userscripts/chat-reply-assistant/VALIDATION.md)
- [使用方式與對話確認](../userscripts/chat-reply-assistant/README.md)
- [實際發布腳本](../userscripts/chat-reply-assistant/chat-reply-assistant.user.js)
