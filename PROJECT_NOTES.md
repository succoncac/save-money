# PROJECT_NOTES.md

## Mục đích
Ứng dụng web **Ví Tiết Kiệm Cá Nhân** (tiếng Việt, đơn vị số nguyên VNĐ), full-stack, cho phép nhiều tài khoản theo dõi tích lũy tiền mặt, quét mệnh giá & số seri bằng AI, phát hiện trùng số seri chống lấy tiền giữa các tài khoản, nhận tư vấn tài chính VNĐ và quản trị hệ thống.

## Công nghệ
- Frontend: React 19, TypeScript, Vite, Tailwind CSS v4, lucide-react, biểu đồ SVG tự viết (không dùng thư viện chart).
- Backend: Node.js + Express (`server.ts`, chạy dev bằng `tsx server.ts`, build production bằng `vite build` + `esbuild`).
- CSDL: Turso (libSQL) qua HTTP pipeline (`/v2/pipeline`), tự động khởi tạo schema khi chạy.
- Font: Plus Jakarta Sans (tiêu đề), DM Sans (nội dung), JetBrains Mono (`tabular-nums` cho số tiền VNĐ và seri).

## Cấu trúc file & vai trò
- `server.ts`: Express server, toàn bộ REST API (`/api/*`), xác thực phiên + 2FA TOTP, giới hạn tần suất thử đăng nhập (`rateLimit.ts`), chống lấy tiền theo số seri, kiểm tra kết nối AI (`/api/admin/ai-test`), bảo vệ Quản trị gốc & tự bảo vệ Admin, phục vụ Vite middleware (dev) và `dist/` (prod).
- `server/db.ts`: Client Turso HTTP pipeline, khởi tạo 6 bảng (`app_users` gồm `password_encrypted`, cột 2FA và `session_version`, `user_transactions`, `user_goals`, `app_ai_settings` gồm cột thông báo & mạng xã hội tùy chỉnh, `user_chat_messages`, `user_security_alerts`), chạy `ALTER TABLE` nâng cấp schema an toàn và seed `app_ai_settings` (mã hóa API key) / `admin`.
- `server/auth.ts`: Băm mật khẩu `scrypt`, cookie HttpOnly `vtk_session` ký HMAC-SHA256 kèm `sv` (`session_version`, `SameSite=None; Secure; Partitioned` trên HTTPS, `SameSite=Lax` trên localhost), token tạm `signTwoFactorToken`/`verifyTwoFactorToken` cho bước đăng nhập 2FA, kiểm tra CSRF Origin và middleware `requireAuth` / `requireAdmin`.
- `server/cryptoVault.ts`: Mã hóa & giải mã AES-256-GCM (`enc:v1:...`) cho `two_factor_secret`, `password_encrypted` và `app_ai_settings.api_key` bằng `DATA_ENCRYPTION_KEY` (hoặc dẫn xuất từ `SESSION_SECRET`/`TURSO_AUTH_TOKEN`).
- `server/adminPolicy.ts`: Quy tắc chặn Admin tự xóa/tự khóa/tự hạ quyền, bắt buộc mật khẩu cũ khi Admin tự đổi mật khẩu của chính mình, và phân quyền xem bảo mật tài khoản.
- `server/rateLimit.ts`: Bộ đếm sliding-window chống brute-force mật khẩu, mã 2FA, endpoint đổi mật khẩu/2FA và xác nhận mật khẩu xem bảo mật (khóa 429 sau 8 lần sai trong 5 phút).
- `server/totp.ts`: Thuật toán Base32 + TOTP RFC 6238 (6 chữ số, chu kỳ 30s, lệch ±1 bước) và sinh mã QR PNG qua `qrcode`.
- `server/ai.ts`: Lớp gọi AI đa nhà cung cấp (`server_default`, `openai_compatible`, `gemini`, `openai`, `anthropic`), giải mã `api_key` khi đọc, chọn model `"auto"` có fallback tự động khi quét ảnh, kiểm tra kết nối `testAiConnection`, thử lại khi gặp 503/429, chống SSRF cho custom Base URL.
- `src/utils/currency.ts`: Định dạng số nguyên VNĐ (`1.250.000 ₫`), rút gọn biểu đồ, danh sách mệnh giá VNĐ và `resolveDenominationForAmount` đồng bộ mệnh giá khi sửa giao dịch.
- `src/utils/serial.ts`: Chuẩn hóa số seri (`normalizeSerial`) và hàm phát hiện trùng seri giữa các tài khoản.
- `src/utils/cashflow.ts`: Tính tổng số dư ròng, nạp hôm nay/tháng này, chuỗi ngày/tháng (dùng `Math.abs` cho cột dòng tiền) và phân bổ mệnh giá.
- `src/utils/notice.ts`: Chuẩn hóa tông màu banner thông báo, danh sách nền tảng mạng xã hội (Discord, Facebook, Telegram, Zalo, YouTube, TikTok, X, Website) và kiểm tra URL an toàn (`http:`/`https:`).
- `src/utils/finance.test.ts`: Bộ unit test (`node:test` + `tsx`) cho định dạng VNĐ, đồng bộ mệnh giá, chuẩn hóa/so trùng seri, tính dòng tiền, TOTP 2FA, token phiên (`sv`), `extractJsonObject`, bộ lọc liên kết thông báo, `AuthRateLimiter`, `cryptoVault` và `adminPolicy`.
- `src/api/client.ts`: Client API kèm `credentials: 'include'`, header `X-Requested-With`, xử lý đăng nhập 2FA và tự động đăng xuất khi `403 ACCOUNT_LOCKED`.
- `src/App.tsx`: Khung ứng dụng responsive (sidebar desktop + bottom tab bar mobile), kiểm tra phiên `GET /api/auth/session` (200), heartbeat `GET /api/auth/me` mỗi 20s, tự chuyển khỏi tab Quản trị nếu bị hạ quyền.
- `src/components/*`: `LoginScreen`, `LoginNoticeCard`, `ForcePasswordModal` (nút hiện/ẩn mật khẩu), `SecurityAlertsBanner`, `GrowthChartSvg` (hỗ trợ bàn phím & hiển thị biến động trong kỳ), `OverviewTab` (ước tính số ngày đạt mục tiêu theo nhịp 14 ngày), `ScanDepositTab` (nén ảnh tải lên <=1400px, gắn luồng camera bằng `useEffect`), `HistoryTab` (lọc theo khoảng thời gian Hôm nay/Tháng này, đồng bộ mệnh giá khi sửa, báo lỗi khi xóa thất bại), `AdvisorTab` + `ChatMessageBody` (chặn hiển thị ký tự thô `*`/`#` trong đoạn chat AI và kẻ bảng Markdown chuẩn có căn lề), `SettingsTab` (nút hiện/ẩn mật khẩu & kiểm tra khớp tức thì), `AdminTab`, `MoneyText`.

