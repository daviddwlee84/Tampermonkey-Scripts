/* Local-only deterministic clock. It never replaces browser-wide time or random APIs. */
(function () {
  'use strict';
  const DT = 1000 / 60;
  let randomState = 20160324,
    nextId = 0,
    frame = 0,
    budget = 0,
    last = 0;
  const callbacks = new Map();
  const lab = (window.DinoLab = {
    version: 'wayou-5455bfa+lab-1',
    now: 1000,
    rate: 1,
    paused: false,
    frames: 0,
    actualRate: 0,
    seed: 20160324,
    obstacleLog: [],
    requestFrame(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      callbacks.delete(id);
    },
    random() {
      randomState |= 0;
      randomState = (randomState + 0x6d2b79f5) | 0;
      let t = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    randomInt(min, max) {
      return Math.floor(lab.random() * (max - min + 1)) + min;
    },
    setRate(value) {
      if ([1, 2, 5, 10, 20].includes(Number(value))) lab.rate = Number(value);
    },
    pause(value = true) {
      lab.paused = !!value;
      budget = 0;
      last = 0;
    },
    reset(seed = lab.seed) {
      const r = window.Runner?.instance_;
      if (!r?.tRex) throw new Error('遊戲還沒載入');
      r.stop();
      callbacks.clear();
      frame = 0;
      budget = 0;
      last = 0;
      lab.seed = Number(seed) >>> 0;
      randomState = lab.seed;
      lab.now = 1000;
      lab.frames = 0;
      lab.obstacleLog = [];
      r.activated = true;
      r.playingIntro = false;
      r.paused = false;
      r.horizon.obstacleHistory = [];
      r.tRex.xPos = r.tRex.config.START_X_POS;
      r.restart();
      lab.paused = false;
      document.getElementById('main-message').hidden = true;
      document.dispatchEvent(new Event('dino-lab-reset'));
    },
    step(count = 1) {
      for (let i = 0; i < count; i++) {
        lab.now = 1000 + ++frame * DT;
        lab.frames = frame;
        document.dispatchEvent(new Event('dino-lab-before-step'));
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback(lab.now);
        const r = window.Runner?.instance_;
        for (const obstacle of r?.horizon?.obstacles || []) {
          if (!seen.has(obstacle)) {
            seen.add(obstacle);
            lab.obstacleLog.push({
              frame,
              type: obstacle.typeConfig.type,
              x: obstacle.xPos,
              y: obstacle.yPos,
              width: obstacle.width,
              gap: obstacle.gap,
              speedOffset: obstacle.speedOffset,
            });
          }
        }
        document.dispatchEvent(new Event('dino-lab-after-step'));
      }
    },
  });
  const seen = new WeakSet();
  let measureTime = 0,
    measureFrame = 0;
  function pump(time) {
    const elapsed = last ? Math.min(100, time - last) : 0;
    last = time;
    if (!lab.paused && !document.hidden) {
      budget = Math.min(budget + elapsed * lab.rate, 2000);
      const deadline = performance.now() + 9;
      while (budget + 1e-8 >= DT && performance.now() < deadline) {
        budget -= DT;
        lab.step();
      }
    }
    if (time - measureTime > 500) {
      lab.actualRate = (Math.max(0, frame - measureFrame) * DT) / Math.max(1, time - measureTime);
      measureTime = time;
      measureFrame = frame;
    }
    window.requestAnimationFrame(pump);
  }
  window.requestAnimationFrame(pump);
  document.addEventListener('visibilitychange', () => {
    budget = 0;
    last = 0;
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event
          .composedPath()
          .some(
            (el) => el?.id === 'dino-ai-lab-ui' || /^(INPUT|SELECT|TEXTAREA)$/.test(el?.tagName)
          )
      )
        return;
      const r = window.Runner?.instance_;
      if (
        (event.code === 'Space' || event.code === 'ArrowUp') &&
        r?.tRex &&
        (!r.activated || r.crashed)
      )
        lab.reset(lab.seed);
    },
    true
  );
})();
