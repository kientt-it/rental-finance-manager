# Thiết lập thông báo thanh toán qua Gmail API

Tính năng dùng Supabase Edge Functions + Cron và Gmail API. Không cần mua tên miền. OAuth credentials phải được lưu trong Supabase **Edge Function Secrets**, không nhập vào ứng dụng hoặc Vault. Vault chỉ giữ URL dự án và bí mật gọi Cron. Nếu `pg_cron`, `pg_net` hoặc Vault chưa bật, bật các extension này trong mục **Database → Extensions**.

## 1. Áp dụng cấu trúc dữ liệu

Chạy migration `0019_payment_reminders.sql` trong Supabase SQL Editor hoặc deploy migration bằng Supabase CLI.

## 2. Bật Gmail API và tạo OAuth credentials

1. Mở [Google Cloud Console](https://console.cloud.google.com/), tạo project hoặc chọn project hiện có.
2. Vào **APIs & Services → Library**, tìm **Gmail API** và bấm **Enable**.
3. Vào **Google Auth Platform** (hoặc **APIs & Services → OAuth consent screen** nếu giao diện cũ), chọn Audience **External**. Điền tên ứng dụng, email hỗ trợ và email liên hệ.
4. Trong **Data Access / Scopes**, thêm đúng scope gửi thư: `https://www.googleapis.com/auth/gmail.send`.
5. Đặt Publishing status là **In production**. Nếu để **Testing**, refresh token cho scope Gmail sẽ hết hạn sau 7 ngày. Ứng dụng chưa xác minh có thể hiện cảnh báo “unverified”; Google có ngoại lệ xác minh cho mục đích cá nhân/dưới 100 người dùng, nhưng vẫn hiện cảnh báo khi cấp quyền. [Chính sách trạng thái và xác minh OAuth](https://support.google.com/cloud/answer/15549945?hl=en) · [Khi nào không cần xác minh](https://support.google.com/cloud/answer/13464323?hl=en).
6. Vào **Clients → Create client**, chọn loại **Web application**. Thêm Authorized redirect URI `https://developers.google.com/oauthplayground`, rồi sao chép **Client ID** và **Client secret**.
7. Mở [OAuth 2.0 Playground](https://developers.google.com/oauthplayground). Bấm bánh răng, bật **Use your own OAuth credentials**, nhập Client ID/secret. Ở bước chọn scope, nhập `https://www.googleapis.com/auth/gmail.send`, bấm **Authorize APIs** và đăng nhập tài khoản Gmail muốn dùng để gửi. Bấm **Exchange authorization code for tokens** rồi sao chép **Refresh token**.

> Refresh token cho phép máy chủ gửi thư từ Gmail của bạn. Chỉ lưu trong Supabase Edge Function Secrets; không gửi token qua chat hoặc commit vào Git. Nếu token bị lộ, thu hồi quyền ứng dụng trong Google Account → Security → Third-party apps & services rồi tạo token mới.

## 3. Thêm secrets cho Edge Function

Trong Supabase Dashboard, mở **Edge Functions → Secrets** và thêm:

| Key | Value |
| --- | --- |
| `GMAIL_CLIENT_ID` | OAuth Client ID từ Google Cloud |
| `GMAIL_CLIENT_SECRET` | OAuth Client secret |
| `GMAIL_REFRESH_TOKEN` | Refresh token từ OAuth Playground |
| `GMAIL_SENDER_EMAIL` | Địa chỉ Gmail đã cấp quyền ở bước 7 |
| `REMINDER_CRON_SECRET` | Chuỗi ngẫu nhiên tự tạo; dùng lại chính xác trong Vault ở bước 4 |

Có thể thêm qua CLI từ máy đã liên kết project:

```sh
supabase secrets set GMAIL_CLIENT_ID=<client-id> GMAIL_CLIENT_SECRET=<client-secret> GMAIL_REFRESH_TOKEN=<refresh-token> GMAIL_SENDER_EMAIL=<your-account@gmail.com> REMINDER_CRON_SECRET=<chuoi-bi-mat>
supabase functions deploy payment-reminders
```

Không dùng `RESEND_API_KEY` nữa. Sau khi kiểm tra Gmail gửi thành công, có thể xóa Resend API key cũ khỏi Edge Function Secrets.

## 4. Lưu hai giá trị Cron trong Vault

Mở **Project Settings → Vault** hoặc chạy SQL Editor. Thay `<project-ref>` bằng mã dự án và `<chuoi-bi-mat>` bằng cùng giá trị của `REMINDER_CRON_SECRET` ở bước 3:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'payment_reminders_project_url');
select vault.create_secret('<chuoi-bi-mat>', 'payment_reminders_cron_secret');
```

Nếu chạy lại, kiểm tra/xóa secret trùng tên trong Vault trước để tránh lỗi tên bị trùng. Không truy vấn hoặc chia sẻ `decrypted_secret`.

## 5. Lên lịch chạy mỗi ngày lúc 08:00 giờ Việt Nam

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

## 6. Gửi email thử

Trong **Quản trị → Thông báo**, nhập tên và địa chỉ Gmail đã kết nối OAuth, tùy chọn email nhận phản hồi, lưu cấu hình rồi bấm **Gửi email thử**. Địa chỉ người gửi phải trùng `GMAIL_SENDER_EMAIL`. Email thử gửi đến email tài khoản quản trị đang đăng nhập. Email nhắc thật gửi cho thành viên có tài khoản liên kết và email hợp lệ.
