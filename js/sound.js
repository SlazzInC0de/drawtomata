/* Soft key click on the raised buttons, synthesized with Web Audio (no audio files).
   A press plays a low "thock", the release a lighter tick. Toggle with #soundBtn; the choice is remembered. */
(function () {
  'use strict';
  const KEY = 'dt-sound';
  const KEYS = '.primary, .modes button, .learnBar button, [data-try]';
  let on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* storage blocked: keep the default */ }
  let ctx = null, noise = null;
  const audio = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  // body: a short pitched thump; tex: filtered noise for the plastic "click" texture
  function play(down) {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime, out = ac.createGain();
    out.gain.value = down ? 0.22 : 0.12;
    out.connect(ac.destination);
    const osc = ac.createOscillator(), og = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(down ? 190 : 320, t);
    osc.frequency.exponentialRampToValueAtTime(down ? 70 : 160, t + 0.05);
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + (down ? 0.07 : 0.04));
    osc.connect(og).connect(out);
    osc.start(t); osc.stop(t + 0.08);
    const src = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain();
    src.buffer = noise;
    bp.type = 'bandpass'; bp.frequency.value = down ? 2400 : 3800; bp.Q.value = 1.4;
    ng.gain.setValueAtTime(down ? 0.5 : 0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(bp).connect(ng).connect(out);
    src.start(t);
  }
  let held = null;
  document.addEventListener('pointerdown', (e) => {
    if (!on || e.button !== 0) return;
    const b = e.target.closest(KEYS);
    if (!b || b.disabled) return;
    held = b; play(true);
  });
  document.addEventListener('pointerup', () => { if (held && on) play(false); held = null; });
  document.addEventListener('keydown', (e) => {
    if (!on || e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    const b = e.target.closest && e.target.closest(KEYS);
    if (b && !b.disabled) play(true);
  });
  const btn = document.getElementById('soundBtn');
  const sync = () => {
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Turn click sounds off' : 'Turn click sounds on');
    btn.querySelector('use').setAttribute('href', on ? '#i-sound' : '#i-mute');
  };
  if (btn) btn.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    sync();
    if (on) play(true);
  });
  sync();
})();
