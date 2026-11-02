'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/clientApi';
import Modal from './Modal';
import './support-knowledge.css';

// "Tri thức trợ lý" tab (spec 4.10): Super Admin teaches the support bot. This section edits the knowledge
// articles; P06 and P08 add their sections to this component. Every write names the version the page
// holds, so the server answers 409 instead of overwriting another admin's save.
const endpoint = '/support/admin/knowledge';
const statuses = { DRAFT: 'Nháp', PUBLISHED: 'Đã xuất bản' };
const PREVIEW_KEY = 'ban-nhap'; // "Xem thử" needs a key before the admin has typed one
const emptyForm = { key: '', title: '', terms: '', answer: '', sources: [], suggestions: '', priority: '0' };
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const author = person => person?.fullName || 'Script nạp'; // seeded content has no admin behind it
const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);
const formOf = article => ({
  key: article.key, title: article.title, terms: article.terms.join('\n'), answer: article.answer,
  sources: article.sources.map(({ title, url }) => ({ title, url })), suggestions: article.suggestions.join('\n'), priority: String(article.priority),
});
// The content the API takes. Empty source rows are dropped; every other rule is checked by the server.
const contentOf = form => ({
  title: form.title, terms: lines(form.terms), answer: form.answer,
  sources: form.sources.filter(source => source.title.trim() || source.url.trim()), suggestions: lines(form.suggestions), priority: Number(form.priority),
});
const sourceLabel = sources => sources.map(source => source.title + ' (' + source.url + ')').join(', ');

