# Thiết lập thông báo thanh toán

Tính năng dùng Supabase Edge Functions + Cron và Resend. Mọi bí mật nằm trong Supabase Secrets hoặc Vault, không nhập vào ứng dụng. Nếu `pg_cron`, `pg_net` hoặc Vault chưa bật, bật các extension này trong mục Database → Extensions trước.

## 1. Áp dụng cấu trúc dữ liệu

Chạy migration `0019_payment_reminders.sql` trong Supabase SQL Editor hoặc deploy migration bằng Supabase CLI.

## 2. Thêm secrets và triển khai hàm

Tạo một chuỗi bí mật ngẫu nhiên dài, dùng cùng giá trị cho Edge Function và Vault. Sau đó chạy từ repo đã liên kết với dự án:

```sh
supabase secrets set RESEND_API_KEY=re_... REMINDER_CRON_SECRET=<chuoi-bi-mat>
supabase functions deploy payment-reminders
```

Đặt thêm secrets trong Supabase Vault bằng SQL Editor:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'payment_reminders_project_url');
select vault.create_secret('<chuoi-bi-mat>', 'payment_reminders_cron_secret');
```

## 3. Lên lịch chạy mỗi ngày lúc 08:00 giờ Việt Nam

Supabase Cron dùng UTC, nên 08:00 tại Việt Nam là 01:00 UTC:

```sql
select cron.schedule(
  'payment-reminders-daily',
  '0 1 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'payment_reminders_project_url') || '/functions/v1/payment-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'payment_reminders_cron_secret')
      ),
      body := '{"action":"run"}'::jsonb
    );
  $$
);
```

Trước khi chạy lại đoạn lên lịch, gỡ job cũ bằng `select cron.unschedule('payment-reminders-daily');`.

## 4. Bật gửi thử

Trong Quản trị → Thông báo, nhập tên/email gửi từ miền đã xác thực trên Resend, tùy chọn email nhận phản hồi, lưu cấu hình rồi gửi email thử. API key không hiển thị trong giao diện.

Các email thử chỉ gửi về email của tài khoản quản trị đang đăng nhập. Email nhắc thật chỉ gửi cho thành viên có tài khoản liên kết và có email hợp lệ.
