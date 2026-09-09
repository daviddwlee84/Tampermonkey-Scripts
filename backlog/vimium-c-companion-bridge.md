# Vimium C Companion 互動橋接

Status: needs evaluation
Priority / effort: P? / XL
Last reviewed: 2026-09-09

## 背景與目前決策

使用者希望除了小抄，也能選擇互動功能。v0.1 先實作獨立 userscript 指南，設定標示互動模式尚未提供。原生 Vimium C 執行所有導覽；Companion 不從觀察鍵盤事件推論原生命令是否成功，也不宣稱知道當前原生模式。

## 已確認的介面邊界

- `f` 能點到 Companion 控制項，只證明原生擴充能辨識頁面 DOM；不能據此推斷監聽器順序、模式讀取或執行 API。
- [manifest](https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/manifest.json) 沒有開放一般網頁的 `externally_connectable.matches`。[Chrome 規則](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable) 區分網頁與 extension 呼叫者。
- 原生 [onMessageExternal](https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/main.ts#L125) 接受 id、inject、command、shortcut，並有 extension allowlist；没有 getMode／getKeymap／getConfig 或模式訂閱，command 回覆也不是執行成功回條。
- `VApi` 與 options／popup 的內部頁面訊息不是給一般 userscript 使用的穩定 API。內容腳本有 [isolated world](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) 邊界。
- [原生按鍵處理](https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/content/key_handler.ts) 會過濾不可信事件；合成 KeyboardEvent 不適合當命令後端。
- [sendToExtension](https://github.com/gdh1995/vimium-c/wiki/Send-dynamic-messages-to-other-extensions) 是原生到其他 extension 的訊息，不是自動暴露完整設定／即時模式。

## 方案比較

| 方案                        | 好處                        | 代價／限制                                                         |
| --------------------------- | --------------------------- | ------------------------------------------------------------------ |
| userscript + 合作 extension | 保留現有 UI 與 manager 儲存 | 需另裝橋接、設定 allowlist、驗證來源／tab／frame；仍缺權威模式讀取 |
| 獨立 Companion WebExtension | UI 與命令能力放在同一產品   | 打包、權限、商店與不同瀏覽器維護成本                               |
| 私有 VApi／合成按鍵         | 不採用                      | 依賴私有實作，無法可靠回報命令成功與模式                           |

## 下一次從哪裡開始

1. 重新核對 upstream 外部訊息協定與版本。
2. 在隔離測試 profile 製作最小合作 extension，測試允許的 command／shortcut、tab／frame 路由及回覆語意。
3. 在能確認的能力範圍內設計 UI；沒有模式 API 時，保留手動練習分類，不顯示假同步狀態。
4. 若互動成為核心需求，優先比較直接 Companion WebExtension，避免永久維護 userscript + bridge 兩個安裝單位。
5. 只有提供可驗證的後端與失敗處理後，才啟用互動模式選項。
