// Tiêu đề tab trình duyệt cho /messages. Trang là client component nên không xuất metadata được; layout này là
// server component và chỉ bọc children.
export const metadata = { title: 'Tin nhắn | RunFurther' };

export default function MessagesLayout({ children }) {
  return children;
}
