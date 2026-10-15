import { birthdayBounds, needsBirthdayConfirmation, ageOn } from '../../lib/runnerValidation.cjs';

export default function BirthdayField({ id, value, confirmedBirthday, onChange, onConfirm, minAge, raceDate }) {
  const needsConfirmation = needsBirthdayConfirmation(value);
  return <div className="birthday-field">
    <label htmlFor={id}>Ngày sinh</label>
    <input id={id} name="birthday" type="date" required autoComplete="bday" {...birthdayBounds({ minAge, raceDate })} value={value || ''} onChange={event => onChange(event.target.value)} aria-describedby={id + '-hint'} />
    <small id={id + '-hint'}>Từ 7 đến 50 tuổi. Trên 50 tuổi cần xác nhận ngày sinh.{minAge > 0 ? ` Cự ly yêu cầu đủ ${minAge} tuổi vào ngày thi đấu.` : ''}</small>
    {needsConfirmation && <div className="birthday-confirmation">
      <p>Bạn {ageOn(value)} tuổi. Ngày sinh này đã chính xác chưa?</p>
      <label><input type="checkbox" checked={confirmedBirthday === value} required onChange={event => onConfirm(event.target.checked ? value : '')} /><span>Tôi xác nhận ngày sinh này chính xác.</span></label>
    </div>}
  </div>;
}
