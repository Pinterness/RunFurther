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
- Không hiệu ứng con trỏ tùy biến. Carousel được tự chuyển mỗi 5 giây theo yêu cầu sản phẩm, phải có nút dừng và tự dừng khi hover/focus hoặc reduced motion.
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
- Trang quản lý tách thông tin, cự ly, nhân sự, người chạy và đối soát tiền vé; dùng cùng palette và component form/modal.
- Mã nhân sự mặc định thu gọn, chỉ hiển thị khi chủ giải chọn xem; không hiển thị mã EVENT_ADMIN.
- Kiểm thử: npm run test:organizer-ui, bao gồm các viewport 1440/768/390/360px và phản hồi 403.

## Hai nhân vật ở hero
- HeroRunners.jsx và hero-runners.css: hai nhân vật SVG với trang phục cam / xanh sage, đặt cạnh nội dung ở desktop và dưới nội dung ở mobile.
- Giữ ảnh rừng; thêm quầng sáng, đường chạy và bóng đổ để nhân vật nổi trên nền.
- Rê chuột vào từng nhân vật để chạy; rời chuột sẽ dừng. Bấm để giữ nhịp chạy khi rời chuột; bấm lại để bỏ giữ.
- Trên màn hình cảm ứng, chạm để chạy/dừng. Bàn phím dùng Enter/Space để bật/tắt, Escape để dừng; có focus rõ và aria-pressed.
- Khi người dùng bật reduced motion, hiển thị tư thế chạy tĩnh và tắt toàn bộ chuyển động.
- npm run test:hero: kiểm tra chuyển động tay chân thật, độc lập giữa hai người, bàn phím, cảm ứng, reduced motion và 7 chiều rộng từ 360 đến 1868px.

- Nhân vật hero có khung chậu liền với thân, hai khớp háng tách biệt và đầu gối gập đúng chiều. Chuyển động hông nhẹ; giữ nguyên bố cục và tương tác của hai nhân vật.

## Xuất hiện khi cuộn
- Hero có lớp sương bằng gradient, tan và dịch nhẹ theo tiến độ cuộn; không cản bấm vào nội dung.
- Tiêu đề rõ dần từ blur; container trượt lên hoặc vào từ trái/phải. Thẻ giải xuất hiện lệch 100ms, FAQ lệch 70ms; mỗi phần chỉ reveal một lần.
- Chuyển động 0,8–0,95 giây, giảm biên độ ngang trên điện thoại. Hỗ trợ reduced motion thay đổi ngay trong phiên; focus bàn phím làm hiện nội dung lập tức.
- Không có JavaScript, nội dung vẫn hiển thị. npm run test:scroll kiểm tra hiệu ứng và các trường hợp này.


## Vòng xoay, chuông và avatar

- “Lịch hẹn với chính mình” dùng carousel có chiều sâu: thẻ chính rõ và lớn, hai thẻ bên thu nhỏ; dữ liệu API thật. Tự chuyển 5 giây, dừng khi hover/focus, có nút dừng và các điều khiển thủ công.
- Mobile cho thấy mép thẻ kế tiếp để gợi ý vuốt; không tràn viewport. Reduced motion tắt tự chuyển và transition.
- Chuông dành cho tài khoản đã đăng nhập; dấu chưa đọc dựa vào API. Panel có tải/rỗng/lỗi, đóng khi bấm ngoài hoặc Escape và trả focus. Không dùng chấm thông báo giả.
- Header avatar 28px, nền nút trong suốt, viền nhẹ khi tương tác; avatar hồ sơ tròn 88px, bỏ dòng chữ trang trí nhỏ.
- Menu tài khoản Super Admin dẫn đến /admin; người tổ chức đến /organizer. Khu kiểm duyệt không có nút sửa giải, phân công nhân sự, xem vận động viên hoặc xóa vĩnh viễn.
- Duyệt quyền tổ chức và kiểm duyệt giải đều dùng modal với quyết định rõ ràng, lý do bắt buộc, trạng thái đang lưu và lỗi.
- Giao diện chủ giải bị kiểm duyệt hiển thị lý do và khóa các thao tác sửa; tiền vé vẫn có thể từ chối để đối soát.
