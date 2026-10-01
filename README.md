# RunFurther

Next.js frontend + Express API + MongoDB. Ví sử dụng VND; 1 RunPoint giảm 1.000 VND, tối đa 50% giá trị đơn và chỉ dùng số điểm nguyên.

## Chạy dự án

1. `npm install`
2. Sao chép `.env.example` thành `.env`, điền URI database và JWT secret của bạn.
3. Chạy API: `npm run dev:api`.
4. Chạy web ở terminal khác: `npm run dev:web`.
5. Mở http://localhost:3000.

Database phải là MongoDB replica set (có thể một node ở máy phát triển) hoặc Atlas/sharded cluster. Chỉ thêm `replicaSet=rs0` vào URI không tự cấu hình replica set. Server kiểm tra điều kiện này vì thanh toán, giữ chỗ và chuyển nhượng cần transaction. Không còn tự chuyển sang một database local khác khi kết nối thất bại.

Trang `/` là landing page RunFurther với chọn cự ly, giải từ API, hướng dẫn tương tác và FAQ. Header có trạng thái khách/tài khoản riêng, menu mobile và đăng xuất. Quy tắc màu sắc, typography, chuyển động và khả năng truy cập được ghi trong [UI_DESIGN.md](UI_DESIGN.md). Các trang nghiệp vụ được giữ tương thích trong khi chuyển dần sang thiết kế chung.

## Kiểm thử

- `npm test`: kiểm thử API và tương thích index cũ trên MongoDB replica set tạm, không dùng `MONGODB_URI` của ứng dụng. Lần đầu có thể cần tải MongoDB binary.
- `npm run build:web`: build production.
- `npm run test:layout`: kiểm tra landing, tabs/bàn phím, FAQ, đăng nhập/đăng xuất, menu mobile, reduced motion, lỗi API/thử lại và account trên Chrome; kiểm tra 5 kích thước từ 360px đến 1440px. Ảnh lưu vào `artifacts/landing-desktop.png` và `artifacts/landing-mobile.png`. Cần web đang chạy. Có thể đặt `WEB_TEST_URL` và `CHROME_PATH`.
- `npm audit`: kiểm tra dependencies.
- `node scripts/testAllFeatures.js` hiện chạy bộ kiểm thử cô lập, không tạo tài khoản/vé trên database đang dùng.

## Database cũ

Trước khi chạy bản mới trên database đã có dữ liệu:

1. Dừng API ghi dữ liệu và có bản sao lưu.
2. Chạy `npm run db:check`. Lệnh này chỉ đọc, báo vé/BIB/đơn tình nguyện viên trùng và chênh lệch quota.
3. Đối soát các bản ghi trùng và số vé/tiền cũ. Không tự xóa hay sửa tiền để làm sạch dữ liệu.
4. Khi hết bản ghi trùng, chạy `npm run db:check -- --indexes` để bổ sung index BIB unique bên cạnh index cũ và tạo index bảo vệ một vé/booking, một đơn tình nguyện viên đang chờ/email/giải. Không xóa index hay dữ liệu cũ. Server cũng tự tạo các index còn thiếu khi khởi động.
5. Khởi động API. Server đợi index sẵn sàng trước khi nhận giao dịch.

Script không tự sửa quota, xóa vé hay chuyển đơn thanh toán. Các đơn cũ từng được xác nhận khi chưa đối soát cần được rà soát riêng.

Seed chỉ chạy với `SEED_MONGODB_URI`, tên database kết thúc bằng `_dev` hoặc `_test`, database rỗng và không ở NODE_ENV=production. Không còn `dropDatabase()` hay fallback database. Ngày đăng ký/thi đấu mẫu được tính từ thời điểm seed, quota đã bán bắt đầu từ 0. Tài khoản và thông tin ngân hàng trong seed chỉ phục vụ phát triển.

## Thanh toán và đối soát

