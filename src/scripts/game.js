/* ============================================================
   CHRONO·MOVIE — a movie timeline guessing game
   Movie data is imported from src/data/movies.json
   ============================================================ */

import MOVIES from '../data/movies.json';

// ---------- Config ----------
const TARGET_TIMELINE = 10;   // total movies needed on the axis to win (incl. reference)
const ROUND_SECONDS = 50;     // trailer playback time per round

// Difficulty modes — only the number of attempts (and the win/lose flavour
// text) changes; the target axis is always 10 movies.
const MODES = {
  easy: {
    label: 'Fácil',
    attempts: 20,
    win:  '🍿 ¡Con 20 intentos lo hace hasta un ciego con el trailer sin sonido…',
    lose: '🎬 ¡Has perdido! Ni clickando a lo loco se puede perder en fácil...😅',
  },
  normal: {
    label: 'Normal',
    attempts: 15,
    win:  '🏆 ¡HAS GANADO! ¡Te está cundiendo Netflix, eh! 🍿',
    lose: '😅 Ponte a ver alguna película más que todavia no te da para esta dificultad...🍿',
  },
  hardcore: {
    label: 'Hardcore',
    attempts: 10,
    win:  '👑 ¡LEYENDA DEL CINE! ¡Estás manteniendo tu solo el cine de tu barrio! 😂',
    lose: '💀 ¡HAS PERDIDO! Vuelve a la dificultad que de verdad te toca anda, chulo…',
  },
};
let difficulty = 'normal';            // selected mode key
let maxAttempts = MODES.normal.attempts; // attempts available this game

// Mobile browsers block autoplay WITH sound; only muted video may autoplay.
// On these devices we start muted so the trailer always plays, and the user
// can tap the 🔊 button (a user gesture, which is allowed) to enable sound.
const IS_MOBILE =
  /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) ||
  (('ontouchstart' in window) && window.matchMedia('(max-width: 900px)').matches);

