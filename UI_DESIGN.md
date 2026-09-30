# Quy tắc thiết kế giao diện RunFurther

## Hướng thiết kế
Thể thao, tự nhiên, rõ ràng. Ảnh đường chạy và typography là điểm nhấn chính.
Không dùng icon trang trí ở mọi dòng, emoji thay nhãn, thẻ kính, gradient neon hay nhiều màu nhấn cùng lúc.
Trang chủ là không gian khám phá; các trang tài khoản và nghiệp vụ ưu tiên thao tác nhanh.

## Màu sắc
- Nền giấy: #f8f7f3.
- Chữ chính: #20241e; chữ phụ: #6b7166.
- Cam thương hiệu: #ee592c; hover/nhãn chữ nhỏ dùng cam đậm #cc4721 hoặc #a93819.
- Xanh rừng: #263426 cho khối nội dung tương phản; xanh rừng tối #14281f cho header/footer, nối với cảnh trang chủ.
- Header dùng chữ kem, liên kết đang chọn và CTA màu cam nhạt #ffb48d. Dropdown/thông báo dùng nền giấy và chữ tối.
- Nút chính trên nền sáng dùng cam đậm #cc4721 với chữ trắng; cam #ee592c dùng cho dấu nhấn/đường kẻ.
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
- Không hiệu ứng con trỏ tùy biến. Carousel được tự chuyển mỗi 4,2 giây theo yêu cầu sản phẩm, phải có nút dừng và tự dừng khi hover/focus hoặc reduced motion.
- Tôn trọng prefers-reduced-motion: bỏ animation/transition và giữ nội dung hiển thị.
- Luôn có focus-visible. Tabs hỗ trợ phím mũi tên, Home/End. Menu hỗ trợ Escape.

## Nội dung và trạng thái
- Danh sách giải lấy API; không đưa giải demo hoặc số người dùng giả vào landing.
- Loading / empty / error phải có nội dung riêng. Lỗi mạng có nút thử lại và timeout.
- Ngày thi đấu đã qua không gắn nhãn đang mở đăng ký trên landing dù dữ liệu cũ còn trạng thái mở.
- Không quảng cáo phương thức thanh toán hay chức năng chưa triển khai.
- Hero hiện là cảnh 3D; chế độ dự phòng dùng public/assets/figma/event-trail.png.

## Vị trí triển khai
- src/app/globals.css: nguồn token chung (màu, bề mặt, bo góc, thời gian và easing) cho site và staff.
- src/components/site/site.css: header/footer, trang nội dung, đăng nhập và tương tác theo token chung.
- src/components/site/landing.css: bố cục landing, tab cự ly, section, FAQ và responsive.
- src/components/site/LandingPage.jsx: nội dung và tương tác landing.
- Biểu mẫu, thẻ giải, bảng kết quả, ví và tra cứu dùng nền giấy/xanh rừng/cam đất; không thêm xanh dương làm màu thương hiệu riêng. Trang đăng nhập dùng cùng bố cục hai cột với đăng ký; mobile xếp dọc.
- Dùng chuyển động 150–240ms cho nút/liên kết, 440ms cho ảnh/thẻ giải; không dùng dịch chuyển làm đổi kích thước bố cục.

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

## Hai nhân vật ở hero (phiên bản cũ, lưu để tái sử dụng)
- HeroRunners.jsx và hero-runners.css: hai nhân vật SVG với trang phục cam / xanh sage, đặt cạnh nội dung ở desktop và dưới nội dung ở mobile.
- Giữ ảnh rừng; thêm quầng sáng, đường chạy và bóng đổ để nhân vật nổi trên nền.
- Rê chuột vào từng nhân vật để chạy; rời chuột sẽ dừng. Bấm để giữ nhịp chạy khi rời chuột; bấm lại để bỏ giữ.
- Trên màn hình cảm ứng, chạm để chạy/dừng. Bàn phím dùng Enter/Space để bật/tắt, Escape để dừng; có focus rõ và aria-pressed.
- Khi người dùng bật reduced motion, hiển thị tư thế chạy tĩnh và tắt toàn bộ chuyển động.
- Bộ kiểm tra SVG cũ nằm tại scripts/checkHeroRunners.js; không chạy với landing 3D hiện tại. test:hero hiện kiểm tra trải nghiệm 3D bên dưới.

- Nhân vật hero có khung chậu liền với thân, hai khớp háng tách biệt và đầu gối gập đúng chiều. Chuyển động hông nhẹ; giữ nguyên bố cục và tương tác của hai nhân vật.

## Xuất hiện khi cuộn
- Hero có lớp sương bằng gradient, tan và dịch nhẹ theo tiến độ cuộn; không cản bấm vào nội dung.
- Tiêu đề rõ dần từ blur; container trượt lên hoặc vào từ trái/phải. Thẻ giải xuất hiện lệch 100ms, FAQ lệch 70ms; mỗi phần chỉ reveal một lần.
- Chuyển động 0,8–0,95 giây, giảm biên độ ngang trên điện thoại. Hỗ trợ reduced motion thay đổi ngay trong phiên; focus bàn phím làm hiện nội dung lập tức.
- Không có JavaScript, nội dung vẫn hiển thị. npm run test:scroll kiểm tra hiệu ứng và các trường hợp này.


## Vòng xoay, chuông và avatar

