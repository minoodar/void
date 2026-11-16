(function (root) {
  'use strict';
  if (!root.__VOID_PODCAST_FLAG__) return;
  var SVG = '<svg class="void-emblem void-emblem--podcast" viewBox="0 0 120 120" role="img" aria-label="Podcast" focusable="false">' +
    '<g class="pc-construct"><circle cx="60" cy="60" r="44"/><path d="M16 60H104"/></g>' +
    '<g class="pc-wave"><path class="pc-wave-b" pathLength="100" d="M16 60C31.84 94.67 44.16 94.67 60 60C75.84 25.33 88.16 25.33 104 60"/><path class="pc-wave-a" pathLength="100" d="M16 60C31.84 25.33 44.16 25.33 60 60C75.84 94.67 88.16 94.67 104 60"/></g>' +
    '<g class="pc-stars"><circle cx="38" cy="34" r="1.8"/><circle cx="38" cy="86" r="1.8"/><circle cx="82" cy="34" r="1.8"/><circle cx="82" cy="86" r="1.8"/><circle cx="60" cy="60" r="2.4"/></g>' +
    '<g class="pc-voice"><circle class="pc-voice-halo" cx="16" cy="60" r="6.5"/><circle class="pc-voice-core" cx="16" cy="60" r="3.4"/></g>' +
    '<g class="pc-listener"><circle class="pc-listener-ring" cx="104" cy="60" r="3.6"/><circle class="pc-listener-dot" cx="104" cy="60" r="1"/></g></svg>';
  function mount(host, variant) {
    if (!host) return null;
    host.innerHTML = SVG;
    host.className += ' podcast-emblem-host';
    if (variant === 'B') host.classList.add('podcast-node-x');
    else host.classList.add('podcast-node-star');
    return host.firstChild;
  }
  root.VoidPodcastEmblem = { markup: SVG, mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
