// api/vnindex-alert.js - Serverless Monitor for VN-INDEX (+/- 15 Points Telegram Alert)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

let lastAlertState = null;
let lastAlertTimestamp = 0;

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN || !chatId) {
    console.warn("Thiếu BOT_TOKEN hoặc chatId để gửi cảnh báo VN-INDEX");
    return false;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });
    return res.ok;
  } catch (err) {
    console.error("sendTelegram error:", err);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { test = "false", chatId = DEFAULT_CHAT_ID } = req.query;
  const isTest = test === "true" || test === "1";

  if (!chatId) {
    return res.status(400).json({ error: "Chưa cấu hình TELEGRAM_CHAT_ID" });
  }

  try {
    // 1. Kéo dữ liệu chỉ số VN-INDEX thời gian thực từ VPS
    let curIndex = 0;
    let refIndex = 0;
    let diff = 0;
    let pct = 0;
    let timeStr = "";

    try {
      const vpsRes = await fetch('https://bgapidatafeed.vps.com.vn/getlistindexdetail/10', {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(2000)
      });
      if (vpsRes.ok) {
        const vpsData = await vpsRes.json();
        if (Array.isArray(vpsData) && vpsData.length > 0) {
          const item = vpsData[0];
          curIndex = parseFloat(item.cIndex) || 0;
          refIndex = parseFloat(item.oIndex) || curIndex;
          diff = curIndex - refIndex;
          pct = refIndex > 0 ? (diff / refIndex) * 100 : 0;
          timeStr = item.time || "";
        }
      }
    } catch (e) {
      console.warn("Lỗi kéo VPS index:", e.message);
    }

    // Fallback qua Entrade nếu VPS nghẽn
    if (curIndex === 0) {
      const now = Math.floor(Date.now() / 1000);
      const enRes = await fetch(`https://services.entrade.com.vn/chart-api/v2/ohlcs/index?from=${now - 86400 * 3}&to=${now}&symbol=VNINDEX&resolution=1D`, {
        signal: AbortSignal.timeout(2500)
      });
      if (enRes.ok) {
        const enData = await enRes.json();
        if (enData && enData.c && enData.c.length > 1) {
          const len = enData.c.length;
          curIndex = parseFloat(enData.c[len - 1]);
          refIndex = parseFloat(enData.c[len - 2]);
          diff = curIndex - refIndex;
          pct = refIndex > 0 ? (diff / refIndex) * 100 : 0;
        }
      }
    }

    const THRESHOLD = 15.0;
    const isTriggered = Math.abs(diff) >= THRESHOLD || isTest;
    let alertSent = false;

    if (isTriggered) {
      const nowMs = Date.now();
      const alertType = diff >= 0 ? "UP_15" : "DOWN_15";

      // Cooldown 30 phút nếu không phải test
      const COOLDOWN_MS = 30 * 60 * 1000;
      const canSend = isTest || (lastAlertState !== alertType) || ((nowMs - lastAlertTimestamp) >= COOLDOWN_MS);

      if (canSend) {
        const isUp = diff >= 0;
        const sign = isUp ? "+" : "";
        const icon = isUp ? "🚀 🟢" : "⚠️ 🔴";
        const title = isUp ? "VN-INDEX BÙNG NỔ TĂNG TRÊN 15 ĐIỂM!" : "VN-INDEX ĐIỀU CHỈNH MẠNH TRÊN 15 ĐIỂM!";
        const advice = isUp
          ? "Thị trường hưng phấn mạnh! Cơ hội thuận lợi để chủ động chốt lời từng phần hoặc cơ cấu danh mục sang các mã khỏe."
          : "Áp lực bán tháo diện rộng! Giữ vững kỷ luật, tuyệt đối không hoảng loạn bán đáy những mã cơ bản tốt, ưu tiên quản trị tiền mặt.";

        const message = `🏛️ <b>[CẢNH BÁO BIẾN ĐỘNG THỊ TRƯỜNG]</b> ${icon}\n━━━━━━━━━━━━━━━━━━━\n<b>${title}</b>\n\n• <b>Điểm số hiện tại:</b> <b>${curIndex.toFixed(2)} điểm</b>\n• <b>Biến động:</b> <b>${sign}${diff.toFixed(2)} điểm (${sign}${pct.toFixed(2)}%)</b>\n• <b>Thời gian:</b> <i>${timeStr || new Date().toLocaleTimeString('vi-VN')}</i>\n\n💡 <b>Hành động định lượng:</b>\n<i>${advice}</i>\n\n👉 <i>KwangTae Terminal</i>`;

        alertSent = await sendTelegram(chatId, message);
        if (alertSent) {
          lastAlertState = alertType;
          lastAlertTimestamp = nowMs;
        }
      }
    }

    return res.status(200).json({
      status: "ok",
      curIndex,
      diff,
      pct,
      isTriggered,
      alertSent,
      isTest
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
