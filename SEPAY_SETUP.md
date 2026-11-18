# Kết nối SePay với RunFurther

Phiên bản webhook đầu tiên giữ riêng hai luồng: `TOPUP` cộng ví người dùng từ tiền nhận vào ngân hàng nền tảng; `BOOKING` cấp vé từ tiền nhận trực tiếp vào ngân hàng của chủ giải. Không chuyển tiền vé trực tiếp thành tiền nạp ví, không chuyển tiền giữa hai tài khoản ngân hàng.

## 1. URL để điền vào form

Sau khi **commit này được deploy thành công trên Render**, với service hiện dùng `https://runfurther.onrender.com`:

```text
Nạp ví (connection id = platform):
https://runfurther.onrender.com/api/payments/webhooks/sepay/platform

Ví dụ giải chạy (connection id = cantho):
https://runfurther.onrender.com/api/payments/webhooks/sepay/cantho
```

Kiểm tra domain thực tế trong Render trước khi sao chép. Đường dẫn phía sau domain cố định, phần cuối phải trùng `id` trong cấu hình. Đây là **POST**, mở bằng thanh địa chỉ (GET) có thể trả 404; đó không phải phép kiểm webhook. SePay gửi thử mới kiểm được chữ ký và kết nối.

Nếu chưa cấu hình hoặc đã tắt connection, POST trả **404**, tuyệt đối không nhận thanh toán ẩn danh. Deploy code một mình không bật tự động thanh toán.

## 2. Tạo cấu hình bí mật trên máy

Chạy tại thư mục dự án, thay `SO_TAI_KHOAN_MB` bằng số tài khoản **dạng chuỗi, giữ cả số 0 ở đầu**:

```powershell
npm run sepay:env -- --bank-bin 970422 --account SO_TAI_KHOAN_MB
```

Lệnh tạo `.env.sepay.local`, đã được Git bỏ qua. File chứa biến `SEPAY_CONNECTIONS` và một khóa HMAC ngẫu nhiên; không in khóa lên terminal. Lệnh không truy cập ngân hàng, database hay thay `.env` đang chạy. Gọi lại cùng id sẽ từ chối ghi đè khóa cũ.

Thêm kết nối cho một giải, lấy đúng MongoDB `_id` của giải từ trang quản lý/API:

```powershell
npm run sepay:env -- --id cantho --event-id ID_24_KY_TU_CUA_GIAI --bank-bin 970422 --account TAI_KHOAN_CHU_GIAI
```

Lệnh thêm một phần tử vào file riêng, giữ các khóa đã tạo. Mỗi connection có khóa khác nhau. Chọn id mới khi thay tài khoản/ngữ cảnh; không tái sử dụng id cũ cho giải khác.

Ví dụ cấu trúc (chỉ minh họa, các placeholder không dùng được để chạy):

```json
[
  {
    "id": "platform",
    "kind": "TOPUP",
    "bankBin": "970422",
    "accountNumber": "SO_TAI_KHOAN_MB",
    "subAccount": "",
    "secret": "KHOA_NGAU_NHIEN_RIENG_IT_NHAT_32_KY_TU",
    "enabled": true
  },
  {
    "id": "cantho",
    "kind": "BOOKING",
    "eventId": "ID_24_KY_TU_CUA_GIAI",
    "bankBin": "970422",
    "accountNumber": "SO_TAI_KHOAN_CHU_GIAI",
    "subAccount": "",
    "secret": "KHOA_NGAU_NHIEN_KHAC_RIENG_CHO_GIAI",
    "enabled": true
  }
]
```

`bankBin` phải thuộc danh mục ngân hàng của dự án. `accountNumber` là tài khoản chính trong payload SePay; `subAccount` mặc định rỗng. Với VA, điền đúng VA vào `subAccount`, còn tài khoản nhận hiển thị trong cài đặt RunFurther phải là số VA đó. Chỉ dùng VA khi đã xác nhận payload thực tế; không tự tạo VA không cần thiết cho MB.

**Render → Environment:** thêm `SEPAY_CONNECTIONS`, giá trị là nguyên mảng JSON trong file (bỏ `SEPAY_CONNECTIONS=` và hai dấu nháy đơn bọc ngoài). Save/redeploy. Không thêm biến này vào Vercel hoặc đặt tiền tố `NEXT_PUBLIC_`.

Để test local, chủ động sao chép biến này vào `.env` của môi trường thử nghiệm. `.env.sepay.local` không được server tự nạp.

### Khi Render báo `Invalid SEPAY_CONNECTIONS`

Backend kiểm tra cấu hình trước khi kết nối database. Log chỉ ra vị trí sai, ví dụ `SEPAY_CONNECTIONS[0].secret` là trường `secret` của connection đầu tiên; không in số tài khoản hay khóa bí mật.

