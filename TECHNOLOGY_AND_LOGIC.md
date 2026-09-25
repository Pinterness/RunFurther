# Công nghệ và thuật toán / logic đã dùng trong cuộc trao đổi

Cập nhật: 24/09/2026. Tài liệu tổng hợp phần đã triển khai và kiểm chứng trong mã nguồn; không xem toàn bộ thư viện được cài là tính năng đã hoàn thành.

## 1. Các công nghệ

| Công nghệ | Cách sử dụng trong dự án |
| --- | --- |
| JavaScript, Node.js | Ngôn ngữ và môi trường chạy backend, script seed/kiểm tra và kiểm thử. |
| Next.js 16, App Router | Router theo thư mục, layout site/staff, trang động theo slug/eventId, build frontend. Đọc tài liệu đi kèm phiên bản cài trong node_modules/next/dist/docs trước khi sửa. |
| React 19 | Form có state, component dùng lại, effect tải API, trạng thái loading/error/empty; use(params) cho tham số route bất đồng bộ. |
| Tailwind CSS 4, @tailwindcss/postcss, PostCSS | Biên dịch utility CSS. globals.css dùng import Tailwind và tham chiếu tailwind.config.js; sửa lỗi mất CSS trước đó. |
| CSS thuần, media queries | Design token, bố cục responsive, hover/focus/active, keyframes, offset-path, reduced motion. Thiết kế kem – xanh rừng – cam. |
| HTML dialog | Hộp thoại với focus trong modal, Escape, trả focus và khóa cuộn nền. |
| Express 4 | REST API, middleware xác thực/phân quyền, xử lý lỗi. |
| MongoDB, Mongoose 8 | Schema, enum, validation, tham chiếu document, index, truy vấn và transaction. Backend yêu cầu replica set hoặc sharded cluster. |
| bcryptjs | Băm mật khẩu tài khoản; đăng ký dùng cost 12. Không lưu mật khẩu dạng rõ. |
| jsonwebtoken | Bearer JWT xác thực tài khoản; mặc định hạn 7 ngày nếu không đổi cấu hình. API kiểm tra lại tài khoản đang hoạt động. |
| node:crypto | Sinh token QR và mã đăng nhập nhân sự bằng nguồn ngẫu nhiên mật mã. |
| qrcode | Tạo ảnh PNG QR ở trình duyệt từ token vé. Không gửi token vé sang dịch vụ tạo QR bên ngoài. |
| Helmet, CORS, dotenv | Header HTTP, cấu hình origin và biến môi trường. |
| nodemon | Khởi động lại backend khi file thay đổi; npm run dev là backend, dev:web là Next. |
| node:test, node:assert | Kiểm thử tích hợp backend và các bất biến nghiệp vụ. |
| mongodb-memory-server | Replica set MongoDB tạm cho kiểm thử; không dùng DB thật từ .env để ghi dữ liệu test. |
| Playwright, Chrome headless | Kiểm thử luồng UI, bàn phím, viewport, trạng thái lỗi, screenshot. Các script UI giả lập API để không tạo giao dịch trên DB thật. |

Framer Motion và lucide-react có trong dependency của dự án. Các tương tác mới ở landing, avatar và khu vực ban tổ chức chủ yếu dùng CSS và React; không có mô hình AI hoặc thuật toán học máy trong các phần này.

## 2. Đăng nhập và phân quyền theo sự kiện

Tách **danh tính** (User) khỏi **phân công** (EventAccount). EVENT_ADMIN không phải quyền quản lý tất cả sự kiện.

Điều kiện quản lý một giải:

```
User đang hoạt động
AND JWT hợp lệ
AND User.systemRole != SUPER_ADMIN
AND Event.createdBy == User.id
AND EventAccount.eventId == Event.id
AND EventAccount.userId == User.id
AND EventAccount.accountType == EVENT_ADMIN
AND EventAccount.status == ACTIVE
```

