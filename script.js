/* OTP Slingshot — shoot digits into the verification slots. */
(() => {
  'use strict';

  // ---------- Config ----------
  const USER_NAME = 'Drake Le';
  const FIXED_OTP = '150787';  // the code from the video; add ?random to the URL for a random one
  const MAX_PULL = 120;        // px the pouch can be pulled
  const MIN_PULL = 18;         // below this the shot is cancelled
  const SPEED = 10;            // px/s of launch speed per px of pull
  const GRAVITY = 820;         // px/s²
  const GUIDE_R = 84;          // radius of the aim arc above the fork
  const MAX_FLIGHT = 2.6;      // seconds before a shot counts as a miss
  const TOAST_MS = 1500;
  const TRAJ_DOTS = 14;        // predicted-path dots while aiming

  // Band anchors and pouch rest position inside the slingshot element (0..1 of its box).
  const TIP_L = { x: 44 / 220, y: 46 / 300 };
  const TIP_R = { x: 176 / 220, y: 46 / 300 };
  const REST  = { x: 110 / 220, y: 50 / 300 };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const slotsEl = $('slots');
  const slots = [...slotsEl.querySelectorAll('.slot')];
  const toast = $('toast');
  const aim = $('aim');
  const aimArc = $('aimArc');
  const aimPtr = $('aimPtr');
  const pullArc = $('pullArc');
  const traj = $('traj');
  const bandL = $('bandL');
  const bandR = $('bandR');
  const sling = $('sling');
  const pouch = $('pouch');
  const pouchDigit = $('pouchDigit');
  const tray = $('tray');
  const chips = [...tray.querySelectorAll('.chip')];
  const modal = $('modal');
  const modalOtp = $('modalOtp');
  const enterBtn = $('enterBtn');
  const progressBar = $('progressBar');
  const hintBtn = $('hintBtn');
  const hintLabel = $('hintLabel');
  const hintCode = $('hintCode');
  const hintDigits = $('hintDigits');
  const statusDot = $('statusDot');
  const statAttempts = $('statAttempts');
  const statAcc = $('statAcc');
  const statTime = $('statTime');
  const logList = $('logList');
  const soundBtn = $('soundBtn');
  const fx = $('fx');
  const fxCtx = fx.getContext('2d');

  $('greet').textContent = `Hi ${USER_NAME},`;

  // ---------- State ----------
  let otp = '';
  let index = 0;               // active slot
  let loaded = null;           // digit currently in the pouch (string) or null
  let loadedChip = null;
  let state = 'idle';          // idle | loaded | dragging | flying | done
  let pointerId = null;
  let pull = { x: 0, y: 0 };
  let rafId = 0;
  let toastTimer = 0;
  let attempts = 0;
  let hits = 0;
  let startedAt = 0;
  let clockTimer = 0;
  let soundOn = true;
  let hintOpen = false;

  // ---------- Geometry ----------
  function geo() {
    const s = stage.getBoundingClientRect();
    const b = sling.getBoundingClientRect();
    const rel = (p) => ({ x: b.left - s.left + b.width * p.x, y: b.top - s.top + b.height * p.y });
    return { stage: s, rest: rel(REST), tipL: rel(TIP_L), tipR: rel(TIP_R) };
  }

  function setPouch(x, y) {
    pouch.style.left = x + 'px';
    pouch.style.top = y + 'px';
  }

  function drawBands(p) {
    const g = geo();
    bandL.setAttribute('x1', g.tipL.x); bandL.setAttribute('y1', g.tipL.y);
    bandR.setAttribute('x1', g.tipR.x); bandR.setAttribute('y1', g.tipR.y);
    const target = p || g.rest;
    bandL.setAttribute('x2', target.x); bandL.setAttribute('y2', target.y);
    bandR.setAttribute('x2', target.x); bandR.setAttribute('y2', target.y);
  }

  function arcPath(cx, cy, r, a0, a1) {
    const p0 = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
    const p1 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
  }

  function drawAim() {
    const g = geo();
    const len = Math.hypot(pull.x, pull.y);
    if (len < 4) { aim.style.display = 'none'; return; }
    aim.style.display = '';
    const ang = Math.atan2(-pull.y, -pull.x);            // launch direction
    const spread = 0.95;                                  // ± radians of the arcs
    aimArc.setAttribute('d', arcPath(g.rest.x, g.rest.y, GUIDE_R, ang - spread, ang + spread));
    pullArc.setAttribute('d', arcPath(g.rest.x, g.rest.y, len + 26, ang + Math.PI - spread * .8, ang + Math.PI + spread * .8));
    const px = g.rest.x + (GUIDE_R + 6) * Math.cos(ang);
    const py = g.rest.y + (GUIDE_R + 6) * Math.sin(ang);
    const deg = ang * 180 / Math.PI;
    aimPtr.setAttribute('d', 'M 14 0 L -2 7 L -10 0 L -2 -7 Z');
    aimPtr.setAttribute('transform', `translate(${px} ${py}) rotate(${deg})`);

    // predicted trajectory
    const vx = -pull.x * SPEED, vy = -pull.y * SPEED;
    let x = g.rest.x + pull.x, y = g.rest.y + pull.y;
    const dots = traj.children;
    const dt = 0.055;
    for (let i = 0; i < TRAJ_DOTS; i++) {
      const t = (i + 1) * dt;
      const dx = x + vx * t, dy = y + vy * t + 0.5 * GRAVITY * t * t;
      let c = dots[i];
      if (!c) { c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); traj.appendChild(c); }
      c.setAttribute('cx', dx); c.setAttribute('cy', dy);
      c.setAttribute('r', Math.max(1.2, 3.2 - i * 0.14));
      c.setAttribute('opacity', Math.max(0.08, 0.7 - i * 0.045));
    }
  }

  // ---------- Toast / status / log ----------
  function showToast(msg, kind) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = 'toast show ' + kind;
    toastTimer = setTimeout(() => { toast.classList.remove('show'); }, TOAST_MS);
  }

  function setStatus(kind) {
    statusDot.className = 'status-dot' + (kind ? ' ' + kind : '');
  }

  function stamp() {
    if (!startedAt) return '00:00';
    const s = Math.floor((Date.now() - startedAt) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function log(msg, kind = 'info') {
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${stamp()}</span><span class="${kind}">${msg}</span>`;
    logList.prepend(li);
    while (logList.children.length > 7) logList.lastChild.remove();
  }

  function updateStats() {
    statAttempts.textContent = String(attempts).padStart(2, '0');
    statAcc.textContent = attempts ? Math.round(hits / attempts * 100) + '%' : '—';
    progressBar.style.width = (index / 6 * 100) + '%';
  }

  function tickClock() {
    if (state === 'done') return;
    statTime.textContent = startedAt ? stamp() : '00:00';
  }

  // ---------- Hint ----------
  function renderHint() {
    hintDigits.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const b = document.createElement('b');
      b.textContent = otp[i];
      if (i < index) b.classList.add('got');
      else if (i === index) b.classList.add('next');
      hintDigits.appendChild(b);
    }
  }

  function setHint(open) {
    hintOpen = open;
    hintCode.hidden = !open;
    hintBtn.setAttribute('aria-expanded', String(open));
    hintLabel.textContent = open ? 'Hide hint' : 'Show hint';
    if (open) { renderHint(); log('hint panel opened — code exposed', 'warn'); }
  }

  // ---------- Sound (tiny WebAudio synth) ----------
  let actx = null;
  function audio() {
    if (!soundOn) return null;
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; } }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur, type = 'sine', gain = 0.08, slide = 0) {
    const ac = audio(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ac.currentTime + dur);
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }
  const sfx = {
    load: () => tone(520, 0.12, 'triangle', 0.06, 220),
    stretch: () => tone(180, 0.08, 'sawtooth', 0.02, 40),
    shoot: () => { tone(300, 0.25, 'sawtooth', 0.05, 600); tone(900, 0.2, 'sine', 0.03, 400); },
    ok: () => { tone(660, 0.12, 'sine', 0.08); setTimeout(() => tone(990, 0.18, 'sine', 0.08), 90); },
    bad: () => { tone(220, 0.22, 'square', 0.05, -120); },
    miss: () => tone(160, 0.3, 'triangle', 0.05, -100),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.28, 'sine', 0.08), i * 110)),
  };

  // ---------- FX canvas: stars, trail, bursts ----------
  const stars = [];
  const trail = [];
  const sparks = [];
  let fxW = 0, fxH = 0, lastFx = 0;
  function sizeFx() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    fxW = stage.clientWidth; fxH = stage.clientHeight;
    fx.width = fxW * dpr; fx.height = fxH * dpr;
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!stars.length) for (let i = 0; i < 90; i++) stars.push({ x: Math.random() * fxW, y: Math.random() * fxH, r: Math.random() * 1.4 + .3, s: Math.random() * 8 + 3, p: Math.random() * Math.PI * 2 });
  }
  function burst(x, y, color, n = 26) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 260;
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.5, age: 0, color, r: 1.5 + Math.random() * 2 });
    }
  }
  function fxLoop(now) {
    const dt = Math.min(0.05, (now - lastFx) / 1000 || 0.016); lastFx = now;
    fxCtx.clearRect(0, 0, fxW, fxH);
    // stars
    for (const s of stars) {
      s.y -= s.s * dt; if (s.y < -4) { s.y = fxH + 4; s.x = Math.random() * fxW; }
      const a = 0.35 + 0.35 * Math.sin(now / 900 + s.p);
      fxCtx.fillStyle = `rgba(200,230,255,${a})`;
      fxCtx.beginPath(); fxCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2); fxCtx.fill();
    }
    // trail
    for (let i = trail.length - 1; i >= 0; i--) {
      const t = trail[i]; t.age += dt;
      if (t.age > 0.45) { trail.splice(i, 1); continue; }
      const k = 1 - t.age / 0.45;
      fxCtx.fillStyle = `rgba(255,194,77,${0.55 * k})`;
      fxCtx.beginPath(); fxCtx.arc(t.x, t.y, 14 * k, 0, Math.PI * 2); fxCtx.fill();
    }
    // sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i]; p.age += dt;
      if (p.age > p.life) { sparks.splice(i, 1); continue; }
      p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - p.age / p.life;
      fxCtx.fillStyle = p.color.replace('A', k.toFixed(2));
      fxCtx.beginPath(); fxCtx.arc(p.x, p.y, p.r * k, 0, Math.PI * 2); fxCtx.fill();
    }
    requestAnimationFrame(fxLoop);
  }

  // ---------- Game flow ----------
  function newOtp() {
    if (!/[?&]random/.test(location.search)) return FIXED_OTP;
    let s = '';
    for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  function resetGame() {
    otp = newOtp();
    index = 0;
    attempts = 0; hits = 0; startedAt = 0;
    loaded = null; loadedChip = null;
    state = 'idle';
    cancelAnimationFrame(rafId);
    slots.forEach((el, i) => {
      el.className = 'slot' + (i === 0 ? ' active' : '');
      el.innerHTML = '<span class="dot"></span>';
    });
    chips.forEach((c) => c.classList.remove('used', 'locked'));
    pouch.className = 'pouch';
    pouchDigit.textContent = '';
    aim.style.display = 'none';
    toast.classList.remove('show');
    modal.hidden = true;
    logList.innerHTML = '';
    setStatus('');
    updateStats();
    statTime.textContent = '00:00';
    if (hintOpen) renderHint();
    const g = geo();
    setPouch(g.rest.x, g.rest.y);
    drawBands();
    log('session opened · awaiting 6-digit code');
  }

  function load(chip) {
    if (state !== 'idle') return;
    if (!startedAt) startedAt = Date.now();
    loaded = chip.dataset.d;
    loadedChip = chip;
    chip.classList.add('used');
    pouchDigit.textContent = loaded;
    const g = geo();
    pouch.classList.remove('hit', 'fade', 'flying', 'dragging');
    setPouch(g.rest.x, g.rest.y);
    void pouch.offsetWidth;
    pouch.classList.add('loaded');
    state = 'loaded';
    setStatus('busy');
    sfx.load();
    log(`digit ${loaded} loaded → slot ${index + 1}`);
  }

  function unload() {
    pouch.classList.remove('loaded', 'flying', 'dragging');
    pouchDigit.textContent = '';
    if (loadedChip) loadedChip.classList.remove('used');
    loaded = null; loadedChip = null;
    const g = geo();
    setPouch(g.rest.x, g.rest.y);
    drawBands();
    state = index >= 6 ? 'done' : 'idle';
    if (state === 'idle') setStatus('');
  }

  function resolveHit(digit, at) {
    const slot = slots[index];
    attempts += 1;
    if (digit === otp[index]) {
      hits += 1;
      slot.classList.remove('active');
      slot.classList.add('filled', 'pop');
      slot.textContent = digit;
      showToast('Correct!', 'ok');
      burst(at.x, at.y, 'rgba(56,225,255,A)');
      sfx.ok();
      log(`slot ${index + 1} ← ${digit} · ACCEPTED`, 'ok');
      index += 1;
      if (index < 6) slots[index].classList.add('active');
    } else {
      slot.classList.remove('shake');
      void slot.offsetWidth;
      slot.classList.add('shake');
      stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake');
      showToast(`${digit} is incorrect. Try again!`, 'bad');
      burst(at.x, at.y, 'rgba(255,77,125,A)', 18);
      sfx.bad();
      setStatus('bad');
      log(`slot ${index + 1} ← ${digit} · REJECTED`, 'bad');
    }
    updateStats();
    if (hintOpen) renderHint();
    setTimeout(() => {
      pouch.classList.remove('hit');
      unload();
      if (index >= 6) setTimeout(showSuccess, 650);
    }, 380);
  }

  function resolveMiss() {
    attempts += 1;
    updateStats();
    showToast('Missed! Try again.', 'miss');
    sfx.miss();
    log('shot left the field · MISS', 'warn');
    setTimeout(() => { pouch.classList.remove('fade'); unload(); }, 320);
  }

  function showSuccess() {
    state = 'done';
    chips.forEach((c) => c.classList.add('locked'));
    modalOtp.textContent = otp;
    $('mAttempts').textContent = attempts;
    $('mAcc').textContent = Math.round(hits / attempts * 100) + '%';
    $('mTime').textContent = stamp();
    modal.hidden = false;
    setStatus('');
    sfx.win();
    log('code verified · ACCESS GRANTED', 'ok');
    const g = geo();
    burst(g.stage.width / 2, g.stage.height / 2, 'rgba(56,255,176,A)', 60);
    enterBtn.focus();
  }

  // ---------- Shooting ----------
  function shoot() {
    const g = geo();
    const v = { x: -pull.x * SPEED, y: -pull.y * SPEED };
    let pos = { x: g.rest.x + pull.x, y: g.rest.y + pull.y };
    const digit = loaded;
    state = 'flying';
    pouch.classList.remove('dragging');
    pouch.classList.add('flying');
    aim.style.display = 'none';
    drawBands();
    sfx.shoot();

    const s = g.stage;
    const row = slotsEl.getBoundingClientRect();
    const zone = { l: row.left - s.left - 8, t: row.top - s.top - 8, r: row.right - s.left + 8, b: row.bottom - s.top + 8 };
    const active = slots[index].getBoundingClientRect();
    const target = { x: active.left - s.left + active.width / 2, y: active.top - s.top + active.height / 2 };

    let last = performance.now();
    let elapsed = 0;
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      elapsed += dt;
      const n = 3;
      for (let i = 0; i < n; i++) {
        const h = dt / n;
        pos.x += v.x * h;
        pos.y += v.y * h;
        v.y += GRAVITY * h;
        if (pos.x > zone.l && pos.x < zone.r && pos.y > zone.t && pos.y < zone.b) {
          setPouch(target.x, target.y);
          pouch.classList.add('hit');
          resolveHit(digit, target);
          return;
        }
      }
      setPouch(pos.x, pos.y);
      trail.push({ x: pos.x, y: pos.y, age: 0 });
      const out = pos.y > s.height + 60 || pos.x < -60 || pos.x > s.width + 60 || pos.y < -120;
      if (out || elapsed > MAX_FLIGHT) {
        pouch.classList.add('fade');
        resolveMiss();
        return;
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  // ---------- Pointer handling ----------
  pouch.addEventListener('pointerdown', (e) => {
    if (state !== 'loaded') return;
    e.preventDefault();
    pointerId = e.pointerId;
    try { pouch.setPointerCapture(pointerId); } catch (_) {}
    state = 'dragging';
    pouch.classList.add('dragging');
    pull = { x: 0, y: 0 };
    drag(e);
  });

  let lastStretch = 0;
  function drag(e) {
    const g = geo();
    let dx = e.clientX - g.stage.left - g.rest.x;
    let dy = e.clientY - g.stage.top - g.rest.y;
    const len = Math.hypot(dx, dy);
    if (len > MAX_PULL) { dx = dx / len * MAX_PULL; dy = dy / len * MAX_PULL; }
    pull = { x: dx, y: dy };
    const p = { x: g.rest.x + dx, y: g.rest.y + dy };
    setPouch(p.x, p.y);
    drawBands(p);
    drawAim();
    if (Math.abs(len - lastStretch) > 22) { lastStretch = len; sfx.stretch(); }
  }

  pouch.addEventListener('pointermove', (e) => {
    if (state !== 'dragging' || e.pointerId !== pointerId) return;
    drag(e);
  });

  function release(e) {
    if (state !== 'dragging' || (e && e.pointerId !== pointerId)) return;
    try { pouch.releasePointerCapture(pointerId); } catch (_) {}
    pointerId = null;
    const len = Math.hypot(pull.x, pull.y);
    if (len < MIN_PULL) {
      state = 'loaded';
      pouch.classList.remove('dragging');
      aim.style.display = 'none';
      const g = geo();
      setPouch(g.rest.x, g.rest.y);
      drawBands();
      return;
    }
    shoot();
  }
  pouch.addEventListener('pointerup', release);
  pouch.addEventListener('pointercancel', release);

  // ---------- Tray / controls ----------
  chips.forEach((chip) => chip.addEventListener('click', () => load(chip)));
  slots.forEach((el) => el.addEventListener('animationend', () => el.classList.remove('shake', 'pop')));
  stage.addEventListener('animationend', (e) => { if (e.target === stage) stage.classList.remove('shake'); });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') { setHint(!hintOpen); return; }
    if (state !== 'idle' || !/^[0-9]$/.test(e.key)) return;
    const chip = chips.find((c) => c.dataset.d === e.key);
    if (chip) load(chip);
  });

  hintBtn.addEventListener('click', () => setHint(!hintOpen));
  enterBtn.addEventListener('click', resetGame);
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    if (soundOn) sfx.load();
  });

  window.addEventListener('resize', () => {
    sizeFx();
    if (state === 'flying' || state === 'dragging') return;
    const g = geo();
    setPouch(g.rest.x, g.rest.y);
    drawBands();
  });

  // ---------- Boot ----------
  sizeFx();
  requestAnimationFrame(fxLoop);
  clockTimer = setInterval(tickClock, 500);
  resetGame();
})();
