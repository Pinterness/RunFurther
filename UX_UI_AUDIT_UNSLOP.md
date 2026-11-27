# Rà soát UX/UI RunFurther với Unslop

Ngày: 19/11/2026. Nhánh: `chore/unslop-ui-review`. Mã nguồn được đánh giá: `73406ec` trên `main`.

Đây là bản rà soát gốc. Trạng thái triển khai đợt đầu được cập nhật ở cuối tài liệu; bảng bằng chứng giữ lại để so sánh trước/sau.

## Skill và cách đánh giá

- Dùng [Unslop của Damir Sokolovsky / @heydamir](https://github.com/heydamir/unslop/tree/main/skills/unslop), giấy phép **CC BY 4.0**. Các tiêu chí và thứ tự rà soát bên dưới được điều chỉnh từ skill này cho RunFurther; giữ ghi nhận tác giả khi sử dụng lại.
- Đã cài tại `C:/Users/User/.codex/skills/unslop`. Đã đọc `SKILL.md`, `references/signs.md` và `references/tokens.md`.
- SHA256 của `SKILL.md` đã đọc: `54e74d73afedb70dd556495f03a13ab7a5724b948cad20c3c7452684f3cb65e9`.
- Chạy Chrome headless trên bản production Next.js 16.4.6 của cùng mã frontend. Preview riêng tại cổng 3103; đóng server khi xong. Dữ liệu người dùng, giải, vé, số dư đều là fixture riêng. Chặn ghi API và truy cập dịch vụ ngoài; không sử dụng database hay thanh toán thật.
- Xem 14 màn/trạng thái ở **1440×1000** và **390×844**: hero 3D, bảng lịch giải, danh sách giải, chi tiết giải, marketplace, đăng nhập, đăng ký, tài khoản/vé, sửa hồ sơ, ví, bước thông tin mua vé, dashboard chủ giải, thông tin giải của chủ giải và duyệt quyền tổ chức của Super Admin.
- Kiểm tra thêm tương tác lịch giải–Hỗ trợ, Escape/trả focus và `prefers-reduced-motion` ở cả hai viewport.

## Kết luận

Chọn **polish theo nhận diện hiện có**. RunFurther đã có logo riêng, bảng màu nhất quán, hình ảnh gắn với chạy bộ, vé/BIB có đặc trưng và nhiều trạng thái tương tác hữu ích. Các vấn đề chính nằm ở độ dễ đọc, mật độ điều khiển, các lớp hộp thoại và thông tin hỗ trợ quyết định mua vé.

Không áp dụng máy móc khuyến nghị bỏ mọi chuyển động của Unslop: người dùng đã yêu cầu hành trình chạy 3D, hành động tại trạm, chuyển cảnh theo cuộn và lịch giải tự chuyển mỗi **2 giây**. Đây là yêu cầu sản phẩm được giữ lại. Nên giảm hiệu ứng ở phần nút/nhãn để cảnh chạy có vai trò rõ ràng hơn.

## Hướng thiết kế đề xuất

1. **Sản phẩm:** giúp người chạy tìm giải, mua vé, quản lý BIB và giao dịch với đúng chủ giải.
2. **Tính cách:** khỏe khoắn, gần gũi, rõ ràng.
3. **Không gian:** đường chạy ngoài trời, rừng và đất; nền giấy sáng cho thông tin và biểu mẫu, xanh rừng cho điều hướng, cam đất cho hành động chính.
4. **Điểm nhấn:** hành trình 3D trên landing; ảnh chính thức của giải và BIB thật trong các màn sự kiện/vé. Những nơi nhập liệu và đối soát giữ bề mặt yên tĩnh.
5. **Dấu hiệu riêng:** đường phân đoạn gợi vạch chạy dùng cho tiến trình và trạng thái đang chọn; không rải thêm dấu trang trí ở mọi thẻ.

Đề xuất giữ logo và bảng màu. Giữ số trạm `01–05` vì đây là yêu cầu đã được chốt. Giữ select native và các kiểm tra ngày sinh/quốc tịch. Không đổi phân quyền, trạng thái thanh toán hoặc cơ chế SePay trong đợt chỉnh giao diện.

## Các vấn đề cần xử lý

P1: ảnh hưởng đọc thông tin, thao tác hoặc quyết định thanh toán. P2: ảnh hưởng tính nhất quán, mật độ và mức độ rõ ràng.

| Mã | Mức | Bằng chứng | Hướng sửa |
| --- | --- | --- | --- |
| U01 | P1 | Ở 390px, nút Hỗ trợ nằm đè lên vùng ảnh/thông tin thẻ lịch giải; ở form đăng ký, nó đè lên cạnh phải ô điện thoại. `support-chat.css:1–2` đặt widget fixed, z-index 85 và nâng đáy lên 132px khi có cảnh 3D. | Đặt quy tắc chung cho lớp nổi; khi có modal, thu/hide launcher hoặc đưa trợ giúp vào đúng lớp. Khi focus nhập liệu trên mobile, tránh che control và bàn phím ảo. |
| U02 | P1 | Mở lịch giải rồi bấm Hỗ trợ: có **2 dialog đang hiển thị** ở cả hai viewport. Một lần Escape đóng cả hai. `TrailScene.jsx` và `SupportChat.jsx` quản lý Escape độc lập. | Chỉ lớp trên cùng nhận Escape; quản lý focus/inert thống nhất. Quyết định rõ có cho mở chat trên modal hay đưa người dùng về bảng trước. |
| U03 | P1 | Mobile: tên trạm 8px, số trạm 7px, nút mở nội dung 9px; “Xem ít chuyển động” 9px với vùng bấm cao 14,4px; trước/tiếp chỉ 30×30px. Metadata lịch giải 10px. Đây là số đo computed style, không chỉ kết quả tìm CSS. | Nhãn tương tác 13–14px, metadata tối thiểu 12px; mục tiêu vùng chạm 44×44px cho nút độc lập. Tổ chức lại hàng điều khiển để đủ chỗ, không tăng chữ rồi để tràn. |
| U04 | P1 | `EventCard.jsx` hiển thị địa điểm, cự ly, sức chứa và giá nhưng **không hiển thị ngày chạy**. Ảnh danh sách xác nhận điều này. | Ưu tiên ngày thi đấu + địa điểm + cự ly + giá trên thẻ, dùng dữ liệu `dateInfo.raceDate` hiện có. Không buộc người dùng mở từng giải để so lịch. |
| U05 | P1 | Checkout dùng giá xanh `#059669` trên nền `#fffefa`: tương phản tính được **3,73:1** ở giá 14px, thấp hơn mục tiêu 4,5:1 của Unslop cho chữ nhỏ. RunPoints có nền vàng riêng; CTA cam và giá xanh cùng cạnh tranh. | Giá và tổng tiền dùng chữ chính; màu trạng thái chỉ dùng khi có ý nghĩa. Dùng token chung cho khối điểm, chọn cự ly, lỗi và thành công. Không đổi số tiền. |
| U06 | P1 | Màn mua vé luôn có “Gói ảnh” +150.000đ và “Pasta Party” +100.000đ. `bookingController.js:47` cũng cộng các giá cố định, không có điều kiện dịch vụ theo giải trong luồng này. | Cần xác nhận với chủ sản phẩm cách chủ giải công bố dịch vụ và giá. Chỉ hiển thị/bán dịch vụ đã được cấu hình cho giải; không xem đây là sửa CSS hay tự xóa tính năng. |
| U07 | P2 | Hero có CTA chính/phụ, 4 nút mở nội dung, 5 trạm, trước/tiếp, đường tắt cự ly, bật/tắt chuyển động và Hỗ trợ. “Chọn cự ly” xuất hiện ở ba vị trí. | Giữ hai CTA ở khối nội dung; gom công cụ hành trình thành một nhóm; giữ các mục nội dung trong một hàng điều hướng. Loại nhãn/đường tắt trùng chức năng sau khi duyệt hướng. |
| U08 | P2 | Nhãn uppercase và tracking rộng lặp lại ở hero, footer, account, marketplace và dashboard. Tiêu đề account/marketplace dùng tracking khoảng `-.055em`; checkout lại Title Case như “Tóm Tắt Đơn Hàng”. | Dùng sentence case cho nhãn giao diện; một thang chữ 12/14/16/20/28/36, display riêng cho hero. Chữ nhỏ không tracking âm. Ưu tiên 400/500/600; kiểm lại hình ảnh logo trước khi thay weight. |
| U09 | P2 | Đăng ký mobile: mảng giới thiệu đẩy ô đầu xuống khoảng y=612px. Marketplace mobile: thẻ đầu bắt đầu khoảng y=805px. Headline vận hành như “Tạo nên những đường chạy đáng nhớ” không nêu nhiệm vụ chính. | Thu khối giới thiệu trên màn có tác vụ; dùng tiêu đề “Tài khoản & vé”, “Quản lý giải”, “Chuyển nhượng BIB”. Giữ giọng truyền cảm hứng ở landing; phần giao dịch dùng nhãn trực tiếp. |
| U10 | P2 | Token chung có control 4px/panel 6px nhưng select riêng 8px, card vé 8px, onboarding 8px, chat 12px; nhiều padding/gap riêng 7/9/14/17/35px trong stylesheet. | Chuẩn hóa theo vai trò, ví dụ control 8px, card 12px, overlay 16px; spacing trên lưới 4px. Giữ ngoại lệ căn quang học cho logo/icon, không sửa số liệu chỉ để đếm bội số. |
| U11 | P2 | Nhiều mũi tên ký tự `↗/→/←`, biểu tượng `⌖/▣` ở trang chi tiết và emoji đồng hồ trong checkout, trong khi header/chat đã dùng Lucide. | Dùng một bộ icon cho hành động và metadata; bỏ mũi tên lặp ở nhãn không cần. Giữ tín hiệu phân biệt điều hướng/mở bảng khi có ích; icon 16/18px, stroke thống nhất. |
| U12 | P2 | Card marketplace dịch lên 5px khi hover; card vé và các link phụ cũng dịch riêng. Lịch giải đã có pause/hover/focus/reduced-motion nhưng chữ “Dừng tự chuyển” chỉ 10px. | Giữ chuyển động chạy và carousel 2s đã yêu cầu; tăng độ thấy của pause. Phần chrome dùng đổi màu/viền 150ms, menu 240ms và opacity/transform nhẹ; rà hiệu ứng card sau cùng. |

### Điểm đã làm tốt

- Màu giấy/xanh rừng/cam đất nối được header, các trang tài khoản và marketplace; không thấy purple gradient, sparkle hoặc robot AI trang trí trên các màn đã xem.
- Hero là cảnh đường chạy liên quan sản phẩm; mảng chữ và CTA vẫn tách khỏi cảnh.
- BIB, hình vé, avatar chữ viết tắt và QR là các yếu tố riêng của sản phẩm; không thay bằng stock avatar hoặc số người tham gia giả.
- Header khách có đăng nhập dạng link và một CTA; menu avatar nhỏ, mũi tên xoay quanh tâm theo mã nguồn hiện tại.
- Sau khi chờ frame khôi phục focus, Escape từ bảng lịch giải trả về đúng nút mở ở cả desktop/mobile.
- Reduced motion tắt 3D và giữ nội dung HTML, lịch giải và các liên kết. Không đánh đồng “có chuyển động” với “lỗi”.
- Các ảnh cuối không tràn ngang; không ghi nhận JavaScript page error trong phiên kiểm tra.

## Thứ tự sửa trên nhánh

Giữ thứ tự chín bước của Unslop trong từng màn, đồng thời xử lý U01/U02 trước vì ảnh hưởng thao tác.

| Bước | Áp dụng cụ thể | Dấu hiệu hoàn tất |
| --- | --- | --- |
| 1. Spacing | Header, điều khiển hero, modal, nhóm nút/form; giảm khoảng đệm phần giới thiệu trên mobile. | Không có control bị che; vùng chạm 44px ở nút độc lập; nhóm nút cách nhau ít nhất 12px. |
| 2. Color | Dùng token text/surface/action; xử lý giá xanh và khối điểm trên checkout. | Chữ nhỏ có tương phản mục tiêu 4,5:1 trên nền thực; cảnh/ảnh giữ màu riêng. |
| 3. Icons | Chuẩn hóa ký tự chỉ hướng, icon metadata và đồng hồ; giữ biểu tượng có nghĩa. | Một bộ icon, cùng cỡ/stroke theo vai trò; không rải icon vào mọi tiêu đề. |
| 4. Copy | Nhãn giao dịch sentence case, tiêu đề theo nhiệm vụ, bỏ CTA trùng; xem lại cam kết dịch vụ U06. | Nhìn tên trang biết tác vụ; không hứa quyền lợi chưa được chủ giải cấu hình. |
| 5. Type | Nâng nhãn 7–11px, chỉnh tracking và thang chữ. | Kiểm rõ dấu tiếng Việt, tên giải dài và mobile; không cắt nội dung để giữ bố cục cũ. |
| 6. Layout | Gọn điều khiển quanh 3D; ngày thi đấu trên thẻ; form/summary rõ luồng đọc. | Tìm giải và tiếp tục thanh toán đều dễ thấy; sidebar/tabs quản trị có phân cấp. |
| 7. Details | Radius theo vai trò, state focus/disabled/pending và số tiền cùng định dạng. | Tab/focus/selection nhận biết độc lập; trạng thái thanh toán không chỉ truyền bằng màu. |
| 8. Visuals | Giữ 3D, ảnh giải và BIB; kiểm chất lượng fallback khi giảm chuyển động. | Ảnh thiếu có fallback đúng tỷ lệ; không thêm ảnh AI vào dashboard/form. |
| 9. Motion | Giữ hành vi hành trình, pause carousel; giảm dịch chuyển phụ. | Reduced motion và thao tác bàn phím đầy đủ; không có hai lớp cùng xử lý Escape. |

Đợt đầu đề xuất: shared controls + lớp modal/chat + chữ nhỏ, rồi event card và checkout. Sau đó chỉnh copy/density của account, đăng ký, marketplace và quản trị. Nội dung U06 cần quyết định nghiệp vụ trước khi triển khai.

## Bằng chứng trực quan

Các ảnh dưới đây dùng dữ liệu mô phỏng, không phản ánh lịch giải, tài khoản hay giao dịch thực tế.

- [Hero mobile: nhiều nhóm điều khiển, nhãn rất nhỏ](docs/ux/unslop-2026-11-19/hero-mobile.png).
- [Lịch giải mobile: launcher Hỗ trợ chồng lên thẻ](docs/ux/unslop-2026-11-19/calendar-mobile.png).
- [Checkout desktop: màu, nhãn và dịch vụ bổ sung cần thống nhất](docs/ux/unslop-2026-11-19/checkout-desktop.png).

Bộ ảnh đầy đủ và số đo trên máy: `artifacts/unslop-audit/`; `metrics.json` cho lượt chính và `followup.json` cho kiểm tra bổ sung. Hai ghi nhận focus=false của lượt đầu là do đọc trước frame khôi phục; lượt bổ sung chờ đúng vòng render xác nhận focus=true, không tính là lỗi sản phẩm. Dữ liệu API thiếu ở fixture đã được bổ sung trước khi kết luận màn quản lý.

Chưa kiểm thử iOS/Safari, bàn phím ảo trên thiết bị thật, 200% zoom, toàn bộ tab staff/đối soát, các trạng thái giao dịch sau submit hoặc hiệu năng GPU trên điện thoại. Không coi bản rà soát này là chứng nhận accessibility hay kiểm thử thanh toán. Không chạy lại backend/build vì nhánh này chỉ thêm tài liệu và ảnh; bản giao diện dùng để quan sát là build đã đạt trước đó.

## Áp dụng skill ở các lượt tiếp theo

Skill dùng được từ lượt chat tiếp theo. Có thể yêu cầu: “Dùng Unslop, sửa U01–U05 theo hướng đã thống nhất trong UX_UI_AUDIT_UNSLOP.md”.

Người dùng đã yêu cầu bắt đầu sửa theo bản rà soát. Các quy tắc đã áp dụng được cập nhật trong `UI_DESIGN.md`.

## Đợt sửa đầu — 19/11/2026

Nhánh: `fix/unslop-ui-polish`. Hướng thiết kế giữ nguyên năm điểm đã đề xuất ở trên.

| Mục | Thay đổi |
| --- | --- |
| U01–U02 | Bảng 3D dùng native modal, giữ Tab và khôi phục focus; Hỗ trợ ẩn dưới modal, Escape không đóng đồng thời cả hai. Mobile ẩn launcher khi nhập liệu. |
| U03 | Nâng chữ điều khiển/metadata; vùng bấm hành trình, nút đóng và carousel 44px trở lên; dành chỗ cho Hỗ trợ ở hàng cuối. |
| U04 | Thêm ngày thi đấu và trạng thái chưa công bố vào EventCard, dùng dữ liệu thật và múi giờ Việt Nam. |
| U05 | Giá/tổng tiền dùng màu chữ chính, RunPoints dùng nền chung; sửa nhãn, label/input và bố cục checkout mobile. |
| U07–U09 | Bỏ đường tắt cự ly lặp ở chân hero; chỉnh nhãn checkout, footer và tiêu đề tác vụ; giảm phần giới thiệu trên đăng ký/marketplace mobile. Một số nhãn trang trí landing vẫn giữ để không đổi toàn bộ nhận diện. |
| U10–U12 | Chuẩn hóa token bo góc, dùng Lucide ở điều khiển hero và metadata sự kiện/checkout, bỏ nâng thẻ marketplace/vé khi hover. Các glyph hướng dẫn nhỏ ở màn khác chưa được thay toàn bộ. |
| U06 | Chưa thay đổi: dịch vụ ảnh/Pasta Party và giá cố định là logic nghiệp vụ. Đề xuất cho chủ giải cấu hình danh mục, giá, bật/tắt và chụp giá vào đơn; cần xác định phạm vi trước khi triển khai. |

Chín lượt tinh chỉnh: khoảng cách/vùng bấm → màu checkout → icon hành động → nhãn tác vụ → cỡ chữ → bố cục mobile → focus/radius/selection → giữ ảnh và 3D sẵn có → giảm chuyển động phụ. Không sinh ảnh mới, không đổi số tiền hay phân quyền. Kiểm thử và giới hạn được ghi tại `TECHNOLOGY_AND_LOGIC.md`.

Ảnh sau sửa, cùng dữ liệu mô phỏng: [hero mobile](docs/ux/unslop-2026-11-19/after-hero-mobile.png), [lịch giải mobile](docs/ux/unslop-2026-11-19/after-calendar-mobile.png), [checkout desktop](docs/ux/unslop-2026-11-19/after-checkout-desktop.png). Carousel được tạm dừng khi chụp để không ghi lại giữa chuyển cảnh; mặc định sản phẩm vẫn tự chuyển 2 giây.

## Tiếp tục — 27/11/2026

Đã đối chiếu GitHub và đưa `origin/main` tại `d42871e` (bản sửa câu hỏi trợ lý và Mongoose) vào nhánh `fix/unslop-ui-polish`. PR #12 tiếp tục chứa toàn bộ phần giao diện để review.

Tinh chỉnh U08/U11/U12 ở tài khoản/vé: nhãn theo tác vụ, bỏ mũi tên lặp, số liệu cùng độ rộng chữ số; liên kết phụ và chọn màu avatar không nhảy khi hover. Lịch giải dùng Lucide thay ký tự mũi tên. Bổ sung vùng bấm 44px cho chỉnh sửa hồ sơ/ví và xử lý xuống dòng tên/BIB dài. Không thay bảng màu, 3D hoặc thời gian tự chuyển giải.

U06 vẫn tách riêng: cấu hình dịch vụ bổ sung theo giải là thay đổi nghiệp vụ. Các nhãn trang trí landing và những trang quản trị chưa được kiểm tra toàn diện vẫn nằm ngoài kết luận đợt này. Kết quả kiểm thử được ghi trong `TECHNOLOGY_AND_LOGIC.md`.
