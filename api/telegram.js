import fs from 'fs';
import path from 'path';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8909883039:AAElr2hemF2WMD5_Wrel_NVhIIf6Dl69dc0';
const GEMINI_KEY = process.env.GEMINI_KEY || process.env.GEMINI_API_KEY || Buffer.from('QVEuQWI4Uk42SnRDMjF1ZkpESmFJT3dPNmJKQkRCVVpfZWJEWlhOeDJtU2pzVHl0OG5za1E=', 'base64').toString('utf-8');
const ALLOWED_CHAT_IDS = (process.env.ALLOWED_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '5951966097')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const API_SECRET = process.env.API_SECRET || '';

function loadPortfolioConfig() {
  const defaultCfg = {
    investor_name: "Nhà đầu tư VIP",
    cash: 0,
    holdings: []
  };

  try {
    const configPath = path.join(process.cwd(), 'portfolio_config.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return { ...defaultCfg, ...JSON.parse(data) };
    }
  } catch (err) {
    console.warn("Lỗi đọc portfolio_config.json:", err.message);
  }
  return defaultCfg;
}

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN) {
    console.warn("TELEGRAM_BOT_TOKEN chưa được cấu hình.");
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

// Danh mục theo dõi trên Terminal
const ALL_SYMBOLS = [
  "VIC", "VHM", "VRE", "GEX", "VIX", "GEE", "VGC", "IDC", "VCB", "MBB", 
  "TCB", "CTG", "STB", "SSI", "VND", "HCM", "VCI", "SHS", "HPG", "HSG", 
  "NKG", "DGC", "DPM", "NVL", "PDR", "DIG", "DXG", "KDH", "FPT", "MWG", 
  "FRT", "MSN", "VNM", "ACV", "VTP", "GMD", "HAH", "VJC", "GAS", "PLX", 
  "PVD", "PVS", "POW", "SAB", "BVH", "HDB", "BID", "TPB", "SHB"
];

async function fetchLiveQuotes(symbols) {
  if (!symbols || symbols.length === 0) return "";
  try {
    const vpsRes = await fetch(`https://bgapidatafeed.vps.com.vn/getliststockdata/${symbols.join(',')}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(1500)
    });
    if (vpsRes.ok) {
      const vpsData = await vpsRes.json();
      if (Array.isArray(vpsData) && vpsData.length > 0) {
        return "BẢNG GIÁ THỜI GIAN THỰC (REALTIME FEED):\n" + vpsData.map(s => {
          const rawLast = parseFloat(s.lastPrice) || parseFloat(s.r) || 0;
          const ave = parseFloat(s.avePrice) || rawLast;
          const ref = parseFloat(s.r) || rawLast;
          const ceil = parseFloat(s.c) || 0;
          const floor = parseFloat(s.f) || 0;
          const m = s.marketId;
          const market = (m === 'UPX' || s.sym === 'ACV') ? 'UPCoM' : ((m === 'STX' || s.sym === 'IDC' || s.sym === 'SHS' || s.sym === 'PVS') ? 'HNX' : 'HOSE');
          const isUpcom = market === 'UPCoM';
          const effectivePrice = isUpcom ? parseFloat(ave.toFixed(1)) : rawLast;
          const dec = isUpcom ? 1 : 2;
          let ot = effectivePrice - ref;
          let chg = ref > 0 ? ((ot / ref) * 100) : 0;
          const sign = ot >= 0 ? '+' : '';
          const extra = isUpcom ? ` | BQ UPCoM: ${effectivePrice.toFixed(1)}k` : ` | Khớp: ${effectivePrice.toFixed(2)}k`;
          return `• ${s.sym} [${market}]: Giá ${effectivePrice.toFixed(dec)}k (${sign}${ot.toFixed(dec)}k, ${sign}${chg.toFixed(2)}%)${extra} | TC: ${ref.toFixed(dec)}k | Trần: ${ceil.toFixed(dec)}k | Sàn: ${floor.toFixed(dec)}k | KL: ${(parseFloat(s.lot)||0).toLocaleString('vi-VN')} CP`;
        }).join('\n');
      }
    }
  } catch (_) {}
  return "";
}

async function askGemini(userQuery, radarData, isAuthorizedUser, portfolio) {
  if (!GEMINI_KEY) return null;

  const vibe = radarData?.vibe_score ?? 50.0;
  const vibe_status = radarData?.vibe_status ?? "TÍCH LŨY / CÂN BẰNG";
  const breadth = radarData?.market_breadth ?? 50.0;
  
  // 1. Kiểm tra hỏi về Danh mục
  const isAskingPortfolio = /DANH MỤC|DANH MUC|CƠ CẤU|CO CAU|TÀI KHOẢN|TAI KHOAN|TỔNG TÀI SẢN|SỐ DƯ/i.test(userQuery);
  let portfolioContext = "";
  if (isAskingPortfolio && isAuthorizedUser) {
    const holdingsStr = portfolio.holdings?.map(h => `• ${h.symbol}: ${h.qty} CP (vốn ${h.avg_price}k)`).join('\n') || "Chưa có mã nắm giữ";
    portfolioContext = `
HỒ SƠ TÀI SẢN KHÁCH HÀNG:
- Tên khách hàng: ${portfolio.investor_name}
- Tiền mặt sẵn có: ${(portfolio.cash || 0).toLocaleString('vi-VN')} VNĐ
- Danh mục cổ phiếu:
${holdingsStr}`;
  }

  // 2. Tìm mã cổ phiếu được nhắc tới trong câu hỏi
  const queryUpper = userQuery.toUpperCase();
  let matchedSymbols = ALL_SYMBOLS.filter(s => {
    const reg = new RegExp(`\\b${s}\\b`);
    return reg.test(queryUpper);
  });

  if (matchedSymbols.length === 0) {
    matchedSymbols = ["VHM", "SSI", "HPG", "FPT"];
  }

  const liveQuoteStr = await fetchLiveQuotes(matchedSymbols);

  // 3. Trích xuất dữ liệu định lượng từ Radar
  let stockDataStr = "";
  if (radarData?.radar && Array.isArray(radarData.radar)) {
    const matched = radarData.radar.filter(r => matchedSymbols.includes(r.symbol));
    const oversold = [...radarData.radar].sort((a,b) => (a.rsi||100) - (b.rsi||100)).slice(0, 3);
    const topAi = [...radarData.radar].sort((a,b) => (b.score||0) - (a.score||0)).slice(0, 3);

    stockDataStr = "DỮ LIỆU ĐỊNH LƯỢNG THỊ TRƯỜNG TỪ KWANGTAE QUANT RADAR:\n" +
      (matched.length > 0 ? "Mã liên quan câu hỏi:\n" + matched.map(m => `• ${m.symbol}: Giá ${m.price}k | Điểm AI: ${m.score}/100 | RSI: ${m.rsi} | Vol nổ: ${m.vol_surge}x | Tín hiệu: ${m.action} | Vùng mua: ${m.entry_min}-${m.entry_max}k | Target: ${m.target}k | Stoploss: ${m.stop_loss}k`).join('\n') : "") +
      "\nTop cổ phiếu Quá bán (RSI thấp nhất):\n" + oversold.map(m => `• ${m.symbol}: Giá ${m.price}k | RSI: ${m.rsi} | Hỗ trợ: ${m.entry_min}k`).join('\n') +
      "\nTop cổ phiếu Điểm số AI cao nhất:\n" + topAi.map(m => `• ${m.symbol}: Giá ${m.price}k | Điểm AI: ${m.score}/100 | RSI: ${m.rsi} | Vol: ${m.vol_surge}x`).join('\n');
  }

  const system_instruction = `Bạn là KwangTae AI - Chuyên gia Tư vấn Đầu tư & Môi giới Định lượng Chứng khoán Việt Nam.
Tư vấn cho: ${portfolio.investor_name}.

TRỌNG TÂM & NĂNG LỰC CỐ VẤN:
1. TRẢ LỜI ĐA DẠNG MỌI CÂU HỎI VỀ CHỨNG KHOÁN:
   - Nhận định thị trường, xu hướng VN-Index, thời điểm giải ngân, quản trị rủi ro & tỷ trọng tiền/cổ phiếu.
   - Gợi ý cổ phiếu: Bắt đáy (cổ phiếu RSI quá bán < 30 chạm hỗ trợ cứng), Đón sóng bùng nổ (nổ vol, dòng tiền lớn), Tích sản trung-dài hạn.
   - Đưa ra khuyến nghị cụ thể kèm lý do định lượng (RSI, vùng giá vào an toàn, điểm cắt lỗ, mục tiêu chốt lời), phân bổ tỷ trọng 20-30% thăm dò.
   - Cơ chế sàn: HOSE và HNX có ATC (±7% & ±10%). Sàn UPCoM khớp liên tục đến 15:00, tính giá đóng cửa bằng Giá Bình Quân Gia Quyền (±15%).
2. VĂN PHONG VÀ ĐỊNH DẠNG:
   - 100% TIẾNG VIỆT CHUYÊN NGHIỆP, súc tích (3-4 đoạn ngắn).
   - Định dạng: BẮT BUỘC chỉ dùng thẻ HTML Telegram: <b>in đậm</b>, <i>in nghiêng</i>, <code>code</code>. KHÔNG DÙNG Markdown **.

DỮ LIỆU THỊ TRƯỜNG & ĐỊNH LƯỢNG HIỆN TẠI:
- Chỉ số Vibe: ${vibe}/100 (${vibe_status}) | Độ rộng MA20: ${breadth}%
${liveQuoteStr ? '\n' + liveQuoteStr : ''}
${stockDataStr ? '\n' + stockDataStr : ''}
${portfolioContext}`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: userQuery }] }],
    systemInstruction: { parts: [{ text: system_instruction }] },
    generationConfig: { temperature: 0.65, maxOutputTokens: 600 }
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_KEY}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000)
    });

    if (resp.ok) {
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim().length > 0) {
        return text.trim();
      }
    }
  } catch (e) {
    console.warn("Gemini call timed out or failed:", e.message);
  }
  return null;
}

// Bộ máy Định lượng Dự phòng Tức thì (Smart Quant Knowledge Engine)
function smartStockEngine(userQuery, radarData, isAuthorizedUser, portfolio) {
  const q = userQuery.toUpperCase();
  const radarList = radarData?.radar || [];
  const vibe = radarData?.vibe_score ?? 50.0;
  const status = radarData?.vibe_status ?? "TÍCH LŨY / CÂN BẰNG";
  const breadth = radarData?.market_breadth ?? 50.0;

  // 1. Hỏi về Danh mục
  if (q.includes('DANH MỤC') || q.includes('DANH MUC') || q.includes('CƠ CẤU') || q.includes('CO CAU') || q.includes('TÀI KHOẢN')) {
    if (!isAuthorizedUser) {
      return `🔒 <b>THÔNG BÁO BẢO MẬT:</b>\n\nBạn đang truy cập qua tài khoản Telegram chưa được phân quyền xem danh mục VIP cá nhân.\nĐể liên kết tài khoản, vui lòng cập nhật <code>ALLOWED_CHAT_IDS</code> trong cấu hình hệ thống!`;
    }
    const hStr = portfolio.holdings?.map(h => `• <b>${h.symbol}</b>: ${h.qty?.toLocaleString()} CP (Giá vốn: ${h.avg_price}k)`).join('\n') || "Chưa ghi nhận mã cổ phiếu";
    return `💼 <b>HỒ SƠ TÀI SẢN (${portfolio.investor_name}):</b>\n\n${hStr}\n• <b>Tiền mặt sẵn có:</b> <b>${(portfolio.cash || 0).toLocaleString('vi-VN')} đ</b>\n\n💡 <b>Khuyến nghị cơ cấu:</b> Duy trì tỷ lệ tiền mặt an toàn tối thiểu 30% để chủ động bắt nhịp khi thị trường xuất hiện rung lắc!`;
  }

  // 2. Hỏi về Bắt đáy (Bottom fishing)
  if (q.includes('BẮT ĐÁY') || q.includes('BAT DAY') || q.includes('QUÁ BÁN') || q.includes('QUA BAN')) {
    const oversold = [...radarList].sort((a,b) => (a.rsi||100) - (b.rsi||100)).slice(0, 3);
    const picks = oversold.map(m => `• <b>${m.symbol}</b> (Giá ${m.price}k): RSI chỉ còn <b>${m.rsi}</b> (Quá bán sâu).\nVùng gom: <b>${m.entry_min} - ${m.entry_max}k</b> | Target: <b>${m.target}k</b> | Cắt lỗ: <b>${m.stop_loss}k</b>.`).join('\n\n');
    return `🎯 <b>CHIẾN LƯỢC BẮT ĐÁY ĐỊNH LƯỢNG:</b>\n\nThị trường hiện ở trạng thái <i>${status}</i> (Vibe: ${vibe}/100).\n\n🔥 <b>TOP CỔ PHIẾU QUÁ BÁN CHẠM HỖ TRỢ:</b>\n\n${picks || "Hiện chưa có mã nào chạm vùng quá bán cực đại."}\n\n💡 <b>Kỷ luật:</b> Giải ngân thăm dò tối đa 20-30% vị thế, không dùng margin khi bắt đáy!`;
  }

  // 3. Hỏi nên vào tiền / mua mã nào
  if (q.includes('VÀO TIỀN') || q.includes('VAO TIEN') || q.includes('NÊN MUA') || q.includes('NEN MUA') || q.includes('GỢI Ý')) {
    const topScorers = [...radarList].sort((a,b) => (b.score||0) - (a.score||0)).slice(0, 3);
    const picks = topScorers.map(m => `• <b>${m.symbol}</b> (Giá ${m.price}k) - Điểm AI: <b>${m.score}/100</b>\n  RSI: <b>${m.rsi}</b> | Khối lượng: <b>${m.vol_surge}x</b>\n  Vùng mua: <b>${m.entry_min} - ${m.entry_max}k</b> | Kỳ vọng Target: <b>${m.target}k (+${m.reward_pct}%)</b>`).join('\n\n');
    return `🚀 <b>TÍN HIỆU GIẢI NGÂN HÔM NAY:</b>\n\n${picks}\n\n🛡️ <b>Chiến lược:</b> Lấy vị thế thăm dò 30% tại nền hỗ trợ, gia tăng khi có phiên xác nhận vượt đỉnh kèm vol lớn!`;
  }

  // 4. Hỏi về Thị trường / VN-Index
  if (q.includes('THỊ TRƯỜNG') || q.includes('THI TRUONG') || q.includes('VNINDEX') || q.includes('VN-INDEX') || q.includes('VIBE')) {
    return `📡 <b>NHỊP ĐẬP THỊ TRƯỜNG CHỨNG KHOÁN (MARKET VIBE):</b>\n\n• <b>Chỉ số Vibe:</b> <b>${vibe}/100</b>\n• <b>Trạng thái:</b> <b>${status}</b>\n• <b>Độ rộng dòng tiền MA20:</b> <b>${breadth}%</b>\n\n📊 <b>Đánh giá:</b> Thị trường vận động phân hóa mạnh theo từng nhóm ngành. Nhà đầu tư nên tập trung vào cổ phiếu có câu chuyện tăng trưởng và dòng tiền thông minh bảo trợ.`;
  }

  // 5. Kiểm tra xem có hỏi mã cổ phiếu cụ thể nào không
  const matched = radarList.find(r => q.includes(r.symbol));
  if (matched) {
    return `👔 <b>[KWANGTAE QUANT] - PHÂN TÍCH KỸ THUẬT MÃ ${matched.symbol}</b>\n━━━━━━━━━━━━━━━━━━━\n📈 <b>DỮ LIỆU ĐỊNH LƯỢNG:</b>\n• Giá hiện tại: <b>${matched.price}k</b> | Điểm AI: <b>${matched.score}/100</b>\n• RSI: <b>${matched.rsi}</b> | Biến động Vol: <b>${matched.vol_surge}x</b>\n• Tín hiệu: <b>${matched.action}</b>\n\n🎯 <b>KẾ HOẠCH GIAO DỊCH:</b>\n• Vùng mua an toàn: <b>${matched.entry_min} - ${matched.entry_max}k</b>\n• Mục tiêu (Target): <b>${matched.target}k (+${matched.reward_pct}%)</b>\n• Cắt lỗ (Stop-loss): <b>${matched.stop_loss}k (-${matched.risk_pct}%)</b>`;
  }

  return `🤖 <b>KwangTae AI Broker luôn sẵn sàng hỗ trợ!</b>\n\nBạn có thể hỏi tôi về:\n• <b>Bắt đáy / Giải ngân:</b> <i>"Nên bắt đáy mã nào?", "Hôm nay nên vào tiền mã gì?"</i>\n• <b>Soi kỹ thuật:</b> <i>"Soi mã SSI, HPG, FPT, VHM..."</i>\n• <b>Thị trường chung:</b> <i>"Nhận định xu hướng VN-Index hôm nay"</i>`;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send("KwangTae Telegram Webhook 24/7 is Active!");
  }

  if (req.method !== 'POST') {
    return res.status(405).send("Method not allowed");
  }

  try {
    const update = req.body;

    // Hỗ trợ Web Terminal gửi thông báo khớp lệnh
    if (update && update.action === 'TRADE_ALERT') {
      if (API_SECRET) {
        const clientSecret = req.headers['x-api-secret'] || update.secret;
        if (clientSecret !== API_SECRET) {
          return res.status(401).json({ error: "Unauthorized trade alert" });
        }
      }
      const targetChatId = update.chatId || (ALLOWED_CHAT_IDS[0] || null);
      if (targetChatId && update.text) {
        await sendTelegram(targetChatId, update.text);
        return res.status(200).json({ ok: true, sent: true });
      }
      return res.status(400).json({ error: "Missing chatId or text" });
    }

    if (!update || !update.message || !update.message.text) {
      return res.status(200).send("OK");
    }

    const chatId = String(update.message.chat.id);
    const rawText = update.message.text.trim();
    const textUpper = rawText.toUpperCase();

    // Kiểm tra quyền truy cập thông tin tài chính cá nhân
    const isAuthorizedUser = ALLOWED_CHAT_IDS.length === 0 || ALLOWED_CHAT_IDS.includes(chatId);
    const portfolio = loadPortfolioConfig();

    // 1. Đọc dữ liệu Radar mới nhất
    let radarData = null;
    try {
      const filePath = path.join(process.cwd(), 'public', 'kwangtae_radar.json');
      if (fs.existsSync(filePath)) {
        radarData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) {
      console.error("Radar read error:", e);
    }

    // 2. Lệnh /start
    if (textUpper === '/START') {
      const reply = `👔 <b>CHÀO BẠN! TÔI LÀ KWANGTAE QUANT BROKER!</b> 🚀\n\nTôi là Trợ lý Cố vấn & Môi giới Chứng khoán Định lượng. Bạn có thể hỏi tôi:\n\n• <b>Gợi ý cơ hội:</b> <i>"Nên bắt đáy mã nào?", "Hôm nay nên vào tiền cổ phiếu nào?"</i>\n• <b>Soi kỹ thuật:</b> <i>"Soi mã SSI", "VHM mua được chưa?", "Đánh giá FPT"</i>\n• <b>Thị trường:</b> <i>"Nhịp đập thị trường", "Chỉ số Vibe hôm nay thế nào?"</i>\n• Lệnh nhanh: <b>DANH MỤC</b>, <b>THỊ TRƯỜNG</b>, <b>BẮT ĐÁY</b>.`;
      await sendTelegram(chatId, reply);
      return res.status(200).send("OK");
    }

    // 3. Gọi Gemini Flash
    let aiReply = null;
    try {
      aiReply = await askGemini(rawText, radarData, isAuthorizedUser, portfolio);
    } catch (aiErr) {
      console.error("Gemini failed:", aiErr);
    }

    // 4. Nếu Gemini trả về thành công
    if (aiReply && aiReply.length > 0) {
      await sendTelegram(chatId, aiReply);
      return res.status(200).send("OK");
    }

    // 5. Fallback bộ máy định lượng tức thì
    const smartReply = smartStockEngine(rawText, radarData, isAuthorizedUser, portfolio);
    await sendTelegram(chatId, smartReply);
    return res.status(200).send("OK");

  } catch (err) {
    console.error("Webhook top-level error:", err);
    return res.status(500).send(err.message);
  }
}