// ---------- State ----------
let pool = [];        // shuffled movies not yet used
let seen = new Set(); // titles already shown this game — never repeat them
let timeline = [];    // placed movies, kept sorted ascending by year
let referenceMovie = null; // the starting movie — keeps the REFERENCIA tag
let current = null;   // movie being guessed this round
let attempts = 0;
let muted = IS_MOBILE;      // start muted on mobile so autoplay is allowed
let userUnmuted = false;    // once the user enables sound, keep it on for the rest
let roundTimer = null;     // interval id for the countdown
let secondsLeft = 0;
let player = null;         // YouTube IFrame player
let ytReady = false;
let pendingVideoId = null; // queued while player API loads
let currentVideoId = null; // the trailer we asked for (to tell it apart from ads)

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const screens = {
  start: $('screen-start'),
  mode: $('screen-mode'),
  countdown: $('screen-countdown'),
  game: $('screen-game'),
  end: $('screen-end'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ---------- YouTube IFrame API ----------
// The API calls this global when ready.
window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('yt-player', {
    width: '100%',
    height: '100%',
    playerVars: {
      autoplay: 1,
      mute: muted ? 1 : 0, // muted autoplay is required on mobile
      controls: 0,      // hide controls
      disablekb: 1,     // no keyboard
      fs: 0,            // no fullscreen button
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      playsinline: 1,
    },
    events: {
      onReady: () => {
        ytReady = true;
        if (pendingVideoId) {
          loadVideo(pendingVideoId);
          pendingVideoId = null;
        }
      },
      onStateChange: onPlayerStateChange,
    },
  });
};

function injectYouTubeAPI() {
  if (document.getElementById('yt-api')) return;
  const tag = document.createElement('script');
  tag.id = 'yt-api';
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}

function onPlayerStateChange(e) {
  // Keep the video playing & muted-state in sync; never let it sit paused
  // (a paused YouTube video can reveal the title overlay).
  if (e.data === YT.PlayerState.PAUSED) {
    try { player.playVideo(); } catch (_) {}
  }
}

function extractVideoId(url) {
  const m = url.match(/[?&]v=([^&]+)/);
  return m ? m[1] : null;
}

function loadVideo(videoId) {
  if (!ytReady || !player || !player.loadVideoById) {
    pendingVideoId = videoId;
    return;
  }
  currentVideoId = videoId;
  // start a little into the clip to skip intros/black frames
  player.loadVideoById({ videoId, startSeconds: 8 });
  if (muted) player.mute(); else player.unMute();
  player.setVolume(60);
  try { player.playVideo(); } catch (_) {}

  // Safety net: if the browser blocked autoplay the player won't be PLAYING
  // shortly after. If the user already enabled sound we respect it and just
  // retry (most mobile browsers allow it after that first gesture); otherwise
  // we fall back to muted playback so the trailer always runs.
  setTimeout(() => {
    try {
      if (player.getPlayerState && player.getPlayerState() !== YT.PlayerState.PLAYING) {
        if (!userUnmuted) {
          muted = true;
          player.mute();
          updateMuteButton();
        }
        player.playVideo();
      }
    } catch (_) {}
  }, 1200);
}

// The IFrame API has no official "ad playing" event, but during a pre/mid-roll
// ad the player reports the AD's metadata, whose video_id differs from the
// trailer we asked for. We treat the round as "really playing" only when the
// player is PLAYING *and* the on-screen video matches our requested trailer.
function isTrailerPlaying() {
  try {
    if (!player || !player.getPlayerState) return false;
    if (player.getPlayerState() !== YT.PlayerState.PLAYING) return false;
    const data = player.getVideoData && player.getVideoData();
    if (data && data.video_id && currentVideoId && data.video_id !== currentVideoId) {
      return false; // an ad is on screen — don't count the time
    }
    return true;
  } catch (_) {
    return false;
  }
}

// ---------- Utilities ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Game flow ----------
// Pick a difficulty from the mode-select screen, then jump into the game.
function selectMode(key) {
  const mode = MODES[key] || MODES.normal;
  difficulty = MODES[key] ? key : 'normal';
  maxAttempts = mode.attempts;
  startGame();
}

function startGame() {
  // Reset state
  pool = shuffle(MOVIES);
  seen = new Set();
  timeline = [];
  attempts = 0;
  current = null;
  // Keep sound on if the user already enabled it; otherwise start muted on mobile.
  muted = IS_MOBILE && !userUnmuted;
  updateMuteButton();

  // Reference movie = first of shuffled pool
  const reference = pool.shift();
  referenceMovie = reference;
  seen.add(reference.title);
  timeline.push(reference);

  updateHud();
  renderTimeline();
  $('feedback').textContent = '';

  injectYouTubeAPI();
  runCountdown(() => {
    showScreen('game');
    nextRound();
  });
}

function runCountdown(done) {
  showScreen('countdown');
  const el = $('countdown-number');
  const steps = ['3', '2', '1'];
  let i = 0;

  const tick = () => {
    if (i < steps.length) {
      el.className = 'countdown-number';
      // The "1" glyph isn't centred within its advance width, so nudge it left.
      const dx = steps[i] === '1' ? -2.2 : 0;
      el.innerHTML = `
        <div class="cd-ring">
          <svg class="cd-svg" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="cd-track" cx="50" cy="50" r="46"></circle>
            <circle class="cd-progress" cx="50" cy="50" r="46" transform="rotate(-90 50 50)"></circle>
            <text class="cd-num" x="50" y="50" dx="${dx}" text-anchor="middle" dominant-baseline="central">${steps[i]}</text>
          </svg>
        </div>`;
      i++;
      setTimeout(tick, 1000);
    } else {
      el.innerHTML = `<div class="cd-action">¡ACCIÓN!</div>`;
      setTimeout(done, 1200);
    }
  };
  tick();
}

function nextRound() {
  // Win check
  if (timeline.length >= TARGET_TIMELINE) return endGame(true);
  // Lose check
  if (attempts >= maxAttempts) return endGame(false);
  // Draw the next unseen movie (a title never repeats within a game).
  let next = null;
  while (pool.length > 0) {
    const candidate = pool.shift();
    if (!seen.has(candidate.title)) { next = candidate; break; }
  }
  if (!next) return endGame(timeline.length >= TARGET_TIMELINE);

  current = next;
  seen.add(current.title);
  $('feedback').textContent = '';
  $('feedback').className = 'feedback';

  renderTimeline(); // enable slot buttons
  setSlotsEnabled(true);

  const vid = extractVideoId(current.trailer_url);
  if (vid) loadVideo(vid);

  startTimer();
}

function startTimer() {
  clearInterval(roundTimer);
  secondsLeft = ROUND_SECONDS;
  const fill = $('timer-fill');
  const bar = fill.parentElement;
  const txt = $('timer-text');

  bar.classList.remove('low');
  // The bar is now driven by JS each tick (so it can pause during ads); a short
  // linear transition keeps it smooth between updates.
  fill.style.transition = 'transform 0.25s linear';
  fill.style.transform = 'scaleX(1)';
  txt.textContent = secondsLeft;

  // Drive the countdown from real elapsed time, but only accumulate it while the
  // trailer is actually on screen — ads (and buffering) pause the clock.
  let last = performance.now();
  roundTimer = setInterval(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;

    if (!isTrailerPlaying()) return; // ad / buffering / paused → freeze the timer

    secondsLeft -= dt;
    txt.textContent = Math.max(Math.ceil(secondsLeft), 0);
    fill.style.transform = `scaleX(${Math.max(secondsLeft / ROUND_SECONDS, 0)})`;
    if (secondsLeft <= 8) bar.classList.add('low');
    if (secondsLeft <= 0) {
      clearInterval(roundTimer);
      handleTimeout();
    }
  }, 200);
}

