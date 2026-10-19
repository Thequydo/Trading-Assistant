# 👔 KWANGTAE QUANT TERMINAL & 24/7 AI BROKER

> **Enterprise Quantitative Trading Terminal & Autonomous AI Financial Assistant for Vietnam Stock Market**  
> Kết hợp công nghệ phân tích định lượng (LightGBM, ATR Risk Budgeting, Market Vibe) + Trợ lý ngôn ngữ lớn Google Gemini + Vercel Serverless & Telegram Bot 24/7.

---

## 🏛️ Các Tính Năng Cốt Lõi

1. **Quản Lý Danh Mục Đầu Tư Động (Dynamic Portfolio Management)**:
   - Cấu hình linh hoạt qua tệp `portfolio_config.json` hoặc giao diện web.
   - Hạch toán chuẩn xác theo quy chế sàn: Sàn **HOSE/HNX** tính theo giá khớp ATC (`lastPrice`), sàn **UPCoM** tính theo **Giá Bình Quân Gia Quyền (`avePrice`)**.
   - Hỗ trợ lưu trữ đa tầng: `LocalStorage` trên trình duyệt kết hợp Vercel KV / Upstash Redis trên đám mây.

2. **Cỗ Máy Định Lượng KwangTae Quant Radar**:
   - **Market Vibe Index**: Đo lường sức khỏe dòng tiền thị trường và tỷ lệ cổ phiếu nằm trên MA20.
   - **Mô hình LightGBM tự học**: Đánh giá xác suất bùng nổ theo chu kỳ **T+2.5** thực tế của thị trường chứng khoán Việt Nam (có trừ chi phí thuế & phí giao dịch).
   - **Cầu dao tự ngắt bảo vệ rủi ro Thiên nga đen (Black Swan Circuit Breaker)**: Tự động khóa trạng thái mua khi VN-INDEX giảm sốc $\ge 2.5\%$ hoặc độ rộng thị trường gãy dưới $12\%$.
   - **Quản trị quy mô vị thế theo biến động thực tế (ATR Risk Budgeting)**: Tự động điều chỉnh tỷ trọng giải ngân dựa trên mức độ dao động nến (`norm_atr`), không thiên vị bất kỳ cổ phiếu nào.

3. **Giao Diện Đa Phong Cách (Multi-Theme UI)**:
   - **Manchester United Fan Edition 🔱**: Tông màu đỏ - vàng Red Devils đặc trưng.
   - **Institutional Pro Dark 🏛️**: Tông màu xanh navy sâu phong cách Bloomberg Terminal tối giản, chuyên nghiệp.
   - Tích hợp biểu đồ kỹ thuật chuyên sâu **TradingView Lightweight Charts** với dữ liệu lịch sử nhiều năm.

4. **Trợ Lý AI Broker 24/7 Trên Telegram**:
   - Vận hành trên máy chủ đám mây Vercel Serverless kết hợp **Google Gemini Flash**.
   - Phản hồi tức thì với cơ chế **Smart Quant Fallback**: không bao giờ treo bot hay trả lời cụt ngủn khi mạng chậm.
   - **Bảo mật phân quyền Chat ID**: Chỉ tài khoản được cấp phép trong `ALLOWED_CHAT_IDS` mới xem được thông tin tài sản cá nhân; người dùng công khai chỉ nhận được phân tích kỹ thuật chung.

---

## ⚙️ Chu Trình Tự Động Hóa MLOps (Daily Post-Close)

Cứ đúng **17:00 mỗi ngày** sau phiên ATC (Thứ 2 - Thứ 6), GitHub Actions sẽ tự động kích hoạt:
1. Tải và làm sạch dữ liệu nến nhật có điều chỉnh (Adjusted Price) của 45 cổ phiếu đại diện 9 nhóm ngành.
2. Chuẩn hóa mốc thời gian và kết hợp đặc trưng chỉ số VN-INDEX không bị lệch ngày.
3. Huấn luyện mô hình LightGBM trên cửa sổ trượt 700 phiên với kiểm định Walk-forward Hold-out.
4. Xuất bản tệp dữ liệu `public/kwangtae_radar.json`.
5. Đồng bộ hóa trực tiếp lên Web Terminal và gửi báo cáo tổng kết phiên 17:00 qua Telegram.

---

## 🔐 Hướng Dẫn Cấu Hình Biến Môi Trường (Security Setup)

Sao chép `.env.example` thành `.env` (khi chạy local) và cấu hình trên **Vercel Settings ➔ Environment Variables** cũng như **GitHub Repo ➔ Settings ➔ Secrets and variables ➔ Actions**:

| Tên biến | Bắt buộc | Mô tả |
| :--- | :---: | :--- |
| `GEMINI_KEY` | Có | API Key từ [Google AI Studio](https://aistudio.google.com/) |
| `TELEGRAM_BOT_TOKEN` | Có | Bot Token từ [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Có | Telegram Chat ID cá nhân nhận báo cáo 17:00 (lấy qua `@userinfobot`) |
| `ALLOWED_CHAT_IDS` | Tùy chọn | Danh sách Chat ID được phép xem số dư tài sản VIP (phân tách dấu phẩy) |
| `API_SECRET` | Tùy chọn | Khóa bí mật bảo vệ các endpoint `POST /api/config` và cảnh báo lệnh |
| `KV_REST_API_URL` | Tùy chọn | URL Upstash Redis / Vercel KV để lưu trữ cấu hình trên đám mây |
| `KV_REST_API_TOKEN` | Tùy chọn | Token truy cập Upstash Redis / Vercel KV |

---

## 🚀 Triển Khai Nhanh Lên Vercel

```bash
# 1. Cài đặt Vercel CLI nếu chưa có
npm i -g vercel

# 2. Khởi chạy môi trường phát triển local
vercel dev

# 3. Triển khai trực tiếp lên Vercel Production
vercel --prod
```

---

## 📄 Bản Quyền & Giấy Phép

Phát hành theo giấy phép **MIT License**. Mọi thuật toán định lượng và khuyến nghị chỉ mang tính chất tham khảo kỹ thuật, nhà đầu tư tự chịu trách nhiệm về quyết định giao dịch của mình.