Chưa tích hợp SePay/Casso hoặc webhook ngân hàng. Hiện đối soát thủ công: EVENT_ADMIN chủ giải duyệt tiền vé của giải; SUPER_ADMIN chỉ duyệt nạp ví.

- `POST /api/bookings/hold`: giữ chỗ 10 phút. Kiểm tra giải đang mở, cự ly thuộc giải, thời gian, tuổi tối thiểu nếu có và quota.
- `POST /api/bookings/:id/confirm` với `paymentMethod: WALLET`: backend lấy ví của người đăng nhập, trừ tiền/điểm và cấp vé trong một transaction.
- Cùng endpoint với `paymentMethod: VIETQR`: trả HTTP 202 và yêu cầu PENDING, chưa cấp vé. Frontend thăm dò trạng thái đơn mỗi 5 giây.
- `POST /api/wallet/topup` với số tiền nguyên dương và header `Idempotency-Key`: tạo yêu cầu PENDING, chưa cộng tiền.
- `GET /api/wallet/payments`: người dùng xem yêu cầu của mình.
- `GET /api/admin/payments?status=PENDING`: Super Admin chỉ xem yêu cầu nạp ví cần đối soát.
- `POST /api/admin/payments/:id/review`: body `{ "status": "APPROVED", "bankReference": "ma-giao-dich-ngan-hang", "reviewNote": "..." }`, hoặc `status: REJECTED`.
- Quản trị viên phải kiểm tra đúng số tiền, tài khoản nhận và nội dung chuyển khoản trước khi duyệt. Mã giao dịch ngân hàng không được sử dụng cho hai yêu cầu.
- Nếu giữ chỗ hết hạn hoặc đơn đã thanh toán theo cách khác, API từ chối phê duyệt chuyển khoản và giữ yêu cầu để đối soát/hoàn tiền thủ công; không tự mở lại chỗ.
- Chưa có luồng hoàn tiền tự động. Không chuyển tiền vào tài khoản mẫu trong seed; cấu hình tài khoản nhận thật trước khi bật chuyển khoản cho người dùng.

Task giải phóng đơn hết hạn chạy mỗi 30 giây và được gọi khi thao tác booking. Mỗi đơn chỉ hoàn quota một lần. Không xóa lịch sử booking bằng TTL.

## Marketplace

Mua BIB hoặc đồ dùng hiện thanh toán bằng ví: trừ người mua, cộng người bán và ghi ledger trong cùng transaction. BIB được chuyển chủ, cập nhật hồ sơ và thay QR token. Không cho chuyển BIB đã check-in, đã nhận kit hoặc giải đã kết thúc/hủy. Một tin chỉ bán một lần; retry của chính người mua không thu tiền lại.

Đồ dùng hiện chỉ có thanh toán/quyền sở hữu tin đăng; chưa có vận chuyển, ký quỹ và tranh chấp. BIB không vượt 110% giá vé gốc.

## Quản trị và kết quả

Các endpoint đều yêu cầu Bearer token. Sửa giải/cự ly, xem VĐV và ghi kết quả yêu cầu chủ giải với phân công EVENT_ADMIN còn ACTIVE; SUPER_ADMIN không được can thiệp nghiệp vụ.

| Endpoint | Chức năng |
| --- | --- |
| POST /api/admin/events | Tạo giải DRAFT; người tạo phải được duyệt quyền tổ chức và sở hữu tổ chức đang hoạt động |
| PATCH /api/admin/events/:eventId | Cập nhật thông tin/trạng thái giải |
| POST /api/admin/events/:eventId/categories | Thêm cự ly |
| PATCH /api/admin/events/:eventId/categories/:categoryId | Cập nhật cự ly; không giảm quota dưới số chỗ đã bán/giữ |
| GET /api/admin/events/:eventId/registrations | Danh sách VĐV có phân trang |
| PUT /api/admin/events/:eventId/registrations/:registrationId/result | Lưu chipTime và gunTime dạng HH:MM:SS |
| GET /api/events/:slug/results | Kết quả công khai; lọc categoryId, gender, search, page, limit |
| GET /api/events | Lọc city, distance, search, page, limit |