- Đây là RBAC theo sự kiện kết hợp kiểm tra quyền sở hữu tài nguyên.
- createdBy lấy từ người dùng đã xác thực; bỏ qua createdBy do client gửi. Trường được đánh dấu immutable và không nằm trong danh sách trường cập nhật.
- Tạo giải DRAFT và cấp EVENT_ADMIN cho người tạo trong cùng transaction.
- Trước khi tạo đơn vị/giải, người dùng phải được SUPER_ADMIN duyệt OrganizerApplication. Tạo giải còn đòi hỏi sở hữu tổ chức đang hoạt động, chưa hết hạn. SUPER_ADMIN không được tạo hay vận hành giải.
- GET danh sách quản lý chỉ trả các giải vừa do mình tạo vừa còn phân công quản lý. Tài khoản mới nhận danh sách rỗng và phải gửi đơn xin quyền tổ chức trước.
- CHECKIN, RACE_KIT, STAFF_MANAGER... được kiểm tra theo cặp người dùng/mã nhân sự và eventId, rồi kiểm tra loại thao tác.
- Mã nhân sự EVENT_ADMIN không được đăng nhập hay gọi API nhân sự: quản lý dùng tài khoản cá nhân bên ngoài.
- Mã nhân sự mới dùng 8 byte ngẫu nhiên, hiển thị dạng 16 ký tự hex; không dùng PIN ngắn dễ đoán.
- Khóa phân công vô hiệu hóa truy cập; đổi mã vô hiệu hóa mã cũ. Nếu phân công gắn User bị khóa, mã đó cũng bị từ chối.
- Tạo/sửa phân công nhân sự không cho tự cấp EVENT_ADMIN. Khi sửa nhân sự/cự ly/VĐV luôn truy vấn cả ID tài nguyên lẫn eventId từ URL.
- Không dựa vào ẩn nút UI để bảo mật: API kiểm tra quyền độc lập.

**Dữ liệu cũ:** giải không có createdBy không tự được gán chủ từ một vai trò hoặc từ tổ chức. Không ai được vận hành giải cho đến khi xác minh người tạo; SUPER_ADMIN chỉ có quyền kiểm duyệt. Script setLegacyEventCreator.js mặc định dry-run; --apply chỉ dùng sau khi đối chiếu lịch sử. Script chỉ bổ sung cho giải chưa có chủ, không chuyển quyền sở hữu đã xác lập. Chưa chạy script này trên DB thật.

## 3. Giữ chỗ và chống bán vượt số suất

- Booking có trạng thái HOLD → PAID, hoặc HOLD → EXPIRED/CANCELLED.
- Giữ chỗ 10 phút; cập nhật quota bằng điều kiện ở DB và transaction để các yêu cầu đồng thời không bán vượt quotaTotal.
- Các bất biến: quotaHold và quotaSold không âm; tổng chỗ giữ và vé đã bán không vượt quotaTotal.
- Hết hạn: tìm HOLD đã quá expiresAt theo lô tối đa 500; chuyển trạng thái có điều kiện và giảm quotaHold trong cùng transaction.
- Việc cleanup lặp lại không trả quota hai lần; backend chạy định kỳ 30 giây và các API liên quan có kiểm tra hết hạn.
- Cập nhật cự ly không cho giảm quota dưới số đã giữ + đã bán.
- Mở đăng ký từ trạng thái khác phải có ít nhất một cự ly với số suất dương.

Đây là cập nhật nguyên tử có điều kiện và transaction; không phải khóa bằng biến JavaScript trong một tiến trình.

## 4. Thanh toán, ví và chống xử lý trùng

- Thanh toán ví kiểm tra số dư, ghi ledger, đổi quota, cấp vé và cập nhật booking trong transaction.
- Idempotency: khóa giao dịch và trạng thái đã hoàn tất giúp request lặp không trừ tiền/cấp vé lại.
- Unique index hỗ trợ phát hiện trùng booking, BIB trong sự kiện và tham chiếu giao dịch.
- Nếu số dư/điểm không đủ hoặc một bước thất bại, transaction rollback toàn bộ thay đổi.
- Tiền dùng số nguyên VNĐ và kiểm tra Number.isSafeInteger ở các đầu vào liên quan.
- Chuyển khoản/VietQR và nạp ví tạo yêu cầu chờ duyệt. Chỉ cộng tiền/cấp vé sau khi đối soát được xác nhận; chưa có webhook ngân hàng tự động.
- RunPoints: 1 điểm giảm 1.000đ; số điểm sử dụng bị giới hạn theo số dư và tối đa 50% tổng tiền. Điểm thưởng là floor(số tiền cuối / 50.000).
- Không tin walletId do client cung cấp để chọn ví của người khác.

