// Tiêu đề tab trình duyệt cho /community và /community/<handle> (WCAG 2.4.2: mỗi trang có tiêu đề riêng). Hai trang là
// client component nên không xuất metadata được; layout này là server component và chỉ bọc children.
export const metadata = { title: 'Cộng đồng | RunFurther' };

export default function CommunityLayout({ children }) {
  return children;
}
