# Đưa RunFurther lên Vercel + Render

Cấu hình được chuẩn bị ngày 08/10/2026. Frontend Next.js chạy trên Vercel; Express chạy trên Render; dữ liệu giữ tại MongoDB Atlas đang dùng. Chưa tạo dịch vụ hoặc publish website trong các tài khoản cloud của bạn.

## 1. Chọn cách sử dụng gói miễn phí

- **Vercel Hobby** chỉ dành cho cá nhân/phi thương mại. RunFurther thử nghiệm có thể dùng cấu hình này; hoạt động bán vé thương mại cần gói phù hợp, không mặc định được phép chạy Hobby chỉ vì ít người truy cập. [Quy định Hobby](https://vercel.com/docs/plans/hobby).
- **Render Free** ngủ sau 15 phút không có truy cập; lần mở tiếp theo mất khoảng một phút khởi động. Render không khuyến nghị Free cho production. Hạn mức theo workspace gồm 750 giờ Free/tháng và giới hạn tài nguyên/băng thông; có thể bị tạm ngừng khi vượt hạn mức. Không dùng dịch vụ ping liên tục để né cơ chế ngủ. [Giới hạn Free](https://render.com/docs/free).
- Atlas đang dùng là database cloud: dùng **đúng URI và tên database hiện tại** để giữ tài khoản, vé và Cantho Heritage. Không chạy seed khi deploy. Ảnh giải đã lưu MongoDB, không cần persistent disk Render. Atlas Free không có backup tự động tích hợp; cần sao lưu bằng mongodump/mongorestore và theo dõi dung lượng cả ảnh. [Atlas Free](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).

## 2. Các file môi trường đã chuẩn bị

Hai file riêng tư đã được tạo tại máy đang làm việc, **không đưa vào Git**:

- `.env.render.local`: có MONGODB_URI sao chép từ `.env` hiện tại và JWT_SECRET mới tạo ngẫu nhiên; chưa thay đổi mật khẩu tài khoản hoặc dữ liệu.
- `.env.vercel.local`: chỉ có NEXT_PUBLIC_API_URL, không chứa bí mật.

Thay **YOUR-API / your-api** và **YOUR-WEB / your-web** bằng hostname thực tế do hai dịch vụ cấp. Các hostname mẫu không phải địa chỉ đã triển khai. Khi nhập từng biến vào dashboard, lấy giá trị bên trong dấu ngoặc kép, không dán tên biến/dấu `=` vào ô Value. Khi import nguyên file `.env`, giữ nguyên định dạng file.

Nếu dựng lại trên máy khác chưa có hai file này, sau khi có URL chạy:

```powershell
npm run deploy:env -- --api-url https://TEN-API-THAT.onrender.com --web-url https://TEN-WEB-THAT.vercel.app
```

Script không kết nối/ghi database, không in bí mật; từ chối ghi đè file đã có để tránh vô tình đổi JWT. Khi đổi tên miền, sửa URL trong các file sẵn có và dashboard. JWT mới chỉ dùng trên Render; token local cũ không đăng nhập được trên host mới, nhưng email/mật khẩu tài khoản giữ nguyên.

## 3. Render — backend

Code cấu hình phải có trên nhánh GitHub mà bạn chọn deploy. Trong Render: **New → Web Service → Git Provider → Pinterness/RunFurther**. Chọn repository đã kết nối qua GitHub để có auto-deploy.

Nếu thay đổi mới còn ở máy local, kiểm tra rồi commit/push trước khi import dịch vụ:

```powershell
git status --short
git add .
git diff --cached --stat
git commit -m "Configure Vercel and Render deployment"
git push origin main
```

Danh sách staged không được có `.env`, `.env.render.local` hay `.env.vercel.local`; các file này đã được `.gitignore` loại trừ. Mẫu trong `deployment/*.env.example` chỉ chứa placeholder nên có thể commit.

| Setting | Giá trị |
| --- | --- |
| Name | `runfurther-api` hoặc tên còn trống |
| Branch | `main` |
| Root Directory | Để trống — dùng gốc repo, không chọn `src/backend` |
| Language / Runtime | Node |
| Region | Singapore, ưu tiên gần Atlas/người dùng |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Instance Type | Free cho bản thử nghiệm |
| Health Check Path | `/health` |

Thêm các biến dưới đây hoặc import `.env.render.local`:

```dotenv
NODE_ENV=production
NODE_VERSION=24.x
MONGODB_URI=<giá trị thật trong .env.render.local>
CLIENT_ORIGIN=https://TEN-WEB-THAT.vercel.app
JWT_SECRET=<giá trị đã sinh trong .env.render.local>
JWT_EXPIRES_IN=7d
TRUST_PROXY_HOPS=1
SUPPORT_AI_PROVIDER=guide
WALLET_TOPUP_RATE_LIMIT=10
```

Không nhập dấu `< >`; chúng chỉ đánh dấu giá trị cần sao chép. Render tự cấp `PORT`, backend đã bind `0.0.0.0:$PORT`. Không chạy `npm run dev`, `next build` hay `npm run seed` trên service backend. [Cấu hình Web Service](https://render.com/docs/web-services), [Node version](https://render.com/docs/node-version).

Nếu chưa có URL Vercel, giữ hostname dự kiến trong CLIENT_ORIGIN để backend khởi động, rồi **bắt buộc thay đúng URL sau bước 4**. `/health` và các request từ server không có Origin vẫn hoạt động; trình duyệt chưa được phép gọi API từ hostname khác.

Trong Render service chọn **Connect → Outbound**, sao chép **tất cả dải IP** được liệt kê. Trong Atlas → **Network Access / IP Access List**, thêm các dải này. Giữ IP máy của bạn nếu còn quản trị local. Không cần thêm IP Vercel vào Atlas vì frontend chỉ gọi Render. [Outbound IP của Render](https://render.com/docs/outbound-ip-addresses).

Atlas Database Access phải có database user dùng trong URI và quyền trên database ứng dụng (ví dụ readWrite, gồm tạo index); không nhầm với tài khoản đăng nhập website hoặc tài khoản đăng nhập Atlas. Giữ nguyên URI hiện tại nếu đang hoạt động; không tự thay phần tên database bằng `test`.

Deploy và mở `https://TEN-API-THAT.onrender.com/health`: cần HTTP 200 và `{"status":"ok"}`. Kiểm tra tiếp `/api/events?upcoming=true`; phải thấy Cantho Heritage. Nếu lần đầu build không kết nối Atlas do chưa thêm IP, thêm IP rồi Manual Deploy lại.

Có thể dùng **New → Blueprint** với `render.yaml` thay cho nhập tay. Blueprint hỏi MONGODB_URI, CLIENT_ORIGIN và tự sinh JWT_SECRET bằng `generateValue`; không ghi đè JWT đã dùng sau khi người dùng bắt đầu đăng nhập. [Blueprint secrets](https://render.com/docs/blueprint-spec#generating-random-secrets).

## 4. Vercel — frontend

Trong Vercel: **Add New → Project → Import Git Repository → Pinterness/RunFurther**.

| Setting | Giá trị |
| --- | --- |
| Framework Preset | Next.js (không chọn Express) |
| Root Directory | Gốc repository |
| Node.js Version | 24.x |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm run build:web` |
| Output Directory | `.next` / mặc định Next.js |

`vercel.json` đã khai báo các lệnh. Không đặt Start Command là `npm start` trên Vercel: script đó phục vụ backend Render. [Project configuration](https://vercel.com/docs/project-configuration), [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Trong **Settings → Environment Variables**, chọn **Production**:

```dotenv
NEXT_PUBLIC_API_URL=https://TEN-API-THAT.onrender.com/api
```

Đây là biến duy nhất frontend cần. **Không đưa MONGODB_URI, JWT_SECRET, OPENAI_API_KEY lên Vercel/NEXT_PUBLIC.** NODE_ENV do Vercel/Next quản lý. API URL cần HTTPS và `/api`; code chuẩn hóa dấu `/` cuối, tự thêm `/api` nếu chỉ nhập origin. Build trên Vercel từ chối thiếu biến hoặc trỏ localhost.

Deploy xong sao chép **Production Domain** chính xác (không đoán theo project name), cập nhật CLIENT_ORIGIN trên Render. Ví dụ nếu URL thật là `https://runfurther-abc.vercel.app`, đây chính là giá trị CLIENT_ORIGIN, không có `/api` hay đường dẫn trang.

Biến NEXT_PUBLIC được gắn vào JavaScript lúc build. Sau mỗi lần đổi NEXT_PUBLIC_API_URL phải **Redeploy Vercel**, không chỉ Save. [Next environment variables](https://nextjs.org/docs/app/guides/environment-variables).

Preview deployment có hostname khác production: mặc định không cho phép truy cập database thật qua CORS. Khi thật sự cần, dùng backend/DB thử nghiệm và env Preview riêng. Hoặc thêm đúng hostname được tin cậy vào CLIENT_ORIGIN, phân cách bằng dấu phẩy; không dùng `*` hoặc `*.vercel.app`. Preview dùng production API vẫn có khả năng ghi dữ liệu thật khi có xác thực; CORS không thay thế quyền truy cập.

## 5. Các biến không cần cho bản miễn phí

- `PORT`: Render cấp tự động.
- `SEED_MONGODB_URI`: chỉ phục vụ seed ở database dev rỗng, không thêm trên host.
- `OPENAI_API_KEY`, `OPENAI_MODEL`: không cần khi SUPPORT_AI_PROVIDER=guide. Chat hỗ trợ dùng bộ hướng dẫn và dữ liệu ứng dụng; không tuyên bố đây là mô hình AI sinh nội dung miễn phí. Nếu bật provider sau này, chỉ thêm khóa và model ở Render; việc sử dụng provider có thể phát sinh phí.
- Thông tin tài khoản ngân hàng nhận vé/nạp ví: cài trong chức năng chủ giải/Super Admin; không dùng ENV thay cho dữ liệu đã cấu hình trong database.

## 6. Kiểm tra trước khi mời người dùng

1. Mở website bằng cửa sổ riêng tư; tab Network gọi API HTTPS của Render, không gọi localhost. Không có CORS/mixed-content.
2. Đăng nhập tài khoản sẵn có, xem hồ sơ, vé và Cantho Heritage. Chuông, đơn tình nguyện viên và ảnh tải từ dữ liệu hiện tại.
3. Kiểm tra tải ảnh bằng tài khoản chủ giải; restart Render rồi ảnh vẫn còn vì lưu Atlas.
4. Kiểm thử mua/đối soát bằng dữ liệu thử nghiệm trong môi trường riêng; không bấm duyệt một giao dịch thật chỉ để kiểm thử. Xác nhận tài khoản nhận tiền và mã chuyển khoản trước khi mở bán.
5. Thay mật khẩu nếu tài khoản vẫn dùng mật khẩu công khai từ seed. Dự án chưa có xác minh email/quên mật khẩu; xác định cách hỗ trợ người dùng bị mất quyền truy cập trước khi mở rộng.
6. Sao lưu dữ liệu, theo dõi log, quota Atlas, usage Render/Vercel. Không bảo đảm dịch vụ miễn phí luôn sẵn sàng lúc check-in hoặc giờ mở bán.

Không có công việc nền chạy khi Render Free đang ngủ. Đơn giữ chỗ vẫn có expiresAt trong database; API kiểm tra hạn khi xử lý và thu hồi các chỗ hết hạn khi khởi động/nhận nghiệp vụ. Tiền vé hiện do chủ giải đối soát thủ công, không tự nhận biết tiền vào ngân hàng; chưa có hoàn tiền tự động.

## 7. Chẩn đoán nhanh

| Triệu chứng | Kiểm tra |
| --- | --- |
| Render `MongooseServerSelectionError` / không thấy port | URI, mật khẩu database, IP allowlist; backend chỉ mở cổng sau khi DB/index sẵn sàng |
| `/health` trả 503 | Database đang mất kết nối; xem Render logs/Atlas, không coi deploy là khỏe |
| Trình duyệt báo CORS | CLIENT_ORIGIN phải khớp origin đang mở, kể cả preview/custom domain; không kèm `/api` |
| Frontend vẫn gọi localhost hoặc API cũ | NEXT_PUBLIC_API_URL chưa đặt đúng trước build; sửa Production env rồi Redeploy |
| API trả trang HTML hoặc chờ lâu | Có thể Render đang khởi động; chờ rồi thử lại. Code không tự retry thao tác ghi để tránh đơn/giao dịch lặp |
| Lên host mất tài khoản/không thấy giải | Đang dùng sai database trong URI; không seed lại |
| Một người bị 429 kéo theo nhiều người | Kiểm tra đường proxy và TRUST_PROXY_HOPS; cấu hình hiện tại là một hop tin cậy, không đặt `true` bừa bãi khi đổi hạ tầng |

## 8. Kiểm chứng cấu hình trong repo

`npm test` có các kiểm tra CORS/preflight, phạm vi origin, IP qua proxy, tách bí mật ENV, URL production và phản hồi HTML khi máy chủ khởi động. `npm run build:web` kiểm tra build frontend. Để kiểm tra browser với hostname HTTPS giả lập (không deploy), build với NEXT_PUBLIC_API_URL=`https://runfurther-deployment-check.example/api`, rồi chạy `node scripts/checkDeploymentUI.js`; script tự mở/tắt preview tại port 3101, mọi request API được mock, không ghi DB thật. Sau đó build lại bình thường để dùng production preview local.
