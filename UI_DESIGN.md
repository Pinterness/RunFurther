# Quy tắc thiết kế giao diện RunFurther

## Hướng thiết kế
Thể thao, tự nhiên, rõ ràng. Ảnh đường chạy và typography là điểm nhấn chính.
Không dùng icon trang trí ở mọi dòng, emoji thay nhãn, thẻ kính, gradient neon hay nhiều màu nhấn cùng lúc.
Trang chủ là không gian khám phá; các trang tài khoản và nghiệp vụ ưu tiên thao tác nhanh.

## Màu sắc
- Nền giấy: #f8f7f3.
- Chữ chính: #20241e; chữ phụ: #6b7166.
- Cam thương hiệu: #ee592c; hover/nhãn chữ nhỏ dùng cam đậm #cc4721 hoặc #a93819.
- Xanh rừng: #263426 cho khối nội dung tương phản.
- Đường viền: #dfe2d7.
- Chỉ một hành động chính nổi bật trong mỗi nhóm.
- Tailwind primary đã đồng bộ bảng màu cam; không tự đặt thêm màu thương hiệu trong component mới.

## Typography và bố cục
- Font hệ thống Segoe UI / Arial hỗ trợ tiếng Việt, không cần tải font bên ngoài.
- Nội dung chính tối đa 1280px; lề desktop 48px, mobile 20–24px.
- Tiêu đề hero 42–104px theo màn hình; section 32–48px.
- Nhãn chữ hoa chỉ dùng ngắn, kích thước nhỏ. Nội dung giải thích luôn dùng câu đọc tự nhiên.
- Khoảng cách theo bội 4/8; ưu tiên khoảng trống và đường phân cách thay vì nhiều hộp có bóng.
- Bo góc 4–6px cho thành phần thương hiệu. Tránh mỗi nút một kiểu bo khác nhau.

## Điều hướng và tài khoản
- Logo luôn dẫn về /, không chuyển thẳng vào dashboard.
- Trang chủ, Giải chạy, Chuyển nhượng BIB, Tra cứu là các liên kết chính.
- Khách chỉ thấy Đăng nhập / Tham gia ngay. Không có avatar giả hoặc chuông không có chức năng.
- Người đã đăng nhập thấy chữ cái tên và menu Hồ sơ & vé, Ví & RunPoints, Đăng xuất.
- Mobile dùng menu mở/đóng bằng nút, có aria-expanded và Escape trả focus.
- Chỉ dùng biểu tượng khi có ý nghĩa: mũi tên cho điều hướng, dấu cộng cho mở FAQ, menu cho điều hướng mobile.
- Mọi icon trang trí có aria-hidden; nút chỉ có icon phải có nhãn truy cập.

## Chuyển động và tương tác
- Hover/focus: 150–240ms; reveal: 400–700ms.
- Easing: cubic-bezier(.22, 1, .36, 1).
- Nút chính dịch lên 2–3px khi hover, nhấn thu nhẹ .98; mũi tên dịch 3px.
- Ảnh thẻ giải scale tối đa 1.06; không làm thay đổi kích thước bố cục.
- Tabs cự ly và bước hướng dẫn đổi nội dung thật; CTA giữ đúng lựa chọn.
- FAQ mở từng mục; icon cộng xoay thành dấu đóng.
- Không hiệu ứng con trỏ tùy biến, tự chạy carousel hoặc animation vô hạn gây nhiễu.
- Tôn trọng prefers-reduced-motion: bỏ animation/transition và giữ nội dung hiển thị.
- Luôn có focus-visible. Tabs hỗ trợ phím mũi tên, Home/End. Menu hỗ trợ Escape.

## Nội dung và trạng thái
- Danh sách giải lấy API; không đưa giải demo hoặc số người dùng giả vào landing.
- Loading / empty / error phải có nội dung riêng. Lỗi mạng có nút thử lại và timeout.
- Ngày thi đấu đã qua không gắn nhãn đang mở đăng ký trên landing dù dữ liệu cũ còn trạng thái mở.
- Không quảng cáo phương thức thanh toán hay chức năng chưa triển khai.
- Ảnh nền hero hiện dùng asset sẵn có: public/assets/figma/event-trail.png.

## Vị trí triển khai
- src/components/site/site.css: token, header, footer và tương tác dùng chung của khu vực site.
- src/components/site/landing.css: bố cục landing, tab cự ly, section, FAQ và responsive.
- src/components/site/LandingPage.jsx: nội dung và tương tác landing.
- src/app/globals.css: nền tảng hiện có; giữ tương thích các trang nghiệp vụ và staff.
- Các trang nghiệp vụ cũ còn inline style: chuyển dần sang token chung khi thiết kế lại từng trang, không thay đổi hàng loạt ngoài phạm vi kiểm tra.

## Kiểm tra trước khi bàn giao
npm run build:web
npm run test:layout (cần web đang chạy và Chrome)

Kiểm tra 1440, 1024, 768, 390, 360px; không tràn ngang; đăng nhập/đăng xuất; bàn phím; reduced motion; trạng thái lỗi API.

## Hồ sơ và marketplace

- `runner.css` quản lý account, đăng ký, marketplace và modal. Thành phần chung: RunnerAvatar, RunnerFields, TicketCard, Modal.
- Avatar dùng chữ viết tắt từ tên, có bốn bảng màu và đường vòng trang trí; không hiển thị ảnh người dùng giả.
- Phân biệt vé đã cấp với đơn chờ thanh toán. QR tạo cục bộ từ token vé thật; không gửi token cho dịch vụ QR bên ngoài.
- Form đăng ký chia hai bước; hồ sơ dùng lại cho mua vé, người dùng vẫn được kiểm tra/sửa trước thanh toán.
- Khách bấm đăng tin/mua phải thấy lời mời đăng nhập ngay. Kiểm tra lại phiên bằng API, không chỉ tin localStorage.
- Modal dùng dialog gốc của trình duyệt để giữ focus, hỗ trợ Escape, khôi phục focus và khóa cuộn nền.
- Thử thách có người chạy quanh track khi hover/focus, không tự đổi tab. Reduced motion giữ hình tĩnh.
- Kiểm tra bổ sung: `npm run test:runner-ui` (Chrome, web đang chạy; API fixture không tác động dữ liệu thật).

## Khu vực ban tổ chức
- /organizer nằm trong layout site và dùng tài khoản cá nhân; truy cập từ menu avatar.
- Dashboard có trạng thái chưa đăng nhập, chưa có giải, lỗi tải và danh sách giải của mình.
- Trang quản lý tách thông tin, cự ly, nhân sự, người chạy; dùng cùng palette và component form/modal.
- Mã nhân sự mặc định thu gọn, chỉ hiển thị khi chủ giải chọn xem; không hiển thị mã EVENT_ADMIN.
- Kiểm thử: npm run test:organizer-ui, bao gồm các viewport 1440/768/390/360px và phản hồi 403.
