import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useT } from '../../i18n.jsx';
import { compressImage } from '../../format.js';
import { Icon } from '../../ui.jsx';

export default function ComplaintNew() {
  const { t } = useT();
  const nav = useNavigate();
  const file = useRef();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api('/complaints', { method: 'POST', body: { text, photo } });
      nav(`/complaints/${r.id}`, { replace: true });
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <form className="stack-lg" onSubmit={submit}>
      <div className="field">
        <label htmlFor="text">{t('describe')}</label>
        <textarea id="text" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('describeHint')} autoFocus />
      </div>
      <div>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden
          onChange={async (e) => e.target.files[0] && setPhoto(await compressImage(e.target.files[0]))} />
        {photo ? (
          <div style={{ position: 'relative' }}>
            <img src={photo} alt="" style={{ borderRadius: 14, maxHeight: 260, objectFit: 'cover', width: '100%' }} />
            <button type="button" className="btn sm" style={{ position: 'absolute', top: 10, right: 10 }} onClick={() => setPhoto(null)} aria-label="Remove photo"><Icon name="x" size={16} /></button>
          </div>
        ) : (
          <button type="button" className="btn block" onClick={() => file.current.click()}><Icon name="camera" size={18} />{t('addPhoto')}</button>
        )}
      </div>
      <p className="notice small row" style={{ gap: 10, alignItems: 'flex-start' }}><Icon name="alert" size={18} style={{ flex: 'none', marginTop: 1 }} />{t('safetyNote')}</p>
      {error && <p className="error">{error}</p>}
      <button className="btn primary lg block" disabled={busy || text.trim().length < 5}>{busy ? '…' : t('submit')}</button>
    </form>
  );
}
