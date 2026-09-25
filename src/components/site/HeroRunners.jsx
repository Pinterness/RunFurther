'use client';
import { useState } from 'react';
import './hero-runners.css';

function Leg({ back = false }) {
  // Local coordinates put the thigh's origin exactly at its own hip socket.
  return <g className="athlete-hip-socket" transform={back ? 'translate(113 224)' : 'translate(126 224)'}><g className={'athlete-leg athlete-leg-' + (back ? 'back' : 'front')}>
    <path d="M0 0V61" className={back ? 'athlete-skin-back' : 'athlete-skin'} strokeWidth="24" />
    <path d="M-14-5Q0-10 14-4L15 25Q2 30-14 25Z" fill={back ? 'var(--shorts-back)' : 'var(--shorts)'} />
    {!back && <path d="M10 5 11 23" stroke="#aab69a" strokeWidth="2" strokeLinecap="round" />}
    <g className="athlete-knee-socket" transform="translate(0 61)"><g className="athlete-shin"><path d="M0 0V56" className={back ? 'athlete-skin-back' : 'athlete-skin'} strokeWidth="18" /><path d="M-4 8V35" stroke="var(--skin-light)" strokeWidth="3" strokeLinecap="round" opacity={back ? 0 : 1} /><path d="M0 39V56" stroke="#f1edd9" strokeWidth="19" /><path d="M-9 42H9M-9 47H9" stroke="var(--shirt)" strokeWidth="2" /><path d="M-10 52H8L17 60 37 65Q45 70 37 75H-13Z" fill={back ? 'var(--shoe-back)' : 'var(--shoe)'} /><path d="m10 60 9 3m-5 1 9 3" stroke="#fff7df" strokeWidth="2" /><path d="M-13 73H39" stroke="#fff7df" strokeWidth="5" strokeLinecap="round" /></g></g>
  </g></g>;
}
function Pelvis() {
  return <g className="athlete-pelvis">
    <Leg back />
    <path d="M101 201Q121 208 141 200L148 222Q145 236 132 239L120 232Q106 239 98 228Z" fill="var(--shorts-back)" />
    <Leg />
    <path d="M101 201Q121 208 141 200L145 216Q137 231 125 231L113 224 100 223Z" fill="var(--shorts)" />
    <path d="M102 206Q123 213 141 205" fill="none" stroke="#97a387" strokeWidth="2" />
    <path d="M130 213Q137 220 132 227" fill="none" stroke="var(--shorts-back)" strokeWidth="2" strokeLinecap="round" />
  </g>;
}
function Arm({ back = false }) {
  return <g className={'athlete-arm athlete-arm-' + (back ? 'back' : 'front')}><path d="M137 128 131 174" className={back ? 'athlete-skin-back' : 'athlete-skin'} strokeWidth="19" /><g className="athlete-forearm"><path d="M131 174 167 160" className={back ? 'athlete-skin-back' : 'athlete-skin'} strokeWidth="15" /><path d="m166 160 9-3" className={back ? 'athlete-skin-back' : 'athlete-skin'} strokeWidth="16" />{!back && <><path d="m157 157 4 11" stroke="#293c32" strokeWidth="7" /><rect x="155" y="159" width="8" height="6" rx="2" transform="rotate(-20 159 162)" fill="#d4dfbb" /></>}</g></g>;
}
function RunnerIllustration({ variant }) {
  const second = variant === 'sage';
  return <svg className="hero-runner-art" viewBox="0 0 270 390" aria-hidden="true" focusable="false">
    <ellipse className="runner-ground-shadow" cx="131" cy="363" rx="66" ry="9" />
    <g className="runner-body">
      <Arm back /><Pelvis />
      <path d="m135 95-8 25 19 12 12-33" fill="var(--skin)" /><path d="m139 99-5 12 15 10 5-17" fill="var(--skin-shadow)" />
      <path d="M130 115q14 0 28 16l-18 44 1 34q-18 14-42 1l4-40 14-40z" fill="var(--shirt)" />
      <path d="m130 115 4 8 13 3 5-1" fill="none" stroke="var(--shirt-light)" strokeWidth="4" />
      <path d="m108 164-4 42 11 3 8-47" fill="var(--shirt-shadow)" /><path d="m126 139 16 3m-20 8 15 3" stroke="var(--shirt-light)" strokeWidth="2" opacity=".65" />
      <g transform="rotate(12 131 177)"><rect x="114" y="165" width="33" height="28" rx="2" fill="#f4eedc" /><path d="M118 170h25" stroke="var(--shirt-shadow)" strokeWidth="2" /><text x="130.5" y="187" textAnchor="middle" fill="#283a2b" fontSize="13" fontFamily="Arial, sans-serif" fontWeight="800">{second ? '02' : '01'}</text></g>
      {second && <path className="athlete-ponytail" d="M135 58q-31-17-34 8t-26 35q30 8 38-19t27-9" fill="#262b25" />}
      <g className="athlete-head"><path d="M132 59q21-14 32 7l-2 15 8 9-9 3q-2 18-16 16l-15-10-6-22z" fill="var(--skin)" /><path d="M132 63q-17 5-7 28l13 9 5-9-4-24" fill="var(--skin-shadow)" /><ellipse cx="136" cy="83" rx="5" ry="7" fill="var(--skin)" /><path d="m153 95 7 1" stroke="var(--skin-shadow)" strokeWidth="2" strokeLinecap="round" /><path d="m155 79 3 1" stroke="#263326" strokeWidth="2.5" strokeLinecap="round" />{second ? <path d="M126 83q-15-24 7-32 28-6 31 18l-17-3-8 13-7-3z" fill="#272d25" /> : <><path d="M122 76q-4-30 24-27 20 1 21 24z" fill="#e9e8cd" /><path d="m144 71 36 9q3 4-3 5l-39-9" fill="#c5ceb4" /><path d="M131 55q7 6 6 16" stroke="#b4bea3" strokeWidth="2" /></>}</g>
      <Arm />
    </g>
    <g className="runner-speed-lines" fill="none" stroke="var(--shirt-light)" strokeWidth="2" strokeLinecap="round"><path d="M38 150h31M22 165h35M43 180h16" /><path d="M61 298h22M41 312h30" /></g>
  </svg>;
}
function InteractiveRunner({ variant, name, caption }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const running = pinned || hovered;
  return <button type="button" className={'hero-athlete athlete-' + variant + (running ? ' is-running' : '')} aria-label={'Chuyển động chạy của ' + name} aria-pressed={pinned} aria-describedby="hero-runners-help" onPointerEnter={event => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') setHovered(true); }} onPointerLeave={() => setHovered(false)} onClick={() => setPinned(value => !value)} onKeyDown={event => { if (event.key === 'Escape') { setPinned(false); setHovered(false); } }}>
    <RunnerIllustration variant={variant} />
    <span className="hero-athlete-label"><span className="athlete-status-dot" />{caption}<span aria-hidden="true">{pinned ? 'Ⅱ' : '↗'}</span></span>
  </button>;
}
export default function HeroRunners() {
  return <div className="hero-runners" role="group" aria-label="Hai người bạn đồng hành trên đường chạy">
    <div className="hero-runners-halo" aria-hidden="true" />
    <svg className="hero-trail-lines" viewBox="0 0 560 430" fill="none" aria-hidden="true"><path d="M-50 404C84 294 114 411 254 322S429 151 601 280" /><path d="M-50 424C84 314 114 431 254 342S429 171 601 300" /><path d="M-50 444C84 334 114 451 254 362S429 191 601 320" /></svg>
    <div className="hero-runners-topnote" aria-hidden="true"><span>THE OUTSIDE IS OURS.</span><span>01 — 02</span></div>
    <div className="hero-athletes"><InteractiveRunner variant="clay" name="người áo cam" caption="BƯỚC ĐẦU TIÊN" /><InteractiveRunner variant="sage" name="người áo xanh" caption="XA HƠN CÙNG NHAU" /></div>
    <p id="hero-runners-help" className="hero-runners-help"><span className="runner-help-pointer">Rê chuột để chạy · Bấm để giữ nhịp</span><span className="runner-help-touch">Chạm vào từng người để chạy / dừng</span><span className="runner-help-reduced">Hai người bạn. Chung một hành trình.</span></p>
  </div>;
}
