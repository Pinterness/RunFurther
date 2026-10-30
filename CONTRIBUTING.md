# Đóng góp cho RunFurther

Quy ước chung của nhóm. Đọc một lần trước khi mở pull request đầu tiên.

## Nhánh và pull request

1. Tạo nhánh từ `main` mới nhất:

   ```text
   git switch main
   git pull
   git switch -c feat/support-knowledge-db
   ```

   Tiền tố nhánh: `feat/` cho tính năng người dùng thấy, `fix/` cho sửa lỗi, `chore/` cho công cụ, cấu hình và thư viện, `docs/` khi chỉ đổi tài liệu.

2. Commit trên nhánh, rồi chạy `git push -u origin <tên-nhánh>`.
3. Mở pull request vào `main` và điền theo mẫu.
4. Chờ CI chạy xong. Nếu CI đỏ thì mở log ở tab Checks, sửa rồi push tiếp lên cùng nhánh.
5. Khi CI xanh, gộp bằng **Create a merge commit** để giữ nguyên từng commit trên `main`.

`main` tự deploy lên Vercel (web) và Render (API), nên chỉ gộp khi CI xanh. CI chỉ báo kết quả, không khóa nhánh.

## Commit

Viết theo [Conventional Commits](https://www.conventionalcommits.org), phần mô tả bằng tiếng Việt có dấu. Ví dụ có trong repo:

```text
feat(wallet): giao diện nạp ví và đối soát nạp ví cho super admin
fix(deps): nâng next lên 16.4.3 để vá lỗ hổng bảo mật
test(wallet): kiểm câu báo đủ lệnh nạp mà không phụ thuộc con số
```

Loại thường dùng: `feat`, `fix`, `docs`, `test`, `refactor`, `ci`, `chore`. Thân commit (nếu có) nói vấn đề và thay đổi.

## Môi trường dev

- Node 24, ghi trong `.nvmrc`.
- `.env` không bao giờ được commit. Mẫu nằm ở `.env.example`.
- `MONGODB_URI` trong `.env` trỏ MongoDB chạy trên máy ở dạng replica set `rs0`, vì nghiệp vụ tiền dùng transaction. Không chạy thử trên database của web thật. Cách dựng database dev và sao lưu: `DEPLOYMENT.md` mục 9.
- Chỉ sửa `package-lock.json` bằng npm 11.21.0, ví dụ `npx --yes npm@11.21.0 install <gói>`. Lockfile tạo bằng npm cũ hơn làm deploy báo `Missing @emnapi/runtime`.

## Lệnh kiểm tra

| Lệnh | Kiểm gì | CI chạy |
| --- | --- | --- |
| `npm test` | API, cấu hình deploy, nạp ví | Có |
| `npm run test:support` | Trợ lý hỗ trợ khách | Có |
| `npm run build:web` | Build web Next.js | Có |
| `npm audit --omit=dev --audit-level=high` | Lỗ hổng trong thư viện | Có, chỉ báo |
| `npm run test:wallet-ui`, `npm run test:support-ui`, … | Giao diện bằng Playwright, cần `npm run dev:web` đang chạy | Không |

## Xong nghĩa là (Definition of Done)

- Test cũ và test mới đều xanh. Đổi giao diện thì `npm run build:web` phải thành công.
- Hành vi mới có test.
- Diff không chứa bí mật: khóa API, mật khẩu, chuỗi kết nối database hay file `.env`.
- Hành vi hệ thống thay đổi thì đã cập nhật `TECHNOLOGY_AND_LOGIC.md`.
- CI xanh trên pull request.
