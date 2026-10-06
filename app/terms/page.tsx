import type { Metadata } from "next";
import Link from "next/link";
import { publicSite } from "@/lib/public-site";
import PublicInfo from "../public-info";

export const metadata: Metadata = {
  title: "Điều khoản sử dụng | 708 La Thành",
  description: "Điều khoản sử dụng ứng dụng 708 La Thành để quản lý phòng, chi phí chung, xác nhận thanh toán và thông báo nhắc hạn.",
};

export default function TermsPage() {
  return (
    <PublicInfo currentPath="/terms" title="Điều khoản sử dụng" description="Các nguyên tắc sử dụng ứng dụng 708 La Thành trong việc quản lý phòng, chi phí chung và ghi nhận thanh toán.">
      <section>
        <h2>1. Phạm vi sử dụng</h2>
        <p>Ứng dụng hỗ trợ quản trị viên và thành viên nhà trọ quản lý phòng, tiền thuê nhà, chi phí sinh hoạt, kỳ đối soát và thông báo nhắc hạn. Quyền xem và thao tác phụ thuộc vào vai trò và dữ liệu được liên kết với tài khoản.</p>
      </section>
      <section>
        <h2>2. Tài khoản và thông tin nhập</h2>
        <p>Bạn chịu trách nhiệm bảo vệ thông tin đăng nhập, cung cấp địa chỉ liên hệ đúng và chỉ sử dụng dữ liệu thuộc phạm vi được cấp quyền. Không dùng tài khoản để truy cập trái phép, thay đổi dữ liệu của người khác hoặc gửi thư không liên quan tới việc quản lý của nhà trọ.</p>
      </section>
      <section>
        <h2>3. Ghi nhận thanh toán</h2>
        <p>Số tiền hiển thị được tính từ dữ liệu và cấu hình quản trị viên nhập. Khi có sai lệch, thành viên cần trao đổi với quản trị viên để đối soát.</p>
        <p>Đánh dấu đã đóng là thao tác ghi nhận trong ứng dụng. Ứng dụng không tự chuyển tiền và không xác minh giao dịch ngân hàng; việc xác nhận tiền thực nhận do các bên liên quan kiểm tra.</p>
      </section>
      <section>
        <h2>4. Thông báo và Gmail</h2>
        <p>Quản trị viên chịu trách nhiệm cấu hình đúng địa chỉ nhận, lịch nhắc, tài khoản gửi và nội dung thư. Email nhắc hạn phụ thuộc vào quyền truy cập Google, hạn mức và tình trạng dịch vụ; thành viên cần xem các khoản cần đóng trong ứng dụng nếu chưa nhận được thư.</p>
        <p>Chỉ cấp quyền Gmail cho tài khoản bạn được phép sử dụng. Quyền có thể được thu hồi trong Google Account hoặc ngừng sử dụng bằng cách tắt cấu hình gửi email.</p>
      </section>
      <section>
        <h2>5. Dữ liệu và hỗ trợ</h2>
        <p>Việc xử lý dữ liệu được mô tả trong <Link href="/privacy">Chính sách quyền riêng tư</Link>. Để báo sai số liệu, sự cố tài khoản hoặc yêu cầu xử lý dữ liệu, liên hệ quản trị viên hoặc <a href={`mailto:${publicSite.supportEmail}`}>{publicSite.supportEmail}</a>.</p>
      </section>
    </PublicInfo>
  );
}
