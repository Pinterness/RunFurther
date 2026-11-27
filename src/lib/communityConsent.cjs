// Văn bản đồng ý của phần cộng đồng và chat (spec T8, mục 4.7). Mỗi lần người dùng đồng ý, server lưu kèm phiên bản,
// nên sau này vẫn chứng minh được người đó đã đồng ý với đúng nội dung nào. Vì vậy phiên bản cũ không bao giờ được
// sửa: đổi nội dung thì thêm phiên bản mới vào CONSENT_HISTORY và trỏ hằng số hiện hành sang nó.

const PROFILE_V1 = Object.freeze({
  version: 'profile-v1',
  text: 'Khi bật hồ sơ cộng đồng, các thành viên đã đăng nhập RunFurther sẽ thấy họ tên, màu avatar, tên hồ sơ (handle), '
    + 'lời giới thiệu và tháng bạn tham gia. Câu lạc bộ và số liệu thành tích tổng hợp chỉ hiện khi bạn bật từng mục. '
    + 'Hồ sơ không bao giờ hiện email, số điện thoại, ngày sinh, giấy tờ tùy thân, thông tin sức khỏe, số BIB hay giải bạn sắp chạy. '
    + 'Khách chưa đăng nhập không xem được hồ sơ. Bạn tắt hồ sơ lúc nào cũng được, và tắt là xóa hẳn hồ sơ cộng đồng. '
    + 'Bên giữ và chịu trách nhiệm về dữ liệu này là nhóm RunFurther. Bạn có quyền xem, sửa và xóa hồ sơ của mình trong tab "Cộng đồng" của trang tài khoản.',
});

const CHAT_V1 = Object.freeze({
  version: 'chat-v1',
  text: 'Khi đồng ý nhắn tin, bạn gửi được lời mời nhắn tin, và nếu bạn có hồ sơ cộng đồng thì thành viên khác gửi được lời mời cho bạn. '
    + 'Tin nhắn được lưu trên máy chủ của RunFurther, và mỗi tin tự xóa 12 tháng sau khi gửi. '
    + 'Khi một tin bị báo cáo, bản chụp đúng tin đó được lưu 12 tháng để Super Admin xử lý; ngoài trường hợp này, không ai trong nhóm RunFurther đọc tin nhắn của bạn. '
    + 'Bạn có thể chặn, báo cáo người khác và rút đồng ý bất cứ lúc nào. '
    + 'Rút đồng ý thì bạn không gửi hay nhận tin mới nữa; tin cũ vẫn xem được và tự xóa theo thời hạn trên.',
});

const CONSENT_HISTORY = Object.freeze([PROFILE_V1, CHAT_V1]);

module.exports = { PROFILE_CONSENT: PROFILE_V1, CHAT_CONSENT: CHAT_V1, CONSENT_HISTORY };