- `secret`: từ 32 đến 256 ký tự, trùng khóa HMAC bên SePay; không dùng chuỗi placeholder hoặc dùng lại cùng khóa cho hai connection. Nếu đổi khóa, cập nhật cả hai bên.
- `bankBin`: MBBank phải là chuỗi `"970422"`, có dấu nháy; không dùng số `970422`.
- `accountNumber`: chuỗi có dấu nháy, 1–19 chữ/số, không có khoảng trắng; giữ số 0 ở đầu.
- `subAccount`: giữ `""` khi dùng tài khoản chính. Không dùng `null` hoặc điền số tài khoản chính vào đây.
- `enabled`: `true`/`false` không có dấu nháy. `kind`: `"TOPUP"` hoặc `"BOOKING"` viết hoa.
- Giá trị Environment phải là mảng `[{...}]`, không phải object `{...}`, không bọc toàn bộ JSON trong dấu nháy hoặc thêm `SEPAY_CONNECTIONS=`.

Nếu cần khôi phục API trong lúc sửa cấu hình, đặt `SEPAY_CONNECTIONS=[]` rồi redeploy: chỉ tắt tự động đối soát, các luồng thủ công vẫn hoạt động. Giao dịch mới không được tự xác nhận trong thời gian này; kiểm tra/gửi lại webhook sau khi cấu hình đúng. Không gửi khóa HMAC trong ảnh log hoặc chat.

## 3. Form webhook SePay

| Trường | Nạp ví | Vé của một giải |
| --- | --- | --- |
| Tên | RunFurther - Nạp ví | RunFurther - Tên giải |
| Cách nhận | Gửi tới URL của tôi | Gửi tới URL của tôi |
| URL | URL `/platform` ở trên | URL có id connection của giải |
| Loại giao dịch | Tiền vào | Tiền vào |
| Ngân hàng | Đúng tài khoản nền tảng | Đúng tài khoản của chủ giải |
| Tài khoản chính / VA | Khớp cấu hình | Khớp cấu hình |
| Định dạng | JSON (`application/json`) | JSON (`application/json`) |
| Xác thực | HMAC-SHA256 | HMAC-SHA256 |
| Secret key | Giá trị `secret` của platform | Giá trị `secret` của connection giải |
| Tự động gửi lại khi server trả lỗi | Bật | Bật |

Không chọn No Auth, API Key hoặc OAuth ở phần **xác thực webhook** của phiên bản này. OAuth kết nối tài khoản chủ giải là tính năng khác, chưa triển khai trong bản này.

Cấu hình mã tại **Cấu hình Công ty → Cấu hình chung → Cấu trúc mã thanh toán**: `NAP` + đúng 8 chữ/số cho nạp ví; `RUN` + đúng 16 chữ/số cho vé. Giai đoạn đầu nên để **không lọc mã, không bỏ qua giao dịch thiếu mã** trên đúng tài khoản nhận: giao dịch sai nội dung vẫn xuất hiện trong danh sách cần đối soát. Khi đã kiểm tra cấu trúc mã, có thể lọc tiền tố; giao dịch bị SePay lọc bỏ sẽ không xuất hiện ở RunFurther.

Mỗi đơn vị tổ chức liên kết ngân hàng bằng tài khoản SePay của mình. Người vận hành cấu hình connection trên Render sau khi đối chiếu chủ giải và ngân hàng. Super Admin trong ứng dụng vẫn không có quyền duyệt tiền vé của chủ giải. Không chia sẻ khóa platform cho chủ giải.

## 4. Chạy thử

1. Tạo môi trường thử riêng với database riêng, secret riêng, cấu hình connection riêng. Dùng **SePay Test mode**, không trỏ webhook Test mode vào backend đang giữ số dư thật. Test mode vẫn có thể gửi payload giống giao dịch thật; chữ ký đúng không tự phân biệt sandbox/live.
2. Tạo lệnh nạp qua web, lấy mã `NAP…`, gửi giao dịch thử cùng tài khoản, đúng số tiền/mã. Kỳ vọng ví tăng đúng một lần, PaymentRequest `APPROVED`, `confirmationSource=SEPAY`.
3. Tạo đơn vé, lấy `RUN…`, gửi đến connection của giải. Không cần bấm nút đã chuyển khoản. Kỳ vọng có vé/BIB, quota tăng đúng một vé, ví không đổi.
4. Gửi lại cùng giao dịch: ví/vé không tăng thêm. Thử sai tiền, sai mã, sai connection, chữ ký sai, tiền chuyển sau hạn.
5. Nút **Gửi thử** của SePay với `id: 0` và HMAC hợp lệ trả `TEST_ONLY`, chỉ kiểm kết nối, không cộng ví hay cấp vé. Payload thử có id dương phải chỉ dùng với môi trường thử riêng.
6. Sau khi các bước trên đạt, cấu hình Live và tự thực hiện một giao dịch thật nhỏ để kiểm tra từ đầu đến cuối. Không gọi giao dịch thử là giao dịch thật đã đối soát.

