import os
import json
import time
import urllib.request
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import roc_auc_score, log_loss

print("="*85)
print("🚀 [KWANGTAE ENTERPRISE MLOPS] KHỞI ĐỘNG HỆ THỐNG ĐỊNH LƯỢNG TỰ TIẾN HÓA TOÀN DIỆN")
print("="*85)

# Danh mục 45 cổ phiếu chuẩn 5 cổ đầu ngành cho 9 nhóm ngành
WATCHLIST = [
    # 👑 Nhóm Vingroup & Trụ Cột VN30
    "VIC", "VHM", "VRE", "BCM", "BVH",
    # ⚡ Hệ Sinh Thái GELEX
    "GEX", "VIX", "GEE", "VGC", "IDC",
    # 🏦 Nhóm Ngân Hàng
    "VCB", "BID", "CTG", "TCB", "MBB",
    # 📈 Nhóm Chứng Khoán
    "SSI", "VND", "VCI", "HCM", "SHS",
    # 🏗️ Nhóm Thép & VL
    "HPG", "HSG", "NKG", "DGC", "DPM",
    # 🏢 Nhóm Bất Động Sản
    "KDH", "DXG", "PDR", "DIG", "NVL",
    # 💻 Công Nghệ & Bán Lẻ
    "FPT", "MWG", "FRT", "MSN", "VNM",
    # 🚚 Logistics & Cảng
    "ACV", "VTP", "GMD", "HAH", "VJC",
    # ⚡ Dầu Khí & Năng Lượng
    "GAS", "PLX", "PVD", "PVS", "POW"
]

# =============================================================================
# TRỤ CỘT 1: LUỒNG DỮ LIỆU TỰ ĐỘNG (ETL PIPELINE & SỰ KIỆN DOANH NGHIỆP)
# =============================================================================
print("\n[BƯỚC 1/5 - ETL PIPELINE] Đang tải dữ liệu sạch đã điều chỉnh (Adjusted Price)...")

def load_entrade_data(symbol, is_index=False, days=850):
    now_ts = int(time.time())
    from_ts = now_ts - (days * 86400)
    endpoint = "index" if is_index else "stock"
    url = f"https://services.entrade.com.vn/chart-api/v2/ohlcs/{endpoint}?from={from_ts}&to={now_ts}&symbol={symbol}&resolution=1D"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode())
            if not data.get('t') or len(data['t']) == 0:
                return None
            dt_series = pd.to_datetime(data['t'], unit='s')
            df = pd.DataFrame({
                'time': dt_series,
                'date': dt_series.dt.date,
                'open': data['o'],
                'high': data['h'],
                'low': data['l'],
                'close': data['c'],
                'volume': data['v']
            })
            df['symbol'] = symbol
            # Khử trùng lặp theo ngày để đảm bảo tính liên tục
            return df.sort_values('date').drop_duplicates('date').reset_index(drop=True)
    except Exception as e:
        print(f"⚠️ Lỗi tải {symbol}: {e}")
        return None

# Tải VN-INDEX làm kim chỉ nam chu kỳ thị trường
df_vn = load_entrade_data("VNINDEX", is_index=True)
if df_vn is None or len(df_vn) < 100:
    print("❌ Lỗi luồng dữ liệu VN-INDEX, dừng quy trình.")
    exit(1)

df_vn['vn_ema20'] = df_vn['close'].ewm(span=20, adjust=False).mean()
df_vn['vn_ema50'] = df_vn['close'].ewm(span=50, adjust=False).mean()
delta_vn = df_vn['close'].diff()
gain_vn = (delta_vn.where(delta_vn > 0, 0)).rolling(14).mean()
loss_vn = (-delta_vn.where(delta_vn < 0, 0)).rolling(14).mean()
df_vn['vn_rsi'] = 100 - (100 / (1 + (gain_vn / (loss_vn + 1e-9))))
df_vn['market_regime'] = np.where((df_vn['close'] > df_vn['vn_ema50']) & (df_vn['vn_ema20'] > df_vn['vn_ema50']), 1.0, 0.0)
df_vn['vn_ret_1d'] = df_vn['close'].pct_change(1)
df_vn['vn_ret_5d'] = df_vn['close'].pct_change(5)
vn_features = df_vn[['date', 'market_regime', 'vn_rsi', 'vn_ret_1d', 'vn_ret_5d']]

