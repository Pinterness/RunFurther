'use client';
import { useState } from 'react';
export function eventImageUrl(value) {
  if (value?.startsWith('/api/media/images/')) return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '') + value;
  return value;
}
export default function EventPhoto({ src, alt = '', ...props }) {
  const [failed, setFailed] = useState(null);
  return <img {...props} alt={alt} src={src && failed !== src ? eventImageUrl(src) : '/assets/figma/event-trail.png'} onError={() => setFailed(src)} />;
}
