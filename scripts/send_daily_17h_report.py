import os
import json
import time
import urllib.request
import urllib.parse
from datetime import datetime

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "").strip()

def get_vnindex():
    """Lấy dữ liệu chỉ số VN-INDEX đóng cửa hôm nay (ưu tiên VPS, dự phòng Entrade)"""
    try:
        req = urllib.request.Request(
            'https://bgapidatafeed.vps.com.vn/getlistindexdetail/10',
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode())
            if data and len(data) > 0:
                cur = float(data[0]['cIndex'])
                ref = float(data[0]['oIndex'])
                diff = cur - ref
                pct = (diff / ref) * 100 if ref > 0 else 0
                return {'current': cur, 'ref': ref, 'diff': diff, 'pct': pct, 'source': 'VPS'}
    except Exception as e:
        print(f"⚠️ Lỗi VPS VN-INDEX: {e}")

    try:
        now_ts = int(time.time())
        url = f'https://services.entrade.com.vn/chart-api/v2/ohlcs/index?from={now_ts - 86400 * 5}&to={now_ts}&symbol=VNINDEX&resolution=1D'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode())
            cur = float(data['c'][-1])
            ref = float(data['c'][-2])
            diff = cur - ref
            pct = (diff / ref) * 100 if ref > 0 else 0
            return {'current': cur, 'ref': ref, 'diff': diff, 'pct': pct, 'source': 'Entrade'}
    except Exception as e:
        print(f"⚠️ Lỗi Entrade VN-INDEX: {e}")
        return {'current': 0.0, 'ref': 0.0, 'diff': 0.0, 'pct': 0.0, 'source': 'Error'}

def get_stock_data(symbol):
    """Lấy giá cổ phiếu thời gian thực đóng cửa phiên hôm nay"""
    try:
        req = urllib.request.Request(
            f'https://bgapidatafeed.vps.com.vn/getliststockdata/{symbol}',
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode())
            if data and len(data) > 0:
                s = data[0]
                raw_last = float(s.get('lastPrice') or s.get('r') or 0)
                ref = float(s.get('r') or raw_last)
                diff = raw_last - ref
                pct = (diff / ref) * 100 if ref > 0 else 0
                return {'price': raw_last, 'ref': ref, 'diff': diff, 'pct': pct, 'source': 'VPS'}
    except Exception as e:
        print(f"⚠️ Lỗi VPS {symbol}: {e}")

    try:
        now_ts = int(time.time())
        url = f'https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?from={now_ts - 86400 * 5}&to={now_ts}&symbol={symbol}&resolution=1D'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode())
            cur = float(data['c'][-1])
            ref = float(data['c'][-2])
            diff = cur - ref
            pct = (diff / ref) * 100 if ref > 0 else 0
            return {'price': cur, 'ref': ref, 'diff': diff, 'pct': pct, 'source': 'Entrade'}
    except Exception as e:
        print(f"⚠️ Lỗi Entrade {symbol}: {e}")
        return {'price': 0.0, 'ref': 0.0, 'diff': 0.0, 'pct': 0.0, 'source': 'Error'}