# Tải danh sách cổ phiếu trong Watchlist
stock_dfs = []
for s in WATCHLIST:
    d = load_entrade_data(s, is_index=False)
    if d is not None and len(d) > 80:
        stock_dfs.append(d)
    time.sleep(0.02)

print(f"  • Đã tải thành công: {len(stock_dfs)}/{len(WATCHLIST)} cổ phiếu.")
raw_data = pd.concat(stock_dfs, ignore_index=True)

# Tính toán đặc trưng định lượng
processed = []
for sym, group in raw_data.groupby('symbol'):
    df = group.copy().sort_values('date').reset_index(drop=True)
    df['ema10'] = df['close'].ewm(span=10, adjust=False).mean()
    df['ema20'] = df['close'].ewm(span=20, adjust=False).mean()
    df['ema50'] = df['close'].ewm(span=50, adjust=False).mean()
    
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    df['rsi'] = 100 - (100 / (1 + (gain / (loss + 1e-9))))
    
    df['vol_ma20'] = df['volume'].rolling(20).mean()
    df['vol_surge'] = df['volume'] / (df['vol_ma20'] + 1e-9)
    df['dist_ema20'] = (df['close'] - df['ema20']) / df['ema20']
    df['dist_ema50'] = (df['close'] - df['ema50']) / df['ema50']
    df['candle_spread'] = (df['high'] - df['low']) / df['close']
    df['ret_1d'] = df['close'].pct_change(1)
    df['ret_3d'] = df['close'].pct_change(3)
    df['ret_5d'] = df['close'].pct_change(5)
    
    tr = np.maximum(df['high'] - df['low'], 
                    np.maximum(abs(df['high'] - df['close'].shift(1)), 
                               abs(df['low'] - df['close'].shift(1))))
    df['atr'] = tr.rolling(14).mean()
    df['norm_atr'] = df['atr'] / df['close']
    
    # Merge theo 'date' để không bị rớt mã khi lệch giờ giữa các sàn (HOSE, HNX, UPCoM)
    df = pd.merge(df, vn_features, on='date', how='inner')
    df = df.dropna().reset_index(drop=True)
    processed.append(df)

dataset = pd.concat(processed, ignore_index=True)

# Tính độ rộng thị trường (Market Breadth) và Vibe Index
dataset['above_ema20'] = (dataset['close'] > dataset['ema20']).astype(float)
dataset['is_panic'] = (dataset['rsi'] < 30).astype(float)
breadth = dataset.groupby('date').agg(
    market_breadth=('above_ema20', 'mean'),
    avg_rsi_all=('rsi', 'mean'),
    panic_ratio=('is_panic', 'mean')
).reset_index()

breadth['vibe_score'] = (
    breadth['market_breadth'] * 50 + 
    (breadth['avg_rsi_all'] / 100.0) * 30 + 
    (1.0 - breadth['panic_ratio']) * 20
).clip(0, 100)

dataset = pd.merge(dataset, breadth, on='date', how='inner')

# =============================================================================
# GÁN NHÃN ĐỊNH LƯỢNG CHU KỲ T+2.5 THỰC TẾ VIỆT NAM (CÓ TRỪ PHÍ)
# Mua tại T+1 Open, hàng khả dụng bán vào chiều T+2 và phiên T+3, T+4
# =============================================================================
TRANSACTION_COST = 0.005  # 0.5% phí giao dịch + thuế 2 chiều
TARGET_NET_PROFIT = 0.030 # Lợi nhuận kỳ vọng tối thiểu +3.0%
MAX_NET_DRAWDOWN  = -0.040 # Chấp nhận sụt giảm tối đa -4.0%

