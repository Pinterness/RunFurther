export default function RunnerFields({ value, onChange, prefix = 'runner' }) {
  const change = event => onChange({ ...value, [event.target.name]: event.target.value });
  return <div className="runner-fields">
    <label htmlFor={prefix + '-birthday'}>Ngày sinh<input id={prefix + '-birthday'} name="birthday" type="date" min="1900-01-01" max={new Date().toISOString().slice(0, 10)} value={value.birthday || ''} onChange={change} /></label>
    <label htmlFor={prefix + '-gender'}>Giới tính<select id={prefix + '-gender'} name="gender" value={value.gender || 'Không chia sẻ'} onChange={change}>{['Không chia sẻ', 'Nam', 'Nữ', 'Khác'].map(x => <option key={x}>{x}</option>)}</select></label>
    <label htmlFor={prefix + '-shirtSize'}>Size áo mặc định<select id={prefix + '-shirtSize'} name="shirtSize" value={value.shirtSize || 'M'} onChange={change}>{['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'].map(x => <option key={x}>{x}</option>)}</select></label>
    <label htmlFor={prefix + '-nationality'}>Quốc tịch<input id={prefix + '-nationality'} name="nationality" maxLength={80} value={value.nationality || ''} onChange={change} /></label>
    <label className="field-wide" htmlFor={prefix + '-club'}>Câu lạc bộ <small>(không bắt buộc)</small><input id={prefix + '-club'} name="club" maxLength={120} placeholder="Cộng đồng bạn đang chạy cùng" value={value.club || ''} onChange={change} /></label>
    <label htmlFor={prefix + '-emergencyContact'}>Người liên hệ khẩn cấp<input id={prefix + '-emergencyContact'} name="emergencyContact" maxLength={120} required={Boolean(value.emergencyPhone)} value={value.emergencyContact || ''} onChange={change} /></label>
    <label htmlFor={prefix + '-emergencyPhone'}>Số điện thoại khẩn cấp<input id={prefix + '-emergencyPhone'} name="emergencyPhone" type="tel" maxLength={30} required={Boolean(value.emergencyContact)} value={value.emergencyPhone || ''} onChange={change} /></label>
  </div>;
}
