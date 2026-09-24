import { notFound } from 'next/navigation';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:5000/api';
export async function getEventPage(query = {}) {
  const response = await fetch(apiUrl + '/events?' + new URLSearchParams(query), { cache: 'no-store' });
  if (!response.ok) throw new Error('Không tải được danh sách giải chạy.');
  return response.json();
}
export async function getEvents() { return (await getEventPage()).events; }
export async function getEvent(slug) {
  const response = await fetch(apiUrl + '/events/' + encodeURIComponent(slug), { cache: 'no-store' });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Không tải được thông tin giải chạy.');
  return (await response.json()).event;
}
export async function getResults(slug, query = {}) {
  const response = await fetch(apiUrl + '/events/' + encodeURIComponent(slug) + '/results?' + new URLSearchParams(query), { cache: 'no-store' });
  if (!response.ok) throw new Error('Không tải được kết quả giải chạy.');
  return response.json();
}