## 5. Marketplace và chuyển nhượng BIB

- Kiểm tra chủ vé, trạng thái CONFIRMED, chưa check-in/chưa phát kit, giải chưa diễn ra và cho phép chuyển nhượng.
- Giá BIB không vượt floor(giá đã trả × 1,1).
- Đăng tin đổi vé sang PENDING_TRANSFER; hủy tin trả về CONFIRMED.
- Mua: trừ ví người mua, cộng ví người bán, chuyển chủ vé, thay hồ sơ người chạy và đổi QR token trong cùng transaction.
- Tranh chấp đồng thời chỉ có một giao dịch mua thành công; request lặp của người mua đã hoàn tất không trả tiền lần nữa.
- UI kiểm tra phiên qua /auth/me trước khi mở form mua/đăng tin. Khách hoặc phiên hết hạn thấy yêu cầu đăng nhập ngay.
- Hỗ trợ tìm kiếm, loại tin và phân trang. Phần đồ chạy bộ chưa có hệ thống vận chuyển/ký quỹ/tranh chấp.

## 6. Hồ sơ người chạy và vé

- Tạo User và RunnerProfile cùng transaction; ngày sinh sai, size áo sai hoặc liên hệ khẩn cấp thiếu một nửa làm thao tác thất bại.
- Ngày sinh kiểm tra định dạng YYYY-MM-DD, ngày có thật, không ở tương lai và năm từ 1900.
- Chỉ cho cập nhật các trường trong danh sách cho phép; không nhận email/vai trò/quyền từ form chỉnh hồ sơ.
- Chuẩn hóa enum giới tính giữa model và form; 2XL được thể hiện là XXL cho luồng mua vé.
- Lưu hồ sơ gốc và snapshot người chạy trên từng vé riêng nhau. Sửa hồ sơ không làm đổi vé đã cấp.
- Avatar lấy chữ đầu của tối đa hai từ cuối trong tên; bốn bảng màu được kiểm tra theo enum. Chưa có upload ảnh avatar.
- QR token sinh ngẫu nhiên; ảnh QR tạo tại client. Vé bị hủy/đang chuyển nhượng không hiển thị QR sử dụng.
- Sự kiện rf-auth đồng bộ header khi hồ sơ/phiên đăng nhập thay đổi.
- next chỉ nhận đường dẫn nội bộ cùng origin, tránh chuyển người dùng sang website ngoài sau đăng nhập.

## 7. Kết quả và thành tích

- Chip time chuyển về tổng số giây để so sánh.
- Kết quả sắp xếp tăng dần theo chip time; _id là tiêu chí phụ khi bằng nhau. Hạng hiện là thứ tự 1,2,3..., chưa áp dụng đồng hạng.
- Bộ lọc cự ly/giới tính xác định nhóm xếp hạng; tìm theo tên/BIB sau khi xếp hạng để không làm thay đổi hạng.
- Thành tích chỉ tính giải có kết quả hợp lệ; không coi việc mua vé là hoàn thành giải.
- Personal best là thời gian nhỏ nhất cho từng cự ly.
- Bảng kết quả hiện sắp xếp trong bộ nhớ ứng dụng; cần chuyển sang aggregation/phân trang DB khi quy mô kết quả lớn.

## 8. Tương tác giao diện

- CSS Grid/Flexbox và breakpoint cho desktop/tablet/mobile; kiểm tra không tràn ngang ở nhiều chiều rộng.
- Hover/focus/active trên nút và liên kết; CSS keyframes + offset-path cho hình người chạy quanh đường đua.
- Tab cự ly có điều khiển bàn phím và aria; hover không tự thay đổi lựa chọn.
- prefers-reduced-motion vô hiệu hóa animation theo thiết lập người dùng.
- IntersectionObserver phục vụ hiệu ứng xuất hiện theo cuộn ở landing.
- AbortController hủy request không còn cần để hạn chế kết quả cũ ghi đè dữ liệu mới.
- API có các trạng thái loading/error/empty riêng; không chèn vé hoặc số liệu giả để lấp khoảng trống.
- Modal dùng HTML dialog, không tự dựng focus trap bằng thuật toán riêng.

