# 08 · 發佈與同步

多台機器、多個瀏覽器 profile，怎麼不用每次手動匯入一遍。

要直接把目前工作區的腳本搬到 iPad Userscripts，可用 `just sync-ipad`（USB）或
`just sync-folder`（本機／iCloud），第一次設定見 [15 · 同步到 iPad](./15-sync-to-ipad.md)。

## 三層機制，各司其職

```text
                   GitHub
              source of truth
                     │
               git push
                     │
              *.user.js
                     │
         @updateURL / @downloadURL
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
     Chrome A     Chrome B      Firefox
        ▲            ▲             ▲
        └────────────┼─────────────┘
                     │
             Tampermonkey Sync
           bootstrap / 可選同步
```

| 層               | 負責                                   |
| ---------------- | -------------------------------------- |
| **Git**          | 原始碼、歷史、diff、rollback、branch   |
| **`@updateURL`** | manager 檢查新版，配合下載來源更新程式 |
| **Manager Sync** | bootstrap：新機器一次把所有腳本裝起來  |

這兩件事**是不同機制**，別搞混：

```text
GitHub repo → @updateURL       = code distribution（發佈）
Drive/WebDAV → Manager Sync    = manager 定義的同步範圍
```

還要把 **腳本寫入的 GM values** 單獨看待：`GM_setValue` 保存的是某個 manager／profile 中，
某份已安裝腳本的資料。Script Sync 會同步哪些原始碼、安裝設定與 values，取決於 manager、
版本、服務及選項，不能因為「腳本出現在另一台電腦」就推斷「腳本的設定也完整同步」。

| 資料               | 例子                                | 可靠的移轉方式                                            |
| ------------------ | ----------------------------------- | --------------------------------------------------------- |
| 腳本原始碼         | `.user.js`、版本與 metadata         | GitHub raw URL／manager 更新                              |
| manager 的安裝狀態 | 已安裝清單、啟用與更新選項          | 核對 manager 的同步／備份選項                             |
| 腳本 GM values     | Vim Navigation 鍵位、主題、本站規則 | 腳本的 JSON 匯出／匯入，或明確包含 values 的 manager 備份 |
| 頁面記憶體         | Insert／Visual、本頁暫停、暫時搜尋  | 重新建立；不當成可同步的設定                              |

## 設定自動更新

每支腳本的 metadata 加上：

```js
// @version      0.3.2
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chatgpt-export-markdown/chatgpt-export-markdown.user.js
```

流程：

1. manager 定期抓 `@updateURL`，只讀 metadata
2. 比對 `@version`

```text
local     0.3.2
remote    0.3.3
             ↑
          有更新
```

3. 有新版就從 `@downloadURL` 抓完整腳本

