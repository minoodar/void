(function () {
  'use strict';

  function showNote(message, parent) {
    var host = parent || document.body;
    var note = document.createElement('div');
    note.id = 'void-gl-note';
    note.setAttribute('role', 'status');
    note.textContent = message;
    host.appendChild(note);
    return note;
  }

  function webgl2Available() {
    try {
      return !!(window.WebGL2RenderingContext && document.createElement('canvas').getContext('webgl2'));
    } catch (e) {
      return false;
    }
  }

  function boot() {
    if (!window.VoidMusic || typeof window.VoidMusic.enter !== 'function') {
      showNote('The player could not load. Check that void-music.js and void-music.css sit next to this page.');
      return;
    }

    /* ?admin=true is a management surface, not the visitor experience: no
       player keyboard capture and no automatic music mode behind the overlay. */
    var adminMode = /[?&]admin=(?:1|true)(?:&|#|$)/.test(location.search);
    if (!adminMode) window.VoidMusic.enter();

    var root = document.getElementById('void-music-root');
    var reopen = document.getElementById('void-reopen');
    function syncReopen() { reopen.hidden = !(root && root.hidden); }
    reopen.addEventListener('click', function () { window.VoidMusic.enter(); });
    if (root && window.MutationObserver) {
      new MutationObserver(syncReopen).observe(root, { attributes: true, attributeFilter: ['hidden'] });
    }
    syncReopen();

    if (!adminMode && !webgl2Available()) {
      showNote(
        'Galaxy view is unavailable because this browser does not support WebGL2. ' +
        'Playback, queue, seek and volume still work normally.',
        document.getElementById('void-music-root') || document.body
      );
    }
  }

  // Wait for the first real layout: arc geometry reads window.innerWidth.
  if (document.readyState === 'complete') requestAnimationFrame(boot);
  else window.addEventListener('load', function () { requestAnimationFrame(boot); }, { once: true });
})();