function stopTimer() {
  clearInterval(roundTimer);
}

// ---------- Placement logic ----------
// A slot index `s` sits between timeline[s-1] and timeline[s].
// It is CORRECT if inserting `current` there keeps the years non-decreasing.
// Ties (==) on either neighbour count as correct, per the rules.
function isSlotCorrect(slotIndex, year) {
  const leftYear = slotIndex > 0 ? timeline[slotIndex - 1].year : -Infinity;
  const rightYear = slotIndex < timeline.length ? timeline[slotIndex].year : Infinity;
  return leftYear <= year && year <= rightYear;
}

function handleSlotClick(slotIndex) {
  if (!current) return;
  stopTimer();
  setSlotsEnabled(false);
  attempts++;

  const correct = isSlotCorrect(slotIndex, current.year);

  if (correct) {
    // Insert in true sorted position (stable for ties).
    let insertAt = timeline.findIndex((m) => m.year > current.year);
    if (insertAt === -1) insertAt = timeline.length;
    const placed = current;
    timeline.splice(insertAt, 0, placed);
    current = null;
    updateHud();
    renderTimeline(insertAt); // highlight the freshly placed card
    showFeedback(true, `✔ ¡Correcto! ${placed.title} — ${placed.year}`);
  } else {
    const missed = current;
    current = null;
    updateHud();
    showFeedback(false, `✗ Fallo. Era ${missed.title} — ${missed.year}`);
    renderTimeline();
  }

  setTimeout(nextRound, 1700);
}

function handleTimeout() {
  setSlotsEnabled(false);
  attempts++;
  const missed = current;
  current = null;
  updateHud();
  showFeedback(false, `⏱ Tiempo agotado. Era ${missed.title} — ${missed.year}`);
  renderTimeline();
  setTimeout(nextRound, 1700);
}

function showFeedback(ok, msg) {
  const f = $('feedback');
  f.textContent = msg;
  f.className = 'feedback ' + (ok ? 'ok' : 'bad');
}