## 9. Kiểm thử và giới hạn hiện tại

- Backend kiểm thử transaction, cạnh tranh đồng thời bằng Promise.all, rollback, idempotency, phân quyền chéo sự kiện, tài khoản bị khóa và dữ liệu sai.
- UI kiểm thử bằng API fixtures; đây không phải kiểm thử end-to-end với ngân hàng/DB sản xuất.
- Màn ban tổ chức: tạo đơn vị, tạo/sửa giải, tạo/sửa cự ly, xem VĐV, phân công/khóa/đổi mã nhân sự.
- Các màn nghiệp vụ nhân sự đang có: check-in và phát race-kit. Chưa có màn riêng cho mọi vai trò như y tế, trạm nước, checkpoint, timing.
- Chưa có UI đầy đủ đối soát ngân hàng, email xác minh/quên mật khẩu, tự động gửi vé, timing thiết bị, chứng nhận PDF và mạng xã hội người chạy.
- Rate limit hiện dùng bộ nhớ một tiến trình; khi triển khai nhiều instance cần kho dùng chung.
- JWT trình duyệt hiện lưu localStorage; cơ chế cookie HttpOnly/CSRF và xoay refresh token chưa triển khai.
- Thư viện không đồng nghĩa đã được kiểm toán bảo mật toàn diện. Danh sách này ghi lại giải pháp đã làm và các giới hạn thực tế.

## 10. Hai người chạy tương tác ở phần mở đầu
- Minh họa SVG dựng trực tiếp trong mã nguồn, không thêm thư viện animation hoặc video.
- Tách các nhóm thân, đùi, cẳng chân, cánh tay, cẳng tay và tóc. CSS transform-origin đặt tại các khớp để xoay theo chu kỳ.
- Keyframes của hai chân/tay lệch nửa chu kỳ; thân nhún và bóng đổ thay đổi theo nhịp. Hai nhân vật có chu kỳ riêng 0,72 và 0,8 giây.
- React quản lý trạng thái hover và giữ chuyển động riêng cho từng người; CSS animation-play-state chạy/dừng mà không cần setInterval hay render lại từng frame.
- Pointer events phân biệt chuột/bút với cảm ứng để tránh hover bị giữ trên điện thoại.
- prefers-reduced-motion giữ minh họa tĩnh; Enter/Space/Escape hỗ trợ bàn phím.
- Playwright kiểm tra ma trận transform thật sự thay đổi khi chạy, người còn lại không bị kích hoạt, chạm lần hai dừng được và phần minh họa không chồng lên nội dung hero.

- Sửa khớp háng: khung chậu riêng có hai điểm gắn đùi. Đùi và cẳng chân dùng tọa độ cục bộ, xoay tại gốc của khớp; chuyển động hông truyền xuống cả chuỗi chân. Đổi chiều gập gối để tránh gập ngược. Kiểm thử lấy 21 mẫu trong chu kỳ, đối chiếu vị trí khớp bằng ma trận SVG và kiểm tra góc gập gối.

## 11. Hiệu ứng cuộn và sương
- useLandingMotion dùng IntersectionObserver để kích hoạt reveal một lần, ngừng theo dõi node đã hiện. MutationObserver đăng ký thêm thẻ sự kiện sau khi API trả dữ liệu.
- CSS custom properties chọn hướng trượt, độ blur và độ trễ theo thứ tự; opacity/transform/filter tạo hiệu ứng mờ thành rõ.
- Scroll listener thụ động và requestAnimationFrame gộp cập nhật tiến độ sương tối đa một lần mỗi frame, không setState khi cuộn. Tiến độ được giới hạn trong [0,1].
- matchMedia theo dõi reduced motion trực tiếp; cleanup observer/listener/frame khi unmount. Focus bàn phím bỏ hiệu ứng che nội dung để tránh điều khiển vô hình.
- Kiểm thử bao gồm tải API muộn, reveal khối carousel, tan sương theo scroll, focus, đổi reduced motion và hiển thị khi tắt JavaScript.


