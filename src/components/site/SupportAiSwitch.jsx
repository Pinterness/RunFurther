'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/clientApi';

// Mục "Trợ lý AI" trong tab "Tri thức trợ lý" (spec 4.8, 4.10): Super Admin bật tắt AI, xem lượt AI hôm nay và lịch sử
// bật tắt. Biến môi trường trên Render vẫn là công tắc tổng: máy chủ chưa cấu hình Gemini thì bật ở đây cũng chưa có AI.
const aiEndpoint = '/support/admin/ai';

function serverNotice(setting) {
  if (setting.provider !== 'gemini') return 'Máy chủ đang tắt AI (SUPPORT_AI_PROVIDER đang là "' + setting.provider + '"), nên bot chỉ trả lời bằng bài soạn sẵn dù công tắc đang bật. Người giữ tài khoản Render đặt biến môi trường để mở AI.';
  if (!setting.configured) return 'Máy chủ chọn Gemini nhưng còn thiếu khóa hoặc tên model, nên AI chưa chạy được.';
  if (setting.today.limit <= 0) return 'AI_DAILY_LIMIT đang là 0, nên AI không chạy. Đặt khoảng một nửa số lượt mỗi ngày của gói Free.';
  return '';
}

export default function SupportAiSwitch({ dateLabel }) {
  const [setting, setSetting] = useState(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [version, refresh] = useState(0);
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState('');
  const writeRequest = useRef(null);

  useEffect(() => () => writeRequest.current?.abort(), []);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true); setLoadError('');
    api(aiEndpoint, { signal: request.signal })
      .then(data => { if (!request.signal.aborted) setSetting(data.setting); })
      .catch(error => { if (!request.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [version]);

  async function toggle() {
    const request = new AbortController();
    writeRequest.current?.abort(); writeRequest.current = request;
    setSaving(true); setSaveError('');
    try {
      const data = await api(aiEndpoint, { method: 'PUT', signal: request.signal, body: JSON.stringify({ aiEnabled: !setting.aiEnabled }) });
      if (!request.signal.aborted) setSetting(data.setting);
    } catch (error) {
      if (!request.signal.aborted) setSaveError(error.message);
    } finally {
      if (!request.signal.aborted) setSaving(false);
    }
  }

  // Đang tải thì khóa công tắc, đang lưu thì khóa "Làm mới": một lần tải bắt đầu trước khi lưu có thể về sau và ghi
  // đè trạng thái mới, khi đó lần bấm tiếp theo sẽ gửi giá trị ngược.
  const notice = setting ? serverNotice(setting) : '';
  return <section className="knowledge-ai" aria-labelledby="knowledge-ai-heading" aria-busy={loading || saving}>
    <header className="knowledge-heading"><div><p className="section-index">Cấu hình trợ lý</p><h2 id="knowledge-ai-heading">Trợ lý AI</h2><p>Khi bật, câu hỏi chung của tài khoản đã đăng nhập và đủ 18 tuổi được Google Gemini viết lại, chỉ dựa trên bài tri thức bot tìm được. Câu về vé, ví, đơn không bao giờ được gửi đi. Tắt thì từ câu hỏi tiếp theo bot trả lời bằng bài soạn sẵn.</p></div>
      <div className="knowledge-heading-actions"><button type="button" className="quiet-button" disabled={loading || saving} onClick={() => refresh(value => value + 1)}>Làm mới</button></div></header>
    {loading && !setting ? <p className="knowledge-empty" role="status">Đang tải cài đặt AI...</p> : loadError ? <div className="knowledge-error" role="alert"><p>{loadError}</p><button type="button" className="text-action" onClick={() => refresh(value => value + 1)}>Tải lại cài đặt AI</button></div> : setting && <div className="knowledge-ai-panel">
      <div className="knowledge-ai-row">
        <button type="button" role="switch" aria-checked={setting.aiEnabled} aria-label="Bật AI cho trợ lý" className={'knowledge-ai-switch' + (setting.aiEnabled ? ' is-on' : '')} disabled={saving || loading} onClick={toggle}><span aria-hidden="true" /></button>
        <div><p className="knowledge-ai-state">{saving ? 'Đang lưu...' : setting.aiEnabled ? 'AI đang bật' : 'AI đang tắt'}</p><p className="knowledge-queue-meta">{setting.provider === 'gemini' && setting.model ? 'Model: ' + setting.model + ' · ' : ''}Lượt hôm nay: {setting.today.used} / {setting.today.limit} (ngày {setting.today.day} giờ Thái Bình Dương; lượt hồi lúc 14 hoặc 15 giờ chiều giờ Việt Nam)</p></div>
      </div>
      {notice && <p className="knowledge-ai-notice" role="status">{notice}</p>}
      {saveError && <div className="knowledge-error knowledge-queue-alert" role="alert"><p>{saveError}</p></div>}
      <h3 className="knowledge-ai-history-heading">Lịch sử bật tắt</h3>
      {setting.history.length ? <ol className="knowledge-ai-history">{setting.history.map((entry, index) => <li key={index}><strong>{entry.aiEnabled ? 'Bật' : 'Tắt'}</strong><span>{entry.changedBy?.fullName || 'Không rõ'} · <time dateTime={entry.changedAt}>{dateLabel(entry.changedAt)}</time></span></li>)}</ol> : <p className="knowledge-queue-meta">Chưa có lần bật tắt nào. Chưa bật lần nào thì AI coi như tắt.</p>}
    </div>}
  </section>;
}