API kết quả không trả email, số điện thoại hay QR token. Thành tích cá nhân chỉ tính những vé có chipTime hợp lệ. Thứ hạng hiện tính theo tập cự ly/giới tính được lọc; tìm BIB/tên không đổi thứ hạng.

Nhân sự gửi `x-login-code` của đúng giải hoặc Bearer token có phân công phù hợp. Vai trò CHECKIN chỉ check-in, RACE_KIT chỉ phát kit, STAFF_MANAGER/EVENT_ADMIN quản lý cả hai và duyệt tình nguyện viên. Đơn tình nguyện viên không thể cấp quyền quản trị. Các thao tác lặp không tạo tài khoản nhân sự trùng.

## Phần tiếp theo

- Hoàn thiện màn duyệt tình nguyện viên và các màn nghiệp vụ nhân sự ngoài check-in/phát kit (ban tổ chức đã có tạo giải, cự ly và phân công).
- Chọn nhà cung cấp ngân hàng để tự động đối soát, hoàn tiền và xử lý khoản chuyển muộn.
- Hồ sơ cộng đồng hiện vẫn là giao diện mẫu; chưa có API hồ sơ công khai, theo dõi hoặc bài viết.
- Xác minh email/quên mật khẩu, gửi email vé và tải ảnh avatar cá nhân (hiện có avatar theo tên và màu).
- Timing thiết bị, nhập kết quả hàng loạt, DNF/DNS và xuất chứng nhận PDF.
- PIN hiện được kiểm tra trực tiếp tại API; rate limit là bộ nhớ của từng tiến trình. Khi triển khai nhiều instance, cần kho giới hạn dùng chung và quy trình cấp/thu hồi PIN phù hợp.

## Hồ sơ người chạy và giao diện tài khoản

- Đăng ký gồm hai bước: tài khoản và hồ sơ người chạy. `POST /api/auth/register` nhận thêm `profile` (ngày sinh, giới tính, quốc tịch, size áo, câu lạc bộ, tên/số điện thoại liên hệ khẩn cấp). Tạo tài khoản và hồ sơ trong cùng transaction.
- `GET /api/auth/me` trả `user` và `profile`; `PATCH /api/auth/me` cập nhật họ tên, điện thoại, màu avatar và hồ sơ của người đang đăng nhập. Không cho sửa email hay vai trò qua endpoint này.
- Trang `/account` có hồ sơ chỉnh sửa, avatar chữ viết tắt với bốn màu, vé/BIB/QR tải về và đơn chờ thanh toán. Vé chỉ xuất hiện khi API đã cấp; không tạo dữ liệu vé giả.
- Mua vé giải và mua BIB tự điền hồ sơ. Thay đổi thông tin trong một lượt mua không sửa hồ sơ gốc hay thông tin các vé đã cấp.
- Marketplace kiểm tra phiên đăng nhập trước khi mở form đăng tin/mua; khách hoặc phiên hết hạn thấy hộp đăng nhập ngay. Đăng nhập/tạo tài khoản giữ đường dẫn quay lại nội bộ qua `next`.
- Hiệu ứng người chạy ở phần chọn thử thách hoạt động khi hover hoặc focus bàn phím, tắt với reduced motion.
- `npm run test:runner-ui`: kiểm tra các luồng trên bằng Chrome, API giả lập và bốn kích thước màn hình; cần web đang chạy. Ảnh kiểm tra trong `artifacts/`. Không ghi dữ liệu kiểm thử vào DB đang dùng.
- `npm test`: kiểm thử backend thật trên MongoDB replica set tạm, bao gồm lưu/sửa hồ sơ, rollback dữ liệu sai và mua vé với hồ sơ đã lưu.

## Khu vực ban tổ chức và quyền sở hữu sự kiện

Sau khi đăng nhập tài khoản cá nhân, chọn **Khu vực ban tổ chức** trong menu avatar hoặc mở `/organizer`.