## 12. Quyền tổ chức, kiểm duyệt và đối soát (quy tắc đã chốt)

- SUPER_ADMIN dùng /admin: duyệt/từ chối quyền tổ chức, ẩn/ngừng/khôi phục giải và duyệt nạp ví. Không tạo/sửa giải, cự ly, nhân sự, kết quả; không xem danh sách vận động viên hoặc duyệt tiền vé.
- Người dùng đăng nhập cá nhân → gửi OrganizerApplication → PENDING → Super Admin APPROVED/REJECTED, bắt buộc lý do. Đơn bị từ chối có thể bổ sung gửi lại. Không suy ra quyền tổ chức từ systemRole cũ hoặc trường client gửi.
- Đơn được duyệt cho phép tạo đơn vị và giải; mỗi giải tự cấp EVENT_ADMIN cho người tạo, không cấp quyền trên giải người khác.
- Event.moderation tách khỏi status nghiệp vụ: ACTIVE/HIDDEN/SUSPENDED. Cả HIDDEN và SUSPENDED đều ẩn khỏi danh sách công khai và chặn giao dịch/vận hành mới. Không có API xóa giải.
- Mỗi quyết định ghi EventModeration (người duyệt, lý do, thời điểm) trong cùng transaction với cập nhật trạng thái. Vé, booking, ledger và phân công được giữ nguyên.
- Chủ giải vẫn đọc dữ liệu của mình để đối soát; không tự khôi phục giải. Có thể từ chối yêu cầu thanh toán đang chờ, nhưng không duyệt cấp vé mới khi giải bị kiểm duyệt. Hoàn tiền vẫn là quy trình thủ công.
- lockOperationalEvent tăng activityRevision trong transaction của đặt vé, xác nhận tiền, chuyển BIB, cập nhật cự ly/giải/nhân sự/kết quả và check-in/kit. Cùng ghi vào Event với kiểm duyệt để MongoDB phát hiện xung đột và retry, tránh thanh toán dựa trên trạng thái cũ.
- GET/POST /api/admin/events/:eventId/payments[/paymentId/review] chỉ dành chủ giải, truy vấn PaymentRequest thông qua Booking.eventId. /api/admin/payments chỉ dành TOPUP của Super Admin. Kiểm tra phạm vi trước xử lý idempotency.
- Dữ liệu cũ không tự được duyệt quyền tổ chức. Chủ giải đã có quyền vẫn quản lý giải cũ; muốn tạo thêm đơn vị/giải phải gửi đơn và được duyệt. Seed mới có đơn được duyệt mẫu, không chạy seed trên DB hiện có.

## 13. Vòng xoay và thông báo

- EventCarousel: chỉ số tuần hoàn modulo, CSS perspective/translate/scale/rotateY để tạo vòng xoay; React quản lý slide hiện tại. Timer 5 giây dừng khi hover, focus, tab ẩn, người dùng dừng hoặc prefers-reduced-motion.
- Điều khiển bằng nút, phím trái/phải, chấm chọn và vuốt cảm ứng; ngưỡng vuốt 45px, ngăn kích hoạt link sau thao tác vuốt. Dữ liệu lấy từ API giải hiện có, không thêm số liệu/giải giả.
- Chuông dùng Lucide Bell. API /notifications tổng hợp vé, yêu cầu thanh toán, đơn tổ chức và quyết định kiểm duyệt thực tế. Super Admin thấy thêm đơn tổ chức/nạp ví chờ duyệt.
- NotificationReceipt có unique index (userId, key), lưu đã đọc tại server. API đánh dấu chỉ nhận key thuộc feed người dùng. Poll 60 giây khi tab hiển thị, tải lại khi mở panel; chưa có WebSocket hay push notification.
- Avatar là monogram của người dùng: header 28px, hồ sơ 88px hình tròn. Giữ bảng màu và animation quỹ đạo nhẹ.
- Kiểm thử mới: npm run test:platform-ui (API fixtures, không sửa DB thật); npm test dùng MongoMemoryReplSet để xác nhận phân quyền, giữ dữ liệu khi ngừng giải, đối soát đúng phạm vi và thông báo riêng tư.
