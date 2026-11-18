/* Void Podcast — Stage 2A sample catalogue (local only, entirely fictional).
   Loaded dynamically from the flag-ON branch of void-domains.js; never fetched.
   Artwork is generated (graphite + initials); audioUrl stays empty unless a
   git-ignored podcast-dev-config.local.js supplies test audio. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.VoidPodcastSampleData = factory(); }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var SHOWS = [
    { id: 'show-night-frequencies', title: 'Night Frequencies', titleFa: 'فرکانس‌های شب',
      publisher: 'Orbital Radio', feedUrl: '', initials: 'NF' },
    { id: 'show-slow-orbit', title: 'The Slow Orbit', titleFa: 'مدار آهسته',
      publisher: 'Deep Field Media', feedUrl: '', initials: 'SO' },
    { id: 'show-paper-lanterns', title: 'Paper Lanterns', titleFa: 'فانوس‌های کاغذی',
      publisher: 'Sama House', feedUrl: '', initials: 'PL' }
  ];

  function ep(id, showId, title, titleFa, publishedAt, durationSec, description, chapters) {
    var e = { id: id, showId: showId, title: title, titleFa: titleFa,
      publishedAt: publishedAt, durationSec: durationSec, audioUrl: '', description: description };
    if (chapters) { e.chapters = chapters; }
    return e;
  }

  var EPISODES = [
    ep('nf-05', 'show-night-frequencies', 'Signals After Midnight', 'سیگنال‌های پس از نیمه‌شب', '2026-11-14T22:00:00Z', 2760,
      'A fictional late-night broadcast about the quiet hum of empty stations and the people who still tune in.'),
    ep('nf-04', 'show-night-frequencies', 'The Last Shortwave', 'آخرین موج کوتاه', '2026-11-07T22:00:00Z', 2400,
      'An invented story of a shortwave operator trading messages with a station that may not exist.',
      [
        { title: 'Cold Open', titleFa: 'آغازِ سرد', startSec: 0 },
        { title: 'The Operator’s Log', titleFa: 'دفترِ اپراتور', startSec: 360 },
        { title: 'Numbers Between Stations', titleFa: 'اعداد میان ایستگاه‌ها', startSec: 900 },
        { title: 'The Reply', titleFa: 'پاسخ', startSec: 1560 },
        { title: 'Sign-Off', titleFa: 'خداحافظی', startSec: 2100 }
      ]),
    ep('nf-03', 'show-night-frequencies', 'Static Gardens', 'باغ‌های برفک', '2026-10-31T22:00:00Z', 3120,
      'Field recordings from a made-up garden where every plant grows a different kind of static.'),
    ep('nf-02', 'show-night-frequencies', 'Numbers, Softly', 'اعداد، آرام', '2026-10-24T22:00:00Z', 1980,
      'A gentle, fictional reading of numbers stations and the lullabies hidden inside them.'),
    ep('nf-01', 'show-night-frequencies', 'First Light on the Dial', 'نخستین نور روی پیچ رادیو', '2026-10-17T22:00:00Z', 2220,
      'The imaginary pilot episode: turning the dial until the night answers back.'),

    ep('so-04', 'show-slow-orbit', 'A Year Around Nothing', 'یک سال گرد هیچ', '2026-11-12T08:00:00Z', 3240,
      'A fictional probe completes a slow orbit around an empty point in space and sends home postcards.'),
    ep('so-03', 'show-slow-orbit', 'Gravity for Beginners', 'گرانش برای تازه‌کارها', '2026-11-05T08:00:00Z', 2640,
      'An invented lecture series on falling slowly, told by an astronaut who never launches.'),
    ep('so-02', 'show-slow-orbit', 'The Patient Comet', 'دنباله‌دار صبور', '2026-10-29T08:00:00Z', 2880,
      'A made-up comet waits seventy years for one good conversation. This is that conversation.'),
    ep('so-01', 'show-slow-orbit', 'Departure, Eventually', 'عاقبت، حرکت', '2026-10-22T08:00:00Z', 2100,
      'The fictional first episode about leaving very, very slowly and noticing everything on the way.'),

    ep('pl-05', 'show-paper-lanterns', 'The Folded River', 'رودِ تاشده', '2026-11-15T18:30:00Z', 1860,
      'A fictional town folds its river into paper boats every autumn. Someone forgets to unfold it.'),
    ep('pl-04', 'show-paper-lanterns', 'Letters to the Wind', 'نامه‌هایی به باد', '2026-11-08T18:30:00Z', 2040,
      'An invented postal service that delivers only to the wind, and the clerk who reads every letter.'),
    ep('pl-03', 'show-paper-lanterns', 'A Lantern for Each Name', 'فانوسی برای هر نام', '2026-11-01T18:30:00Z', 2340,
      'A made-up festival where every lantern carries a name nobody has spoken in a hundred years.'),
    ep('pl-02', 'show-paper-lanterns', 'Ink That Glows', 'جوهرِ شب‌تاب', '2026-10-25T18:30:00Z', 1740,
      'A fictional calligrapher mixes ink from moonlight and regret. The results are luminous.'),
    ep('pl-01', 'show-paper-lanterns', 'First Fold', 'اولین تا', '2026-10-18T18:30:00Z', 1560,
      'The imaginary beginning: one sheet of paper, one candle, and a very patient teacher.')
  ];

  function episodesOf(showId) {
    return EPISODES.filter(function (e) { return e.showId === showId; })
      .sort(function (a, b) { return a.publishedAt < b.publishedAt ? 1 : -1; });
  }
  function latest(count) {
    return EPISODES.slice().sort(function (a, b) { return a.publishedAt < b.publishedAt ? 1 : -1; })
      .slice(0, count || 8);
  }
  function showById(id) {
    for (var i = 0; i < SHOWS.length; i++) { if (SHOWS[i].id === id) { return SHOWS[i]; } }
    return null;
  }

  return { SHOWS: SHOWS, EPISODES: EPISODES, episodesOf: episodesOf, latest: latest, showById: showById };
});