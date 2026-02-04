/**
 * スクリプトプロパティからAPIキーを取得
 */
function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle('Cooking Metrics Studio');
}

/**
 * Gemini 2.0 API 呼び出し
 */
function callGemini(payload) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません。");

  // ユーザー様ご指摘の通り、2.0-flash を使用
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const resultText = response.getContentText();
  
  if (response.getResponseCode() !== 200) {
    throw new Error("API Error (" + response.getResponseCode() + "): " + resultText);
  }

  const json = JSON.parse(resultText);
  const rawContent = json.candidates[0].content.parts[0].text;
  
  // JSON部分だけを抽出
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("JSON抽出失敗");
  
  return JSON.parse(jsonMatch[0]);
}

/**
 * GitHubからハンドブックを直接取得（キャッシュ付き）
 */
function getManualFromGithub() {
  const cache = CacheService.getScriptCache();
  const cachedManual = cache.get("cooking_manual");
  
  if (cachedManual) return cachedManual;

  // Rawデータの直URL
  const rawUrl = "https://raw.githubusercontent.com/Human-Life-Metrics-Studio/CookingMetricsHandbook/main/docs/handbook.md";
  
  try {
    const response = UrlFetchApp.fetch(rawUrl);
    const content = response.getContentText();
    
    // 1時間（3600秒）キャッシュに保存
    cache.put("cooking_manual", content, 3600);
    return content;
  } catch (e) {
    console.error("マニュアル取得失敗: " + e.message);
    return "基準に従って分析してください。"; // 失敗時のフォールバック
  }
}

/**
 * 画像分析（マニュアル適用 ＆ 以前の出力形式を維持）
 */
function analyzeCookingWithImage(base64Data, menuHint) {
  const manual = getManualFromGithub();
  
  const payload = {
    contents: [{
      parts: [
        { inline_data: { mime_type: "image/jpeg", data: base64Data } },
        { text: `以下のマニュアルを前提知識として読み込め。\n\n${manual}\n\n上記を踏まえ、分析対象（${menuHint || "この料理"}）を分析せよ。出力は必ず以下のCooking Metrics Ver4.16形式のJSONのみとし、余計な文章は一切含めるな。\n\n{"menu":"料理名","ingredients":"食材","cost_val":300,"time_val":20,"nutrition_val":5,"satisfaction_score":0.0,"maint_score":0.3,"comment":"コメント"}` }
      ]
    }]
  };
  return callGemini(payload);
}

/**
 * テキスト分析（マニュアル適用 ＆ 以前の出力形式を維持）
 */
function analyzeCooking(data) {
  const manual = getManualFromGithub();
  
  const payload = {
    contents: [{
      parts: [{
        text: `以下のマニュアルを前提知識として読み込め。\n\n${manual}\n\n上記を踏まえ、料理「${data.menu}」を分析せよ。出力は必ず以下のJSONのみとし、余計な文章は一切含めるな。\n\n{"menu":"${data.menu}","ingredients":"食材","cost_val":300,"time_val":20,"nutrition_val":5,"satisfaction_score":0.0,"maint_score":0.3,"comment":"コメント"}`
      }]
    }]
  };
  return callGemini(payload);
}
/**
 * スプレッドシート保存
 * 指定したファイル名、指定したシート名に書き込む
 */
function saveDataToSheetByName(data) {
  // --- 設定項目 ---
  const TARGET_FILE_NAME = 'CWAR記録表'; // ★ここに保存先のファイル名を入れる
  const TARGET_SHEET_NAME = 'Database';     // ★保存するシート名
  const DASHBOARD_SHEET_NAME = 'DashBoard'; 
  // ----------------

  // 1. ファイル名でスプレッドシートを検索
  const files = DriveApp.getFilesByName(TARGET_FILE_NAME);
  
  if (!files.hasNext()) {
    throw new Error('ファイル「' + TARGET_FILE_NAME + '」が見つかりませんでした。');
  }

  // 最初に見つかったファイルを開く
  const ss = SpreadsheetApp.open(files.next());
  
  // 2. シートを取得（なければ作成）
  let logSheet = ss.getSheetByName(TARGET_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(TARGET_SHEET_NAME);
  }
  
  // 3. データ保存
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['日付', 'メニュー', '食材', '費用スコア', '時間スコア', '栄養スコア', '満足度スコア', '保守性スコア', 'メモ', '重視軸']);
  }
  
  logSheet.appendRow([
    new Date(), 
    data.menu, 
    data.ingredients, 
    data.cost_score, 
    data.time_score, 
    data.nutrition_score, 
    data.satisfaction_score, 
    data.maint_score, 
    data.comment, 
    data.weightedAxisLabel
  ]);

  // 4. DashBoardシートのURLを生成して返す
  const dashSheet = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  let url = ss.getUrl();
  
  if (dashSheet) {
    url += '#gid=' + dashSheet.getSheetId();
  }

  return url;
}

/**
 * スプレッドシート保存 & ダッシュボードURL取得
 * 満足度を重視（重み2）し、A列基準で最終行を特定して保存します。
 */
function saveDataAndGetDashboardUrl(finalData) {
  // --- 設定項目 (変更なし) ---
  const TARGET_FILE_NAME = 'CWAR記録表';
  const TARGET_SHEET_NAME = 'Database';
  const DASHBOARD_SHEET_NAME = 'DashBoard';

  const files = DriveApp.getFilesByName(TARGET_FILE_NAME);
  if (!files.hasNext()) throw new Error('ファイルが見つかりません');
  const ss = SpreadsheetApp.open(files.next());
  const sheet = ss.getSheetByName(TARGET_SHEET_NAME);

  // --- 【修正】GAS側での再計算ロジックを全削除 ---
  // フロントから送られてきた global_cwar と local_cwar をそのまま使う
  const globalCWAR = finalData.global_cwar;
  const localCWAR = finalData.local_cwar;

  // --- 3. 行特定 (変更なし) ---
  const aValues = sheet.getRange("A1:A").getValues();
  let lastRow = 0;
  for (let i = aValues.length - 1; i >= 0; i--) {
    if (aValues[i][0] !== "") { lastRow = i + 1; break; }
  }
  const nextRow = lastRow + 1;

  // 4. 書き込みデータ配列
  const rowData = [
    new Date(),                  // A
    finalData.meal_type,         // B
    finalData.menu,              // C
    finalData.ingredients,       // D
    finalData.cost_score,        // E
    finalData.time_score,        // F
    finalData.nutrition_score,   // G
    finalData.satisfaction_score,// H
    finalData.maint_score,       // I
    finalData.weightedAxisLabel, // J
    globalCWAR,                  // K: そのまま保存
    localCWAR,                   // L: そのまま保存
    "4.16",                      // M
    finalData.cost_raw || 0      // N
  ];

  sheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);

  const dashboardSheet = ss.getSheetByName(DASHBOARD_SHEET_NAME);
  return dashboardSheet ? ss.getUrl() + "#gid=" + dashboardSheet.getSheetId() : ss.getUrl();
}