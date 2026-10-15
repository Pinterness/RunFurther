import { nationalities, normalizeNationality } from '../../lib/nationalities.cjs';

export default function NationalitySelect({ id, value, onChange }) {
  const selected = normalizeNationality(value);
  return <select id={id} name="nationality" aria-label="Quốc tịch" value={selected} onChange={onChange} required>
    <option value="" disabled>{value && !selected ? 'Giá trị cũ không hợp lệ — chọn lại' : 'Chọn quốc tịch'}</option>
    {nationalities.map(country => <option key={country.code} value={country.name}>{country.name}</option>)}
  </select>;
}