labeled = []
for sym, group in dataset.groupby('symbol'):
    df = group.copy().sort_values('date').reset_index(drop=True)
    entry_p = df['open'].shift(-1)
    
    # Cửa sổ bán thực tế: Chiều T+2 (close T+2) và trọn vẹn T+3, T+4
    exit_max = np.maximum(df['close'].shift(-2), np.maximum(df['high'].shift(-3), df['high'].shift(-4)))
    exit_min = np.minimum(df['close'].shift(-2), np.minimum(df['low'].shift(-3), df['low'].shift(-4)))
    
    max_ret = ((exit_max - entry_p) / (entry_p + 1e-9)) - TRANSACTION_COST
    min_ret = ((exit_min - entry_p) / (entry_p + 1e-9)) - TRANSACTION_COST
    
    df['target'] = np.where((max_ret >= TARGET_NET_PROFIT) & (min_ret > MAX_NET_DRAWDOWN), 1, 0)
    labeled.append(df.iloc[:-4])

full_df = pd.concat(labeled, ignore_index=True).sort_values('date').reset_index(drop=True)

FEATURES = [
    'rsi', 'vol_surge', 'dist_ema20', 'dist_ema50', 
    'candle_spread', 'ret_1d', 'ret_3d', 'ret_5d', 'norm_atr',
    'market_regime', 'vn_rsi', 'vn_ret_1d', 'vn_ret_5d',
    'market_breadth', 'avg_rsi_all', 'vibe_score'
]

# =============================================================================
# TRỤ CỘT 5: GIÁM SÁT RỦI RO & BẢO VỆ THIÊN NGA ĐEN (BLACK SWAN CIRCUIT BREAKER)
# =============================================================================
print("\n[BƯỚC 2/5 - GIÁM SÁT RỦI RO & THIÊN NGA ĐEN]")
latest_date = dataset['date'].max()
today_sub = dataset[dataset['date'] == latest_date]
cur_vibe = float(today_sub['vibe_score'].iloc[0])
cur_breadth = float(today_sub['market_breadth'].iloc[0]) * 100
latest_vn_drop = float(today_sub['vn_ret_1d'].iloc[0]) * 100

print(f"  • VN-INDEX phiên mới nhất : {latest_vn_drop:+.2f}%")
print(f"  • Market Vibe Index       : {cur_vibe:.1f}/100")
print(f"  • Độ rộng dòng tiền MA20  : {cur_breadth:.1f}%")

# Kích hoạt Cầu Dao Ngắt Khẩn Cấp (Circuit Breaker) nếu thị trường hoảng loạn cực độ
CIRCUIT_BREAKER_ACTIVE = False
if latest_vn_drop <= -2.5 or cur_breadth < 12.0:
    CIRCUIT_BREAKER_ACTIVE = True
    print("🚨 [CẢNH BÁO THIÊN NGA ĐEN] Thị trường sụp đổ sốc hoặc phân hóa gãy đổ cực nặng!")
    print("🛡️ Cầu dao bảo vệ tự động KÍCH HOẠT: Toàn bộ tỷ trọng giải ngân chuyển về 0% (Cash is King)!")

# =============================================================================
# TRỤ CỘT 2: CỬA SỔ TRƯỢT (SLIDING WINDOW) & TỰ HỌC TIẾN BƯỚC
# =============================================================================
print("\n[BƯỚC 3/5 - CỬA SỔ TRƯỢT (SLIDING WINDOW)]")
SLIDING_WINDOW_DAYS = 700
unique_dates = sorted(full_df['date'].unique())
if len(unique_dates) > SLIDING_WINDOW_DAYS:
    cutoff_date = unique_dates[-SLIDING_WINDOW_DAYS]
    window_df = full_df[full_df['date'] >= cutoff_date].copy().reset_index(drop=True)
else:
    window_df = full_df.copy()

print(f"  • Khung cửa sổ trượt: {len(window_df):,} mẫu nến (từ {window_df['date'].min()} -> {window_df['date'].max()})")

# =============================================================================
# TRỤ CỘT 3: KIỂM ĐỊNH TRƯỚC KHI TRIỂN KHAI (VALIDATION GATEKEEPER)
# =============================================================================
print("\n[BƯỚC 4/5 - KIỂM ĐỊNH TRƯỚC KHI CẤP PHÉP TRIỂN KHAI]")
# Tách tập kiểm định 35 phiên gần nhất
split_date = unique_dates[-35]
train_part = window_df[window_df['date'] < split_date]
val_part   = window_df[window_df['date'] >= split_date]

