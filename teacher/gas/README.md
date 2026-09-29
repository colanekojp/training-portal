# JLPT 老師檢閱 API（獨立 GAS）

這份 GAS 是獨立的老師統計服務，不需修改學生端既有 GAS，也不會寫入 N1／N2／N3 原始題庫、`attempts` 或 `responses`。

## 為什麼使用統計快取

學生作答資料增加後，若老師每切一次回數就掃描整張 `responses`，載入時間會隨資料列數變長。這份 API 改採：

1. 每 5 分鐘在背景掃描一次原始資料。
2. `responses` 每 10,000 列分批處理，降低記憶體尖峰。
3. 統計寫進 API 自己建立的快取試算表。
4. 老師畫面只讀某一回約 30–50 列快取。

前端使用無自訂 header 的 GET 讀取 GAS；Apps Script 與轉址後的
`googleusercontent.com` 都會回傳 `Access-Control-Allow-Origin: *`，因此不會觸發 POST 的跨網域問題。

因此一般開頁、切換回次很快；資料量增加主要影響背景更新，不影響每一次老師操作。

## 安裝

1. 到 <https://script.google.com/> 新增「獨立專案」，例如命名為 `JLPT 老師檢閱 API`。
2. 將 [Code.gs](./Code.gs) 全部貼進專案的 `Code.gs`。
3. 在函式選單選擇 `setupTeacherDashboard`，執行並完成授權。
4. 執行記錄會顯示「JLPT 老師檢閱統計快取」試算表網址，以及 N1／N2／N3 各自的統計列數與耗時。
5. 點「部署 → 新增部署作業 → 網頁應用程式」：
   - 執行身分：我
   - 誰可以存取：任何人
6. 複製 `/exec` 網址，貼到前端 [config.js](../js/config.js) 的 `API_URL`。

這個版本不要求老師存取碼；知道老師頁或 API 網址的人即可讀取彙總統計與題目正解。API 不回傳個別學生姓名或學號。

## 本機預覽

不要直接雙點 `teacher/index.html`（`file://` 頁面會被瀏覽器限制跨網域連線）。
請在 `training-portal` 目錄啟動本機伺服器：

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

再開啟 <http://127.0.0.1:4173/teacher/>。正式發布成 HTTPS 後不會有這個問題。

## 更新方式

- `setupTeacherDashboard` 會自動建立每 5 分鐘更新一次的觸發條件。
- 老師頁的「更新統計」按鈕可以手動立即重建快取。
- 重新部署新版本時，沿用同一個 Web App deployment，即可保留 API URL。

## 來源與寫入範圍

- 唯讀：N1／N2／N3 文法題庫試算表、主要點名表的對應等級點名表。
- 寫入：獨立 GAS 自己建立的「JLPT 老師檢閱統計快取」。
- 不修改：學生端 GAS、原始 `units`、`questions`、`attempts`、`responses`。
