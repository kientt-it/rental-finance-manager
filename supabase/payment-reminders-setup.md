# Thiết lập thông báo thanh toán qua Gmail API

Tính năng dùng Supabase Edge Functions + Cron và Gmail API. Không cần mua tên miền. OAuth credentials phải được lưu trong Supabase **Edge Function Secrets**, không nhập vào ứng dụng hoặc Vault. Vault chỉ giữ URL dự án và bí mật gọi Cron. Nếu `pg_cron`, `pg_net` hoặc Vault chưa bật, bật các extension này trong mục **Database → Extensions**.

## 1. Áp dụng cấu trúc dữ liệu

Chạy lần lượt migration `0019_payment_reminders.sql`, `0020_room_rent_settlements.sql`, `0021_room_rent_billing_cycles.sql`, `0022_split_rent_and_living_reminders.sql`, `0023_fix_payment_reminder_conflict_target.sql`, `0024_separate_send_days_and_recipient_audit.sql` và `0025_disable_overdue_reminders_with_zero.sql` trong Supabase SQL Editor, hoặc deploy migration bằng Supabase CLI. Nếu project đã chạy đến `0024`, chỉ cần chạy `0025`. Migration `0024` cho phép đặt ngày gửi nhắc đầu tiên riêng cho chi phí sinh hoạt hằng tháng và tiền phòng theo chu kỳ; đồng thời thêm danh sách kiểm tra lý do từng thành viên có hoặc không có email. Migration `0025` cho phép đặt **Nhắc quá hạn = 0** để tắt email quá hạn cho từng loại. Tiền phòng chỉ phát sinh ở tháng đến kỳ 1/3/6/12 tháng của từng phòng.

Để kiểm tra migration `0024` đã được áp dụng, chạy truy vấn chỉ đọc sau trong SQL Editor. Cả ba cột cần hiện `true`:

```sql
select exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'payment_reminder_settings' and column_name = 'living_send_day'
       ) as co_ngay_gui_sinh_hoat,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'payment_reminder_settings' and column_name = 'rent_send_day'
       ) as co_ngay_gui_tien_phong,
       to_regprocedure('public.get_payment_reminder_recipient_audit(uuid)') is not null as co_danh_sach_kiem_tra;
```

Nếu đã chạy đến `0028`, chạy thêm `0029_safe_reminder_delivery.sql` rồi deploy lại Edge Function **và website**. Chạy SQL trước khi deploy function: bản mới cần hàm `claim_payment_reminder_email`. Migration này cho phép thông báo trong app cho người đã liên kết tài khoản nhưng thiếu email, kiểm tra lại khoản nợ trước khi gửi, và ngăn tự gửi trùng khi kết quả Gmail chưa rõ. Không cần đổi Gmail token hay Cron. Đừng chạy thử lịch gửi trên dữ liệu thật nếu chưa muốn gửi email cho thành viên đủ điều kiện.

## 2. Bật Gmail API và tạo OAuth credentials

Trước khi chuyển sang **In production**, deploy website lên Vercel để ba trang công khai `/about`, `/privacy` và `/terms` có hiệu lực. Mở từng trang trong cửa sổ ẩn danh: trang phải đọc được mà không yêu cầu đăng nhập. Trong **Google Auth Platform → Branding**, nhập tên ứng dụng `708 La Thành`, email hỗ trợ `k2team.club0@gmail.com` và các URL:

| Trường trong Branding | URL |
| --- | --- |
| Application home page | `https://708-la-thanh.vercel.app/about` |
| Application privacy policy link | `https://708-la-thanh.vercel.app/privacy` |
| Application terms of service link | `https://708-la-thanh.vercel.app/terms` |

Nếu bạn đổi địa chỉ website, thay tên miền trong cả ba URL. Lưu Branding rồi quay lại **Audience → Publish app**. Chuyển trạng thái publish và xác minh OAuth là các bước riêng; thêm các trang này không tự hoàn tất việc xét duyệt của Google. Sau khi chuyển trạng thái, cấp quyền OAuth lại và thay `GMAIL_REFRESH_TOKEN` trong Supabase bằng token mới.