1. Tạo đơn vị tổ chức của mình (nếu chưa có).
2. Tạo sự kiện DRAFT; backend tự ghi createdBy và cấp EVENT_ADMIN.
3. Mở trang quản lý: sửa thông tin/lịch trình, thêm cự ly, phân công nhân sự, xem người chạy.
4. Chuyển trạng thái công bố/mở đăng ký khi sẵn sàng. Mở đăng ký yêu cầu ít nhất một cự ly có số suất.
5. Mã nhân sự chỉ dùng trong đúng giải; có thể khóa/mở quyền và đổi mã. EVENT_ADMIN dùng tài khoản cá nhân, không đăng nhập bằng mã nhân sự.

Quyền EVENT_ADMIN đòi hỏi cả `Event.createdBy == userId` và phân công còn ACTIVE. SUPER_ADMIN chỉ kiểm duyệt qua /admin/platform, không có ngoại lệ truy cập nghiệp vụ. Gán thêm một EventAccount EVENT_ADMIN cho người khác không làm người đó thành chủ sự kiện.

API bổ sung:
- GET /api/organizations/mine: đơn vị đang hoạt động do mình sở hữu.
- GET /api/admin/events/:eventId: thông tin riêng của giải và cự ly.
- GET/POST /api/admin/events/:eventId/staff: xem/tạo phân công.
- PATCH /api/admin/events/:eventId/staff/:accountId: đổi role, ACTIVE/INACTIVE, rotateCode. Không cho cấp hoặc sửa EVENT_ADMIN qua endpoint này.

**Giải cũ thiếu createdBy:** chưa tự suy đoán người tạo. Sau khi người quản trị xác minh lịch sử, dùng lệnh sau để xem trước:
```powershell
node scripts/setLegacyEventCreator.js --event-id <ID> --creator-email <EMAIL>
```
Thêm `--apply` mới ghi vào DB. Script chỉ bổ sung chủ cho giải chưa có chủ và khôi phục phân công EVENT_ADMIN; không chuyển chủ giải đã có createdBy. Chưa chạy cập nhật này trên DB thật.

`npm run test:organizer-ui` kiểm tra giao diện ban tổ chức bằng Chrome và API fixtures, cần web đang chạy. Ghi chú đầy đủ công nghệ, thuật toán và giới hạn: [TECHNOLOGY_AND_LOGIC.md](TECHNOLOGY_AND_LOGIC.md).


## Quy trình xét duyệt tổ chức và kiểm duyệt

1. Người tổ chức đăng nhập tại /organizer, gửi tên đơn vị, số điện thoại và kế hoạch tổ chức.
2. Super Admin mở /admin → Quyền tổ chức, duyệt hoặc từ chối kèm lý do.
3. Sau khi duyệt, người tổ chức tạo đơn vị/giải và trở thành chủ riêng của giải vừa tạo.
4. /admin → Kiểm duyệt giải chỉ cho phép ẩn, tạm ngừng hoặc khôi phục, luôn lưu lý do và lịch sử; không xóa hẳn bất kỳ giải nào.
5. Chủ giải đối soát tiền vé ở tab Tiền vé. Super Admin đối soát nạp ví ở /admin → Nạp ví.

API tiền vé: GET /api/admin/events/:eventId/payments và POST /api/admin/events/:eventId/payments/:paymentId/review, cùng body status/bankReference/reviewNote như nạp ví. Giải bị ẩn/ngừng chặn giao dịch mới; giữ nguyên vé/giao dịch để đối soát và hoàn tiền thủ công. Quyền tổ chức của dữ liệu cũ không tự động được duyệt.

Kiểm tra giao diện mới: npm run test:platform-ui. Chuông thông báo lấy dữ liệu thật, lưu đã đọc trên server và thăm dò mỗi 60 giây khi tab hiển thị.


## Ảnh giải và QR tiền vé

