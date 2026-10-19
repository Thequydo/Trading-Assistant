// api/config.js - Vercel Serverless Function cho Trader Desk Pro
import fs from 'fs';
import path from 'path';

const API_SECRET = process.env.API_SECRET || '';

function getInitialConfig() {
  const defaultCfg = {
    stocks: "VN-INDEX,VIC,VHM,VRE,GEX,VIX,GEE,VGC,IDC,VCB,MBB,TCB,CTG,STB,SSI,VND,HCM,VCI,SHS,HPG,HSG,NKG,DGC,DPM,NVL,PDR,DIG,DXG,KDH,FPT,MWG,FRT,MSN,VNM,ACV,VTP,GMD,HAH,VJC,GAS,PLX,PVD,PVS,POW",
    owned: "ACV",
    qty: 1250,
    avg: 45.899,
    cash: 500000,
    holdings: {
      "ACV": { symbol: "ACV", qty: 1250, avgPrice: 45.899, curPrice: 39.2, name: "TCT Cảng Hàng Không VN" }
    },
    transactions: [],
    session: "ONLINE",
    time: ""
  };

  try {
    const configPath = path.join(process.cwd(), 'portfolio_config.json');
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (data.cash !== undefined) defaultCfg.cash = data.cash;
      if (data.holdings && Array.isArray(data.holdings)) {
        defaultCfg.holdings = {};
        data.holdings.forEach(h => {
          defaultCfg.holdings[h.symbol] = {
            symbol: h.symbol,
            qty: h.qty || 0,
            avgPrice: h.avg_price || 0,
            curPrice: h.avg_price || 0,
            name: h.name || h.symbol
          };
        });
        if (data.holdings.length > 0) {
          defaultCfg.owned = data.holdings[0].symbol;
          defaultCfg.qty = data.holdings[0].qty;
          defaultCfg.avg = data.holdings[0].avg_price;
        }
      }
    }
  } catch (err) {
    console.warn("Lỗi tải portfolio_config:", err.message);
  }

  return defaultCfg;
}

let inMemoryConfig = getInitialConfig();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-secret");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 1. XỬ LÝ LƯU CẤU HÌNH (POST /save HOẶC POST /api/config)
  if (req.method === "POST") {
    if (API_SECRET) {
      const authHeader = req.headers['authorization'] || '';
      const clientSecret = req.headers['x-api-secret'] || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
      if (clientSecret !== API_SECRET) {
        return res.status(401).json({ error: "Unauthorized: Invalid API secret" });
      }
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (_) {
        const params = new URLSearchParams(body);
        body = Object.fromEntries(params.entries());
      }
    }

    if (body) {
      if (body.stocks) inMemoryConfig.stocks = body.stocks;
      if (body.owned) inMemoryConfig.owned = body.owned;
      if (body.qty) inMemoryConfig.qty = parseInt(body.qty) || inMemoryConfig.qty;
      if (body.avg) inMemoryConfig.avg = parseFloat(body.avg) || inMemoryConfig.avg;
      if (body.cash !== undefined) inMemoryConfig.cash = parseFloat(body.cash);
      if (body.holdings) inMemoryConfig.holdings = body.holdings;
      if (body.transactions) inMemoryConfig.transactions = body.transactions;
    }

    // Nếu có KV / Upstash Redis -> Lưu vào đám mây
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      try {
        await fetch(`${process.env.KV_REST_API_URL}/set/trader_cfg`, {
          headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
          method: "POST",
          body: JSON.stringify(inMemoryConfig)
        });
      } catch (err) {
        console.error("KV save error:", err);
      }
    }

    return res.status(200).json({ status: "ok", msg: "Đã lưu cấu hình danh mục thành công!" });
  }

  // 2. XỬ LÝ ĐỌC CẤU HÌNH & BẢNG GIÁ REALTIME (GET /api/config)
  if (req.method === "GET") {
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      try {
        const kvRes = await fetch(`${process.env.KV_REST_API_URL}/get/trader_cfg`, {
          headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
        });
        const kvData = await kvRes.json();
        if (kvData && kvData.result) {
          const parsed = typeof kvData.result === "string" ? JSON.parse(kvData.result) : kvData.result;
          inMemoryConfig = { ...inMemoryConfig, ...parsed };
        }
      } catch (err) {
        console.error("KV read error:", err);
      }
    }

    let items = [];
    const stockList = inMemoryConfig.stocks.split(",").map(s => s.trim().toUpperCase()).filter(s => s !== "VN-INDEX");

    try {
      // 1. Kéo VN-INDEX
      if (inMemoryConfig.stocks.includes("VN-INDEX")) {
        try {
          const idxRes = await fetch("https://bgapidatafeed.vps.com.vn/getlistindexdetail/10", {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(2000)
          });
          const idxData = await idxRes.json();
          if (idxData && idxData.length > 0) {
            const cIdx = parseFloat(idxData[0].cIndex) || 0;
            const oIdx = parseFloat(idxData[0].oIndex) || cIdx;
            const ot = cIdx - oIdx;
            const chg = oIdx > 0 ? (ot / oIdx) * 100 : 0;
            items.push({ sym: "VN-INDEX", price: cIdx, chg: chg, ot: ot, vol: idxData[0].vol || 0 });
          }
        } catch (_) {
          items.push({ sym: "VN-INDEX", price: 0.0, chg: 0.0, vol: 0 });
        }
      }

      // 2. Kéo danh sách cổ phiếu từ VPS
      if (stockList.length > 0) {
        const vpsRes = await fetch(`https://bgapidatafeed.vps.com.vn/getliststockdata/${stockList.join(",")}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(2500)
        });
        const vpsData = await vpsRes.json();
        for (const s of vpsData) {
          const last = parseFloat(s.lastPrice) || parseFloat(s.r) || 0;
          const ave = parseFloat(s.avePrice) || last;
          const ref = parseFloat(s.r) || last;
          const ceil = parseFloat(s.c) || 0;
          const floor = parseFloat(s.f) || 0;
          const m = s.marketId;
          const market = (m === 'UPX' || s.sym === 'ACV') ? 'UPCoM' : ((m === 'STX' || s.sym === 'IDC' || s.sym === 'SHS' || s.sym === 'PVS') ? 'HNX' : 'HOSE');
          const effectivePrice = (market === 'UPCoM' && ave > 0) ? parseFloat(ave.toFixed(1)) : last;
          
          let ot = effectivePrice - ref;
          let chg = ref > 0 ? ((ot / ref) * 100) : 0;
          const vol = parseFloat(s.lot) || 0;

          items.push({ 
            sym: s.sym, 
            price: effectivePrice, 
            rawPrice: last,
            ave: ave, 
            closePrice: effectivePrice,
            market: market, 
            ref: ref, 
            ceil: ceil, 
            floor: floor, 
            chg: chg, 
            ot: ot, 
            vol: vol 
          });
        }
      }
    } catch (e) {
      console.error("VPS proxy error:", e.message);
    }

    const now = new Date();
    const vnTime = now.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

    return res.status(200).json({
      stocks: inMemoryConfig.stocks,
      owned: inMemoryConfig.owned,
      qty: inMemoryConfig.qty,
      avg: inMemoryConfig.avg,
      cash: inMemoryConfig.cash,
      holdings: inMemoryConfig.holdings,
      transactions: inMemoryConfig.transactions,
      ip: "Vercel Cloud",
      session: "ONLINE",
      time: vnTime,
      items: items
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
