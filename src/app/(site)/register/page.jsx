'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import RunnerFields from '../../../components/site/RunnerFields';
import { api, blankProfile, nextPath, rememberUser } from '../../../lib/clientApi';
export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [identity, setIdentity] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [profile, setProfile] = useState({ ...blankProfile });
  const [destination, setDestination] = useState('/account');
  useEffect(() => { setDestination(nextPath()); }, []);
  const change = event => setIdentity({ ...identity, [event.target.name]: event.target.value });
  async function submit(event) {
    event.preventDefault(); setError('');
    if (step === 1) { setStep(2); return; }
    setBusy(true);
    try { const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ ...identity, profile }) }); rememberUser(data.user, data.token); router.push(nextPath('/account')); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <div className="runner-onboarding"><aside className="onboarding-story"><p className="section-index">RUNFURTHER / BẮT ĐẦU</p><h1>Một hồ sơ.<br />Nhiều đường chạy.</h1><p>Lưu thông tin một lần. Đăng ký giải tiếp theo nhanh hơn, theo cách của bạn.</p><div className="onboarding-track" aria-hidden="true"><span>01</span><i /><span>GO</span></div><small>Thông tin của bạn chỉ được sử dụng cho tài khoản và các lượt đăng ký của bạn.</small></aside><section className="onboarding-form"><div className="form-progress"><span className={step === 1 ? 'is-current' : ''}>01 · Tài khoản</span><span className={step === 2 ? 'is-current' : ''}>02 · Hồ sơ người chạy</span></div><h2>{step === 1 ? 'Chào mừng bạn.' : 'Sẵn sàng cho giải đầu tiên.'}</h2><p className="section-description">{step === 1 ? 'Tạo tài khoản để lưu hồ sơ, vé và hành trình của bạn.' : 'Các thông tin này được tự điền khi mua vé. Bạn có thể bổ sung hoặc sửa sau trong hồ sơ.'}</p>{error && <p className="notice notice-error" role="alert">{error}</p>}<form onSubmit={submit}>{step === 1 ? <div className="runner-fields"><label className="field-wide" htmlFor="signup-name">Họ và tên<input id="signup-name" name="fullName" autoComplete="name" required maxLength={120} value={identity.fullName} onChange={change} /></label><label className="field-wide" htmlFor="signup-email">Email<input id="signup-email" name="email" type="email" autoComplete="email" required value={identity.email} onChange={change} /></label><label htmlFor="signup-phone">Số điện thoại<input id="signup-phone" name="phone" type="tel" autoComplete="tel" required maxLength={30} value={identity.phone} onChange={change} /></label><label htmlFor="signup-password">Mật khẩu<input id="signup-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} placeholder="Tối thiểu 8 ký tự" value={identity.password} onChange={change} /></label></div> : <RunnerFields value={profile} onChange={setProfile} prefix="signup-runner" />}<div className="form-bottom">{step === 2 && <button type="button" className="quiet-button" disabled={busy} onClick={() => setStep(1)}>Quay lại</button>}<button className="button-primary" disabled={busy}>{busy ? 'Đang tạo tài khoản...' : step === 1 ? 'Tiếp tục →' : 'Tạo tài khoản & lưu hồ sơ'}</button></div></form><p className="auth-switch">Đã có tài khoản? <Link href={'/login?next=' + encodeURIComponent(destination)}>Đăng nhập</Link></p></section></div>;
}