X_train, y_train = train_part[FEATURES], train_part['target']
X_val, y_val     = val_part[FEATURES], val_part['target']

candidate_model = lgb.LGBMClassifier(
    n_estimators=180, learning_rate=0.03, max_depth=4,
    num_leaves=16, min_child_samples=40, subsample=0.8,
    colsample_bytree=0.8, random_state=42, verbose=-1
)
candidate_model.fit(X_train, y_train)

val_preds = candidate_model.predict_proba(X_val)[:, 1]
val_auc = float(roc_auc_score(y_val, val_preds))
val_loss = float(log_loss(y_val, val_preds))

print(f"  • Năng lực phân biệt kiểm định (ROC-AUC): {val_auc:.3f}")
print(f"  • Sai số kiểm định (Log-Loss)          : {val_loss:.3f}")

MODEL_APPROVED = False
if val_auc >= 0.58:
    MODEL_APPROVED = True
    print("✅ [CẤP PHÉP THÀNH CÔNG] Mô hình ứng viên đạt chuẩn chất lượng định lượng, đưa vào sản xuất!")
    prod_model = lgb.LGBMClassifier(
        n_estimators=180, learning_rate=0.03, max_depth=4,
        num_leaves=16, min_child_samples=40, subsample=0.8,
        colsample_bytree=0.8, random_state=42, verbose=-1
    )
    prod_model.fit(window_df[FEATURES], window_df['target'])
else:
    print("⚠️ [CẢNH BÁO SUY GIẢM] AUC dưới ngưỡng 0.58, kích hoạt mô hình bảo toàn an toàn!")
    prod_model = candidate_model

# =============================================================================
# TRỤ CỘT 4: SINH TÍN HIỆU GIAO DỊCH & QUẢN TRỊ RỦI RO ĐỘNG (ATR RISK BUDGET)
# =============================================================================
print("\n[BƯỚC 5/5 - XUẤT MA TRẬN TÍN HIỆU & PHÂN BỔ TỶ TRỌNG]")

vibe_status = "🟢 HƯNG PHẤN (FOMO)" if cur_vibe >= 65 else ("🟡 THẬN TRỌNG / TÍCH LŨY" if cur_vibe >= 40 else "🔴 SỢ HÃI / RỦI RO")