Trong /organizer/events/:eventId → Thông tin giải, chủ giải có thể:
- Tải ảnh bìa/logo JPG, PNG hoặc WebP tối đa 5 MB, xem trước rồi lưu. Ảnh được chuyển thành WebP và lưu MongoDB; cần đưa collection EventImage vào backup.
- Chọn ngân hàng, nhập số tài khoản/tên người nhận và xem trước QR. Có thể tắt chuyển khoản bằng cách xóa cả cấu hình; người chạy vẫn dùng ví.
- Duyệt tiền vé tại tab Tiền vé, đối chiếu mã đơn và tài khoản nhận của booking.

QR thanh toán lấy số tiền/mã đơn từ backend. Thông tin ngân hàng được lưu bất biến khi giữ chỗ; sửa cấu hình giải chỉ áp dụng cho đơn mới. Đơn cũ không có snapshot không tự dùng tài khoản mới. Mã hết hạn hoặc giải bị ẩn/ngừng không tiếp tục hiển thị để chuyển tiền.

Ảnh QR tải lỗi vẫn có thông tin chuyển khoản và nút sao chép/thử lại. Bấm “Tôi đã chuyển khoản” chỉ gửi yêu cầu chờ chủ giải đối soát. Chưa có tải biên lai, QR nạp ví hay xác nhận ngân hàng tự động.

