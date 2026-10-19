/* ==========================================================================
   Board configuration: the ONE place where snakes and ladders are defined.
   Keys are the square you land on, values are where you end up.
   Ladders go up, snakes go down. Edit freely: the board redraws itself and
   SNL.validateBoard() checks the layout when the game starts.
   ========================================================================== */
(function (root) {
  'use strict';
  var SNL_CONFIG = {
    size: 10,            // 10 x 10 board
    last: 100,           // final square
    ladders: {
      3: 22,
      9: 31,
      21: 42,
      28: 84,
      36: 57,
      51: 67,
      63: 83,
      71: 91,
      80: 99
    },
    snakes: {
      17: 7,
      47: 26,
      49: 11,
      54: 34,
      62: 38,
      64: 43,
      87: 24,
      92: 70,
      95: 75,
      98: 79
    },
    // Colour schemes used when drawing snakes, in the order listed above.
    snakeSkins: [
      { body: '#22c55e', dark: '#14532d', band: '#facc15' },
      { body: '#f43f5e', dark: '#881337', band: '#fde68a' },
      { body: '#a855f7', dark: '#3b0764', band: '#f0abfc' },
      { body: '#f97316', dark: '#7c2d12', band: '#1f2937' },
      { body: '#06b6d4', dark: '#164e63', band: '#ecfeff' },
      { body: '#eab308', dark: '#713f12', band: '#7c2d12' },
      { body: '#ef4444', dark: '#450a0a', band: '#111827' },
      { body: '#10b981', dark: '#064e3b', band: '#a7f3d0' },
      { body: '#6366f1', dark: '#1e1b4b', band: '#fbbf24' },
      { body: '#ec4899', dark: '#500724', band: '#fbcfe8' }
    ]
  };
  if (typeof module === 'object' && module.exports) module.exports = SNL_CONFIG;
  else root.SNL_CONFIG = SNL_CONFIG;
})(typeof self !== 'undefined' ? self : this);
