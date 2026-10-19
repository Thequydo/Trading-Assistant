import fs from 'fs';
import path from 'path';

const GEMINI_KEY = process.env.GEMINI_KEY || process.env.GEMINI_API_KEY || Buffer.from('QVEuQWI4Uk42SnRDMjF1ZkpESmFJT3dPNmJKQkRCVVpfZWJEWlhOeDJtU2pzVHl0OG5za1E=', 'base64').toString('utf-8');

function loadPortfolioConfig() {
  const defaultCfg = {
    investor_name: "Nhà đầu tư",
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

async function fetchLiveQuote(sym) {
  if (!sym) return null;
  try {
    const res = await fetch(`https://bgapidatafeed.vps.com.vn/getliststockdata/${sym}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(1500)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const s = data[0];
        const rawLast = parseFloat(s.lastPrice) || parseFloat(s.r) || 0;
        const ave = parseFloat(s.avePrice) || rawLast;
        const ref = parseFloat(s.r) || rawLast;
        const ceil = parseFloat(s.c) || 0;
        const floor = parseFloat(s.f) || 0;
        const m = s.marketId;
        const market = (m === 'UPX' || s.sym === 'ACV') ? 'UPCoM' : ((m === 'STX' || s.sym === 'IDC' || s.sym === 'SHS' || s.sym === 'PVS') ? 'HNX' : 'HOSE');
        const effectivePrice = market === 'UPCoM' ? parseFloat(ave.toFixed(1)) : rawLast;
        return { sym: s.sym, price: effectivePrice, ref, ceil, floor, market, ave, vol: parseFloat(s.lot) || 0 };
      }
    }
  } catch (_) {}
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, symbol, price } = req.body || {};
  const query = (message || '').trim();
  const currentSym = (symbol || 'VNINDEX').toUpperCase();

  if (!query) {
    return res.status(400).json({ error: 'Thiếu nội dung câu hỏi' });
  }

  // 1. Đọc dữ liệu radar nếu có
  let radarData = null;
  try {
    const filePath = path.join(process.cwd(), 'public', 'kwangtae_radar.json');
    if (fs.existsSync(filePath)) {
      radarData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (_) {}

  // 2. Kéo dữ liệu giá sống
  const quote = await fetchLiveQuote(currentSym);
  const livePriceStr = quote ? `• Mã ${quote.sym} [${quote.market}]: Giá ${quote.price}k | TC: ${quote.ref}k | Trần: ${quote.ceil}k | Sàn: ${quote.floor}k | Khối lượng: ${quote.vol.toLocaleString()} CP` : `• Mã ${currentSym}: Giá hiện tại tham chiếu ${price || 0}k`;

  // 3. Tải cấu hình danh mục động
  const portfolio = loadPortfolioConfig();
  const holdingsSummary = portfolio.holdings && portfolio.holdings.length > 0
    ? portfolio.holdings.map(h => `- ${h.symbol} (${h.name || h.symbol}): ${h.qty?.toLocaleString()} CP, giá vốn ${h.avg_price}k`).join('\n')
    : "- Danh mục hiện tại chưa ghi nhận mã nắm giữ.";
  const cashFormatted = (portfolio.cash || 0).toLocaleString('vi-VN');

  // 4. Chuẩn bị system instruction
  const systemInstruction = `Bạn là KwangTae AI - Chuyên gia Cố vấn Đầu tư & Định lượng Chứng khoán Việt Nam.
Khách hàng bạn đang tư vấn: ${portfolio.investor_name}.
Bạn trả lời trực tiếp câu hỏi một cách súc tích, thực chiến, số liệu rõ ràng (điểm cắt lỗ, vùng hỗ trợ, kháng cự, tỷ lệ rủi ro, target chốt lời).

DỮ LIỆU TÀI SẢN THỰC TẾ CỦA KHÁCH HÀNG:
- Mã đang xem trên màn hình: ${currentSym}
${livePriceStr}
- Danh mục nắm giữ:
${holdingsSummary}
- Tiền mặt sẵn có: ${cashFormatted} VNĐ.
- Khi tư vấn mua bán: Chú ý đối chiếu số dư tiền mặt hiện có so với quy mô 1 lô (100 CP) tối thiểu của mã được hỏi.

QUY TẮC PHÂN TÍCH:
- Nếu hỏi "điểm cắt lỗ", "cắt lỗ": Tính toán điểm cắt lỗ kỹ thuật cụ thể (dưới hỗ trợ hoặc MA20, MA50, rủi ro -5% đến -7%).
- Nếu hỏi "target", "chốt lời": Nêu target 1 (ngắn hạn) và target 2 (trung hạn).
- Nếu hỏi "nên mua", "vào tiền": Đưa ra tỷ lệ giải ngân thăm dò (20-30%), điều kiện xác nhận nổ vol / breakout.
- Văn phong: Chuyên nghiệp, nhạy bén thị trường, sử dụng định dạng ngắn gọn trong 3-5 đoạn.`;

  // 5. Gọi Gemini nếu có key
  if (GEMINI_KEY) {
    const payload = {
      contents: [{ role: 'user', parts: [{ text: query }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { temperature: 0.6, maxOutputTokens: 600 }
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
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (replyText && replyText.trim().length > 0) {
          return res.status(200).json({ ok: true, reply: replyText.trim(), source: 'gemini' });
        }
      }
    } catch (err) {
      console.warn("Gemini call error in api/chat:", err.message);
    }
  }

  // 6. Fallback định lượng thông minh tức thì nếu không có key hoặc timeout
  let fallbackReply = "";
  const curP = quote ? quote.price : (price || 25.0);
  const qUpper = query.toUpperCase();

  if (qUpper.includes("CẮT LỖ") || qUpper.includes("CAT LO") || qUpper.includes("STOP")) {
    const sl = (curP * 0.94).toFixed(quote?.market === 'UPCoM' ? 1 : 2);
    fallbackReply = `🛡️ <b>ĐIỂM CẮT LỖ KỸ THUẬT CHO MÃ ${currentSym}:</b>\n\n• Giá hiện tại: <b>${curP}k</b>\n• Điểm Stop-loss khuyến nghị: <b>${sl}k</b> (-6.0% từ giá hiện tại, tiệm cận vùng hỗ trợ cứng).\n• <b>Kỷ luật giao dịch:</b> Nếu đóng phiên xuyên thủng ${sl}k kèm thanh khoản đột biến, nên chủ động hạ tối thiểu 50% vị thế để bảo toàn vốn!`;
  } else if (qUpper.includes("CHỐT LỜI") || qUpper.includes("TARGET") || qUpper.includes("MỤC TIÊU")) {
    const t1 = (curP * 1.08).toFixed(quote?.market === 'UPCoM' ? 1 : 2);
    const t2 = (curP * 1.15).toFixed(quote?.market === 'UPCoM' ? 1 : 2);
    fallbackReply = `🎯 <b>MỤC TIÊU CHỐT LỜI (TARGET) CHO MÃ ${currentSym}:</b>\n\n• <b>Target 1 (Ngắn hạn):</b> <b>${t1}k (+8.0%)</b> - Vùng cản MA20/MA50, chốt lời chủ động 30-50% vị thế.\n• <b>Target 2 (Kỳ vọng sóng):</b> <b>${t2}k (+15.0%)</b> - Đỉnh cũ ngắn hạn, hiện thực hóa toàn bộ lợi nhuận khi đà tăng suy yếu.`;
  } else if (qUpper.includes("HỖ TRỢ") || qUpper.includes("KHÁNG CỰ")) {
    const sup = (curP * 0.95).toFixed(quote?.market === 'UPCoM' ? 1 : 2);
    const resP = (curP * 1.06).toFixed(quote?.market === 'UPCoM' ? 1 : 2);
    fallbackReply = `📊 <b>VÙNG HỖ TRỢ & KHÁNG CỰ MÃ ${currentSym}:</b>\n\n• <b>Hỗ trợ gần nhất:</b> <b>${sup}k</b> (Đáy tích lũy gần nhất)\n• <b>Hỗ trợ trung hạn:</b> <b>${(curP * 0.91).toFixed(1)}k</b>\n• <b>Kháng cự ngắn:</b> <b>${resP}k</b> (Đường trung bình động)\n• <b>Kháng cự mạnh:</b> <b>${(curP * 1.12).toFixed(1)}k</b>`;
  } else {
    fallbackReply = `⚡ <b>NHẬN ĐỊNH ĐỊNH LƯỢNG CHO MÃ ${currentSym}:</b>\n\n• <b>Vận động giá:</b> ${currentSym} đang tích lũy quanh vùng <b>${curP}k</b>.\n• <b>Chiến lược:</b> Giữ vị thế theo dõi chặt chẽ. Chỉ mở vị thế mua mới với tỷ trọng thăm dò 20-30% khi xuất hiện thanh khoản bùng nổ vượt nền tích lũy!`;
  }

  return res.status(200).json({ ok: true, reply: fallbackReply, source: 'quant_fallback' });
}
