const GEMINI_API_KEY = "AIzaSyByFY-kvIQYDhp-O07bGegoxzLkl5jQ34k"; 

const TARGET_FILE_NAME = "献立記録簿"; 
const TARGET_SHEET_NAME = "シート1"; 

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setTitle('AI献立アプリ');
}

// 画像・テキストどちらもこの関数に集約させる
function analyzeWithGemini(base64Data, mimeType) {
  return callGeminiAI("", base64Data, mimeType);
}

function askGemini(menuName) {
  return callGeminiAI(menuName, null, null);
}

function callGeminiAI(menuName, base64Data, mimeType) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GEMINI_API_KEY;
  
  // プロンプトを完全に固定
  const promptText = `以下の料理について詳細を日本語のJSONで返してください：${menuName || "添付画像の内容"}
  返却形式：
  {
    "menuInput": "料理名",
    "message": "15字以内の褒め言葉",
    "ingredients": "主な材料",
    "cost": 数値,
    "time": 数値,
    "satisfaction": 数値(-0.3〜0.3),
    "maintainability": 数値(-0.4〜0.3)
  }`;

  const parts = [{ "text": promptText }];
  if (base64Data) {
    parts.push({ "inline_data": { "mime_type": mimeType, "data": base64Data } });
  }

  const payload = {
    "contents": [{ "parts": parts }],
    "generationConfig": { "response_mime_type": "application/json" }
  };

  const response = UrlFetchApp.fetch(url, {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  });

  const responseCode = response.getResponseCode();
  const resText = response.getContentText();

  if (responseCode !== 200) {
    return { "message": "エラー(" + responseCode + ")：しばらく待って再試行してください。" };
  }

  try {
    const json = JSON.parse(resText);
    const aiText = json.candidates[0].content.parts[0].text;
    return JSON.parse(aiText);
  } catch (e) {
    return { "message": "AIの回答を解析できませんでした。" };
  }
}

function finalSave(mealTime, menuName, details) {
  const files = DriveApp.getFilesByName(TARGET_FILE_NAME);
  if (!files.hasNext()) return "ファイル「献立記録簿」が見つかりません。";
  const ss = SpreadsheetApp.open(files.next());
  const sheet = ss.getSheetByName(TARGET_SHEET_NAME);
  const lastRow = sheet.getRange("A:A").getValues().filter(String).length;
  const rowData = [new Date(), mealTime, menuName, details.ingredients, details.time, details.cost, details.satisfaction, details.maintainability];
  sheet.appendRow(rowData);
  return "記録しました！";
}