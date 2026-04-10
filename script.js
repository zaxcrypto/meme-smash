'use strict';

import * as Web3 from './web3.js';

const Game = (() => {

  /* ═══════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════ */
  const CFG = {
    gravity:           1400,      // px/s²
    trailLength:       20,        // points kept in swipe trail
    trailFadeMs:       120,       // older points fade out
    spawnIntervalBase: 1100,      // ms between spawns (base)
    spawnIntervalMin:  320,       // floor
    coinsPerWaveBase:  1,
    coinsPerWaveMax:   5,
    difficultyStep:    30000,     // ms between difficulty bumps
    bombRatio:         3,         // 1 bomb per N coin spawns
    maxDiffLevel:      6,
    particleCount:     16,
    coinRadius:        38,
    bombRadius:        34,
    scoreCommon:       1,
    scoreRareMin:      2,
    scoreRareMax:      5,
    rareChance:        0.12,
  };

  /* ═══════════════════════════════════════════
     MEME COIN DATA (fallback + display)
  ═══════════════════════════════════════════ */
  const FALLBACK_COINS = [
    { id:'dogecoin',          symbol:'DOGE',  name:'Dogecoin',    color:'#C2A633', img:'https://assets.coingecko.com/coins/images/5/large/dogecoin.png' },
    { id:'shiba-inu',         symbol:'SHIB',  name:'Shiba Inu',   color:'#E05716', img:'https://assets.coingecko.com/coins/images/11939/large/shiba.png' },
    { id:'pepe',              symbol:'PEPE',  name:'Pepe',        color:'#4CAF50', img:'https://assets.coingecko.com/coins/images/29850/large/pepe-token.jpeg' },
    { id:'floki',             symbol:'FLOKI', name:'Floki',       color:'#F5A623', img:'https://assets.coingecko.com/coins/images/16746/large/PNG_image.png' },
    { id:'bonk',              symbol:'BONK',  name:'Bonk',        color:'#F7931A', img:'https://assets.coingecko.com/coins/images/28600/large/bonk.jpg' },
    { id:'dogwifcoin',        symbol:'WIF',   name:'dogwifhat',   color:'#A78BFA', img:'https://assets.coingecko.com/coins/images/33566/large/dogwifhat.jpg' },
    { id:'brett-based',       symbol:'BRETT', name:'Brett',       color:'#3B82F6', img:'https://assets.coingecko.com/coins/images/35529/large/Brett_(BRETT)_logo.png' },
    { id:'meme-ai',           symbol:'MEME',  name:'Meme',        color:'#EC4899', img:'https://assets.coingecko.com/coins/images/36070/large/meme_ai.jpg' },
    { id:'turbo',             symbol:'TURBO', name:'Turbo',       color:'#10B981', img:'https://assets.coingecko.com/coins/images/30424/large/logonoline_%281%29.png' },
    { id:'cat-in-a-dogs-world', symbol:'MEW', name:'MEW',         color:'#F472B6', img:'https://assets.coingecko.com/coins/images/36975/large/mew_icon.png' },
  ];

  /* ═══════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════ */
  let canvas, ctx;
  let W, H;
  let rafId;
  let lastTime   = 0;
  let playerName = '';
  let score      = 0;
  let diffLevel  = 1;
  let missedCoins = 0;
  let bombStrikes = 0;
  let coinSpawnCounter = 0;   // for bomb ratio
  let spawnInterval;          // current ms between spawns
  let coinsPerWave;
  let nextSpawnTime = 0;
  let diffTimer    = 0;
  let isPlaying    = false;
  let isGameOver   = false;
  let isPaused     = false;
  let lastPausedTime = 0;
  let totalPauseTime = 0;
  let isMuted      = false;

  const objects   = [];       // live coins + bombs
  const halves    = [];       // sliced halves
  const particles = [];       // burst particles

  // Swipe trail
  const trail = [];

  // Loaded images cache
  const imgCache = {};
  let coinDefs = [];

  // Shake
  let shakeFrames  = 0;
  let shakeMagnitude = 0;

  // Combo tracking
  let recentSliceTimes = [];   // timestamps of recent coin slices
  let comboBannerTimer = null;

  /* ═══════════════════════════════════════════
     AUDIO (simple Web Audio beeps)
  ═══════════════════════════════════════════ */
  let audioCtx;
  function ensureAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} }
  }
  function playTone(freq, type, duration, gain=0.18) {
    if (isMuted) return;
    ensureAudio(); if(!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      o.start(); o.stop(audioCtx.currentTime + duration);
    } catch(e){}
  }
  function sfxSlice() {
    if (isMuted) return;
    if (weeeAudioEl) {
      const clone = weeeAudioEl.cloneNode();
      clone.volume = 1.0;
      clone.play().catch(e => playTone(880,'sawtooth',0.12,0.15));
    } else {
      playTone(880,'sawtooth',0.12,0.15);
    }
  }
  function sfxScore()  { playTone(1200,'sine',0.08,0.1); }
  function sfxMiss()   {}

  // Sounds
  let bombAudioEl = null;
  let weeeAudioEl = null;

  function initAudio() {
    ensureAudio();
    // Use import.meta.url so Vite resolves the correct asset URL in both dev and prod
    try {
      bombAudioEl = new Audio(new URL('./fahhh.mp3', import.meta.url).href);
      bombAudioEl.volume = 1.0;

      weeeAudioEl = new Audio(new URL('./weee.mp3', import.meta.url).href);
      weeeAudioEl.volume = 1.0;
    } catch(e) {
      console.warn("Audio load error:", e);
    }
  }

  function sfxBomb() {
    if (isMuted) return;
    if (bombAudioEl) {
      const clone = bombAudioEl.cloneNode();
      clone.volume = 1.0;
      clone.play().catch(e => synthFahhhh());
    } else {
      synthFahhhh();
    }
  }

  function synthFahhhh() {
    if (isMuted) return;
    ensureAudio(); if (!audioCtx) return;
    try {
      // Low rumble
      const rumble = audioCtx.createOscillator();
      const rumbleGain = audioCtx.createGain();
      rumble.type = 'sawtooth';
      rumble.frequency.setValueAtTime(200, audioCtx.currentTime);
      rumble.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.6);
      rumbleGain.gain.setValueAtTime(0.35, audioCtx.currentTime);
      rumbleGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.65);
      rumble.connect(rumbleGain); rumbleGain.connect(audioCtx.destination);
      rumble.start(); rumble.stop(audioCtx.currentTime + 0.65);
      // Voiced "Fahhhh"
      const bufSize = audioCtx.sampleRate * 0.7;
      const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, audioCtx.currentTime);
      bp.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.55);
      bp.Q.value = 4;
      const nGain = audioCtx.createGain();
      nGain.gain.setValueAtTime(0.5, audioCtx.currentTime);
      nGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
      noise.connect(bp); bp.connect(nGain); nGain.connect(audioCtx.destination);
      noise.start(); noise.stop(audioCtx.currentTime + 0.7);
    } catch(e){}
  }

  // COMBO sounds
  function sfxCombo2() {
    if (isMuted) return;
    ensureAudio(); if (!audioCtx) return;
    try {
      // "Com-bo!" two-note ding
      [660, 990].forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, audioCtx.currentTime + i*0.12);
        g.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + i*0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i*0.12 + 0.22);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i*0.12);
        o.stop(audioCtx.currentTime + i*0.12 + 0.25);
      });
    } catch(e){}
  }

  function sfxCombo3() {
    if (isMuted) return;
    ensureAudio(); if (!audioCtx) return;
    try {
      // "Triple!" rising three-note fanfare
      [523, 659, 1047].forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0, audioCtx.currentTime + i*0.1);
        g.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + i*0.1 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i*0.1 + 0.28);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i*0.1);
        o.stop(audioCtx.currentTime + i*0.1 + 0.32);
      });
    } catch(e){}
  }

  /* ═══════════════════════════════════════════
     ASSET LOADER
  ═══════════════════════════════════════════ */
  function loadImages(coins) {
    return Promise.all(coins.map(coin => new Promise(resolve => {
      if (imgCache[coin.id]) { resolve(); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => { imgCache[coin.id] = img; resolve(); };
      img.onerror = () => { imgCache[coin.id] = null; resolve(); }; // null = use fallback circle
      img.src = coin.img;
    })));
  }

  async function fetchCoinData() {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=market_cap_desc&per_page=20&page=1',
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const coins = data.slice(0,12).map(c => ({
        id: c.id, symbol: c.symbol.toUpperCase(),
        name: c.name, color: FALLBACK_COINS.find(f=>f.id===c.id)?.color || '#FFD700',
        img: c.image,
      }));
      return coins.length >= 4 ? coins : FALLBACK_COINS;
    } catch {
      return FALLBACK_COINS;
    }
  }

  /* ═══════════════════════════════════════════
     SCREEN MANAGER
  ═══════════════════════════════════════════ */
  function showScreen(id) {
    // 1. Mark all NOT active
    const screens = document.querySelectorAll('.screen');
    screens.forEach(s => {
      s.classList.remove('active');
    });
    
    // 2. Mark target active
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('active');
    }
  }

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */
  async function init() {
    canvas = document.getElementById('gameCanvas');
    ctx    = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    initAudio();

    drawLoadingScreen();

    // Load assets
    coinDefs = await fetchCoinData();
    await loadImages(coinDefs);

    // Input
    canvas.addEventListener('mousemove',  onMouseMove, { passive: false });
    canvas.addEventListener('mousedown',  onPointerDown, { passive: false });
    canvas.addEventListener('mouseup',    onPointerUp, { passive: false });
    canvas.addEventListener('mouseleave', onPointerUp, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchend',   onPointerUp, { passive: false });

    showScreen('screen-home');
    
    // Auto-Connect previously approved wallets
    Web3.autoConnectWallet().then(addr => {
      if (addr) updatePlayButtonState();
    });
  }

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function drawLoadingScreen() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Let CSS background show
    ctx.fillStyle = '#2D1060';
    ctx.font = 'bold 20px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Loading meme coins... 🚀', (canvas.width||320)/2, (canvas.height||600)/2);
  }

  /* ═══════════════════════════════════════════
     GAME FLOW
  ═══════════════════════════════════════════ */
  function startGame() {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;

    const profile = getProfileData(addr);
    if (!profile.name || profile.name.trim() === '') {
      alert('Please set and save your Ninja Name in your Profile first!');
      showProfile();
      return;
    }
    playerName = profile.name;

    window.scrollTo(0, 0);

    ensureAudio();
    resetGameState();
    showScreen('screen-hud');
    isPlaying = true;
    lastTime  = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(gameLoop);
  }

  async function handleWalletAction() {
    const btn = document.getElementById('btn-connect');
    
    if (Web3.getConnectedAddress()) {
      await Web3.disconnectWallet();
      updatePlayButtonState();
      return;
    }

    // Open modal — don't block the button; let watchAccount handle state update
    try {
      Web3.connectWallet().then(() => {
        updatePlayButtonState();
      }).catch((err) => {
        console.error('Wallet connection error:', err);
        updatePlayButtonState();
      });
    } catch (err) {
      console.error('Wallet action error:', err);
      updatePlayButtonState();
    }
  }

  function updatePlayButtonState() {
    const address = Web3.getConnectedAddress();
    const isConnected = !!address;
    const btnStart = document.getElementById('btn-start');
    const btnConnect = document.getElementById('btn-connect');
    const btnProfile = document.getElementById('btn-profile');
    const addrEl = document.getElementById('user-address');

    if (isConnected) {
      btnStart.disabled = false;
      btnStart.style.opacity = '1';
      btnStart.style.filter = 'none';
      btnStart.textContent = 'Play Now';
      
      btnProfile.disabled = false;
      btnProfile.style.opacity = '1';
      btnProfile.style.filter = 'none';

      btnConnect.textContent = 'Disconnect Wallet';
      addrEl.textContent = `Connected: ${address.slice(0,6)}...${address.slice(-4)}`;
      addrEl.style.display = 'block';
    } else {
      btnStart.disabled = true;
      btnStart.style.opacity = '0.5';
      btnStart.style.filter = 'grayscale(1)';
      btnStart.textContent = 'Play Now (Connect Wallet First)';

      btnProfile.disabled = true;
      btnProfile.style.opacity = '0.5';
      btnProfile.style.filter = 'grayscale(1)';
      
      btnConnect.textContent = 'Connect Wallet';
      addrEl.style.display = 'none';
    }
  }

  /* ═══════════════════════════════════════════
     PROFILE & LOCAL DATA
  ═══════════════════════════════════════════ */
  function getProfileData(address) {
    if (!address) return { name: '', cumulativeScore: 0, altAddresses: [] };
    const key = `meme_smash_profile_${address.toLowerCase()}`;
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : { name: '', cumulativeScore: 0, altAddresses: [] };
  }

  function saveProfileData(address, data) {
    if (!address) return;
    const key = `meme_smash_profile_${address.toLowerCase()}`;
    localStorage.setItem(key, JSON.stringify(data));
  }

  function refreshProfileUI(address) {
    const profile = getProfileData(address);
    const addrEl = document.getElementById('profile-connected-address');
    
    if (address && address.length >= 42) {
      addrEl.textContent = `${address.slice(0, 10)}...${address.slice(-8)}`;
      addrEl.dataset.full = address;
      document.getElementById('btn-copy-primary').style.display = 'block';
    } else {
      addrEl.textContent = 'Not Connected';
      addrEl.dataset.full = '';
      document.getElementById('btn-copy-primary').style.display = 'none';
    }
    
    document.getElementById('profile-cumulative-score').textContent = profile.cumulativeScore;
    document.getElementById('playerName').value = profile.name;
    document.getElementById('hud-career-score').textContent = profile.cumulativeScore;
    
    const list = document.getElementById('saved-addresses-list');
    list.innerHTML = '';
    
    if (profile.altAddresses.length === 0) {
      list.innerHTML = '<div style="font-size:12px; color:rgba(255,255,255,0.5);">No secondary addresses saved yet.</div>';
    } else {
      profile.altAddresses.forEach((alt, i) => {
        const item = document.createElement('div');
        item.className = 'alt-wallet-card';
        item.innerHTML = `
          <div class="alt-wallet-info">
            <span class="alt-wallet-desc">${alt.desc}</span>
            <span class="alt-wallet-addr">${alt.address.slice(0,10)}...${alt.address.slice(-8)}</span>
          </div>
          <div style="display:flex; gap: 5px;">
            <button class="alt-wallet-copy-btn" onclick="Game.copyAddress('${alt.address}', this)">Copy</button>
            <button class="alt-wallet-del-btn" onclick="Game.removeAlternativeAddress(${i})">✕</button>
          </div>
        `;
        list.appendChild(item);
      });
    }
  }

  function showProfile() {
    refreshProfileUI(Web3.getConnectedAddress());
    showScreen('screen-profile');
  }

  function saveProfileName() {
    const address = Web3.getConnectedAddress();
    if (!address) return;
    const profile = getProfileData(address);
    profile.name = document.getElementById('playerName').value.trim();
    saveProfileData(address, profile);
    alert('Ninja Name Saved!');
  }

  function addAlternativeAddress() {
    const address = Web3.getConnectedAddress();
    if (!address) return;
    const altAddr = document.getElementById('alt-address-input').value.trim();
    const altDesc = document.getElementById('alt-desc-input').value.trim() || 'Additional';
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(altAddr)) {
      alert("Invalid EVM Address");
      return;
    }

    const profile = getProfileData(address);
    profile.altAddresses.push({ address: altAddr, desc: altDesc });
    saveProfileData(address, profile);
    refreshProfileUI(address);
    document.getElementById('alt-address-input').value = '';
    document.getElementById('alt-desc-input').value = '';
  }

  function removeAlternativeAddress(index) {
    const address = Web3.getConnectedAddress();
    if (!address) return;
    if (!confirm("Are you sure you want to remove this address?")) return;
    const profile = getProfileData(address);
    profile.altAddresses.splice(index, 1);
    saveProfileData(address, profile);
    refreshProfileUI(address);
  }

  function copyAddress(addr, btnEl) {
    navigator.clipboard.writeText(addr).then(() => {
      const old = btnEl.textContent;
      btnEl.textContent = 'Copied!';
      btnEl.style.background = '#4CAF50';
      setTimeout(() => {
        btnEl.textContent = old;
        btnEl.style.background = '';
      }, 1500);
    }).catch(e => console.error(e));
  }

  async function reviveMenu() {
    const btn = document.getElementById('btn-revive');
    const originalText = btn.textContent;
    try {
      if (!confirm("Revive for $0.05 worth of ETH?")) return;
      btn.textContent = 'Processing...';
      await Web3.payToRevive();
      btn.textContent = 'Success!';
      setTimeout(() => {
        btn.textContent = originalText;
        resetForRevive();
        showScreen('screen-hud');
        isPlaying = true;
        lastTime = performance.now();
        rafId = requestAnimationFrame(gameLoop);
      }, 1000);
    } catch (e) {
      console.error(e);
      btn.textContent = 'Payment Failed';
      setTimeout(() => btn.textContent = originalText, 2000);
    }
  }

  function resetForRevive() {
    // Keep score and level, but clear objects and reset health
    objects.length = 0;
    missedCoins = 0;
    bombStrikes = 0;
    isPlaying = true;
    isGameOver = false;
    updateHUD();
  }

  async function submitScoreMenu() {
    try {
      if (confirm(`Submit your score of ${score} to leaderboard for $0.01 worth of ETH?`)) {
        await Web3.payToSubmitScore();
        alert('Payment successful! Score submitted.');
        
        // Add to Career Score
        const addr = Web3.getConnectedAddress();
        if (addr) {
          const profile = getProfileData(addr);
          profile.cumulativeScore += score;
          saveProfileData(addr, profile);
          refreshProfileUI(addr);
        }

        showLeaderboard();
      }
    } catch (e) {
      console.error(e);
      alert('Payment failed or cancelled.');
    }
  }

  function restartGame() {
    if (playerName && playerName !== '') {
      resetGameState();
      showScreen('screen-hud');
      isPlaying = true;
      lastTime  = performance.now();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(gameLoop);
    } else {
      goHome();
    }
  }

  function resetGameState() {
    objects.length    = 0;
    halves.length     = 0;
    particles.length  = 0;
    trail.length      = 0;
    recentSliceTimes  = [];
    score             = 0;
    diffLevel         = 1;
    missedCoins       = 0;
    bombStrikes       = 0;
    coinSpawnCounter  = 0;
    spawnInterval     = CFG.spawnIntervalBase;
    coinsPerWave      = CFG.coinsPerWaveBase;
    nextSpawnTime     = 0;
    diffTimer         = 0;
    isGameOver        = false;
    shakeFrames       = 0;
    updateHUD();
  }

  function gameOver() {
    isPlaying  = false;
    isGameOver = true;
    cancelAnimationFrame(rafId);
    sfxBomb();
    triggerBombFlash();
    triggerShake(18, 22);
    
    const addr = Web3.getConnectedAddress();
    if (addr) {
      const profile = getProfileData(addr);
      if (score > (profile.topScore || 0)) {
        profile.topScore = score;
        saveProfileData(addr, profile);
      }
    }

    setTimeout(() => {
      document.getElementById('gameover-name').textContent = playerName;
      document.getElementById('final-score').textContent   = score;
      showScreen('screen-gameover');
    }, 900);
  }

  function showLeaderboard() {
    renderLeaderboard();
    showScreen('screen-leaderboard');
  }

  function goHome() {
    if (rafId) cancelAnimationFrame(rafId);
    isPlaying = false;
    isGameOver = false;
    isPaused = false;
    objects.length = 0; halves.length = 0; particles.length = 0; trail.length = 0;
    showScreen('screen-home');
  }

  function toggleSettings() {
    if (!isPlaying || isGameOver) return;
    if (!isPaused) {
      isPaused = true;
      lastPausedTime = performance.now();
      showScreen('screen-settings');
    }
  }

  function resumeGame() {
    if (isPaused) {
      totalPauseTime += (performance.now() - lastPausedTime);
      isPaused = false;
      showScreen('screen-hud');
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    const txt = document.getElementById('text-mute-state');
    const icon = document.getElementById('icon-mute-state');
    if (isMuted) {
      txt.textContent = 'Unmute Sound';
      icon.innerHTML = '<use href="#ico-vol-off" />';
    } else {
      txt.textContent = 'Mute Sound';
      icon.innerHTML = '<use href="#ico-vol-on" />';
    }
  }

  function goHomeFromPause() {
    goHome();
  }

  /* ═══════════════════════════════════════════
     GAME LOOP
  ═══════════════════════════════════════════ */
  function gameLoop(now) {
    if (isPaused) {
      render(now);
      if (isPlaying) rafId = requestAnimationFrame(gameLoop);
      return;
    }

    const gameNow = now - totalPauseTime;
    const dt = Math.min((gameNow - lastTime) / 1000, 0.05);
    lastTime = gameNow;

    update(dt, gameNow);
    render(now);

    if (isPlaying) rafId = requestAnimationFrame(gameLoop);
  }

  /* ═══════════════════════════════════════════
     UPDATE
  ═══════════════════════════════════════════ */
  function update(dt, now) {
    // Difficulty progression
    diffTimer += dt * 1000;
    if (diffTimer >= CFG.difficultyStep && diffLevel < CFG.maxDiffLevel) {
      diffTimer = 0;
      diffLevel++;
      spawnInterval = Math.max(CFG.spawnIntervalMin, spawnInterval * 0.80);
      coinsPerWave  = Math.min(CFG.coinsPerWaveMax, coinsPerWave + 1);
      document.getElementById('hud-level').textContent = diffLevel;
    }

    // Spawn
    if (now >= nextSpawnTime) {
      nextSpawnTime = now + spawnInterval + (Math.random() - 0.5) * spawnInterval * 0.4;
      spawnWave();
    }

    // Physics: objects
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      o.vy += CFG.gravity * dt;
      o.x  += o.vx * dt;
      o.y  += o.vy * dt;
      o.angle += o.spin * dt;
      if (o.y > H + o.radius + 10) {
        if (!o.sliced && o.type === 'coin') {
          missedCoins++;
          updateHUD();
          if (missedCoins >= 50) gameOver();
        }
        objects.splice(i, 1);
      }
    }

    // Halves physics
    for (let i = halves.length - 1; i >= 0; i--) {
      const h = halves[i];
      h.vy += CFG.gravity * 1.2 * dt;
      h.x  += h.vx * dt;
      h.y  += h.vy * dt;
      h.angle += h.spin * dt;
      h.life  -= dt;
      if (h.life <= 0 || h.y > H + 120) halves.splice(i, 1);
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 600 * dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Shake decay
    if (shakeFrames > 0) shakeFrames--;

    // Slice detection
    if (trail.length >= 2) {
      checkSlices(now);
    }
  }

  /* ═══════════════════════════════════════════
     SPAWN
  ═══════════════════════════════════════════ */
  function spawnWave() {
    const count = coinsPerWave + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      // Stagger spawns slightly
      setTimeout(() => {
        if (!isPlaying) return;
        coinSpawnCounter++;
        const spawnBomb = (coinSpawnCounter % CFG.bombRatio === 0) && Math.random() < 0.75;
        if (spawnBomb) spawnObject('bomb');
        else           spawnObject('coin');
      }, i * (180 + Math.random() * 200));
    }
  }

  function spawnObject(type) {
    const radius  = type === 'bomb' ? CFG.bombRadius : CFG.coinRadius;
    const x       = radius + Math.random() * (W - radius * 2);
    const y       = H + radius;
    const speed   = (800 + Math.random() * 400) * (1 + (diffLevel - 1) * 0.18);
    const angle   = -Math.PI / 2 + (Math.random() - 0.5) * 0.9; // mostly up, slight spread
    const vx      = Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1) * 0.25;
    const vy      = -speed;
    const spin    = (Math.random() - 0.5) * 4;

    if (type === 'bomb') {
      objects.push({ type:'bomb', x, y, vx, vy, angle:0, spin, radius, sliced:false });
    } else {
      const isRare = Math.random() < CFG.rareChance;
      const coin   = coinDefs[Math.floor(Math.random() * coinDefs.length)];
      const pts    = isRare
        ? CFG.scoreRareMin + Math.floor(Math.random() * (CFG.scoreRareMax - CFG.scoreRareMin + 1))
        : CFG.scoreCommon;
      objects.push({ type:'coin', x, y, vx, vy, angle:0, spin, radius, coin, pts, isRare, sliced:false });
    }
  }

  /* ═══════════════════════════════════════════
     SLICE DETECTION
  ═══════════════════════════════════════════ */
  function checkSlices(now) {
    const recent = trail.filter(p => now - p.t < CFG.trailFadeMs * 1.5);
    if (recent.length < 2) return;

    for (let oi = objects.length - 1; oi >= 0; oi--) {
      const o = objects[oi];
      if (o.sliced) continue;

      for (let ti = 0; ti < recent.length - 1; ti++) {
        const a = recent[ti], b = recent[ti + 1];
        if (segmentCircleIntersects(a.x, a.y, b.x, b.y, o.x, o.y, o.radius * 0.85)) {
          o.sliced = true;
          objects.splice(oi, 1);
          handleSlice(o);
          break;
        }
      }
    }
  }

  function segmentCircleIntersects(ax, ay, bx, by, cx, cy, r) {
    const dx = bx - ax, dy = by - ay;
    const fx = ax - cx, fy = ay - cy;
    const a_ = dx*dx + dy*dy;
    if (a_ === 0) return Math.hypot(fx,fy) <= r;
    const b_ = 2*(fx*dx + fy*dy);
    const c_ = fx*fx + fy*fy - r*r;
    let disc  = b_*b_ - 4*a_*c_;
    if (disc < 0) return false;
    disc = Math.sqrt(disc);
    const t0 = (-b_ - disc) / (2*a_);
    const t1 = (-b_ + disc) / (2*a_);
    return (t0 >= 0 && t0 <= 1) || (t1 >= 0 && t1 <= 1) || (t0 < 0 && t1 > 1);
  }

  function handleSlice(o) {
    if (o.type === 'bomb') {
      sfxBomb();
      triggerBombFlash();
      triggerShake(15, 12);
      bombStrikes++;
      updateHUD();
      if (bombStrikes >= 3) {
        gameOver();
      }
      return;
    }
    // Coin sliced!
    o.sliced = true;
    score += o.pts;
    updateHUD();
    sfxSlice();
    if (o.pts > 1) sfxScore();
    spawnParticles(o.x, o.y, o.coin.color, CFG.particleCount);
    spawnHalves(o);
    showFloatingScore(o.x, o.y, o.pts);
    checkCombo();
  }

  function checkCombo() {
    const now = performance.now();
    recentSliceTimes.push(now);
    // Keep only slices within 600ms window
    recentSliceTimes = recentSliceTimes.filter(t => now - t < 600);
    const count = recentSliceTimes.length;
    if (count === 2) {
      sfxCombo2();
      showComboBanner('<svg class="combo-icon-svg" viewBox="0 0 48 48"><use href="#ico-fire"/></svg>COMBO!', '#FF3DAE');
    } else if (count === 3) {
      sfxCombo3();
      showComboBanner('<svg class="combo-icon-svg" viewBox="0 0 48 48"><use href="#ico-star"/></svg>TRIPLE SLICE!', '#FFD700');
    } else if (count >= 4) {
      sfxCombo3();
      showComboBanner('<svg class="combo-icon-svg" viewBox="0 0 48 48"><use href="#ico-rocket"/></svg>UNSTOPPABLE!', '#7FE82A');
    }
  }

  function showComboBanner(htmlContent, color) {
    const el = document.getElementById('combo-banner');
    el.innerHTML = htmlContent;
    el.style.background = '';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    if (comboBannerTimer) clearTimeout(comboBannerTimer);
    comboBannerTimer = setTimeout(() => {
      el.classList.remove('show');
    }, 900);
  }

  /* ═══════════════════════════════════════════
     HALVES
  ═══════════════════════════════════════════ */
  function spawnHalves(o) {
    const speed = 220 + Math.random() * 140;
    for (let side = 0; side < 2; side++) {
      const dir  = side === 0 ? -1 : 1;
      halves.push({
        x: o.x, y: o.y,
        vx: dir * (speed + Math.random()*80),
        vy: -(80 + Math.random()*120),
        angle: o.angle,
        spin: dir * (3 + Math.random()*3),
        radius: o.radius,
        life: 0.8,
        side,
        coin: o.coin,
        isRare: o.isRare,
      });
    }
  }

  /* ═══════════════════════════════════════════
     PARTICLES
  ═══════════════════════════════════════════ */
  function spawnParticles(x, y, color, count, extraColors) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 150 + Math.random() * 350;
      const colors = extraColors || [color, '#FFD700', '#fff'];
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 100,
        life: 0.4 + Math.random() * 0.35,
        maxLife: 0.75,
        size: 3 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  /* ═══════════════════════════════════════════
     FLOATING SCORE TEXT
  ═══════════════════════════════════════════ */
  const floatingTexts = [];
  function showFloatingScore(x, y, pts) {
    floatingTexts.push({ x, y, pts, life:1.0 });
  }

  /* ═══════════════════════════════════════════
     EFFECTS
  ═══════════════════════════════════════════ */
  function triggerShake(frames, mag) {
    shakeFrames    = frames;
    shakeMagnitude = mag;
  }
  function triggerBombFlash() {
    const el = document.getElementById('bomb-flash');
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 400);
  }

  /* ═══════════════════════════════════════════
     HUD
  ═══════════════════════════════════════════ */
  function updateHUD() {
    document.getElementById('hud-score').textContent = score;
    document.getElementById('hud-level').textContent = diffLevel;
    document.getElementById('hud-missed').textContent = `${missedCoins}/50`;
    
    const strikesContainer = document.getElementById('bomb-strikes');
    strikesContainer.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const x = document.createElement('div');
      x.className = 'strike-slot ' + (i < bombStrikes ? 'strike-active' : 'strike-inactive');
      if (i < bombStrikes) {
        x.innerHTML = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><use href="#ico-x"/></svg>';
      } else {
        x.innerHTML = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><use href="#ico-circle"/></svg>';
      }
      strikesContainer.appendChild(x);
    }
  }

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  function render(now) {
    ctx.save();

    // Screen shake
    if (shakeFrames > 0) {
      const sx = (Math.random() - 0.5) * shakeMagnitude;
      const sy = (Math.random() - 0.5) * shakeMagnitude;
      ctx.translate(sx, sy);
    }

    // Bright Sky gradient (No Green)
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#38bdf8');   // deep sky
    bg.addColorStop(0.45,'#7dd3fc');   // light sky
    bg.addColorStop(0.75,'#bae6fd');   // lighter sky
    bg.addColorStop(1,   '#e0f2fe');   // very light horizon
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Dynamic, slow-moving fluffy clouds and sparkles
    drawClouds(now);

    // Objects
    for (const o of objects) drawObject(o, now);

    // Halves
    for (const h of halves) drawHalf(h, now);

    // Particles
    for (const p of particles) drawParticle(p);

    // Floating scores
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.life -= 0.025;
      ft.y    -= 1.5;
      if (ft.life <= 0) { floatingTexts.splice(i,1); continue; }
      ctx.globalAlpha = ft.life;
      ctx.font = `bold ${20 + ft.pts * 3}px Orbitron, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = ft.pts > 1 ? '#FFD700' : '#fff';
      ctx.shadowBlur = 12;
      ctx.shadowColor = ft.pts > 1 ? '#FFD700' : '#00F7FF';
      ctx.fillText(`+${ft.pts}`, ft.x, ft.y);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Slice trail
    drawTrail(now);

    ctx.restore();
  }

  /* Dynamic continuous clouds */
  function drawClouds(now) {
    const t = now * 0.00004;

    // Background Layer Clouds
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 0.25 + t * 1.5) % 1.5) - 0.25;
      const cy = Math.sin(i * 3) * 0.15 + 0.15;
      const r = 90 + Math.sin(i*2)*20;
      drawCloudBlob(cx * W, cy * H, r);
    }
    
    // Mid Layer Clouds (Puffier, faster)
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 0.3 + t * 2.8) % 1.5) - 0.25;
      const cy = Math.sin(i * 5) * 0.1 + 0.08;
      const r = 70 + Math.sin(i*7)*15;
      drawCloudBlob(cx * W, cy * H, r);
    }

    // Foreground Accent Clouds (Slightly larger, dynamic drifting)
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 0.4 + t * 4.2) % 1.5) - 0.25;
      const cy = Math.sin(i * 11) * 0.05 + 0.05;
      const r = 85 + Math.sin(i*3)*10;
      drawCloudBlob(cx * W, cy * H, r);
    }
    
    ctx.globalAlpha = 1;
  }
  
  function drawCloudBlob(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.arc(x + r*0.6, y + r*0.15, r*0.75, 0, Math.PI*2);
    ctx.arc(x - r*0.55, y + r*0.12, r*0.65, 0, Math.PI*2);
    ctx.arc(x + r*0.3, y - r*0.4, r*0.6, 0, Math.PI*2);
    ctx.fill();
  }

  /* Draw coin or bomb */
  function drawObject(o, now) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);

    if (o.type === 'bomb') {
      drawBomb(o);
    } else {
      drawCoin(o, now);
    }
    ctx.restore();
  }

  function drawCoin(o, now) {
    const r = o.radius;
    // Rare glow
    if (o.isRare) {
      ctx.shadowBlur  = 24;
      ctx.shadowColor = '#FFD700';
    }

    // Outer ring
    const ringGrad = ctx.createRadialGradient(0, 0, r*0.6, 0, 0, r+5);
    ringGrad.addColorStop(0, o.isRare ? '#FFD700' : (o.coin.color || '#888'));
    ringGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r+3, 0, Math.PI*2);
    ctx.fillStyle = ringGrad;
    ctx.fill();

    // Coin circle clip
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.save();
    ctx.clip();

    // Draw image or fallback
    const img = imgCache[o.coin.id];
    if (img) {
      ctx.drawImage(img, -r, -r, r*2, r*2);
    } else {
      // Fallback gradient circle
      const grad = ctx.createRadialGradient(-r*0.3, -r*0.3, 0, 0, 0, r);
      grad.addColorStop(0, lighten(o.coin.color, 60));
      grad.addColorStop(1, o.coin.color);
      ctx.fillStyle = grad;
      ctx.fillRect(-r, -r, r*2, r*2);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r*0.55}px Nunito, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.coin.symbol.slice(0,4), 0, 0);
    }
    ctx.restore(); // unclip

    // Shine overlay
    const shine = ctx.createLinearGradient(-r, -r, r, r*0.3);
    shine.addColorStop(0, 'rgba(255,255,255,0.28)');
    shine.addColorStop(0.5,'rgba(255,255,255,0.06)');
    shine.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fillStyle = shine;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.strokeStyle = o.isRare ? '#FFD700' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = o.isRare ? 3 : 1.5;
    ctx.stroke();

    ctx.shadowBlur = 0;
  }

  function drawBomb(o) {
    const r = o.radius;

    // Pulsing red glow
    ctx.shadowBlur  = 20 + 10 * Math.sin(Date.now() * 0.006);
    ctx.shadowColor = '#FF2020';

    // Body
    const grad = ctx.createRadialGradient(-r*0.25, -r*0.25, 0, 0, 0, r);
    grad.addColorStop(0, '#3a3a3a');
    grad.addColorStop(1, '#111');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Shine
    const shine = ctx.createLinearGradient(-r, -r, 0, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0.22)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fillStyle = shine;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Fuse
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r*0.1, -r);
    ctx.quadraticCurveTo(r*0.5, -r*1.4, r*0.2, -r*1.7);
    ctx.stroke();

    // Spark
    ctx.shadowBlur  = 8;
    ctx.shadowColor = '#FF8800';
    ctx.fillStyle   = '#FFAA00';
    ctx.beginPath();
    ctx.arc(r*0.2, -r*1.7, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Skull crossbones — pure canvas, no emoji
    const sk = r * 0.32;
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#ff4444';
    ctx.strokeStyle = '#ff2222';
    ctx.lineWidth = r * 0.14;
    ctx.lineCap = 'round';
    // X cross
    ctx.beginPath(); ctx.moveTo(-sk, -sk); ctx.lineTo(sk, sk); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sk, -sk); ctx.lineTo(-sk, sk); ctx.stroke();
    // Small circle in center
    ctx.beginPath(); ctx.arc(0, 0, r*0.1, 0, Math.PI*2); ctx.fillStyle='#ff2222'; ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawHalf(h, now) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.angle);
    ctx.globalAlpha = Math.min(h.life / 0.4, 1);

    const r = h.radius;

    ctx.save();
    ctx.beginPath();
    if (h.side === 0) {
      ctx.arc(0, 0, r, Math.PI, 0); // top half
    } else {
      ctx.arc(0, 0, r, 0, Math.PI); // bottom half
    }
    ctx.closePath();
    ctx.clip();

    const img = imgCache[h.coin?.id];
    if (img) {
      ctx.drawImage(img, -r, -r, r*2, r*2);
    } else {
      const grad = ctx.createRadialGradient(-r*0.3, -r*0.3, 0, 0, 0, r);
      grad.addColorStop(0, lighten(h.coin?.color||'#888', 60));
      grad.addColorStop(1, h.coin?.color||'#888');
      ctx.fillStyle = grad;
      ctx.fillRect(-r, -r, r*2, r*2);
    }
    // Juice drip (vertical gradient overlay)
    const juice = ctx.createLinearGradient(0, -r, 0, r);
    juice.addColorStop(0, 'rgba(255,200,0,0.25)');
    juice.addColorStop(1, 'rgba(255,200,0,0)');
    ctx.fillStyle = juice;
    ctx.fillRect(-r, -r, r*2, r*2);

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawParticle(p) {
    const alpha = p.life / 0.75;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI*2);
    ctx.fillStyle = p.color;
    ctx.shadowBlur  = 10;
    ctx.shadowColor = p.color;
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;
  }

  /* ── Slice Trail ── */
  function drawTrail(now) {
    if (trail.length < 2) return;
    const recent = trail.filter(p => now - p.t < CFG.trailFadeMs);
    if (recent.length < 2) return;

    // Build a smooth path using interpolation to avoid "segment" artifacts
    // and create a tapered "comet" look.
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // Glow Pass (Outer Red heat)
    ctx.shadowBlur  = 0;
    ctx.globalCompositeOperation = 'screen';
    
    for (let i = 1; i < recent.length; i++) {
      const p1 = recent[i-1];
      const p2 = recent[i];
      const age  = (now - p2.t) / CFG.trailFadeMs;
      const alpha = (1 - age);
      const w     = (1 - age) * 22 + 4;

      // Draw segment with heavy red glow
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineWidth   = w;
      ctx.strokeStyle = `rgba(255, 30, 0, ${alpha * 0.4})`;
      ctx.stroke();
      
      // Extra fuzzy glow
      ctx.lineWidth   = w * 1.8;
      ctx.strokeStyle = `rgba(255, 50, 0, ${alpha * 0.15})`;
      ctx.stroke();
    }

    // Fire Core Pass (Yellow to Red Taper)
    for (let i = 1; i < recent.length; i++) {
      const p1 = recent[i-1];
      const p2 = recent[i];
      const age  = (now - p2.t) / CFG.trailFadeMs;
      const alpha = (1 - age);
      const w     = (1 - age) * 14 + 2;

      const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
      grad.addColorStop(0, `rgba(255, 230, 100, ${alpha})`); // Hot Yellow/White head
      grad.addColorStop(1, `rgba(255, 80, 0, ${alpha * 0.8})`); // Orange/Red tail

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineWidth   = w;
      ctx.strokeStyle = grad;
      ctx.stroke();
    }

    // Bright White Internal Core
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(recent[0].x, recent[0].y);
    for (let i = 1; i < recent.length; i++) {
      ctx.lineTo(recent[i].x, recent[i].y);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /* ═══════════════════════════════════════════
     INPUT HANDLING
  ═══════════════════════════════════════════ */
  let pointerDown = false;

  function onPointerDown(e) {
    if (isPaused || !isPlaying) return;
    pointerDown = true;
    trail.length = 0;
    const pt = getEventPos(e);
    trail.push({ x:pt.x, y:pt.y, t:performance.now() });
  }
  function onPointerUp() {
    pointerDown = false;
    trail.length = 0;
  }
  function onMouseMove(e) {
    if (!pointerDown || !isPlaying || isPaused) return;
    e.preventDefault();
    const pt = getEventPos(e);
    trail.push({ x:pt.x, y:pt.y, t:performance.now() });
    if (trail.length > CFG.trailLength) trail.shift();
  }
  function onTouchStart(e) {
    if (isPaused || !isPlaying) return;
    e.preventDefault();
    pointerDown = true;
    trail.length = 0;
    const pt = getTouchPos(e.touches[0]);
    trail.push({ x:pt.x, y:pt.y, t:performance.now() });
  }
  function onTouchMove(e) {
    if (!isPlaying || isPaused) return;
    e.preventDefault();
    const pt = getTouchPos(e.touches[0]);
    trail.push({ x:pt.x, y:pt.y, t:performance.now() });
    if (trail.length > CFG.trailLength) trail.shift();
  }
  function getEventPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function getTouchPos(t) {
    const r = canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  /* ═══════════════════════════════════════════
     DUAL LEADERBOARD & PUBLIC PROFILE
  ═══════════════════════════════════════════ */
  let lbMode = 'score'; // 'score' or 'points'

  function setLeaderboardMode(mode) {
    lbMode = mode;
    document.getElementById('btn-lb-score').style.background = mode === 'score' ? 'var(--hot-pink)' : '';
    document.getElementById('btn-lb-points').style.background = mode === 'points' ? 'var(--hot-pink)' : '';
    renderLeaderboard();
  }

  function getLeaderboard() {
    const board = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('meme_smash_profile_')) {
        const addr = key.replace('meme_smash_profile_', '');
        try {
          const profile = JSON.parse(localStorage.getItem(key));
          board.push({
            address: addr,
            name: profile.name || 'Ninja',
            topScore: profile.topScore || 0,
            points: profile.cumulativeScore || 0,
            altAddresses: profile.altAddresses || []
          });
        } catch(e) {}
      }
    }
    return board;
  }

  function renderLeaderboard() {
    let board = getLeaderboard();
    
    // Sort based on mode
    if (lbMode === 'score') {
      board.sort((a,b) => b.topScore - a.topScore);
    } else {
      board.sort((a,b) => b.points - a.points);
    }
    
    board = board.slice(0, 100);

    const list  = document.getElementById('leaderboard-list');
    list.innerHTML = '';

    if (board.length === 0) {
      list.innerHTML = '<li class="lb-empty">No scores yet!</li>';
      return;
    }

    const medals = [
      '<svg viewBox="0 0 36 40" xmlns="http://www.w3.org/2000/svg"><use href="#ico-medal1"/></svg>',
      '<svg viewBox="0 0 36 40" xmlns="http://www.w3.org/2000/svg"><use href="#ico-medal2"/></svg>',
      '<svg viewBox="0 0 36 40" xmlns="http://www.w3.org/2000/svg"><use href="#ico-medal3"/></svg>'
    ];
    board.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = i < 3 ? `rank-${i+1}` : '';
      li.style.cursor = 'pointer';
      li.onclick = () => showPublicProfile(entry.address);
      
      const val = lbMode === 'score' ? entry.topScore : entry.points;
      
      li.innerHTML = `
        <span class="lb-rank">${i+1}</span>
        <span class="lb-name">${escHtml(entry.name)}</span>
        <span class="lb-score">${val}</span>
        <span class="lb-medal">${medals[i] || ''}</span>
      `;
      list.appendChild(li);
    });
  }

  function showPublicProfile(addr) {
    const board = getLeaderboard();
    const p = board.find(x => x.address === addr);
    if (!p) return;
    document.getElementById('pub-name').textContent = p.name;
    document.getElementById('pub-score').textContent = p.topScore;
    document.getElementById('pub-points').textContent = p.points;
    document.getElementById('pub-primary').textContent = p.address;
    
    const altList = document.getElementById('pub-alt-list');
    altList.innerHTML = '';
    if (p.altAddresses.length === 0) {
      altList.innerHTML = '<div style="font-size:12px; opacity:0.5;">No additional addresses.</div>';
    } else {
      p.altAddresses.forEach(alt => {
        altList.innerHTML += `<div style="font-size:11px; font-family:monospace; margin-bottom:4px; padding:5px; background:rgba(0,0,0,0.1); border-radius:4px; border: 1px solid rgba(0,0,0,0.05);"><b>${escHtml(alt.desc)}</b>: <span style="user-select:all;">${escHtml(alt.address)}</span></div>`;
      });
    }
    
    document.getElementById('modal-public-profile').classList.add('active');
  }

  function closePublicProfile() {
    document.getElementById('modal-public-profile').classList.remove('active');
  }

  /* ═══════════════════════════════════════════
     UTILS
  ═══════════════════════════════════════════ */
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function lighten(hex, amount) {
    let c = hex.replace('#','');
    if (c.length === 3) c = c.split('').map(x=>x+x).join('');
    const r = Math.min(255, parseInt(c.slice(0,2),16)+amount);
    const g = Math.min(255, parseInt(c.slice(2,4),16)+amount);
    const b = Math.min(255, parseInt(c.slice(4,6),16)+amount);
    return `rgb(${r},${g},${b})`;
  }

  /* ═══════════════════════════════════════════
     DAILY CHECK-IN SYSTEM
  ═══════════════════════════════════════════ */

  // Day resets at 5:30 AM IST = UTC midnight (UTC+5:30 offset)
  // So we use UTC day number as our "IST day" marker
  const CHECKIN_REWARDS = [7, 15, 35, 80, 180, 400, 1000]; // Day 1–7
  const CHECKIN_EMOJIS  = ['🌟','💫','✨','🚀','🔥','💎','👑'];
  let checkinCountdownTimer = null;

  function getUtcDayNumber() {
    return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  }

  function getCheckinData(address) {
    if (!address) return { streak: 0, lastDay: -1 };
    const key = `meme_smash_checkin_${address.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : { streak: 0, lastDay: -1 };
  }

  function saveCheckinData(address, data) {
    if (!address) return;
    const key = `meme_smash_checkin_${address.toLowerCase()}`;
    localStorage.setItem(key, JSON.stringify(data));
  }

  function getCheckinStatus(address) {
    const today = getUtcDayNumber();
    const data  = getCheckinData(address);
    const alreadyCheckedIn = data.lastDay === today;
    // Streak continues only if last check-in was YESTERDAY; otherwise broken
    const streakAlive = data.lastDay === (today - 1);
    const currentStreak = streakAlive || alreadyCheckedIn ? data.streak : 0;
    return { today, alreadyCheckedIn, currentStreak, lastDay: data.lastDay };
  }

  function msUntilNextCheckin() {
    const now = Date.now();
    const nextMidnightUTC = (getUtcDayNumber() + 1) * 24 * 60 * 60 * 1000;
    return Math.max(0, nextMidnightUTC - now);
  }

  function formatCountdown(ms) {
    if (ms <= 0) return 'Available now!';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  }

  function showCheckinModal() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { alert('Connect your wallet first!'); return; }
    renderCheckinModal(addr);
    document.getElementById('modal-checkin').classList.add('active');
    startCheckinCountdown(addr);
  }

  function closeCheckinModal() {
    document.getElementById('modal-checkin').classList.remove('active');
    if (checkinCountdownTimer) { clearInterval(checkinCountdownTimer); checkinCountdownTimer = null; }
  }

  function startCheckinCountdown(addr) {
    if (checkinCountdownTimer) clearInterval(checkinCountdownTimer);
    checkinCountdownTimer = setInterval(() => {
      renderCheckinModal(addr);
    }, 1000);
  }

  function renderCheckinModal(addr) {
    const { today, alreadyCheckedIn, currentStreak, lastDay } = getCheckinStatus(addr);
    const nextDayIndex = Math.min(currentStreak, 6); // which reward comes next (0-indexed)
    const msLeft = msUntilNextCheckin();
    const canCheckin = !alreadyCheckedIn;

    // Render day tiles
    const grid = document.getElementById('checkin-day-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const dayNum   = i + 1;
      const reward   = CHECKIN_REWARDS[i];
      const emoji    = CHECKIN_EMOJIS[i];
      const isDone   = i < currentStreak;
      const isToday  = i === currentStreak && canCheckin;
      const isFuture = !isDone && !isToday;

      const tile = document.createElement('div');
      tile.className = 'ci-tile' + (isDone ? ' ci-done' : '') + (isToday ? ' ci-today' : '') + (isFuture ? ' ci-future' : '');
      tile.innerHTML = `
        <div class="ci-day">Day ${dayNum}</div>
        <div class="ci-emoji">${isDone ? '✅' : emoji}</div>
        <div class="ci-pts">${reward}<span class="ci-mp">MP</span></div>
      `;
      grid.appendChild(tile);
    }

    // Streak label
    const streakEl = document.getElementById('ci-streak-label');
    if (streakEl) {
      if (currentStreak === 0) {
        streakEl.textContent = 'Start your streak! 🌱';
      } else if (currentStreak >= 7) {
        streakEl.textContent = '🏆 7-Day Champion! Streak resets now!';
      } else {
        streakEl.textContent = `🔥 ${currentStreak}-Day Streak!`;
      }
    }

    // Countdown / CTA
    const btnEl = document.getElementById('ci-btn');
    const cdEl  = document.getElementById('ci-countdown');
    const rewardEl = document.getElementById('ci-next-reward');
    if (currentStreak >= 7 && !canCheckin) {
      // Full cycle done, show restart info
      if (rewardEl) rewardEl.textContent = `Next streak starts tomorrow — Day 1 (7 MP)`;
      if (cdEl) cdEl.textContent = formatCountdown(msLeft);
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '✅ Full Streak Complete!'; }
    } else if (canCheckin) {
      const idx = Math.min(currentStreak, 6);
      if (rewardEl) rewardEl.textContent = `Today's reward: ${CHECKIN_REWARDS[idx]} MP ${CHECKIN_EMOJIS[idx]}`;
      if (cdEl) cdEl.textContent = '';
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = `Check In — $0.01 on Base`; }
    } else {
      const idx = Math.min(currentStreak, 6);
      if (rewardEl) rewardEl.textContent = `Next: Day ${currentStreak + 1} — ${CHECKIN_REWARDS[idx]} MP ${CHECKIN_EMOJIS[idx]}`;
      if (cdEl) cdEl.textContent = `Next check-in in: ${formatCountdown(msLeft)}`;
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = '✅ Checked In Today!'; }
    }
  }

  async function doCheckin() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { alert('Connect your wallet first!'); return; }

    const { today, alreadyCheckedIn, currentStreak } = getCheckinStatus(addr);
    if (alreadyCheckedIn) { alert('Already checked in today! Come back tomorrow.'); return; }

    const btn = document.getElementById('ci-btn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
      await Web3.payForDailyCheckin();

      // Determine new streak
      const data = getCheckinData(addr);
      const lastDay = data.lastDay;
      let newStreak;
      if (lastDay === today - 1) {
        // Consecutive day
        newStreak = (data.streak >= 7) ? 1 : data.streak + 1;
      } else {
        // Broken or first time
        newStreak = 1;
      }

      saveCheckinData(addr, { streak: newStreak, lastDay: today });

      // Award meme points
      const rewardIdx = newStreak - 1; // 0-indexed
      const pts = CHECKIN_REWARDS[Math.min(rewardIdx, 6)];
      const profile = getProfileData(addr);
      profile.cumulativeScore = (profile.cumulativeScore || 0) + pts;
      saveProfileData(addr, profile);
      refreshProfileUI(addr);

      btn.textContent = `🎉 +${pts} Meme Points!`;
      renderCheckinModal(addr);

      setTimeout(() => {
        btn.textContent = origText;
        renderCheckinModal(addr);
      }, 3000);

    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = 'Payment Failed — Try Again';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2500);
    }
  }

  /* ═══════════════════════════════════════════
     EXPORT PUBLIC API
  ═══════════════════════════════════════════ */
  return { 
    init, 
    startGame, 
    restartGame, 
    showLeaderboard, 
    goHome, 
    toggleSettings, 
    resumeGame, 
    toggleMute, 
    goHomeFromPause,
    handleWalletAction,
    updatePlayButtonState,
    reviveMenu,
    submitScoreMenu,
    showProfile,
    saveProfileName,
    addAlternativeAddress,
    removeAlternativeAddress,
    copyAddress,
    setLeaderboardMode,
    showPublicProfile,
    closePublicProfile,
    showCheckinModal,
    closeCheckinModal,
    doCheckin,
  };

})();

window.Game = Game;
window.addEventListener('DOMContentLoaded', () => {
  Game.init();
  // Periodically check wallet state as a fallback
  setInterval(Game.updatePlayButtonState, 2000);
});