Nội dung các trang mô tả cấu hình Supabase/Gmail hiện tại. Email hỗ trợ và ngày cập nhật đặt trong `lib/public-site.ts`; nội dung ở `app/privacy/page.tsx` và `app/terms/page.tsx`. Cập nhật các trang nếu cách dùng dữ liệu thay đổi.

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

## 5. Lên lịch chạy mỗi ngày lúc 12:00 giờ Việt Nam

Supabase Cron dùng UTC, nên 12:00 trưa tại Việt Nam là 05:00 UTC. Nếu **chưa có** job, tạo mới bằng:

```sql
select cron.schedule(
  'payment-reminders-daily',
  '0 5 * * *',
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

Nếu **đã có** job `payment-reminders-daily`, chỉ đổi giờ chạy, không xóa job và không sửa lệnh gửi hiện có:

```sql
select cron.alter_job(jobid, '0 5 * * *')
from cron.job
where jobname = 'payment-reminders-daily';

select jobname, schedule, active
from cron.job
where jobname = 'payment-reminders-daily';
```

Dòng kiểm tra phải hiện `schedule = 0 5 * * *` và `active = true`. Nếu không có dòng nào, job chưa tồn tại trong project/phiên SQL hiện tại; dùng câu lệnh tạo mới ở trên.

## 6. Gửi email thử

Trong **Quản trị → Thông báo**, nhập tên và địa chỉ Gmail đã kết nối OAuth, nhập địa chỉ nhận thư thử, tùy chọn email nhận phản hồi, lưu cấu hình rồi bấm **Gửi email thử**. Địa chỉ người gửi phải trùng `GMAIL_SENDER_EMAIL`. Email nhắc thật gửi cho thành viên có tài khoản liên kết và email hợp lệ.

Hai tab **Sinh hoạt · hằng tháng** và **Tiền phòng · theo chu kỳ** có ô **Ngày gửi nhắc đầu tiên** riêng. Đây là ngày trong tháng của email nhắc trước hạn; nhập `0` nếu không muốn nhắc trước. Ô **Ngày đến hạn** và công tắc **Nhắc đúng ngày đến hạn** vẫn điều khiển email đúng hạn; **Nhắc quá hạn** điều khiển mốc sau hạn và nhận `0` để không nhắc quá hạn. Với tiền phòng, chỉ những phòng tới chu kỳ trong tháng mới được xét.

Khối **Kiểm tra người nhận** liệt kê mọi thành viên đang hoạt động của kỳ hiện tại, kể cả người không có email gửi. Nó ghi lý do như chưa liên kết tài khoản, thiếu địa chỉ email, chưa có chi phí phân bổ, chưa tới chu kỳ phòng, đã thanh toán hoặc đang chờ ngày gửi. **Lịch sử gửi gần đây** lấy tối đa 200 lần, lọc theo loại/trạng thái và hiển thị lỗi Gmail cùng số lần thử. Nếu một người không xuất hiện trong lịch sử nhưng khối kiểm tra ghi “Đến mốc gửi hôm nay”, hãy kiểm tra lần chạy Cron/Edge Function; nếu có dòng “Gửi lỗi”, đọc chi tiết lỗi trên chính dòng đó. Trạng thái **Cần kiểm tra** nghĩa là yêu cầu có thể đã tới Gmail nhưng chưa ghi được kết quả chắc chắn: đối chiếu mục **Đã gửi** trong Gmail và log Edge Function, không tự gửi lại trước khi xác minh. Cron sẽ trả HTTP 500 nếu có lỗi gửi hoặc ca cần kiểm tra, dù một số email khác trong lượt đó đã gửi thành công. Bản email thử không tạo lịch sử nhắc thật.