RunFurther trả `200 {"success":true,"result":"APPLIED|REVIEW|IGNORED"}` sau khi đã lưu kết quả. `success` nghĩa là nhận được thông báo; chỉ `APPLIED` mới xác nhận tài chính. Lỗi xác thực/payload trả 4xx; lỗi database tạm thời trả 5xx để SePay gửi lại. Nếu process bị ngắt sau khi lưu receipt, job nền xử lý tiếp các bản ghi `RECEIVED` sau khi khởi động và mỗi 30 giây, tối đa 25 bản/lần.

## 5. Giao dịch cần đối soát

- Super Admin: mục Nạp ví có bảng **Giao dịch ngân hàng cần kiểm tra**.
- Chủ giải: trang quản lý giải, phần Đối soát tiền vé có cùng bảng, chỉ gồm giao dịch của giải đó.
- **Kiểm tra lại** chỉ chạy lại các điều kiện ban đầu; không cho phép sửa số tiền, mã đơn hay bỏ qua quyền.
- Sai số tiền, sai/thiếu mã, tài khoản người dùng/ví bị khóa, giao dịch đã xử lý, giải tạm ngừng hoặc hết chỗ: không tự cộng tiền/cấp vé; lưu `REVIEW`. Duyệt thủ công theo sao kê qua chức năng hiện có hoặc hoàn tiền ngoài hệ thống; chưa có API hoàn/rút tiền.

API quản trị (Bearer token, quyền đúng phạm vi):

```text
GET  /api/admin/platform/sepay/receipts?status=REVIEW
POST /api/admin/platform/sepay/receipts/:receiptId/retry
GET  /api/admin/events/:eventId/payments/sepay/receipts?status=REVIEW
POST /api/admin/events/:eventId/payments/sepay/receipts/:receiptId/retry
```

Danh sách tối đa 50 bản/trang, dùng `nextCursor` làm `before` cho trang sau. Bỏ `status` để xem cả `RECEIVED`, `APPLIED`, `IGNORED`. Người dùng thường không có quyền đọc nhật ký ngân hàng.

## 6. Quy tắc và phạm vi bản này

- HMAC-SHA256 trên `timestamp.raw_body`, so sánh thời gian hằng; chấp nhận timestamp chữ ký lệch tối đa 5 phút. Đây là thời điểm **gửi webhook**, khác thời điểm giao dịch ngân hàng (UTC+7).
- Dedupe theo connection + id giao dịch, kiểm fingerprint khi cùng id có dữ liệu khác. PaymentRequest bankReference và receipt APPLIED có unique index, thao tác ví/vé/điểm/quota/receipt chạy chung MongoDB transaction.
- Tiền phải đến từ lúc tạo đơn đến hạn thanh toán. Vé vẫn giữ 10 phút; webhook chậm có thể hoàn tất nếu tiền đến đúng hạn. Nếu job đã trả chỗ, hệ thống lấy lại chỗ bằng kiểm tra quota nguyên tử; hết chỗ thì `REVIEW`, không bán vượt quota.
- Tắt/đổi tài khoản trong cài đặt không chuyển đích nhận của đơn cũ. Giao dịch đúng snapshot cũ vẫn được xác nhận khi connection cũ còn bật. Tắt `enabled` hoặc xóa connection trong Render sẽ dừng nhận/xử lý tự động connection đó.
- Số dư `accumulated`, thông tin người gửi và raw JSON không được lưu. Lưu mã tham chiếu, nội dung chuyển khoản, số tiền, thời điểm và phạm vi để đối soát.
- Phiên bản này cấu hình connection qua môi trường Render; chưa có nút OAuth tự kết nối chủ giải, chưa polling SePay API để tải các giao dịch chưa từng nhận, chưa có hoàn/rút tiền, chưa quyết toán tiền vé mua bằng ví cho chủ giải.
- Render Free có thể ngủ. Bật retry; nếu giao dịch chưa từng vào RunFurther và SePay đã hết retry, gửi lại từ lịch sử webhook của SePay. Job nền chỉ khôi phục receipt **đã được lưu**. Với lưu lượng thật ổn định nên dùng service luôn chạy.
- Chạy `npm run test:sepay` hoặc `npm test`: toàn bộ giao dịch trong bộ test là mô phỏng, database MongoDB memory riêng, không gọi API ngân hàng thật.

Tài liệu nguồn: [Webhook và retry](https://docs.sepay.vn/tich-hop-webhooks.html), [HMAC](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc), [Mã thanh toán](https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan), [SePay Test mode](https://developer.sepay.vn/vi/sepay-webhooks/test-mode/bat-dau-nhanh).