export default function SupportKnowledgeAdmin() {
  const [articles, setArticles] = useState([]), [listLoading, setListLoading] = useState(true), [listError, setListError] = useState(''), [listVersion, refreshList] = useState(0);
  const [selectedId, setSelectedId] = useState(null), [article, setArticle] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState(''), [detailVersion, refreshDetail] = useState(0);
  const [form, setForm] = useState(emptyForm), [saved, setSaved] = useState(emptyForm);
  const [busy, setBusy] = useState(false), [writeError, setWriteError] = useState(null), [notice, setNotice] = useState('');
  const [question, setQuestion] = useState(''), [preview, setPreview] = useState(null), [previewBusy, setPreviewBusy] = useState(false), [previewError, setPreviewError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false), [restoring, setRestoring] = useState(null);
  const writeRequest = useRef(null), previewRequest = useRef(null), alreadyShown = useRef(null);
  const isNew = selectedId === 'new', dirty = JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => () => { writeRequest.current?.abort(); previewRequest.current?.abort(); }, []);
  useEffect(() => {
    const request = new AbortController();
    setListLoading(true); setListError('');
    api(endpoint, { signal: request.signal })
      .then(data => { if (!request.signal.aborted) setArticles(data.articles || []); })
      .catch(error => { if (!request.signal.aborted) setListError(error.message); })
      .finally(() => { if (!request.signal.aborted) setListLoading(false); });
    return () => request.abort();
  }, [listVersion]);

  useEffect(() => {
    if (!selectedId || selectedId === 'new') return undefined;
    // A just-created article is already on screen; reading it again could land after a quick "Xuất bản"
    // and put the older version back.
    if (alreadyShown.current === selectedId) { alreadyShown.current = null; return undefined; }
    const request = new AbortController();
    setDetailLoading(true); setDetailError('');
    api(endpoint + '/' + encodeURIComponent(selectedId), { signal: request.signal })
      .then(data => {
        if (request.signal.aborted) return;
        if (!data.article) throw new Error('Không tìm thấy bài tri thức.');
        const fields = formOf(data.article);
        setArticle(data.article); setForm(fields); setSaved(fields); setWriteError(null);
      })
      .catch(error => { if (!request.signal.aborted) setDetailError(error.message); })
      .finally(() => { if (!request.signal.aborted) setDetailLoading(false); });
    return () => request.abort();
  }, [selectedId, detailVersion]);

  function show(next) {
    const fields = formOf(next);
    if (next._id !== selectedId) alreadyShown.current = next._id;
    setArticle(next); setForm(fields); setSaved(fields); setSelectedId(next._id);
  }
  function open(id) {
    if (id === selectedId || busy) return;
    if (dirty) { setNotice('Bài đang sửa có thay đổi chưa lưu. Hãy lưu hoặc bấm “Hủy thay đổi” trước khi mở bài khác.'); return; }
    previewRequest.current?.abort(); previewRequest.current = null;
    setSelectedId(id); setWriteError(null); setNotice(''); setDetailError('');
    setPreview(null); setPreviewError(''); setPreviewBusy(false);
    if (id === 'new') { setArticle(null); setForm(emptyForm); setSaved(emptyForm); }
  }
  const setField = (field, value) => setForm(previous => ({ ...previous, [field]: value }));
  const setSource = (index, field, value) => setForm(previous => ({ ...previous, sources: previous.sources.map((source, at) => at === index ? { ...source, [field]: value } : source) }));

  async function write(path, method, body, done) {
    if (writeRequest.current) return;
    const request = new AbortController(); writeRequest.current = request;
    setBusy(true); setWriteError(null); setNotice('');
    try {
      const result = await api(endpoint + path, { method, signal: request.signal, body: JSON.stringify(body) });
      if (request.signal.aborted) return;
      if (!result.article) throw new Error('Chưa nhận được bài sau khi lưu. Hãy tải lại bài để kiểm tra.');
      show(result.article); setNotice(done); refreshList(value => value + 1);
    } catch (error) { if (!request.signal.aborted) setWriteError({ message: error.message, code: error.code }); }
    finally {
      if (!request.signal.aborted) setBusy(false);
      if (writeRequest.current === request) writeRequest.current = null;
    }
  }
  const articlePath = action => '/' + encodeURIComponent(article._id) + (action ? '/' + action : '');
  function saveArticle(event) {
    event.preventDefault();
    if (isNew) write('', 'POST', { key: form.key.trim(), ...contentOf(form) }, 'Đã tạo bài nháp. Bot chỉ dùng bài sau khi bạn bấm Xuất bản.');
    else write(articlePath(), 'PUT', { ...contentOf(form), version: article.version }, 'Đã lưu.');
  }
  function togglePublished() {
    const publish = article.status !== 'PUBLISHED';
    write(articlePath(publish ? 'publish' : 'unpublish'), 'POST', { version: article.version }, publish ? 'Đã xuất bản. Bot dùng bài này ngay.' : 'Đã gỡ xuất bản. Bot thôi dùng bài này.');
  }
  // The dialog closes first, so a 409 or a missing snapshot shows in the editor next to "Tải lại bài".
  function restore() {
    const { changedAt } = restoring;
    setRestoring(null); setHistoryOpen(false);
    write(articlePath('restore'), 'POST', { version: article.version, changedAt }, 'Đã khôi phục bản cũ.');
  }
  function reload() { setWriteError(null); refreshDetail(value => value + 1); }

  async function runPreview(event) {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    previewRequest.current?.abort();
    const request = new AbortController(); previewRequest.current = request;
    setPreviewBusy(true); setPreview(null); setPreviewError('');
    try {
      const draft = { key: isNew ? form.key.trim() || PREVIEW_KEY : article.key, ...contentOf(form) };
      const result = await api(endpoint + '/preview', { method: 'POST', signal: request.signal, body: JSON.stringify({ question: text, draft }) });
      if (!request.signal.aborted) setPreview(result);
    } catch (error) { if (!request.signal.aborted) setPreviewError(error.message); }
    finally { if (previewRequest.current === request) { previewRequest.current = null; setPreviewBusy(false); } }
  }

  const termCount = lines(form.terms).length, showEditor = isNew || (article && article._id === selectedId);
  return <div className="knowledge-admin">
    <section aria-labelledby="knowledge-articles-heading">
      <header className="knowledge-heading"><div><p className="section-index">RUNFURTHER / TRỢ LÝ HỖ TRỢ</p><h2 id="knowledge-articles-heading">Bài tri thức</h2><p>Bot chỉ trả lời từ bài đã xuất bản. Lưu, xuất bản hay khôi phục ở đây thì bot dùng nội dung mới ngay.</p></div>
        <div className="knowledge-heading-actions"><button type="button" className="button-dark" disabled={busy} onClick={() => open('new')}>Thêm bài</button><button type="button" className="quiet-button" disabled={listLoading} onClick={() => refreshList(value => value + 1)}>Làm mới</button></div></header>
      <div className="knowledge-grid">
        <aside className="knowledge-list" aria-label="Danh sách bài tri thức" aria-busy={listLoading}>
          <div className="knowledge-list-heading"><h3>Danh sách bài</h3>{!listError && <span>{articles.length} bài</span>}</div>
          {listLoading && !articles.length ? <p className="knowledge-empty" role="status">Đang tải danh sách...</p> : listError ? <div className="knowledge-error" role="alert"><p>{listError}</p><button type="button" className="text-action" onClick={() => refreshList(value => value + 1)}>Tải lại danh sách</button></div> : !articles.length ? <p className="knowledge-empty">Chưa có bài tri thức. Bấm “Thêm bài” để soạn bài đầu tiên.</p> : <ul>{articles.map(item => <li key={item._id}><button type="button" className="knowledge-row" aria-pressed={selectedId === item._id} disabled={busy} onClick={() => open(item._id)}><span className="knowledge-row-meta"><span className={'knowledge-badge knowledge-badge-' + item.status.toLowerCase()}>{statuses[item.status] || item.status}</span><span>{item.key} · phiên bản {item.version}</span></span><strong>{item.title}</strong><span className="knowledge-row-author">{author(item.updatedBy)} · <time dateTime={item.updatedAt}>{dateLabel(item.updatedAt)}</time></span></button></li>)}</ul>}
        </aside>
        <div className="knowledge-editor" aria-busy={detailLoading}>
          {!selectedId ? <div className="knowledge-placeholder"><h3>Chọn một bài để sửa.</h3><p>Hoặc bấm “Thêm bài” để soạn bài mới. Bài mới luôn bắt đầu ở trạng thái nháp.</p></div> : !showEditor ? (detailError ? <div className="knowledge-error" role="alert"><p>{detailError}</p><button type="button" className="text-action" onClick={reload}>Tải lại bài</button></div> : <p className="knowledge-empty" role="status">Đang mở bài...</p>) : <>
            <header className="knowledge-editor-heading"><div><span className={'knowledge-status knowledge-badge knowledge-badge-' + (isNew ? 'new' : article.status.toLowerCase())}>{isNew ? 'Bài mới' : statuses[article.status] || article.status}</span><h3>{isNew ? 'Soạn bài mới' : article.title}</h3>{!isNew && <p>{article.key} · phiên bản {article.version} · {author(article.updatedBy)} lưu lúc {dateLabel(article.updatedAt)}</p>}</div>
              {!isNew && <div className="knowledge-editor-actions"><button type="button" className="button-dark" disabled={busy || dirty} onClick={togglePublished}>{article.status === 'PUBLISHED' ? 'Gỡ xuất bản' : 'Xuất bản'}</button><button type="button" className="quiet-button" onClick={() => setHistoryOpen(true)}>Lịch sử</button></div>}</header>
            {!isNew && dirty && <p className="knowledge-hint">Lưu thay đổi trước khi xuất bản hoặc gỡ xuất bản.</p>}
            <form className="knowledge-form" onSubmit={saveArticle}>
              <div className="knowledge-field"><label htmlFor="knowledge-key">Mã bài</label><input id="knowledge-key" value={form.key} readOnly={!isNew} required maxLength={60} autoComplete="off" spellCheck={false} disabled={busy} aria-describedby="knowledge-key-hint" onChange={event => setField('key', event.target.value)} /><small id="knowledge-key-hint">{isNew ? 'Chữ thường không dấu, số và dấu gạch ngang, 2–60 ký tự, ví dụ doi-co-ao. Không đổi được sau khi tạo.' : 'Mã bài không đổi được sau khi tạo.'}</small></div>
              <div className="knowledge-field"><label htmlFor="knowledge-title">Tiêu đề</label><input id="knowledge-title" value={form.title} required maxLength={120} disabled={busy} onChange={event => setField('title', event.target.value)} /></div>
              <div className="knowledge-field"><label htmlFor="knowledge-terms">Từ khóa</label><textarea id="knowledge-terms" rows={4} value={form.terms} required disabled={busy} aria-describedby="knowledge-terms-hint" onChange={event => setField('terms', event.target.value)} /><small id="knowledge-terms-hint">Mỗi dòng một cụm người chạy hay gõ, mỗi cụm tối đa 60 ký tự. Đang có {termCount} / 30 cụm.</small></div>
              <div className="knowledge-field"><label htmlFor="knowledge-answer">Câu trả lời</label><textarea id="knowledge-answer" rows={6} value={form.answer} required maxLength={2000} disabled={busy} aria-describedby="knowledge-answer-hint" onChange={event => setField('answer', event.target.value)} /><small id="knowledge-answer-hint">{form.answer.length.toLocaleString('vi-VN')} / 2.000 ký tự. Người chạy thấy đúng chữ bạn gõ.</small></div>
              <fieldset className="knowledge-field knowledge-sources" disabled={busy}><legend>Nguồn</legend>{form.sources.map((source, index) => <div className="knowledge-source" key={index}><input aria-label={'Tên nguồn ' + (index + 1)} placeholder="Tên nguồn" value={source.title} maxLength={80} onChange={event => setSource(index, 'title', event.target.value)} /><input aria-label={'Đường dẫn nguồn ' + (index + 1)} placeholder="/events" value={source.url} spellCheck={false} onChange={event => setSource(index, 'url', event.target.value)} /><button type="button" className="text-action" onClick={() => setField('sources', form.sources.filter((_, at) => at !== index))}>Bỏ</button></div>)}<button type="button" className="text-action" disabled={form.sources.length >= 3} onClick={() => setField('sources', [...form.sources, { title: '', url: '' }])}>Thêm nguồn</button><small>Tối đa 3 nguồn, chỉ đường dẫn trong RunFurther như /events.</small></fieldset>
              <div className="knowledge-field"><label htmlFor="knowledge-suggestions">Câu gợi ý</label><textarea id="knowledge-suggestions" rows={3} value={form.suggestions} disabled={busy} aria-describedby="knowledge-suggestions-hint" onChange={event => setField('suggestions', event.target.value)} /><small id="knowledge-suggestions-hint">Mỗi dòng một câu, tối đa 3 câu, mỗi câu tối đa 120 ký tự.</small></div>
              <div className="knowledge-field knowledge-priority"><label htmlFor="knowledge-priority">Ưu tiên</label><input id="knowledge-priority" type="number" min={0} max={9} step={1} value={form.priority} disabled={busy} aria-describedby="knowledge-priority-hint" onChange={event => setField('priority', event.target.value)} /><small id="knowledge-priority-hint">Từ 0 đến 9. Hai bài khớp câu hỏi như nhau thì bài ưu tiên cao hơn đứng trước.</small></div>
              <div className="knowledge-form-actions"><button type="button" className="text-action" disabled={busy || !dirty} onClick={() => { setForm(saved); setNotice(''); setWriteError(null); }}>Hủy thay đổi</button><button type="submit" className="button-dark" disabled={busy || !dirty}>Lưu</button></div>
            </form>
            {writeError && <div className="knowledge-error" role="alert"><p>{writeError.message}</p>{writeError.code === 'KNOWLEDGE_VERSION_CONFLICT' && <>{dirty && <p>Tải lại sẽ thay nội dung bạn đang sửa bằng bản mới nhất. Hãy chép lại phần cần giữ trước.</p>}<button type="button" className="text-action" onClick={reload}>Tải lại bài</button></>}</div>}
            {detailError && <div className="knowledge-error" role="alert"><p>{detailError}</p><button type="button" className="text-action" onClick={reload}>Tải lại bài</button></div>}
            <p className="knowledge-write-status" role="status">{busy ? 'Đang lưu...' : notice}</p>
            <form className="knowledge-preview" onSubmit={runPreview} aria-labelledby="knowledge-preview-heading">
              <h4 id="knowledge-preview-heading">Xem thử</h4><p>Bot trả lời bằng nội dung đang soạn ở trên, kể cả khi chưa lưu. Xem thử không lưu gì và không gọi AI.</p>
              <label htmlFor="knowledge-question">Câu hỏi xem thử</label><div className="knowledge-preview-ask"><input id="knowledge-question" value={question} maxLength={2000} placeholder="Ví dụ: đổi size áo được không" onChange={event => setQuestion(event.target.value)} /><button type="submit" className="quiet-button" disabled={previewBusy || !question.trim()}>Xem thử</button></div>
              {previewError && <p className="knowledge-error" role="alert">{previewError}</p>}
              {preview && <div className="knowledge-preview-result" aria-live="polite"><p className="knowledge-preview-reply">{preview.reply}</p>{preview.sources?.length > 0 && <p>Nguồn: {sourceLabel(preview.sources)}</p>}{preview.suggestions?.length > 0 && <p>Gợi ý: {preview.suggestions.join(' · ')}</p>}</div>}
            </form>
          </>}
        </div>
      </div>
    </section>
    {historyOpen && article && <Modal title={'Lịch sử: ' + article.title} busy={busy} onClose={() => { setHistoryOpen(false); setRestoring(null); }}>
      {restoring ? <div className="knowledge-restore">
        <p className="dialog-copy">Bài sẽ trở về bản do {author(restoring.changedBy)} lưu lúc {dateLabel(restoring.changedAt)}. Trạng thái “{statuses[article.status]}” giữ nguyên, và bản đang dùng được cất vào lịch sử nên vẫn khôi phục lại được.{article.status === 'PUBLISHED' && ' Bài đang xuất bản nên bot đổi câu trả lời ngay.'}{dirty && ' Thay đổi chưa lưu trong form sẽ bị bỏ.'}</p>
        <dl className="knowledge-snapshot-content"><dt>Tiêu đề</dt><dd>{restoring.title}</dd><dt>Từ khóa</dt><dd>{restoring.terms.join(', ')}</dd><dt>Câu trả lời</dt><dd>{restoring.answer}</dd><dt>Nguồn</dt><dd>{restoring.sources.length ? sourceLabel(restoring.sources) : 'Không có'}</dd><dt>Câu gợi ý</dt><dd>{restoring.suggestions.length ? restoring.suggestions.join(' · ') : 'Không có'}</dd><dt>Ưu tiên</dt><dd>{restoring.priority}</dd></dl>
        <div className="dialog-actions"><button type="button" className="button-primary" disabled={busy} onClick={restore}>Xác nhận khôi phục</button><button type="button" className="text-action" onClick={() => setRestoring(null)}>Quay lại</button></div>
      </div> : <>
        <p className="dialog-copy">Bản đang dùng: do {author(article.updatedBy)} lưu lúc {dateLabel(article.updatedAt)}. Các bản cũ xếp mới nhất ở trên, giữ tối đa 20 bản.</p>
        {article.history?.length ? <ol className="knowledge-snapshots">{article.history.map((snapshot, index) => <li className="knowledge-snapshot" key={index}><div><strong>Bản do {author(snapshot.changedBy)} lưu lúc {dateLabel(snapshot.changedAt)}</strong><span>{statuses[snapshot.status] || snapshot.status}</span><p>{snapshot.answer}</p></div><button type="button" className="quiet-button" onClick={() => setRestoring(snapshot)}>Khôi phục</button></li>)}</ol> : <p className="dialog-copy">Chưa có bản cũ. Mỗi lần lưu, xuất bản hay khôi phục, bản trước đó được cất vào đây.</p>}
      </>}
    </Modal>}
  </div>;
}
