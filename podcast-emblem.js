(function (root) {
  'use strict';
  if (!root.__VOID_PODCAST_FLAG__) return;
  var SVG = '<svg class="void-emblem void-emblem--podcast" viewBox="0 0 120 120" role="img" aria-label="Podcast" focusable="false">' +
    '<g class="pc-construct"><circle cx="60" cy="60" r="50"/><path d="M10 60H110"/></g>' +
    '<g class="pc-wave"><path class="pc-wave-b" pathLength="100" d="M10 60C28 105.33 42 105.33 60 60C78 14.67 92 14.67 110 60"/><path class="pc-wave-a" pathLength="100" d="M10 60C28 14.67 42 14.67 60 60C78 105.33 92 105.33 110 60"/></g>' +
    '<g class="pc-stars"><g class="pc-halos"><circle class="pc-halo" cx="35" cy="26" r="4.6"/><circle class="pc-halo" cx="35" cy="94" r="4.6"/><circle class="pc-halo" cx="85" cy="26" r="4.6"/><circle class="pc-halo" cx="85" cy="94" r="4.6"/></g>' +
    '<circle class="pc-antinode" cx="35" cy="26" r="2.3"/><circle class="pc-antinode" cx="35" cy="94" r="2.3"/><circle class="pc-antinode" cx="85" cy="26" r="2.3"/><circle class="pc-antinode" cx="85" cy="94" r="2.3"/>' +
    '<g class="pc-shoulders"><circle cx="22.9" cy="34.5" r="1.1"/><circle cx="47.1" cy="34.5" r="1.1"/><circle cx="22.9" cy="85.5" r="1.1"/><circle cx="47.1" cy="85.5" r="1.1"/><circle cx="72.9" cy="85.5" r="1.1"/><circle cx="97.1" cy="85.5" r="1.1"/><circle cx="72.9" cy="34.5" r="1.1"/><circle cx="97.1" cy="34.5" r="1.1"/></g>' +
    '<g class="pc-dust"><circle cx="30" cy="12" r="0.7"/><circle cx="94" cy="108" r="0.7"/><circle cx="16" cy="100" r="0.7"/><circle cx="104" cy="16" r="0.7"/><circle cx="60" cy="108" r="0.7"/></g></g>' +
    '<path class="pc-x" d="M56.5 56.5l7 7M63.5 56.5l-7 7"/>' +
    '<g class="pc-voice"><circle class="pc-voice-halo" cx="10" cy="60" r="8.5"/><path class="pc-sparkle" d="M10 51V69M1 60H19"/><circle class="pc-voice-core" cx="10" cy="60" r="4"/></g>' +
    '<g class="pc-listener"><circle class="pc-listener-halo" cx="110" cy="60" r="8.5"/><circle class="pc-listener-ring" cx="110" cy="60" r="4.6"/><circle class="pc-listener-dot" cx="110" cy="60" r="1.3"/></g></svg>';
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