Danh sách ngân hàng dùng [API VietQR](https://www.vietqr.io/danh-sach-api/api-danh-sach-ma-ngan-hang/) với cache và snapshot dự phòng. Công thức ảnh dùng [Quick Link](https://www.vietqr.io/danh-sach-api/link-tao-ma-nhanh/). Tên chủ tài khoản vẫn cần được kiểm tra trong ứng dụng ngân hàng.

Chạy npm run test:event-media-ui để kiểm tra giao diện (web đang chạy, Chrome; API giả lập). npm test kiểm tra backend bằng DB tạm, không dùng tài khoản hoặc giao dịch thật.

## Landing 3D

Three.js + GSAP ScrollTrigger điều khiển nhân vật qua 5 trạm (01–05): cuộn/vuốt một lần chạy một chặng, uống nước, nhận race kit và huy chương; camera đổi từ góc nhìn thứ nhất sang bám theo, nhìn bên và trên cao. Chọn cự ly, lịch giải, hướng dẫn và FAQ mở trong khung 3D. Chạy npm run dev:web để xem; có chế độ ít chuyển động và nội dung dự phòng khi thiếu WebGL. Mô hình/sa bàn là minh họa cách điệu.

Kiểm tra bằng npm run test:trail-scene (alias test:hero), test:layout và test:scroll khi web đang chạy. Tài liệu chi tiết ở TECHNOLOGY_AND_LOGIC.md mục 15 và UI_DESIGN.md.

## Trợ lý và yêu cầu hỗ trợ

Nút **Hỗ trợ** trên các trang site có hai phần:

- **Trợ lý nhanh:** hỏi về đăng ký, vé, thanh toán, ví, Marketplace và quyền tổ chức. Mặc định trả hướng dẫn đã đối chiếu với nghiệp vụ dự án, kèm liên kết màn chức năng. Khách chưa đăng nhập cũng dùng được; kiểm tra trạng thái vé riêng tư cần đăng nhập.
- **Nhân viên hỗ trợ:** người đăng nhập tạo yêu cầu, xem phản hồi và bổ sung nội dung. Super Admin tiếp nhận ở `/admin` → **Hỗ trợ khách**, trả lời và đóng/mở lại. Đây là hộp thư hỗ trợ không đồng thời, chưa phải live chat; chưa có chuyển tự động đến chủ giải hoặc thông báo email. Quyền duyệt tiền vé vẫn thuộc EVENT_ADMIN chủ giải.

Chế độ hướng dẫn hoạt động mà không cần khóa AI. `.env.example` có cấu hình mặc định:

```dotenv
SUPPORT_AI_PROVIDER=guide
OPENAI_API_KEY=
OPENAI_MODEL=
```

Để bật AI, đặt `SUPPORT_AI_PROVIDER=openai`, cung cấp khóa OpenAI và tên model được tài khoản của bạn cho phép sử dụng ở môi trường **server**, rồi khởi động lại API. Không đặt khóa trong biến `NEXT_PUBLIC_*`, mã frontend hoặc commit lên Git. Không có model mặc định tự chọn; thiếu bất kỳ cấu hình nào hoặc provider lỗi thì hệ thống dùng hướng dẫn nội bộ và hiển thị đúng nhãn.

Adapter Responses API có `store: false`, timeout 15 giây, giới hạn 700 output tokens và 4 yêu cầu đồng thời mỗi tiến trình. Chỉ câu hỏi hiện tại cùng hướng dẫn và thông tin giải công khai được đưa vào prompt; không gửi lịch sử chat, dữ liệu vé riêng tư hoặc hộp thư nhân viên. Tóm tắt vé cá nhân xử lý nội bộ từ dữ liệu đúng người đăng nhập. Chưa cấu hình khóa/model thật và chưa thử gọi AI thật trong lần triển khai này.

Các endpoint đặt dưới `/api/support`: `POST /chat` công khai; `/tickets` và `/tickets/:id/messages` cho chủ yêu cầu; `/admin/tickets` dành riêng SUPER_ADMIN. Giới hạn tin chat 2.000 ký tự; yêu cầu hỗ trợ có tiêu đề 160 ký tự, mỗi tin 4.000 ký tự, tối đa 100 tin. Rate limit theo IP/bộ nhớ tiến trình: chat 12/phút, tạo yêu cầu 6/phút, các thao tác gửi bổ sung/phản hồi/đóng/mở lại dùng chung 30/phút. Triển khai nhiều instance cần giới hạn dùng chung.

Kiểm tra:

- `npm run test:support`: API/service; 17/17 kiểm tra đạt ở lần cập nhật này. DB thử nghiệm tách riêng, provider giả lập, không gọi AI hoặc giao dịch thật.
- `npm run test:support-ui`: kịch bản hộp thư quản trị bằng Chrome/API fixtures, yêu cầu web đang chạy; chạy riêng để xác nhận phần giao diện.

Chi tiết dữ liệu, API và giới hạn xem `TECHNOLOGY_AND_LOGIC.md` mục 17; quy tắc giao diện xem `UI_DESIGN.md`.

Kiểm tra widget người dùng bằng `npm run test:support-chat`. Nhân vật 3D có kiểm tra chuyển động `npm run test:character` và bản dựng sáu tư thế/ba góc nhìn `npm run test:character-visual` (Chrome, không cần API). Ảnh kiểm tra ở `artifacts/runner-review-*.png`. Chi tiết sửa khớp, quai balo, khoảng cách nút và hướng nâng cấp model có bộ xương xem mục 18 của `TECHNOLOGY_AND_LOGIC.md`.

## Bản thử điện ảnh trên trang chủ

Chạy `npm run dev:web`, mở trang chủ và cuộn đến trạm đầu để xem nhân vật GLB có bộ xương, chạy/uống nước/nhận kit/huy chương trong cảnh bình minh có sương và núi xa. Giữ nút **Xem ít chuyển động** và nhân vật dự phòng khi tải model lỗi. Đây là bản 3D cách điệu, chưa phải nhân vật người thật.

Model Quaternius CC0 được lưu local (khoảng 881 KiB), không cần tài khoản dịch vụ 3D. Nguồn và giấy phép tại `public/assets/models/runner-casual.LICENSE.md`; cách chuẩn bị tài sản tại `scripts/prepareRunnerAsset.mjs`.

Kiểm tra bằng `npm run test:cinematic`, `npm run test:cinematic-visual` và `npm run test:cinematic-ui` (lệnh UI cần web đang chạy). Chi tiết kỹ thuật và giới hạn ở mục 19 của `TECHNOLOGY_AND_LOGIC.md`.
