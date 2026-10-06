import type { Metadata } from "next";
import Link from "next/link";
import PublicInfo from "../public-info";

export const metadata: Metadata = {
  title: "Giới thiệu | 708 La Thành",
  description: "708 La Thành giúp quản lý phòng, chia tiền thuê nhà và chi phí sinh hoạt, theo dõi thanh toán và gửi email nhắc hạn.",
};

export default function AboutPage() {
  return (
    <PublicInfo currentPath="/about" title="708 La Thành" description="Ứng dụng quản lý phòng và tài chính chung dành cho quản trị viên và các thành viên nhà trọ.">
      <section>
        <h2>Quản lý phòng và các khoản cần đóng</h2>
        <p>Quản trị viên quản lý danh sách phòng, thành viên và tiền thuê nhà theo chu kỳ của từng phòng. Thành viên xem phần tiền được chia cho mình và ghi nhận việc đã đóng trong phạm vi được phân quyền.</p>
      </section>
      <section>
        <h2>Theo dõi chi phí sinh hoạt</h2>
        <p>Ứng dụng tổng hợp chi phí sinh hoạt theo tháng, phân chia cho thành viên và hiển thị công nợ, kỳ đối soát và báo cáo. Tiền phòng và chi phí sinh hoạt có lịch nhắc thanh toán riêng.</p>
      </section>
      <section>
        <h2>Đăng nhập và gửi thông báo bằng Google</h2>
        <p>Thành viên có thể đăng nhập bằng Google để xác thực tài khoản. Thông tin tài khoản cơ bản được dùng để nhận diện thành viên và áp dụng quyền truy cập.</p>
        <p>Quản trị viên có thể cấp quyền gửi thư cho tài khoản Gmail dùng gửi thông báo. Ứng dụng dùng Gmail API để gửi email nhắc tiền phòng, chi phí sinh hoạt và email thử theo cấu hình. Quyền gửi thư không được dùng để đọc hộp thư đến.</p>
      </section>
      <section>
        <h2>Thông tin trước khi sử dụng</h2>
        <p>Xem <Link href="/privacy">Chính sách quyền riêng tư</Link> để biết dữ liệu được xử lý như thế nào và <Link href="/terms">Điều khoản sử dụng</Link> để biết trách nhiệm khi ghi nhận các khoản thanh toán.</p>
      </section>
    </PublicInfo>
  );
}