// ---------- Rendering ----------
function updateHud() {
  $('placed-count').textContent = timeline.length;
  $('attempts-count').textContent = attempts;
  $('attempts-max').textContent = maxAttempts;
}

function setSlotsEnabled(enabled) {
  document.querySelectorAll('.slot-btn').forEach((b) => {
    b.disabled = !enabled;
  });
}

function renderTimeline(highlightCardIndex = -1) {
  const tl = $('timeline');
  tl.innerHTML = '';
  const roundActive = !!current;

  // slot, card, slot, card, ... , slot
  for (let i = 0; i <= timeline.length; i++) {
    // insertion slot before card i
    const slot = document.createElement('button');
    slot.className = 'slot-btn';
    slot.innerHTML = '＋';
    slot.title = 'Colocar aquí';
    slot.disabled = !roundActive;
    slot.addEventListener('click', () => handleSlotClick(i));
    tl.appendChild(slot);

    if (i < timeline.length) {
      tl.appendChild(buildCard(timeline[i], timeline[i] === referenceMovie, i === highlightCardIndex));
    }
  }

  if (highlightCardIndex >= 0) {
    // scroll the new card into view
    const cards = tl.querySelectorAll('.card');
    const target = cards[highlightCardIndex];
    if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function buildCard(movie, isReference, justPlaced) {
  const card = document.createElement('div');
  card.className = 'card' + (isReference ? ' reference' : '') + (justPlaced ? ' just-placed' : '');
  card.innerHTML = `
    ${isReference ? '<span class="ref-tag">REFERENCIA</span>' : ''}
    <img class="poster" src="${movie.poster_url}" alt="" loading="lazy"
         onerror="this.style.display='none'">
    <div class="year">${movie.year}</div>
    <div class="title">${movie.title}</div>
  `;
  return card;
}

// ---------- End ----------
function endGame(won) {
  stopTimer();
  current = null;
  try { if (player && player.stopVideo) player.stopVideo(); } catch (_) {}

  const mode = MODES[difficulty] || MODES.normal;
  const title = $('end-title');
  const sub = $('end-sub');
  if (won) {
    title.textContent = mode.win;
    title.className = 'end-title win';
    sub.textContent = `¡Eje completado con ${timeline.length} películas en ${attempts} intentos! (Modo ${mode.label})`;
  } else {
    title.textContent = mode.lose;
    title.className = 'end-title lose';
    sub.textContent = `Colocaste ${timeline.length} de ${TARGET_TIMELINE} películas en modo ${mode.label}. ¡Vuelve a intentarlo!`;
  }
  showScreen('end');
}

function goHome() {
  stopTimer();
  current = null;
  try { if (player && player.stopVideo) player.stopVideo(); } catch (_) {}
  showScreen('start');
}

function updateMuteButton() {
  const btn = $('btn-mute');
  btn.textContent = muted ? '🔇' : '🔊';
  btn.title = muted ? 'Toca para activar el sonido' : 'Silenciar';
}

function toggleMute() {
  muted = !muted;
  // Remember the user's intent: once they turn sound on, keep it on for the
  // following trailers; if they deliberately mute, stop forcing sound.
  userUnmuted = !muted;
  updateMuteButton();
  if (player) {
    if (muted) player.mute(); else { player.unMute(); player.setVolume(60); }
  }
}

// ---------- Wire up ----------
updateMuteButton(); // reflect initial muted state (muted on mobile)
$('btn-start').addEventListener('click', () => showScreen('mode'));
$('btn-mode-back').addEventListener('click', () => showScreen('start'));
document.querySelectorAll('.mode-btn').forEach((b) => {
  b.addEventListener('click', () => selectMode(b.dataset.mode));
});
$('btn-again').addEventListener('click', () => showScreen('mode')); // re-pick difficulty
$('btn-home').addEventListener('click', goHome);
$('btn-mute').addEventListener('click', toggleMute);
