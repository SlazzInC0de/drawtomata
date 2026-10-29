/* /verified/: run every textbook check again in the visitor's browser and show the result. */
(function (DT) {
  'use strict';
  const results = DT.textbook.runAll();
  for (const r of results) {
    const box = document.querySelector(`[data-case="${r.id}"]`);
    if (!box) continue;
    box.querySelector('.vAct').textContent = r.actual;
    const chip = box.querySelector('.vStatus');
    chip.className = `chip ${r.ok ? 'ok' : 'bad'} vStatus`;
    chip.textContent = r.ok ? '✓ matches' : '✗ differs';
  }
  const ok = results.filter((r) => r.ok).length;
  const sum = document.querySelector('#vSummary .chip');
  sum.className = `chip ${ok === results.length ? 'ok' : 'bad'}`;
  sum.textContent = `${ok} of ${results.length} match`;
  document.getElementById('vWhen').textContent = 'checked just now in your browser';
})(window.DT);
