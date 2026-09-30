'use client';
import { useEffect, useState } from 'react';
export default function WalletPage() {
  const [summary, setSummary] = useState(null), [ledger, setLedger] = useState([]), [payments, setPayments] = useState([]);
  const [amount, setAmount] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [requestKey, setRequestKey] = useState(null);
  async function request(path, options = {}) {
    const token = localStorage.getItem('rf_token');
    if (!token) throw new Error('Vui lòng đăng nhập.');
    const res = await fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api') + path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...options.headers } });
    const data = await res.json(); if (!res.ok) throw new Error(data.message); return data;
  }
  async function load() {
    const [s, l, p] = await Promise.all([request('/wallet'), request('/wallet/ledger'), request('/wallet/payments')]);
    setSummary(s); setLedger(l.ledger); setPayments(p.payments);
  }
  useEffect(() => { load().catch(error => setMessage(error.message)); }, []);
  async function topup(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    const key = requestKey || crypto.randomUUID(); setRequestKey(key);
    try {
      const data = await request('/wallet/topup', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ amount: Number(amount) }) });
      setRequestKey(null); setAmount(''); setMessage(data.message); await load();
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  const money = value => Number(value).toLocaleString('vi-VN') + ' đ';
  return <div className="page wallet-page"><h1 className="page-title">Ví của tôi</h1>{message && <p role="status">{message}</p>}<div className="split"><section className="balance-card"><span>Số dư khả dụng</span><strong>{summary ? money(summary.wallet.balance) : '—'}</strong><span>{summary?.runPoints.balance ?? 0} RunPoints</span></section><section className="panel"><h2>Yêu cầu nạp tiền</h2><p>Yêu cầu cần được quản trị viên đối soát trước khi cộng số dư.</p><form onSubmit={topup}><input aria-label="Số tiền VND" type="number" min="1" max="100000000" step="1" required value={amount} onChange={event => { setAmount(event.target.value); setRequestKey(null); }} /><button className="button button-dark" disabled={busy}>Gửi yêu cầu</button></form></section></div><section className="section panel"><h2>Lịch sử giao dịch</h2>{ledger.map(row => <div className="transaction-row" key={row._id}><span>{row.referenceType} · {new Date(row.createdAt).toLocaleString('vi-VN')}</span><strong>{row.type === 'CREDIT' ? '+' : '−'}{money(row.amount)}</strong></div>)}{!ledger.length && <p>Chưa có giao dịch.</p>}<h2>Yêu cầu đối soát</h2>{payments.map(row => <p key={row._id}>{row.kind} · {money(row.amount)} · {row.status}</p>)}<button onClick={() => load().catch(error => setMessage(error.message))}>Cập nhật</button></section></div>;
}

