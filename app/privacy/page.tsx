import type { Metadata } from "next";
import { publicSite } from "@/lib/public-site";
import PublicInfo from "../public-info";

export const metadata: Metadata = {
  title: "Chính sách quyền riêng tư | 708 La Thành",
  description: "Thông tin về dữ liệu tài khoản, dữ liệu phòng và thanh toán, quyền Gmail và cách yêu cầu chỉnh sửa hoặc xóa dữ liệu tại 708 La Thành.",
};

export default function PrivacyPage() {
  return (
    <PublicInfo currentPath="/privacy" title="Chính sách quyền riêng tư" description="Chính sách này mô tả cách ứng dụng 708 La Thành xử lý thông tin khi bạn đăng nhập, quản lý các khoản chi chung và nhận thông báo thanh toán.">
      <section>
        <h2>1. Dữ liệu ứng dụng xử lý</h2>
        <ul>
          <li>Thông tin tài khoản: mã tài khoản, tên tài khoản, tên hiển thị, địa chỉ email và ảnh đại diện nếu được cung cấp. Khi đăng nhập bằng Google, thông tin cơ bản được chuyển tới hệ thống xác thực Supabase.</li>
          <li>Thông tin do thành viên hoặc quản trị viên nhập: phòng ở, thành viên, tiền thuê phòng, chu kỳ đóng tiền, chi phí sinh hoạt, phần tiền được phân chia và trạng thái xác nhận thanh toán.</li>
          <li>Thông tin thông báo: địa chỉ email nhận thư, tên và địa chỉ người gửi, địa chỉ nhận phản hồi, mẫu thư, lịch nhắc và lịch sử gửi cùng trạng thái thành công hoặc lỗi.</li>
        </ul>
      </section>
      <section>
        <h2>2. Mục đích sử dụng</h2>
        <p>Dữ liệu được dùng để xác thực và phân quyền tài khoản, quản lý phòng, tính và đối soát các khoản cần đóng, lập báo cáo và gửi thông báo theo cấu hình của quản trị viên. Email thành viên được dùng làm địa chỉ nhận nhắc thanh toán khi tính năng gửi email được bật.</p>
      </section>
      <section>
        <h2>3. Quyền truy cập Google và Gmail</h2>
        <p>Đăng nhập bằng Google dùng thông tin tài khoản cơ bản để nhận diện người đăng nhập. Việc cấp quyền cho Gmail gửi thông báo là cấu hình riêng của quản trị viên đối với tài khoản gửi thư.</p>
        <p>Tính năng gửi thông báo yêu cầu quyền <code>gmail.send</code>. Ứng dụng dùng quyền này để gửi email nhắc thanh toán và email thử; không dùng quyền này để đọc, tìm kiếm hoặc xóa thư trong hộp thư của bạn.</p>
        <p>Thông tin xác thực Gmail, bao gồm refresh token, được lưu trong Supabase Edge Function Secrets và được xử lý phía máy chủ để lấy access token trước khi gửi thư. Các thông tin bí mật này không được đưa vào giao diện người dùng.</p>
        <p>Việc sử dụng và chuyển dữ liệu nhận từ Google APIs tuân theo <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noreferrer">Google API Services User Data Policy</a>, bao gồm các yêu cầu Limited Use. Ứng dụng không bán dữ liệu Google, không dùng dữ liệu này cho quảng cáo hoặc huấn luyện mô hình AI.</p>
      </section>
      <section>
        <h2>4. Lưu trữ và bên cung cấp dịch vụ</h2>
        <p>Supabase cung cấp hệ thống xác thực, cơ sở dữ liệu và tác vụ gửi thông báo. Vercel cung cấp hạ tầng chạy website. Google xử lý việc đăng nhập bằng Google và gửi thư qua Gmail API.</p>
        <p>Ứng dụng sử dụng cookie xác thực để duy trì phiên đăng nhập. Nếu bạn dùng ứng dụng dạng PWA, trình duyệt có thể lưu các tài nguyên giao diện và biểu tượng để hỗ trợ tải ứng dụng.</p>
        <p>Khi gửi thư, địa chỉ người nhận và nội dung nhắc thanh toán được chuyển tới Google để gửi tới người nhận. Quản trị viên và thành viên truy cập dữ liệu trong phạm vi được phân quyền; dữ liệu phòng và tài chính không hiển thị trên các trang thông tin công khai.</p>
      </section>
      <section>
        <h2>5. Thời gian lưu giữ và yêu cầu về dữ liệu</h2>
        <p>Thông tin tài khoản, kỳ thanh toán và lịch sử thông báo được lưu để phục vụ quản lý và đối soát trong thời gian sử dụng ứng dụng. Tắt nhắc hạn hoặc thu hồi quyền Google không tự xóa các bản ghi đã được lưu.</p>
        <p>Bạn có thể liên hệ quản trị viên hoặc gửi email tới <a href={`mailto:${publicSite.supportEmail}`}>{publicSite.supportEmail}</a> để yêu cầu xem, chỉnh sửa hoặc xóa dữ liệu liên quan đến mình. Người quản lý sẽ kiểm tra quyền sở hữu tài khoản và trao đổi phạm vi xử lý, bao gồm các bản ghi chi phí chung liên quan đến thành viên khác.</p>
      </section>
      <section>
        <h2>6. Thu hồi quyền Google</h2>
        <p>Bạn có thể quản lý hoặc thu hồi quyền của ứng dụng tại <a href="https://myaccount.google.com/connections" rel="noreferrer">trang kết nối của Google Account</a>. Thu hồi quyền của tài khoản Gmail gửi thư sẽ khiến ứng dụng không thể tiếp tục gửi thư bằng tài khoản đó cho tới khi được cấp quyền lại. Quản trị viên có thể tắt gửi email trong phần cấu hình thông báo và xóa thông tin xác thực Gmail khỏi Supabase.</p>
      </section>
      <section>
        <h2>7. Liên hệ và cập nhật</h2>
        <p>Đầu mối hỗ trợ của {publicSite.name}: <a href={`mailto:${publicSite.supportEmail}`}>{publicSite.supportEmail}</a>. Các thay đổi về cách xử lý dữ liệu sẽ được cập nhật tại trang này, với ngày cập nhật ghi ở đầu trang.</p>
      </section>
    </PublicInfo>
  );
}
