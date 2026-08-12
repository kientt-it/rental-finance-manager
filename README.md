# 708 La Thành — quản lý tài chính nhà trọ

Ứng dụng Next.js + Supabase để quản lý phòng, công nợ, thanh toán và chi phí nhà trọ.

   Tính năng hiện có

- Đăng ký, xác nhận email, đăng nhập và đăng xuất bằng Supabase Auth.
- Tự khởi tạo tổ chức và nhà trọ cho tài khoản mới.
- Dashboard dùng dữ liệu thật: doanh thu, công nợ, chi phí và tỷ lệ lấp đầy.
- Thêm phòng và ghi nhận thanh toán.
- Quản lý sơ đồ phòng và giá thuê theo tầng/kích thước.
- Theo dõi chi phí sinh hoạt, người ứng tiền và cách phân bổ.
- Đối soát chi phí từng người, tài khoản ngân hàng và trạng thái thanh toán.
- Row Level Security cô lập dữ liệu giữa các tổ chức.
- Ghi thanh toán nguyên tử để tránh sai công nợ khi có thao tác đồng thời.

   Chạy local

1. Dùng Node.js 20 trở lên.
2. Sao chép `.env.example` thành `.env.local` và điền URL/publishable key của Supabase.
3. Chạy lần lượt các migration trong Supabase SQL Editor:
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_dashboard_functions.sql`
   - `supabase/migrations/0003_shared_living_expenses.sql`
   - `supabase/migrations/0004_organization_users.sql`
   - `supabase/migrations/0005_current_organization_users.sql`
4. Cài package bằng `npm install`.
5. Khởi chạy bằng `npm run dev` và mở `http://localhost:3000`.

Trong Supabase Auth, thêm `http://localhost:3000/auth/callback` vào Redirect URLs để xác nhận email local hoạt động.

   Kiểm tra production

```bash
npm run build
npm start
```

Không đưa `service_role` key vào biến môi trường public hoặc mã phía trình duyệt.

   Bước phát triển tiếp theo

Luồng hợp lý tiếp theo là tạo khách thuê/hợp đồng, chốt điện nước, sinh hóa đơn và ghi chi phí. Schema cho các nghiệp vụ này đã có trong migration đầu tiên.
