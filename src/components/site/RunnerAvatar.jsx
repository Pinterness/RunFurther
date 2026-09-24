export default function RunnerAvatar({ name = '', theme = 'forest', large = false }) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(-2).map(part => Array.from(part)[0]).join('').toUpperCase() || 'RF';
  const safeTheme = ['forest', 'clay', 'ocean', 'plum'].includes(theme) ? theme : 'forest';
  return <span className={`runner-avatar avatar-${safeTheme} ${large ? 'avatar-large' : ''}`} aria-label={'Ảnh đại diện của ' + (name || 'người chạy')}><span className="avatar-orbit" aria-hidden="true" /><span className="avatar-monogram">{initials}</span>{large && <span className="avatar-caption" aria-hidden="true">RUN / YOUR WAY</span>}</span>;
}