- “Lịch hẹn với chính mình” dùng carousel có chiều sâu: thẻ chính rõ và lớn, hai thẻ bên thu nhỏ; dữ liệu API thật. Tự chuyển 4,2 giây, dừng khi hover/focus, có nút dừng và các điều khiển thủ công.
- Carousel chuyển thẻ trong 440ms, nội suy transform/opacity đồng bộ; nút trước/sau và chỉ báo nằm trên bộ thẻ, căn giữa bằng grid. Mobile chia hai hàng điều khiển để nút không bị đẩy xuống dưới thẻ.
- Mobile cho thấy mép thẻ kế tiếp để gợi ý vuốt; không tràn viewport. Reduced motion tắt tự chuyển và transition.
- Chuông dành cho tài khoản đã đăng nhập; dấu chưa đọc dựa vào API. Panel có tải/rỗng/lỗi, đóng khi bấm ngoài hoặc Escape và trả focus. Không dùng chấm thông báo giả.
- Header avatar 28px, nền nút trong suốt, viền nhẹ khi tương tác; avatar hồ sơ tròn 88px, bỏ dòng chữ trang trí nhỏ.
- Menu tài khoản Super Admin dẫn đến /admin; người tổ chức đến /organizer. Khu kiểm duyệt không có nút sửa giải, phân công nhân sự, xem vận động viên hoặc xóa vĩnh viễn.
- Duyệt quyền tổ chức và kiểm duyệt giải đều dùng modal với quyết định rõ ràng, lý do bắt buộc, trạng thái đang lưu và lỗi.
- Giao diện chủ giải bị kiểm duyệt hiển thị lý do và khóa các thao tác sửa; tiền vé vẫn có thể từ chối để đối soát.


## Ảnh nhận diện và chuyển khoản tiền vé

- Chủ giải chọn JPG/PNG/WebP từ thiết bị, xem trước ảnh bìa/logo ngay trong form. Dùng nhãn “Chọn ảnh”, “Đổi ảnh”, “Gỡ ảnh”; trạng thái tải/lỗi đặt cạnh vùng ảnh. Khóa lưu khi upload chưa xong.
- Ảnh bìa giữ tỷ lệ khi lưu; crop cover tại thẻ/hero, logo dùng contain trên nền sáng. Không kéo giãn logo. Ảnh thiếu/lỗi dùng ảnh dự phòng.
- Trang đăng ký hiển thị ảnh bìa và logo của đúng giải để người mua nhận diện trước khi điền hồ sơ.
- Ngân hàng chọn từ danh sách, số tài khoản và tên chủ tài khoản nhập riêng. Xem trước QR chỉ bật khi đủ dữ liệu; nhãn nêu rõ đây là mã xem trước.
- QR tiền vé và thông tin người nhận đặt cạnh nhau ở desktop, xếp dọc ở mobile. Có nút sao chép số tài khoản, số tiền và nội dung đơn; giữ thông tin đọc/chọn được khi Clipboard không khả dụng.
- QR tải lỗi phải có hướng dẫn chuyển khoản thủ công và nút tải lại, không để ảnh vỡ. Đơn hết hạn hoặc giải tạm ngừng phải ngừng hiển thị QR thanh toán.
- Phân biệt rõ “chờ chủ giải đối soát” với “đã cấp vé”; không hiển thị yêu cầu PENDING như lỗi, không cho bấm gửi nhiều lần trong lúc chờ.
- Nhắc kiểm tra tên người nhận trong ứng dụng ngân hàng; tên do chủ giải nhập chưa được xác minh tự động.
- Kiểm thử bổ sung: npm run test:event-media-ui.

## Trải nghiệm chạy 3D trên landing

- Cả landing nằm trong khung cảnh 3D; header/footer nền tảng vẫn có thể truy cập. Trạm đánh số 01–05, không dùng 00.
- Người xem bắt đầu ở góc nhìn thứ nhất. Cuộn một lần, nhân vật chạy đến trạm kế tiếp với góc máy bám theo; tiếp tục chuyển qua góc nhìn bên, trên cao, vòng quanh và chính diện.
- Nhân vật có động tác chạy thật theo các khớp; đứng nghỉ khi dừng. Tới trạm nước đưa cốc lên miệng, tới race kit nhận túi, tới đích nhận huy chương và giơ tay ăn mừng. Trạng thái đang chạy/làm động tác hiển thị cạnh nút trước/tiếp.
- Không để một đợt trackpad dài bỏ qua nhiều trạm. Khóa nút chuyển chặng khi động tác chưa xong; vẫn cho mở bảng nội dung hoặc chuyển sang ít chuyển động.
- Thanh nội dung trong cảnh gồm Chọn cự ly / Lịch giải / Cách tham gia / Hỏi đáp. Bảng mở trên nền 3D, tự cuộn khi dài, có nút Đóng và Escape; đóng trả focus đúng nút. Nội dung không còn xếp thành chuỗi section dài dưới cảnh.
- Tạm dừng chuyển động khi bảng mở để đọc/dùng form dễ hơn; đóng tiếp tục hành trình. Wheel trong bảng không được kích hoạt nhân vật.
- Desktop đặt chữ bên trái, cảnh và nhân vật bên phải. Mobile đưa góc máy lên trên, chữ và điều khiển phía dưới, bảng nội dung gần đầy khung.
- Nền xanh đêm, đường đất cam, sương/bụi và bóng đổ mềm; giữ phong cách 3D cách điệu. Sa bàn, race kit và huy chương là minh họa, không phải quyền lợi được cam kết của một giải cụ thể.
- Có nút Xem ít chuyển động; reduced motion, màn hình thấp, thiếu/mất WebGL hoặc tắt JS đều giữ nội dung đầy đủ trong bố cục tĩnh, không giữ khoảng cuộn trống.
- Dùng test:trail-scene, test:camera, test:layout, test:scroll và test:platform-ui để kiểm tra.
