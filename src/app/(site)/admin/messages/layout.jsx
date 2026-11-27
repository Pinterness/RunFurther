// Tiêu đề tab trình duyệt cho /admin/messages. Trang là client component nên không xuất metadata được; layout này là
// server component và chỉ bọc children.
export const metadata = { title: 'Báo cáo tin nhắn | RunFurther' };

export default function AdminMessagesLayout({ children }) {
  return children;
}