## Ràng buộc & quy ước thiết kế
- Không dùng `localStorage` hay `sessionStorage`; phiên lưu hoàn toàn bằng cookie HttpOnly `vtk_session`.
- `GET /api/auth/session` luôn trả 200 `{ authenticated: false }` khi chưa đăng nhập.
- Đã loại bỏ Sao lưu/Khôi phục JSON và Xóa dữ liệu cá nhân khỏi Cài đặt (`SettingsTab` chuyển thành `Cài đặt & Bảo mật` gồm Đổi mật khẩu và 2FA).
- Bật 2FA bắt buộc nhập mật khẩu để tạo QR/khóa bí mật, sau đó nhập lại mật khẩu + mã 6 số để kích hoạt; tắt 2FA bắt buộc nhập mật khẩu + mã 6 số hiện tại. Admin có nút hỗ trợ tắt 2FA cho user thường (bị chặn trên Quản trị gốc bởi Admin phụ).
- Tài khoản `Quản trị gốc` (`is_root_admin = 1`) được bảo vệ ở cả UI và backend: không thể bị khóa, đổi quyền, đặt lại mật khẩu, tắt 2FA hoặc xem mật khẩu/2FA bởi admin phụ hoặc bị xóa.
- Admin không thể tự xóa, tự khóa hoặc tự hạ quyền chính mình; khi tự đổi mật khẩu của chính mình ở danh sách tài khoản bắt buộc phải nhập mật khẩu cũ (trong khi đặt lại cho người dùng khác không cần mật khẩu cũ).
- Xem mật khẩu & mã 2FA người dùng (`POST /api/admin/users/:id/credentials`) yêu cầu xác thực lại mật khẩu quản trị, giới hạn tần suất sai (429), chỉ giải mã tạm thời từ bản lưu AES-256-GCM và chặn Admin phụ xem của Quản trị gốc/Admin khác.
- API key cấu hình trong Admin chỉ ghi một chiều lên server, không trả lại client.
- Mọi số tiền VNĐ bọc `whitespace-nowrap tabular-nums` để ký hiệu `₫` không xuống dòng trên màn hình 390px.

## Lỗi đã sửa
- Model AI trên endpoint tùy chỉnh: kiểm tra `/v1/models` thấy ID chuẩn là `claude-opus-5` nên cập nhật mặc định và `.env.example`.
- Căn chỉnh ký hiệu `₫` trong `MoneyText` và giãn chữ tiêu đề tiếng Việt (`tracking`), chỉnh `aria-label` nút hiện/ẩn mật khẩu để tránh trùng nhãn trợ năng.
- Nâng cấp schema Turso an toàn bằng `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` idempotent cho 2FA, đa liên kết mạng xã hội và `session_version`.
- Sửa race condition gắn luồng camera trong `ScanDepositTab`, nén ảnh tải lên qua canvas để tránh lỗi quá dung lượng, đồng bộ `denomination` khi sửa giao dịch ở `HistoryTab`, mã hóa `api_key` AI trong DB và xoay vòng `session_version` khi đổi mật khẩu/2FA.
- Đổi nhãn trường tên đăng nhập ở màn hình đăng nhập, khởi tạo quản trị gốc và tạo tài khoản thành `Username`.
- Thêm `src/utils/chatMarkdown.ts` và `ChatMessageBody.tsx` để lọc sạch dấu `*`/`#` thô ở phản hồi Trợ lý AI và tự động kẻ bảng HTML rõ nét khi AI trả về bảng số liệu.
- Ẩn toàn bộ chi tiết công nghệ/CSDL (`HttpOnly`, `AES-256-GCM`, `scrypt`, `TOTP`, `Base32`, `GEMINI_API_KEY`, gợi ý `admin`, lỗi `Turso`/`HTTP`/`SQL`) khỏi giao diện người dùng, đặc biệt làm gọn màn hình chưa đăng nhập (`LoginScreen`, `AdminTab`, `SettingsTab`, `server.ts`, `server/db.ts`).