**一般自動更新需要提高 `@version`。**只改程式碼、維持同一版本，不能期待已安裝的腳本自動跟進。
是否更新還受到 manager 的更新開關、來源 URL、網路及本機修改處理政策影響；手動重裝或匯入也和
自動版本檢查不同。[Violentmonkey metadata 說明](https://violentmonkey.github.io/api/metadata-block/#downloadurl)
亦說明下載來源與缺少版本號時的限制。

本 repo 的 `npm run check` 會驗證這兩個 URL 指向正確的 raw 路徑，
但**它無法知道你有沒有記得加版本號**——那是 commit 前的自覺。

### 版本號慣例

用 `X.Y.Z`：

- `Z` bug fix、selector 微調
- `Y` 加功能
- `X` 破壞性改動（設定格式改了、行為大改）

### 更新頻率

更新頻率以目前 manager 設定為準。要立刻拿到新版，可使用：
Dashboard → 該腳本 → **Check for userscript updates**。

## 新機器 bootstrap：第一次怎麼把腳本裝進去

只用 GitHub 的話，第一次要手動裝一輪；更新設定正確時，之後可由 manager 自動檢查。所以不是
「每次都重新匯入」，而是**每個 browser profile bootstrap 一次**。

### 方法 A：Install from URL（最可靠，建議用這個）

**Violentmonkey**：Dashboard → 左上角 `+` → **Install from URL** → 貼上 raw 網址

**Tampermonkey**：Dashboard → **Utilities** 分頁 → **Install from URL** 欄位 → 貼上 → Install

網址格式：

```text
https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/<slug>/<slug>.user.js
```

manager 會先顯示確認頁，列出這支腳本的 `@match`、`@grant`、`@connect`，
確認後才安裝。**安裝來源會被記下來**，所以之後的自動更新直接就能運作。

### 方法 B：直接在瀏覽器打開 raw 網址

manager 會攔截以 `.user.js` 結尾的網址並跳出安裝畫面。
README 那張自動產生的表格裡，Install 連結就是這種網址。

⚠️ 但這招在 Chromium 系瀏覽器上**不一定穩**——瀏覽器有時會直接把檔案下載下來
而不是交給 manager 攔截。遇到這種情況就改用方法 A。

### 本機檔案與 ZIP 也能安裝，但要核對來源與資料

這兩個看起來也能把腳本弄進去，但意義完全不同：

| 選項                 | 實際上是                                                |
| -------------------- | ------------------------------------------------------- |
| **Install from URL** | 從遠端安裝，來源容易核對；本 repo 的一般安裝方式        |
| New from file        | 從本機內容建立／更新腳本；檢查 metadata、身分與更新設定 |
| Import from zip      | 還原 ZIP 內實際包含的腳本與資料；內容受匯出選項影響     |

不能一概說本機匯入的腳本不會更新：保留有效的 `@updateURL`／`@downloadURL`、版本與 manager
更新設定時，仍可能正常檢查新版。本機複製、ZIP 還原後，應確認實际安裝內容、來源、腳本身分，
以及是否包含預期的 values。[Violentmonkey metadata](https://violentmonkey.github.io/api/metadata-block/#downloadurl)
把下載 URL 定義為更新來源；不是只以「是否從檔案匯入」決定。

建議以 URL 管理一般程式碼安裝，以有明確內容的 JSON／ZIP 管理備份；本地開發仍可用檔案匯入。

### 確認更新設定有開

裝完之後到 Settings 檢查（以 Violentmonkey 為例）：

```text
Update
  Check for script updates every [1] day(s)     ← 不要填 0，0 = 停用
  ☑ Notify script updates                        ← 建議打開
```

`Notify script updates` 預設是關的。開起來的話，你 push 新版之後
其他機器會主動告訴你「更新了」，不然它會安靜地更新，你不會知道版本何時生效。

要立刻拉一次更新：Dashboard 上那個**重新整理圖示**（`+` 旁邊）就是
「檢查所有腳本的更新」。

## Manager 內建同步

可以把「第一次 bootstrap」也省掉。

Tampermonkey 的 **Script Sync** 提供 Google Drive、Dropbox、WebDAV、Browser Sync 等選項；
實際可用服務與條件以目前版本為準。Browser Sync 還有容量與腳本來源限制，不能直接當成完整備份。
[Tampermonkey 官方同步說明](https://www.tampermonkey.net/faq.php?q=Q105)

```text
Mac A
Tampermonkey
    │
    ├── Script A
    ├── Script B
    └── Script C
          │
          ▼
      Google Drive
          │
     ┌────┴────┐
     ▼         ▼
 Windows      Mac B
```

Tampermonkey 官方同步說明的衝突規則是：**修改時間較新的那份勝出。**

新機器就變成：

```text
安裝 Tampermonkey
  → 開啟 Script Sync
  → 腳本自己出現
```

Violentmonkey 也有類似的雲端同步（Dropbox / OneDrive / Google Drive / WebDAV）。
[可用服務見官方說明](https://violentmonkey.github.io/)。這些是 manager 同步功能，
不表示任意腳本的 GM values 都會跟著移轉；需要 values 時，確認明確的同步／匯出選項。

### 移轉腳本設定的驗證流程

1. 在來源 profile 匯出腳本提供的設定 JSON；若使用 manager ZIP，確認有勾選需要的腳本資料／values。
2. 在目標 profile 安裝相同腳本，核對 `@name`、`@namespace`、版本與更新來源。
3. 匯入設定，再實際確認一個自訂鍵位、主題與本站設定；不要只看腳本清單。
4. 完成核對後才清理舊副本；刪除／重裝腳本或 manager 可能改變儲存身分，不能假設資料一定沿用。

同一腳本的一般版本更新通常保留 GM values；另存副本、改名稱／namespace、換 manager 或 profile
則不能保證。以 Vim Navigation 為例，`vimNavigationConfig` 包含全域設定與 `sites[origin]`；
設定內的「下載 JSON」可備份這些資料，本頁暫停與目前選取不在備份範圍。

### ⚠️ 兩者一起用時的注意事項

Sync 會把**你在 manager 編輯器裡的修改**同步出去。如果在某台機器上直接改了
manager 裡的腳本，就會出現：

```text
repo         v0.3.2   ← 你以為的 master
Sync 那份    v0.3.2 但內容不同   ← 實際跑的
```

規則很簡單：**修改一律回 repo 改，manager 編輯器只用來看和 debug。**

## public 還是 private repo

**優先 public**，只要腳本裡沒有 secret。

`raw.githubusercontent.com` 作為公開的 `@updateURL` 最簡單。
private repo 的 raw URL 需要 token 認證，manager 抓不到。

而且：

```js
const OPENAI_KEY = 'sk-...'; // ❌ 絕對不要
```

**userscript 裡本來就不該有 secret**——它跑在使用者的瀏覽器裡，
public 或 private repo 都救不了。詳見 [12 安全性](./12-security.md)。

真的有 private 需求時的選項：

```text
private Git repo
       +
WebDAV / S3
       +
Manager Sync
```

或自建一個需要認證的分發端點。

## 發佈到腳本市集（選用）

想讓別人找得到的話，可以額外發到
[Greasy Fork](https://greasyfork.org/) 或 [OpenUserJS](https://openuserjs.org/)。
它們會提供自己的 `@updateURL`，等於多一個分發管道。

自己用的話 GitHub raw 就夠了。

## 下一步

[09 · Manager 比較](./09-managers-comparison.md)
