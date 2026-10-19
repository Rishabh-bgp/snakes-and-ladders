/* Apply the saved (or system) theme before the first paint to avoid a flash. */
(function () {
  'use strict';
  var t = null;
  try { t = localStorage.getItem('snl.theme'); } catch (e) { /* storage blocked */ }
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