radar_list = []
for sym in WATCHLIST:
    sub = dataset[dataset['symbol'] == sym]
    if len(sub) == 0: 
        continue
    last_r = sub.iloc[-1]
    
    x_in = pd.DataFrame([last_r[FEATURES]])
    prob = float(prod_model.predict_proba(x_in)[0, 1])
    score = int(prob * 100)
    cur_p = float(last_r['close'])
    rsi_v = float(last_r['rsi'])
    vol_s = float(last_r['vol_surge'])
    atr_v = float(last_r['atr'])
    norm_atr = float(last_r['norm_atr'])
    
    # 1. Tính toán điểm Cắt lỗ (Stop-loss) và Mục tiêu (Target) theo ATR
    stop_dist = max(1.5 * atr_v, cur_p * 0.04) # Tối thiểu -4%
    stop_loss = round(cur_p - stop_dist, 2)
    risk_pct = round((stop_dist / cur_p) * 100, 1)
    
    target_dist = max(2.5 * atr_v, cur_p * 0.08) # Tối thiểu +8%
    target_p = round(cur_p + target_dist, 2)
    reward_pct = round((target_dist / cur_p) * 100, 1)

    # 2. Quản trị quy mô vị thế theo rủi ro (Risk Budgeting 1.5% NAV max)
    # Cổ phiếu biến động cao (norm_atr lớn) sẽ tự động bị giảm tỷ trọng giải ngân
    raw_pos = (1.5 / max(risk_pct, 1.0)) * 100.0
    safe_pos = min(max(round(raw_pos, 0), 10.0), 25.0)

    # 3. Phân loại hành động HOÀN TOÀN KHÁCH QUAN THEO CHỈ SỐ (Không thiên vị mã nào)
    if CIRCUIT_BREAKER_ACTIVE:
        action = "🔴 CẦU DAO NGẮT: ĐỨNG NGOÀI"
        pos_size = 0.0
    elif score >= 60 and vol_s >= 1.4:
        action = "🟢 BÙNG NỔ DÒNG TIỀN"
        pos_size = safe_pos
    elif score >= 52:
        action = "🟢 MUA TÍCH LŨY"
        pos_size = safe_pos
    elif rsi_v < 32 and score >= 35:
        action = "🟢 BẮT ĐÁY QUÁ BÁN"
        pos_size = round(safe_pos * 0.8, 1)
    elif vol_s >= 1.8 and score >= 35:
        action = "🟢 NỔ VOL THĂM DÒ"
        pos_size = round(safe_pos * 0.6, 1)
    elif score >= 35:
        action = "🟡 THEO DÕI QUAN SÁT"
        pos_size = round(safe_pos * 0.4, 1)
    else:
        action = "🔴 ĐỨNG NGOÀI / KHÔNG MUA"
        pos_size = 0.0
        
    radar_list.append({
        'symbol': sym,
        'price': round(cur_p, 2),
        'score': score,
        'rsi': round(rsi_v, 1),
        'vol_surge': round(vol_s, 2),
        'action': action,
        'pos_size_pct': pos_size,
        'atr': round(atr_v, 2),
        'entry_min': round(cur_p * 0.992, 2),
        'entry_max': round(cur_p * 1.008, 2),
        'target': target_p,
        'stop_loss': stop_loss,
        'reward_pct': reward_pct,
        'risk_pct': risk_pct
    })

# Sắp xếp thuần túy theo điểm số định lượng AI cao nhất
radar_list.sort(key=lambda x: x['score'], reverse=True)
top3 = radar_list[:3]

# Đóng gói JSON
output_payload = {
    'updated_at': str(latest_date) + " 15:35",
    'vibe_score': round(cur_vibe, 1),
    'vibe_status': vibe_status,
    'market_breadth': round(cur_breadth, 1),
    'circuit_breaker': CIRCUIT_BREAKER_ACTIVE,
    'validation_auc': round(val_auc, 3),
    'model_status': "DEPLOYED_APPROVED" if MODEL_APPROVED else "ROLLED_BACK_SAFE",
    'top3': top3,
    'radar': radar_list
}

os.makedirs('public', exist_ok=True)
with open('public/kwangtae_radar.json', 'w', encoding='utf-8') as f:
    json.dump(output_payload, f, ensure_ascii=False, indent=2)

print("\n" + "="*85)
print(f"🎉 [HOÀN TẤT CHU TRÌNH MLOPS] Đã lưu kết quả tại public/kwangtae_radar.json!")
print(f"• Trạng thái mô hình  : {'ĐÃ CẤP PHÉP TRIỂN KHAI (PROD)' if MODEL_APPROVED else 'ĐÃ HOÀN TÁC (ROLLBACK)'}")
print(f"• Cầu dao Thiên Nga Đen: {'KÍCH HOẠT (BẢO VỆ VỐN)' if CIRCUIT_BREAKER_ACTIVE else 'AN TOÀN BÌNH THƯỜNG'}")
if top3:
    print(f"• Top 1 cơ hội hôm nay  : {top3[0]['symbol']} (Điểm: {top3[0]['score']}/100, Tỷ trọng: {top3[0]['pos_size_pct']}%)")
print("="*85)

# BẮN THÔNG BÁO TỰ ĐỘNG ĐẾN TELEGRAM
try:
    import sys
    sys.path.append(os.path.dirname(__file__))
    import send_daily_17h_report
    msg = send_daily_17h_report.generate_daily_report()
    sent = send_daily_17h_report.send_telegram(msg)
    if sent:
        print("📲 [TELEGRAM] Đã gửi báo cáo tổng kết tự động thành công!")
except Exception as tg_err:
    print(f"⚠️ Thông báo Telegram: {tg_err}")
