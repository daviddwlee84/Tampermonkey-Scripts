# 08 · 發佈與同步

多台機器、多個瀏覽器 profile，怎麼不用每次手動匯入一遍。

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
           bootstrap / 設定同步
```

| 層                  | 負責                                       |
| ------------------- | ------------------------------------------ |
| **Git**             | 原始碼、歷史、diff、rollback、branch        |
| **`@updateURL`**    | 部署：把新版推到所有已安裝的機器            |
| **Manager Sync**    | bootstrap：新機器一次把所有腳本裝起來       |

這兩件事**是不同機制**，別搞混：

```text
GitHub repo → @updateURL       = code distribution（發佈）
Drive/WebDAV → Manager Sync    = state synchronization（狀態同步）
```

## 設定自動更新

每支腳本的 metadata 加上：

```js
// @version      0.3.2
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chatgpt-export/chatgpt-export.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/chatgpt-export/chatgpt-export.user.js
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

**`@version` 是唯一的判斷依據。**改了 code 卻沒動版本號，其他機器永遠不會更新。
這是最常見的「我明明推上去了但沒生效」。

本 repo 的 `npm run check` 會驗證這兩個 URL 指向正確的 raw 路徑，
但**它無法知道你有沒有記得加版本號**——那是 commit 前的自覺。

### 版本號慣例

用 `X.Y.Z`：

- `Z` bug fix、selector 微調
- `Y` 加功能
- `X` 破壞性改動（設定格式改了、行為大改）

### 更新頻率

Tampermonkey 預設每天檢查一次。要立刻拿到新版：
Dashboard → 該腳本 → **Check for userscript updates**。

## 新機器 bootstrap：第一次怎麼把腳本裝進去

只用 GitHub 的話，第一次要手動裝一輪，之後就全自動。所以不是
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

### ⚠️ 不要用「New from file」/「Import from zip」

這兩個看起來也能把腳本弄進去，但意義完全不同：

| 選項                     | 實際上是                                        |
| ------------------------ | ----------------------------------------------- |
| **Install from URL**     | ✅ 從遠端安裝，記住來源 → 自動更新可用            |
| New from file            | ⚠️ 從本機檔案建立一份**副本**                    |
| Import from zip / Sync   | ⚠️ 還原 manager 自己的備份，是 **state**，不是 code |

`New from file` 匯入的腳本雖然 metadata 裡有 `@downloadURL`，
但它是「本機來源」的一份拷貝，很容易變成和 repo 各自演化的兩份。
`Import from zip` 更是另一回事——那是還原整個 manager 的狀態（見下面的 Sync 段落）。

**規則**：code 走 URL，state 走 zip / Sync。

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

Tampermonkey 的 **Script Sync** 支援 Google Drive、Dropbox、WebDAV、
Browser Sync，較新版本另外加了 Amazon S3。

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

衝突時官方的規則是：**修改時間較新的那份勝出。**

新機器就變成：

```text
安裝 Tampermonkey
  → 開啟 Script Sync
  → 腳本自己出現
```

Violentmonkey 也有類似的雲端同步（Dropbox / OneDrive / Google Drive / WebDAV）。

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
