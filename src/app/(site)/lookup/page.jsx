'use client';
import { useState } from 'react';
export default function LookupBibPage() {
  const [query, setQuery] = useState('');
  const [ticket, setTicket] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  async function lookup(event) {
    event.preventDefault(); setLoading(true); setTicket(null); setMessage('');
    try {
      const response = await fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api') + '/registrations/lookup?query=' + encodeURIComponent(query.trim()));
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setTicket(data.ticket);
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }
  return <main className="page"><section className="form-card"><h1>Tra cứu BIB</h1><form onSubmit={lookup}><div className="field"><label htmlFor="query">BIB, email hoặc số điện thoại đăng ký</label><input id="query" value={query} onChange={event => setQuery(event.target.value)} required maxLength={120} /></div><button className="button button-dark" disabled={loading}>{loading ? 'Đang tìm...' : 'Tra cứu'}</button></form>{message && <p role="alert">{message}</p>}{ticket && <div aria-live="polite"><h2>{ticket.eventName}</h2><p>{ticket.fullName} · {ticket.bibNumber}</p><p>{ticket.category} · {ticket.status}</p><p>Race-kit: {ticket.logistics.raceKitIssued ? 'Đã nhận' : 'Chưa nhận'}</p></div>}</section></main>;
}