def load_portfolio_config():
    """Tải cấu hình danh mục đầu tư"""
    config_paths = [
        os.path.join(os.path.dirname(__file__), '..', 'portfolio_config.json'),
        'portfolio_config.json'
    ]
    for p in config_paths:
        if os.path.exists(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
    
    return {
        "investor_name": "Nhà đầu tư",
        "cash": 0,
        "holdings": []
    }

def format_money(val):
    """Định dạng tiền tệ VNĐ dễ nhìn"""
    sign = "+" if val > 0 else ""
    return f"{sign}{val:,.0f} đ".replace(",", ".")

def generate_daily_report():
    today_str = datetime.now().strftime("%d/%m/%Y")
    
    # 1. Dữ liệu VN-INDEX
    vn = get_vnindex()
    vn_sign = "+" if vn['diff'] >= 0 else ""
    vn_icon = "🟢" if vn['diff'] > 0 else ("🔴" if vn['diff'] < 0 else "🟡")

    # 2. Dữ liệu danh mục
    cfg = load_portfolio_config()
    investor_name = cfg.get('investor_name', 'Nhà đầu tư')
    cash = float(cfg.get('cash', 0))
    holdings = cfg.get('holdings', [])
    
    total_stock_value = 0.0
    total_cost_value = 0.0
    total_daily_pnl = 0.0
    
    holdings_msg_parts = []
    
    for h in holdings:
        sym = h['symbol']
        qty = int(h.get('qty', 0))
        avg_price = float(h.get('avg_price', 0.0))
        name = h.get('name', sym)
        
        quote = get_stock_data(sym)
        cur_p = quote['price']
        diff_p = quote['diff']
        pct_p = quote['pct']
        
        # Tính toán giá trị
        cur_val = cur_p * qty * 1000
        cost_val = avg_price * qty * 1000
        daily_pnl = diff_p * qty * 1000
        total_pnl = (cur_p - avg_price) * qty * 1000
        total_pnl_pct = ((cur_p - avg_price) / avg_price) * 100 if avg_price > 0 else 0.0
        
        total_stock_value += cur_val
        total_cost_value += cost_val
        total_daily_pnl += daily_pnl
        
        stock_sign = "+" if diff_p >= 0 else ""
        stock_icon = "🟢" if diff_p > 0 else ("🔴" if diff_p < 0 else "🟡")
        pnl_icon = "🚀" if daily_pnl > 0 else ("📉" if daily_pnl < 0 else "➖")
        
        part = (
            f"• <b>{sym} ({name}):</b>\n"
            f"  - Giá đóng cửa: <b>{cur_p:.2f}k</b> ({stock_icon} <b>{stock_sign}{diff_p:.2f}k | {stock_sign}{pct_p:.2f}%</b>)\n"
            f"  - Khối lượng: <b>{qty:,} CP</b> | Giá vốn: <code>{avg_price:.3f}k</code>\n"
            f"  - Lời/lỗ hôm nay: {pnl_icon} <b>{format_money(daily_pnl)}</b>\n"
            f"  - Tổng lời/lỗ mã này: <b>{format_money(total_pnl)}</b> ({'+' if total_pnl_pct>=0 else ''}{total_pnl_pct:.2f}%)"
        )
        holdings_msg_parts.append(part)
        time.sleep(0.05)

    if not holdings_msg_parts:
        holdings_msg_parts.append("• <i>Chưa có cổ phiếu nào được thiết lập trong danh mục.</i>")

    # Tổng kết tài khoản
    total_nav = total_stock_value + cash
    overall_pnl = total_stock_value - total_cost_value
    overall_pnl_pct = (overall_pnl / total_cost_value) * 100 if total_cost_value > 0 else 0.0
    
    prev_stock_value = total_stock_value - total_daily_pnl
    daily_nav_pct = (total_daily_pnl / prev_stock_value) * 100 if prev_stock_value > 0 else 0.0
    
    daily_icon = "🟢" if total_daily_pnl > 0 else ("🔴" if total_daily_pnl < 0 else "🟡")
    overall_icon = "🟢" if overall_pnl >= 0 else "🔴"
    
    # Lời khuyên định lượng từ KwangTae AI
    if total_daily_pnl > 0:
        advice_text = "Hôm nay danh mục tăng trưởng tích cực! Dòng tiền mua chủ động gia tăng. Tiếp tục kiên định chiến lược quản trị rủi ro, không mua đuổi vùng hưng phấn."
    elif total_daily_pnl < 0:
        advice_text = "Thị trường chung điều chỉnh. Vị thế danh mục an toàn, giữ tỷ trọng tiền mặt hợp lý để chủ động đón nhịp cân bằng tiếp theo."
    else:
        advice_text = "Danh mục hôm nay biến động tích lũy cân bằng. Giữ nguyên tỷ trọng chờ dòng tiền kích hoạt xu hướng rõ ràng."

    message = (
        f"👔 <b>[KWANGTAE QUANT - BÁO CÁO PHIÊN 17:00]</b> 🔔\n"
        f"📅 <i>Tổng kết ngày: {today_str}</i>\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"📊 <b>1. BIẾN ĐỘNG THỊ TRƯỜNG CHUNG:</b>\n"
        f"• <b>VN-INDEX:</b> <b>{vn['current']:.2f} điểm</b>\n"
        f"• <b>Mức thay đổi:</b> {vn_icon} <b>{vn_sign}{vn['diff']:.2f} điểm ({vn_sign}{vn['pct']:.2f}%)</b>\n"
        f"• <b>Tham chiếu đầu phiên:</b> {vn['ref']:.2f} điểm\n\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"💼 <b>2. CỔ PHIẾU TRONG DANH MỤC:</b>\n"
        + "\n\n".join(holdings_msg_parts) + "\n\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"💰 <b>3. HIỆU QUẢ TÀI SẢN ({investor_name}):</b>\n"
        f"• <b>LÃI / LỖ HÔM NAY:</b> {daily_icon} <b>{format_money(total_daily_pnl)} ({'+' if daily_nav_pct>=0 else ''}{daily_nav_pct:.2f}%)</b>\n"
        f"• <b>TỔNG LÃI / LỖ DANH MỤC:</b> {overall_icon} <b>{format_money(overall_pnl)} ({'+' if overall_pnl_pct>=0 else ''}{overall_pnl_pct:.2f}%)</b>\n"
        f"• <b>Giá trị cổ phiếu:</b> {total_stock_value:,.0f} đ\n".replace(",", ".") +
        f"• <b>Tiền mặt sẵn có:</b> {cash:,.0f} đ\n".replace(",", ".") +
        f"• 🏆 <b>TỔNG TÀI SẢN (NAV):</b> <b>{total_nav:,.0f} đ</b>\n\n".replace(",", ".") +
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"💡 <b>NHẬN ĐỊNH ĐỊNH LƯỢNG:</b>\n"
        f"<i>{advice_text}</i>\n\n"
        f"👉 <i>Theo dõi trực tiếp: KwangTae Quant Terminal</i>"
    )
    
    return message

def send_telegram(message):
    if not BOT_TOKEN or not CHAT_ID:
        print("⚠️ Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong biến môi trường. Bỏ qua gửi tin.")
        return False

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = json.dumps({
        'chat_id': CHAT_ID,
        'text': message,
        'parse_mode': 'HTML'
    }).encode('utf-8')
    
    req = urllib.request.Request(
        url,
        data=payload,
        headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            res_body = response.read().decode('utf-8')
            print("✅ Đã gửi báo cáo 17:00 thành công tới Telegram!")
            return True
    except Exception as e:
        print(f"❌ Lỗi gửi Telegram: {e}")
        return False

if __name__ == "__main__":
    print("="*65)
    print("🚀 [KWANGTAE] KHỞI ĐỘNG XUẤT BẢN BÁO CÁO TỔNG KẾT 17:00 CHIỀU")
    print("="*65)
    msg = generate_daily_report()
    print("\n--- [NỘI DUNG THÔNG BÁO] ---")
    print(msg)
    print("----------------------------\n")
    send_telegram(msg)
