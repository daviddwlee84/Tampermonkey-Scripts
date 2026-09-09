// ==UserScript==
// @name         Little Dino AI Lab
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.1.0
// @description  保留 2016 恐龍 AI，加入預測策略、浮動調參、離線加速與可重現 A/B 實驗
// @author       Da-Wei Lee
// @license      MIT AND BSD-3-Clause
// @match        https://chromedino.com/*
// @match        https://wayou.github.io/t-rex-runner/*
// @match        http://127.0.0.1/dino/*
// @match        http://localhost/dino/*
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23263d36'/%3E%3Ctext x='9' y='47' font-size='42'%3E🦖%3C/text%3E%3C/svg%3E
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/dino-ai-lab/dino-ai-lab.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/dino-ai-lab/dino-ai-lab.user.js
// ==/UserScript==

/* Chromium-derived collision geometry and jump physics:
 * Copyright (c) 2014 The Chromium Authors. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * 3. Neither the name of Google Inc. nor the names of its contributors may be
 *    used to endorse or promote products derived from this software without
 *    specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

(function () {
  'use strict';
  // BEGIN DINO CORE — tested directly from this delivered file.
  const Core = (() => {
    const DT = 1000 / 60;
    const DEFAULTS = { margin: 4, latency: 33, earlyRelease: true, fastDrop: true };
    // Collision geometry and jump integration derived from Chromium / Wayou.
    // Copyright (c) 2014 The Chromium Authors. BSD-3-Clause; full notice in LICENSE.chromium.
    const BOXES = {
      running: [
        [22, 0, 17, 16],
        [1, 18, 30, 9],
        [10, 35, 14, 8],
        [1, 24, 29, 5],
        [5, 30, 21, 4],
        [9, 34, 15, 4],
      ],
      ducking: [[1, 18, 55, 25]],
    };
    const clamp = (v, lo, hi, fallback) =>
      Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback;
    function settings(value = {}) {
      return {
        margin: clamp(value.margin, 0, 20, 4),
        latency: clamp(value.latency, 0, 200, 33),
        earlyRelease: value.earlyRelease !== false,
        fastDrop: value.fastDrop !== false,
      };
    }
    function snapshot(r) {
      const t = r.tRex;
      return {
        speed: r.currentSpeed,
        acceleration: r.config.ACCELERATION,
        maxSpeed: r.config.MAX_SPEED,
        trex: {
          x: t.xPos,
          y: t.yPos,
          ground: t.groundYPos,
          minHeight: t.minJumpHeight,
          jumping: t.jumping,
          ducking: t.ducking,
          velocity: t.jumpVelocity,
          reachedMin: t.reachedMinHeight,
          speedDrop: t.speedDrop,
          config: { ...t.config },
        },
        obstacles: (r.horizon.obstacles || []).map((o) => ({
          x: o.xPos,
          y: o.yPos,
          width: o.width ?? o.typeConfig.width * (o.size || 1),
          height: o.typeConfig.height,
          typeWidth: o.typeConfig.width,
          speedOffset: o.typeConfig.speedOffset ? o.speedOffset : 0,
          type: o.typeConfig.type,
          boxes: (o.collisionBoxes || []).map((b) => [b.x, b.y, b.width, b.height]),
        })),
      };
    }
    function legacy(s) {
      const t = s.trex,
        actions = [];
      if (!t.jumping) {
        const obstacle = s.obstacles.find((o) => o.x >= t.x + t.config.WIDTH);
        if (!obstacle) return { actions, reason: '2016：前方沒有障礙物' };
        const first = s.obstacles[0];
        const shouldDuck = first.y + first.height < 150 - 25;
        if ((shouldDuck && !t.ducking) || (!shouldDuck && t.ducking))
          actions.push({ type: 'duck', value: shouldDuck });
        if (shouldDuck) return { actions, reason: '2016：依第一個障礙物高度蹲下' };
        if (t.y < obstacle.y + obstacle.height && t.config.HEIGHT + t.y > obstacle.y) {
          const factor = (obstacle.x + obstacle.typeWidth + obstacle.height) / s.speed;
          if (factor <= 30) actions.push({ type: 'jump' });
          return { actions, reason: `2016：jumpFactor ${factor.toFixed(1)} / 30` };
        }
      } else if (s.obstacles.length) {
        const obstacle = s.obstacles[0];
        if (t.x > obstacle.x + obstacle.typeWidth && !t.speedDrop) actions.push({ type: 'drop' });
      }
      return { actions, reason: '2016：保持目前動作' };
    }
    function overlap(a, b) {
      return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
    }
    function collides(t, o, margin = 0) {
      // Match the engine's outer broad phase, including its fixed duck width.
      const outerT = [
        t.x + 1 - margin,
        t.y + 1,
        t.config.WIDTH - 2 + margin * 2,
        t.config.HEIGHT - 2,
      ];
      const outerO = [o.x + 1, o.y + 1, o.width - 2, o.height - 2];
      if (!overlap(outerT, outerO)) return false;
      for (const a of t.ducking ? BOXES.ducking : BOXES.running) {
        for (const b of o.boxes) {
          if (
            overlap(
              [t.x + 1 + a[0] - margin, t.y + 1 + a[1], a[2] + margin * 2, a[3]],
              [o.x + 1 + b[0], o.y + 1 + b[1], b[2], b[3]]
            )
          )
            return true;
        }
      }
      return false;
    }
    function jump(t, speed) {
      t.ducking = false;
      t.jumping = true;
      t.reachedMin = false;
      t.speedDrop = false;
      t.velocity = t.config.INIITAL_JUMP_VELOCITY - speed / 10;
    }
    function release(t) {
      if (t.reachedMin && t.velocity < t.config.DROP_VELOCITY) t.velocity = t.config.DROP_VELOCITY;
    }
    function advanceTrex(t) {
      if (!t.jumping) return;
      t.y += Math.round(t.velocity * (t.speedDrop ? t.config.SPEED_DROP_COEFFICIENT : 1));
      t.velocity += t.config.GRAVITY;
      if (t.y < t.minHeight || t.speedDrop) t.reachedMin = true;
      if (t.y < t.config.MAX_JUMP_HEIGHT || t.speedDrop) release(t);
      if (t.y > t.ground) {
        t.y = t.ground;
        t.velocity = 0;
        t.jumping = false;
        t.ducking = false;
        t.speedDrop = false;
      }
    }
    function rollout(
      s,
      {
        delay = -1,
        releaseAfter = Infinity,
        initial = 'hold',
        frames = 90,
        margin = 0,
        untilLanding = false,
        target = -1,
      } = {}
    ) {
      const t = { ...s.trex },
        obstacles = s.obstacles.map((o) => ({ ...o }));
      let speed = s.speed,
        launched = t.jumping,
        jumpFrames = 0;
      const trajectory = [];
      if (initial === 'duck') t.ducking = true;
      if (initial === 'stand') t.ducking = false;
      if (initial === 'release') release(t);
      if (initial === 'drop') {
        t.speedDrop = true;
        t.velocity = 1;
      }
      for (let i = 0; i < frames; i++) {
        if (i === delay && !t.jumping) {
          jump(t, speed);
          launched = true;
        }
        if (t.jumping && jumpFrames++ >= releaseAfter) release(t);
        advanceTrex(t);
        for (const o of obstacles) o.x -= Math.floor(speed + (o.speedOffset || 0));
        const hit = obstacles.findIndex((o) => collides(t, o, margin));
        trajectory.push({ x: t.x, y: t.y, time: (i + 1) * DT });
        if (hit >= 0) return { safe: false, hit, frame: i, trajectory };
        if (speed < s.maxSpeed) speed += s.acceleration;
        if (untilLanding && launched && !t.jumping) {
          const passed = target < 0 || obstacles[target].x + obstacles[target].width < t.x;
          return { safe: passed, frame: i, trajectory, landed: true };
        }
      }
      return { safe: !untilLanding, frame: frames, trajectory };
    }
    function predictive(s, raw) {
      const p = settings(raw),
        t = s.trex;
      const actions = [],
        pass = (reason, result) => ({ actions, reason, trajectory: result?.trajectory || [] });
      if (t.jumping) {
        const target = s.obstacles.findIndex(
          (o) => o.x + o.width >= t.x && o.x < t.x + t.config.WIDTH + 180
        );
        if (
          p.fastDrop &&
          !t.speedDrop &&
          !s.obstacles.some((o) => o.x < t.x + t.config.WIDTH && o.x + o.width >= t.x)
        ) {
          const drop = rollout(s, {
            initial: 'drop',
            untilLanding: true,
            target,
            margin: p.margin,
          });
          if (drop.safe) {
            actions.push({ type: 'drop' });
            return pass('預測：落點安全，加速落地', drop);
          }
        }
        if (p.earlyRelease && t.reachedMin && t.velocity < t.config.DROP_VELOCITY) {
          const short = rollout(s, {
            initial: 'release',
            untilLanding: true,
            target,
            margin: p.margin,
          });
          if (short.safe) {
            actions.push({ type: 'release' });
            return pass('預測：縮短跳躍仍可通過', short);
          }
        }
        return pass('預測：保持跳躍', rollout(s, { untilLanding: true, margin: p.margin }));
      }
      const standing = rollout(s, { initial: 'stand', margin: p.margin });
      if (standing.safe) {
        if (t.ducking) actions.push({ type: 'duck', value: false });
        return pass('預測：前方安全', standing);
      }
      const target = standing.hit;
      const obstacle = s.obstacles[target];
      const clearFrames = Math.min(
        90,
        Math.ceil(
          (obstacle.x + obstacle.width - t.x) / Math.max(1, s.speed + obstacle.speedOffset)
        ) + 2
      );
      const duck = rollout(s, { initial: 'duck', frames: clearFrames, margin: p.margin });
      if (duck.safe) {
        if (!t.ducking) actions.push({ type: 'duck', value: true });
        return pass('預測：蹲下可通過飛鳥', duck);
      }
      if (t.ducking) actions.push({ type: 'duck', value: false });
      // Search from the latest start backwards. Sampling uses the same 60 Hz physics.
      const maxDelay = Math.min(60, standing.frame);
      const releases = p.earlyRelease ? [Infinity, 8, 12, 16] : [Infinity];
      let latest = null,
        selected = null;
      const compensation = Math.ceil(p.latency / DT);
      for (let delay = maxDelay; delay >= 0; delay--) {
        for (const releaseAfter of releases) {
          const result = rollout(s, {
            delay,
            releaseAfter,
            initial: 'stand',
            untilLanding: true,
            target,
            margin: p.margin,
          });
          if (result.safe) {
            if (!latest) latest = { delay, result };
            selected = { delay, result };
            break;
          }
        }
        if (latest && (delay <= latest.delay - compensation || delay === 0)) break;
      }
      if (selected) {
        if (selected.delay <= 1) actions.push({ type: 'jump' });
        return pass(
          selected.delay <= 1
            ? '預測：進入安全起跳窗口'
            : `預測：約 ${Math.round(selected.delay * DT)} ms 後起跳`,
          selected.result
        );
      }
      if (p.margin > 0) return predictive(s, { ...p, margin: 0 });
      if (standing.frame <= 12) actions.push({ type: 'jump' });
      return pass('預測：沒有完整安全窗口，嘗試避讓', standing);
    }
    const strategies = {
      legacy: {
        id: 'legacy',
        name: '2016 原版',
        version: '2016.03.24',
        interval: 33,
        decide: legacy,
      },
      predictive: {
        id: 'predictive',
        name: 'Predictive AI',
        version: '1',
        interval: DT,
        decide: predictive,
      },
    };
    function summarize(records) {
      const valid = records.filter((r) => !r.mixed && ['crash', 'limit'].includes(r.end));
      const scores = valid.map((r) => r.score).sort((a, b) => a - b),
        n = scores.length;
      return {
        count: n,
        average: n ? scores.reduce((a, b) => a + b, 0) / n : 0,
        median: n ? (scores[Math.floor((n - 1) / 2)] + scores[Math.floor(n / 2)]) / 2 : 0,
        best: n ? scores[n - 1] : 0,
      };
    }
    return {
      DT,
      DEFAULTS,
      BOXES,
      settings,
      snapshot,
      legacy,
      predictive,
      strategies,
      collides,
      advanceTrex,
      rollout,
      summarize,
    };
  })();
  // END DINO CORE

  const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
  if (
    window.top !== window.self ||
    (location.hostname === 'chromedino.com' && location.pathname !== '/')
  )
    return;
  if (document.getElementById('dino-ai-lab-ui')) return;
  const KEY = 'dinoAiLab.v1',
    RECORD_KEY = 'dinoAiLab.records.v1';
  const read = (key, fallback) => {
    try {
      return GM_getValue(key, fallback);
    } catch {
      return fallback;
    }
  };
  const stored = read(KEY, {});
  const config = {
    strategy: stored.strategy === 'predictive' ? 'predictive' : 'legacy',
    params: Core.settings(stored.params),
    timing: stored.timing === 'next' ? 'next' : 'now',
    enabled: stored.enabled !== false,
    autoRestart: stored.autoRestart === true,
    restartDelay: Math.min(30000, Math.max(100, Number(stored.restartDelay) || 1000)),
    info: Object.fromEntries(
      ['metrics', 'reason', 'boxes', 'trajectory', 'stats'].map((k) => [
        k,
        stored.info?.[k] === true,
      ])
    ),
    presets: Array.isArray(stored.presets)
      ? stored.presets
          .filter((p) => typeof p.id === 'string' && typeof p.name === 'string')
          .slice(0, 40)
          .map((p) => ({ id: p.id, name: p.name.slice(0, 60), params: Core.settings(p.params) }))
      : [],
    right: Math.max(12, Number(stored.right) || 24),
    bottom: Math.max(12, Number(stored.bottom) || 24),
  };
  let records = read(RECORD_KEY, []);
  if (!Array.isArray(records)) records = [];
  records = records
    .filter((r) => r && typeof r.id === 'string' && Number.isFinite(r.score))
    .slice(-1000);
  let r = null,
    lab = null,
    active = { strategy: config.strategy, params: { ...config.params } },
    pending = null;
  let record = null,
    batch = null,
    lastBatch = null,
    restartTimer = 0,
    nextDecision = null;
  let decision = { reason: '等待遊戲', actions: [] },
    opened = false,
    internalReset = false,
    error = '';
  let stopped = false,
    animation = 0,
    probeTimer = 0,
    probeCount = 0;
  const host = document.createElement('div');
  host.id = 'dino-ai-lab-ui';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.append(host);
  shadow.innerHTML = `
    <style>
      :host { all: initial; color-scheme: light dark; --bg:#fcfcf7; --ink:#243e34; --muted:#687b6b; --line:#dce4d5; --soft:#edf2e6; --accent:#2c7250; font:14px/1.55 system-ui,sans-serif; }
      * { box-sizing:border-box; } button,input,select { font:inherit; } button,select { cursor:pointer; }
      button { border:1px solid var(--line); border-radius:9px; padding:7px 12px; background:var(--bg); color:var(--ink); }
      button:hover { background:var(--soft); } button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid #6daa70; outline-offset:2px; }
      button:disabled,input:disabled,select:disabled { opacity:.45; cursor:default; }
      .primary { background:var(--accent); border-color:var(--accent); color:white; } .primary:hover { background:#3b825f; }
      #toggle { position:fixed; width:56px; height:56px; padding:0; font-size:29px; border-radius:18px; background:#263d36; border-color:#406051; color:white; box-shadow:0 5px 20px #102a3326; z-index:2147483646; touch-action:none; }
      #toggle::after { content:''; position:absolute; right:5px; top:5px; width:8px; height:8px; border-radius:50%; background:#f0b46a; }
      #toggle[data-running=true]::after { background:#96d57a; }
      #panel { position:fixed; width:min(430px,calc(100vw - 24px)); max-height:calc(100vh - 94px); overflow:auto; border:1px solid var(--line); border-radius:18px; background:var(--bg); color:var(--ink); box-shadow:0 12px 56px #1b372933; z-index:2147483646; }
      [hidden] { display:none!important; } .top { padding:20px 20px 12px; display:flex; align-items:start; justify-content:space-between; gap:8px; }
      h2 { margin:2px 0; font-size:21px; letter-spacing:-.5px; } .eyebrow { font:10px ui-monospace,monospace; letter-spacing:2px; color:var(--muted); }
      .muted,small { color:var(--muted); } #status { font-size:12px; min-height:20px; }
      nav { display:flex; padding:0 16px; border-bottom:1px solid var(--line); gap:4px; } nav button { border:0; border-radius:0; padding:10px 12px; color:var(--muted); background:none; }
      nav button[aria-selected=true] { color:var(--ink); border-bottom:2px solid var(--accent); }
      section { padding:18px 20px; } label { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:10px 0; }
      input:not([type=checkbox]),select { border:1px solid var(--line); border-radius:8px; padding:6px 8px; color:var(--ink); background:var(--bg); min-width:0; max-width:220px; }
      input[type=number] { width:105px; } input[type=checkbox] { accent-color:var(--accent); width:17px; height:17px; }
      .row { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin:12px 0; } .row input { flex:1; } .row select { flex:1; }
      details { border-top:1px solid var(--line); padding:12px 0 0; margin-top:16px; } summary { cursor:pointer; font-weight:600; }
      #pending,#error { font-size:12px; padding:8px 10px; border-radius:8px; margin-top:10px; background:#fff0d5; color:#765121; }
      .metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:14px 0; }
      .metric { background:var(--soft); border-radius:10px; padding:10px; } .metric b { font:21px ui-monospace,monospace; display:block; }
      #reason { font-size:12px; border-left:3px solid var(--accent); padding:7px 10px; background:var(--soft); }
      progress { width:100%; accent-color:var(--accent); } table { border-collapse:collapse; width:100%; font-size:11px; } th,td { text-align:left; border-bottom:1px solid var(--line); padding:6px 4px; }
      .scroll { max-height:210px; overflow:auto; } p { margin:10px 0; } a { color:var(--accent); } .foot { padding:10px 20px; font-size:10px; color:var(--muted); border-top:1px solid var(--line); }
      @media(prefers-color-scheme:dark) { :host { --bg:#192721; --ink:#e0ead7; --muted:#9daf9f; --line:#35473a; --soft:#25382b; --accent:#38805b; } }
    </style>
    <button id="toggle" title="Little Dino AI Lab（可拖曳）" aria-label="開啟恐龍 AI 控制台" aria-expanded="false">🦖</button>
    <div id="panel" hidden>
      <div class="top"><div><div class="eyebrow">2016 → NEXT JUMP</div><h2>Little Dino AI Lab</h2><div id="status">正在尋找遊戲…</div></div><button id="close" aria-label="關閉面板">×</button></div>
      <nav role="tablist"><button data-tab="control" role="tab" aria-selected="true">控制</button><button data-tab="experiment" role="tab" aria-selected="false">實驗</button><button data-tab="history" role="tab" aria-selected="false">紀錄</button><button data-tab="about" role="tab" aria-selected="false">原作</button></nav>
      <section data-section="control">
        <label>AI 策略<select id="strategy"><option value="legacy">2016 原版</option><option value="predictive">Predictive AI</option></select></label>
        <div class="row"><button id="start" class="primary">開始 / 重開</button><button id="enable">切換手動</button><button id="retry">重新偵測</button></div>
        <label>調整套用時機<select id="timing"><option value="now">立即套用</option><option value="next">下一局套用</option></select></label>
        <div id="pending" hidden>設定將於下一局套用</div>
        <div id="error" hidden></div>
        <label><span>死亡後自動重開</span><input id="autoRestart" type="checkbox" /></label>
        <label>重開等待（ms）<input id="restartDelay" type="number" min="100" max="30000" step="100" /></label>
        <div id="local-speed" hidden><label>本地遊戲倍率<select id="rate"><option>1</option><option>2</option><option>5</option><option>10</option><option>20</option></select></label><small id="actual-rate"></small><div class="row"><button id="pause">暫停 / 繼續</button></div></div>
        <details id="parameters"><summary>策略參數與預設</summary><p id="legacy-note" class="muted">原版維持 33 ms 更新與 jumpFactor ≤ 30；歷史決策參數唯讀。</p>
          <div id="predictive-parameters"><label>安全邊界（px）<input id="margin" type="number" min="0" max="20" step="1" /></label><label>延遲補償（ms）<input id="latency" type="number" min="0" max="200" step="1" /></label><label>提早收跳<input id="earlyRelease" type="checkbox" /></label><label>安全快速落地<input id="fastDrop" type="checkbox" /></label><button id="reset-params">還原預設參數</button></div>
          <label>儲存的 Predictive 預設<select id="preset"><option value="">選擇預設…</option></select></label>
          <input id="preset-name" type="text" placeholder="預設名稱" maxlength="60" aria-label="預設名稱" />
          <div class="row"><button id="save-preset">儲存副本</button><button id="load-preset">套用</button><button id="rename-preset">改名</button><button id="delete-preset">刪除</button></div>
        </details>
        <details><summary>資訊顯示</summary><label>即時數值<input type="checkbox" data-info="metrics" /></label><label>決策原因<input type="checkbox" data-info="reason" /></label><label>碰撞框<input type="checkbox" data-info="boxes" /></label><label>預測軌跡<input type="checkbox" data-info="trajectory" /></label><label>成績統計<input type="checkbox" data-info="stats" /></label></details>
        <div id="metrics" class="metrics" hidden><div class="metric"><small>分數</small><b id="score">0</b></div><div class="metric"><small>速度</small><b id="speed">0</b></div><div class="metric"><small>遊戲秒數</small><b id="elapsed">0</b></div></div><div id="reason" hidden></div><div id="stats" hidden></div>
      </section>
      <section data-section="experiment" hidden><p id="experiment-note" class="muted">可重現 A/B 僅供本地固定版本使用。</p>
        <fieldset id="batch-fields" style="border:0;padding:0;margin:0"><label>策略 A<select id="variant-a"></select></label><label>策略 B<select id="variant-b"></select></label><label>基底種子<input id="seed" type="number" min="0" max="4294967295" value="20160324" /></label><label>配對局數<input id="rounds" type="number" min="1" max="100" value="10" /></label><label>每局上限（遊戲秒）<input id="limit" type="number" min="10" max="600" value="180" /></label><label>實驗倍率<select id="batch-rate"><option>1</option><option>2</option><option>5</option><option selected>10</option><option>20</option></select></label></fieldset>
        <div class="row"><button id="batch-start" class="primary">開始 A/B</button><button id="batch-cancel" disabled>取消實驗</button></div><progress id="progress" value="0" max="1"></progress><p id="batch-status" class="muted">尚未開始</p><div id="batch-summary"></div><div class="scroll" id="pairs"></div><div class="row"><button id="batch-json">匯出實驗 JSON</button><button id="batch-csv">匯出實驗 CSV</button></div>
      </section>
      <section data-section="history" hidden><p class="muted">保留最近 1,000 局。網站、引擎、策略與參數分組；混合局及取消局不納入平均。</p><div id="history-summary"></div><div class="scroll" id="history"></div><div class="row"><button id="export-json">匯出 JSON</button><button id="export-csv">匯出 CSV</button><button id="clear-history">清除紀錄</button></div><button id="reset-settings">還原控制台設定</button></section>
      <section data-section="about" hidden><div class="eyebrow">HACKATHON / ~2016.03.24</div><h2>Google Little Dinosaur AI</h2><p>從大學 Hackathon 的 Developer Console 程式開始：讀取障礙物、蹲下、跳躍，再加速落地。</p><p>2016 策略保留原判斷，包括第一個障礙物的選取方式、固定提前量與單株寬度。這些局限也是比較的一部分。</p><p>新版從遊戲資料讀取碰撞框並預測跳躍，不需要影像辨識模型。實驗結果以實測為準。</p><p class="muted">歷史原檔與 Arduino 空白段落保存在腳本 history 目錄。介面和啟停相容層不屬於歷史決策。</p><a href="https://github.com/daviddwlee84/Tampermonkey-Scripts/tree/main/userscripts/dino-ai-lab" target="_blank" rel="noopener noreferrer">原始碼與說明 ↗</a></section>
      <div class="foot">v0.1.0 · 本機保存設定與紀錄 · Esc 關閉</div>
    </div>`;
  const $ = (id) => shadow.getElementById(id);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  function save() {
    try {
      GM_setValue(KEY, copy(config));
    } catch {
      fail('設定儲存失敗，這次調整仍會在目前分頁生效');
    }
  }
  function fail(message) {
    error = message;
    $('error').textContent = message;
    $('error').hidden = !message;
  }
  function phase() {
    if (!r) return 'missing';
    if (r.crashed) return 'crashed';
    if (lab?.paused) return 'paused';
    if ('playing' in r) return r.playing ? 'running' : r.activated ? 'paused' : 'waiting';
    return r.activated ? (r.isRunning() ? 'running' : 'paused') : 'waiting';
  }
  function gameVersion() {
    return lab?.version || `${location.hostname}:classic-adapter-1`;
  }
  function score() {
    return r ? r.distanceMeter.getActualDistance(Math.ceil(r.distanceRan)) : 0;
  }
  function selectedSpec() {
    return { strategy: config.strategy, params: { ...config.params } };
  }
  function handoff() {
    nextDecision = null;
    if (r?.tRex.ducking) r.tRex.setDuck(false);
    decision = { actions: [], reason: '策略已切換，等待下一幀' };
  }
  function applySpec() {
    if (batch) return;
    if (record && config.timing === 'next') pending = selectedSpec();
    else {
      const next = selectedSpec();
      if (record && JSON.stringify(next) !== JSON.stringify(active)) record.mixed = true;
      active = next;
      pending = null;
      handoff();
    }
    save();
    syncControls();
  }
  function beginRecord() {
    if (record || phase() !== 'running') return;
    if (pending && !batch) {
      active = pending;
      pending = null;
      handoff();
    }
    record = {
      id: uid(),
      batchId: batch?.id || null,
      pair: batch ? Math.floor(batch.index / 2) + 1 : null,
      side: batch ? (batch.index % 2 ? 'B' : 'A') : null,
      label:
        config.enabled || batch
          ? batch?.variants[batch.index % 2]?.name || Core.strategies[active.strategy].name
          : '手動',
      site: location.origin + location.pathname,
      engine: gameVersion(),
      gameConfig: {
        speed: r.config.SPEED,
        maxSpeed: r.config.MAX_SPEED,
        acceleration: r.config.ACCELERATION,
        gravity: r.tRex.config.GRAVITY,
        width: r.dimensions.WIDTH,
      },
      strategy: config.enabled || batch ? active.strategy : 'manual',
      strategyVersion:
        config.enabled || batch ? Core.strategies[active.strategy].version : 'manual-1',
      params: active.strategy === 'predictive' ? { ...active.params } : null,
      seed: lab ? lab.seed : null,
      startedAt: new Date().toISOString(),
      mixed: false,
      score: 0,
      seconds: 0,
      end: null,
    };
    nextDecision = null;
  }
  function finishRecord(end) {
    if (!record) return;
    record.score = score();
    record.seconds = Math.round(r.runningTime / 10) / 100;
    record.end = end;
    record.finishedAt = new Date().toISOString();
    if (lab) record.obstacles = copy(lab.obstacleLog);
    records.push(record);
    records = records.slice(-1000);
    if (batch) batch.results.push(copy(record));
    record = null;
    try {
      GM_setValue(RECORD_KEY, records);
    } catch {
      fail('成績儲存失敗，請先匯出目前紀錄');
    }
    renderHistory();
  }
  function startRun() {
    if (!r) return fail('尚未找到相容遊戲，請按重新偵測');
    clearTimeout(restartTimer);
    restartTimer = 0;
    if (record) finishRecord('restart');
    if (!batch) {
      active = pending || selectedSpec();
      pending = null;
    }
    handoff();
    fail('');
    internalReset = true;
    try {
      if (lab) lab.reset(batch ? (batch.seed + Math.floor(batch.index / 2)) >>> 0 : lab.seed);
      else if (!r.activated)
        r.onKeyDown({ type: 'keydown', keyCode: 32, preventDefault() {}, target: r.canvas });
      else {
        r.stop();
        r.restart();
      }
    } catch (e) {
      fail(`開局失敗：${e.message}`);
    } finally {
      internalReset = false;
    }
    beginRecord();
    syncControls();
  }
  function tick(now) {
    if (stopped || !r || phase() !== 'running' || (!config.enabled && !batch)) return;
    beginRecord();
    if (nextDecision === null) nextDecision = now;
    if (now + 0.00001 < nextDecision) return;
    const strategy = Core.strategies[active.strategy];
    do {
      nextDecision += strategy.interval;
    } while (nextDecision <= now);
    try {
      const s = Core.snapshot(r);
      decision = strategy.decide(s, active.params);
      for (const action of decision.actions) {
        if (action.type === 'duck' && r.tRex.ducking !== action.value) r.tRex.setDuck(action.value);
        else if (action.type === 'jump' && !r.tRex.jumping) r.tRex.startJump(r.currentSpeed);
        else if (action.type === 'release') r.tRex.endJump();
        else if (action.type === 'drop' && !r.tRex.speedDrop) r.tRex.setSpeedDrop();
      }
    } catch (e) {
      config.enabled = false;
      handoff();
      fail(`AI 已停止：${e.message}`);
      if (batch) cancelBatch();
    }
  }
  function monitor() {
    if (!r || stopped) return;
    const state = phase();
    if (state === 'running' && !record) beginRecord();
    const limited = batch && record && r.runningTime >= batch.limit * 1000;
    if (record && (state === 'crashed' || limited)) {
      finishRecord(limited ? 'limit' : 'crash');
      if (batch) {
        lab.pause();
        r.stop();
        batch.index++;
        renderBatch();
        restartTimer = window.setTimeout(nextBatchRun, 0);
      } else if (config.autoRestart && config.enabled) {
        clearTimeout(restartTimer);
        restartTimer = window.setTimeout(() => {
          if (config.autoRestart && config.enabled && phase() === 'crashed') startRun();
        }, config.restartDelay);
      }
    }
  }
  function discover() {
    clearTimeout(probeTimer);
    const candidate = page.Runner?.instance_;
    if (
      candidate?.tRex &&
      candidate?.horizon &&
      candidate?.distanceMeter &&
      typeof candidate.tRex.startJump === 'function' &&
      typeof candidate.tRex.endJump === 'function' &&
      typeof candidate.tRex.setDuck === 'function' &&
      candidate.tRex.config.WIDTH === 44 &&
      candidate.tRex.config.HEIGHT === 47 &&
      candidate.dimensions.HEIGHT === 150
    ) {
      if (r !== candidate) {
        if (record) finishRecord('engine-replaced');
        if (batch) cancelBatch();
        r = candidate;
        nextDecision = null;
      }
      lab =
        /^(127\.0\.0\.1|localhost)$/.test(location.hostname) &&
        page.DinoLab?.version === 'wayou-5455bfa+lab-1'
          ? page.DinoLab
          : null;
      probeCount = 0;
      fail('');
      const note = document.getElementById('installation-note');
      if (lab && note)
        note.textContent = 'AI 控制台已就緒。按空白鍵開始，或點右下角恐龍切換策略與實驗。';
      syncControls();
      return;
    }
    if (++probeCount < 40) probeTimer = window.setTimeout(discover, 250);
    else {
      r = null;
      fail('未找到支援的經典 Runner 引擎；可在遊戲載入後重新偵測。');
      syncControls();
    }
  }
  function variantOptions() {
    return [
      { id: 'legacy', name: '2016 原版', strategy: 'legacy', params: {} },
      {
        id: 'current',
        name: 'Predictive：目前參數',
        strategy: 'predictive',
        params: { ...config.params },
      },
      ...config.presets.map((p) => ({
        id: p.id,
        name: `Predictive：${p.name}`,
        strategy: 'predictive',
        params: { ...p.params },
      })),
    ];
  }
  function startBatch() {
    if (!lab || batch) return;
    const seed = Number($('seed').value),
      rounds = Number($('rounds').value),
      limit = Number($('limit').value);
    if (
      ![seed, rounds, limit].every(Number.isInteger) ||
      seed < 0 ||
      seed > 4294967295 ||
      rounds < 1 ||
      rounds > 100 ||
      limit < 10 ||
      limit > 600
    ) {
      $('batch-status').textContent = '請輸入有效種子、1–100 組配對、10–600 秒上限。';
      return;
    }
    const options = variantOptions();
    const variants = [$('variant-a').value, $('variant-b').value].map((id) =>
      copy(options.find((v) => v.id === id))
    );
    if (record) finishRecord('cancel');
    clearTimeout(restartTimer);
    batch = {
      id: uid(),
      seed,
      rounds,
      limit,
      variants,
      index: 0,
      results: [],
      previous: { active: copy(active), rate: lab.rate },
      startedAt: new Date().toISOString(),
    };
    lab.setRate(Number($('batch-rate').value));
    nextBatchRun();
  }
  function nextBatchRun() {
    restartTimer = 0;
    if (!batch) return;
    if (batch.index >= batch.rounds * 2) return completeBatch(false);
    const variant = batch.variants[batch.index % 2];
    active = { strategy: variant.strategy, params: { ...variant.params } };
    startRun();
    syncControls();
    renderBatch();
  }
  function completeBatch(cancelled) {
    if (!batch) return;
    clearTimeout(restartTimer);
    restartTimer = 0;
    if (record) finishRecord('cancel');
    lab.pause();
    r.stop();
    active = batch.previous.active;
    lab.setRate(batch.previous.rate);
    batch.cancelled = cancelled;
    batch.finishedAt = new Date().toISOString();
    lastBatch = copy(batch);
    delete lastBatch.previous;
    batch = null;
    handoff();
    syncControls();
    renderBatch();
  }
  function cancelBatch() {
    completeBatch(true);
  }
  function download(name, body, type) {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportRecords(format, experimental) {
    const experiment = batch || lastBatch;
    const data = experimental ? experiment?.results || [] : records;
    if (format === 'json') {
      const value = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        ...(experimental && experiment
          ? { experiment: { ...copy(experiment), previous: undefined } }
          : { records: data }),
      };
      download('dino-ai-lab.json', JSON.stringify(value, null, 2), 'application/json');
    } else {
      const keys = [
        'id',
        'batchId',
        'pair',
        'side',
        'site',
        'engine',
        'label',
        'strategy',
        'strategyVersion',
        'params',
        'seed',
        'score',
        'seconds',
        'mixed',
        'end',
        'startedAt',
      ];
      const cell = (value) => {
        let text =
          value === null || value === undefined
            ? ''
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
        if (/^[=+@-]/.test(text)) text = "'" + text;
        return `"${text.replaceAll('"', '""')}"`;
      };
      download(
        'dino-ai-lab.csv',
        '\uFEFF' +
          [
            keys.join(','),
            ...data.map((item) => keys.map((key) => cell(item[key])).join(',')),
          ].join('\r\n'),
        'text/csv;charset=utf-8'
      );
    }
  }
  function fillSelect(select, options, fallback) {
    const value = select.value;
    select.replaceChildren(
      ...options.map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        return option;
      })
    );
    select.value = options.some((o) => o.id === value) ? value : fallback;
  }
  function syncPresets() {
    fillSelect($('preset'), [{ id: '', name: '選擇預設…' }, ...config.presets], '');
    const options = variantOptions();
    fillSelect($('variant-a'), options, 'legacy');
    fillSelect($('variant-b'), options, 'current');
  }
  function syncControls() {
    $('strategy').value = config.strategy;
    $('timing').value = config.timing;
    $('autoRestart').checked = config.autoRestart;
    $('restartDelay').value = config.restartDelay;
    for (const key of ['margin', 'latency']) $(key).value = config.params[key];
    for (const key of ['earlyRelease', 'fastDrop']) $(key).checked = config.params[key];
    $('legacy-note').hidden = config.strategy !== 'legacy';
    $('predictive-parameters').hidden = config.strategy === 'legacy';
    $('pending').hidden = !pending;
    $('enable').textContent = config.enabled ? '切換手動' : '啟用 AI';
    $('local-speed').hidden = !lab;
    if (lab) $('rate').value = String(lab.rate);
    $('batch-start').disabled = !lab || !!batch;
    $('batch-cancel').disabled = !batch;
    $('batch-fields').disabled = !lab || !!batch;
    $('experiment-note').textContent = lab
      ? '同一組種子、相同遊戲時間；策略和參數在批次期間固定。倍率與資訊顯示可隨時調整。'
      : '可重現 A/B 與加速只在本地版提供：於 repo 執行 npm run dino。';
    for (const id of [
      'strategy',
      'timing',
      'start',
      'enable',
      'margin',
      'latency',
      'earlyRelease',
      'fastDrop',
      'load-preset',
      'reset-params',
      'reset-settings',
      'autoRestart',
      'restartDelay',
      'pause',
    ])
      $(id).disabled = !!batch;
    $('start').disabled = !r || !!batch;
    for (const input of shadow.querySelectorAll('[data-info]'))
      input.checked = config.info[input.dataset.info];
    for (const key of ['metrics', 'reason', 'stats']) $(key).hidden = !config.info[key];
    updateDisplay();
  }
  function table(target, headers, rows) {
    target.replaceChildren();
    const t = document.createElement('table'),
      head = t.createTHead().insertRow(),
      body = t.createTBody();
    for (const name of headers) {
      const th = document.createElement('th');
      th.textContent = name;
      head.append(th);
    }
    for (const values of rows) {
      const row = body.insertRow();
      for (const value of values) row.insertCell().textContent = String(value ?? '—');
    }
    target.append(t);
  }
  function summaryText(items) {
    const s = Core.summarize(items);
    return `${s.count} 局 · 平均 ${s.average.toFixed(1)} · 中位 ${s.median.toFixed(1)} · 最高 ${s.best}`;
  }
  function renderHistory() {
    const groups = new Map();
    for (const item of records.filter((item) => !item.batchId)) {
      const key = JSON.stringify([
        item.site,
        item.engine,
        item.gameConfig,
        item.strategy,
        item.strategyVersion,
        item.params,
      ]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    $('history-summary').replaceChildren();
    for (const items of [...groups.values()].slice(-12)) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = `${items[0].strategy} · ${new URL(items[0].site).host} · ${items[0].params ? JSON.stringify(items[0].params) : '原參數'}：${summaryText(items)}`;
      $('history-summary').append(p);
    }
    const ending = {
      crash: '死亡',
      limit: '上限',
      cancel: '取消',
      restart: '重開',
      'engine-replaced': '引擎更換',
    };
    table(
      $('history'),
      ['策略', '分數', '秒', '結果'],
      records
        .slice(-60)
        .reverse()
        .map((item) => [
          item.label,
          item.score,
          item.seconds,
          item.mixed ? '混合' : ending[item.end] || item.end,
        ])
    );
    const current = records.filter(
      (item) =>
        !item.batchId &&
        item.site === location.origin + location.pathname &&
        item.strategy === active.strategy &&
        JSON.stringify(item.params) ===
          JSON.stringify(active.strategy === 'predictive' ? active.params : null)
    );
    $('stats').textContent = summaryText(current);
  }
  function renderBatch() {
    const b = batch || lastBatch;
    if (!b) return;
    $('progress').max = b.rounds * 2;
    $('progress').value = b.results.length;
    $('batch-status').textContent =
      `${batch ? '執行中' : b.cancelled ? '已取消' : '已完成'} · ${b.results.length}/${b.rounds * 2} 局${batch ? ` · 第 ${Math.floor(b.index / 2) + 1} 組 ${b.index % 2 ? 'B' : 'A'}` : ''}`;
    $('batch-summary').replaceChildren();
    for (const side of ['A', 'B']) {
      const p = document.createElement('p');
      p.textContent = `${side}：${summaryText(b.results.filter((item) => item.side === side))}`;
      $('batch-summary').append(p);
    }
    table(
      $('pairs'),
      ['種子', 'A 分數', 'B 分數', 'B − A'],
      Array.from({ length: Math.ceil(b.results.length / 2) }, (_, i) => {
        const a = b.results.find((item) => item.pair === i + 1 && item.side === 'A'),
          other = b.results.find((item) => item.pair === i + 1 && item.side === 'B');
        const completed = (item) => item && ['crash', 'limit'].includes(item.end);
        return [
          (b.seed + i) >>> 0,
          a ? `${a.score}${a.end === 'limit' ? '+' : a.end === 'cancel' ? '（取消）' : ''}` : '—',
          other
            ? `${other.score}${other.end === 'limit' ? '+' : other.end === 'cancel' ? '（取消）' : ''}`
            : '—',
          completed(a) && completed(other) ? other.score - a.score : '—',
        ];
      })
    );
  }
  function updateDisplay() {
    if (stopped) return;
    const names = {
      missing: '尋找遊戲中',
      waiting: '待命 · 按空白鍵開始',
      running: '遊戲進行中',
      crashed: '本局結束',
      paused: '遊戲已暫停',
    };
    $('status').textContent =
      `${names[phase()]} · ${config.enabled || batch ? Core.strategies[active.strategy].name : '手動'}${record?.mixed ? ' · 混合局' : ''}`;
    $('toggle').dataset.running = String(phase() === 'running' && (config.enabled || !!batch));
    if (config.info.metrics) {
      $('score').textContent = score();
      $('speed').textContent = r?.currentSpeed.toFixed(2) || '0';
      $('elapsed').textContent = r ? (r.runningTime / 1000).toFixed(1) : '0';
    }
    if (config.info.reason) $('reason').textContent = decision.reason;
    if (lab && opened)
      $('actual-rate').textContent =
        `目標 ${lab.rate}× · 實際約 ${lab.actualRate.toFixed(1)}×（受電腦效能影響）`;
    $('pending').hidden = !pending;
  }
  const overlay = document.createElement('canvas');
  overlay.id = 'dino-ai-lab-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483644',
    display: 'none',
  });
  document.documentElement.append(overlay);
  function drawOverlay() {
    if (!r || (!config.info.boxes && !config.info.trajectory)) {
      overlay.style.display = 'none';
      return;
    }
    const rect = r.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    const dpr = window.devicePixelRatio || 1;
    if (
      overlay.width !== Math.round(rect.width * dpr) ||
      overlay.height !== Math.round(rect.height * dpr)
    ) {
      overlay.width = Math.round(rect.width * dpr);
      overlay.height = Math.round(rect.height * dpr);
    }
    const ctx = overlay.getContext('2d');
    ctx.setTransform(
      overlay.width / r.dimensions.WIDTH,
      0,
      0,
      overlay.height / r.dimensions.HEIGHT,
      0,
      0
    );
    ctx.clearRect(0, 0, r.dimensions.WIDTH, r.dimensions.HEIGHT);
    const s = Core.snapshot(r),
      t = s.trex;
    if (config.info.boxes) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#218e60';
      for (const box of t.ducking ? Core.BOXES.ducking : Core.BOXES.running)
        ctx.strokeRect(t.x + 1 + box[0], t.y + 1 + box[1], box[2], box[3]);
      ctx.strokeStyle = '#d86138';
      for (const o of s.obstacles)
        for (const box of o.boxes)
          ctx.strokeRect(o.x + 1 + box[0], o.y + 1 + box[1], box[2], box[3]);
    }
    if (config.info.trajectory && decision.trajectory?.length) {
      ctx.strokeStyle = '#4b88df';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(t.x + 22, t.y + 23);
      for (const point of decision.trajectory)
        ctx.lineTo(point.x + 22 + (s.speed * point.time) / Core.DT, point.y + 23);
      ctx.stroke();
    }
  }
  function fit() {
    config.right = Math.min(Math.max(12, config.right), Math.max(12, innerWidth - 68));
    config.bottom = Math.min(Math.max(12, config.bottom), Math.max(12, innerHeight - 68));
    $('toggle').style.right = config.right + 'px';
    $('toggle').style.bottom = config.bottom + 'px';
    if (opened) {
      const panel = $('panel');
      panel.style.right =
        Math.max(12, Math.min(config.right, innerWidth - panel.offsetWidth - 12)) + 'px';
      panel.style.bottom =
        Math.max(12, Math.min(config.bottom + 68, innerHeight - panel.offsetHeight - 12)) + 'px';
    }
  }
  function open(value = !opened) {
    opened = value;
    $('panel').hidden = !value;
    $('toggle').setAttribute('aria-expanded', String(value));
    if (value) {
      renderHistory();
      updateDisplay();
    }
    fit();
  }
  let drag = null,
    dragged = false;
  $('toggle').addEventListener('pointerdown', (e) => {
    dragged = false;
    drag = { x: e.clientX, y: e.clientY, right: config.right, bottom: config.bottom };
    $('toggle').setPointerCapture(e.pointerId);
  });
  $('toggle').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) dragged = true;
    if (dragged) {
      config.right = drag.right - dx;
      config.bottom = drag.bottom - dy;
      fit();
    }
  });
  $('toggle').addEventListener('pointerup', () => {
    drag = null;
    if (dragged) save();
  });
  $('toggle').addEventListener('pointercancel', () => {
    drag = null;
  });
  $('toggle').addEventListener('click', () => {
    if (!dragged) open();
  });
  $('close').addEventListener('click', () => {
    open(false);
    $('toggle').focus();
  });
  for (const button of shadow.querySelectorAll('[data-tab]'))
    button.addEventListener('click', () => {
      for (const tab of shadow.querySelectorAll('[data-tab]'))
        tab.setAttribute('aria-selected', String(tab === button));
      for (const section of shadow.querySelectorAll('[data-section]'))
        section.hidden = section.dataset.section !== button.dataset.tab;
      renderHistory();
      renderBatch();
      fit();
    });
  $('strategy').addEventListener('change', () => {
    config.strategy = $('strategy').value;
    applySpec();
  });
  $('timing').addEventListener('change', () => {
    config.timing = $('timing').value;
    if (config.timing === 'now' && pending) applySpec();
    else save();
  });
  for (const key of ['margin', 'latency', 'earlyRelease', 'fastDrop'])
    $(key).addEventListener('change', () => {
      config.params = Core.settings({
        ...config.params,
        [key]: $(key).type === 'checkbox' ? $(key).checked : $(key).value,
      });
      applySpec();
    });
  $('reset-params').addEventListener('click', () => {
    config.params = { ...Core.DEFAULTS };
    applySpec();
  });
  $('autoRestart').addEventListener('change', () => {
    config.autoRestart = $('autoRestart').checked;
    clearTimeout(restartTimer);
    restartTimer = 0;
    save();
  });
  $('restartDelay').addEventListener('change', () => {
    config.restartDelay = Math.min(30000, Math.max(100, Number($('restartDelay').value) || 1000));
    save();
    syncControls();
  });
  $('start').addEventListener('click', () => startRun());
  $('enable').addEventListener('click', () => {
    config.enabled = !config.enabled;
    if (record) record.mixed = true;
    clearTimeout(restartTimer);
    restartTimer = 0;
    handoff();
    save();
    syncControls();
  });
  $('retry').addEventListener('click', () => {
    probeCount = 0;
    discover();
  });
  $('rate').addEventListener('change', () => {
    lab?.setRate(Number($('rate').value));
  });
  $('pause').addEventListener('click', () => lab?.pause(!lab.paused));
  $('batch-rate').addEventListener('change', () => {
    if (batch) lab.setRate(Number($('batch-rate').value));
  });
  for (const input of shadow.querySelectorAll('[data-info]'))
    input.addEventListener('change', () => {
      config.info[input.dataset.info] = input.checked;
      save();
      syncControls();
      renderHistory();
      fit();
    });
  const chosenPreset = () => config.presets.find((p) => p.id === $('preset').value);
  $('save-preset').addEventListener('click', () => {
    const name = $('preset-name').value.trim();
    if (!name) return fail('請輸入預設名稱');
    if (config.presets.length >= 40) return fail('最多保存 40 組預設');
    const preset = { id: uid(), name, params: { ...config.params } };
    config.presets.push(preset);
    save();
    syncPresets();
    $('preset').value = preset.id;
    fail('');
  });
  $('preset').addEventListener('change', () => {
    $('preset-name').value = chosenPreset()?.name || '';
  });
  $('load-preset').addEventListener('click', () => {
    const p = chosenPreset();
    if (p) {
      config.strategy = 'predictive';
      config.params = { ...p.params };
      applySpec();
    }
  });
  $('rename-preset').addEventListener('click', () => {
    const p = chosenPreset(),
      name = $('preset-name').value.trim();
    if (p && name) {
      p.name = name;
      save();
      syncPresets();
    }
  });
  $('delete-preset').addEventListener('click', () => {
    config.presets = config.presets.filter((p) => p.id !== $('preset').value);
    save();
    syncPresets();
  });
  $('batch-start').addEventListener('click', startBatch);
  $('batch-cancel').addEventListener('click', cancelBatch);
  for (const kind of ['json', 'csv']) {
    $(`export-${kind}`).addEventListener('click', () => exportRecords(kind, false));
    $(`batch-${kind}`).addEventListener('click', () => exportRecords(kind, true));
  }
  $('clear-history').addEventListener('click', () => {
    if ($('clear-history').dataset.confirm !== 'yes') {
      $('clear-history').dataset.confirm = 'yes';
      $('clear-history').textContent = '再次點擊確認清除';
      return;
    }
    records = [];
    GM_setValue(RECORD_KEY, []);
    $('clear-history').dataset.confirm = '';
    $('clear-history').textContent = '清除紀錄';
    renderHistory();
  });
  $('reset-settings').addEventListener('click', () => {
    config.strategy = 'legacy';
    config.params = { ...Core.DEFAULTS };
    config.timing = 'now';
    config.enabled = true;
    config.autoRestart = false;
    config.restartDelay = 1000;
    for (const k of Object.keys(config.info)) config.info[k] = false;
    config.right = 24;
    config.bottom = 24;
    clearTimeout(restartTimer);
    applySpec();
    fit();
  });
  function onKey(e) {
    const owned = e.composedPath().includes(host);
    if (owned) {
      if (e.type === 'keydown' && e.key === 'Escape') {
        open(false);
        $('toggle').focus();
        e.preventDefault();
      }
      e.stopImmediatePropagation();
      return;
    }
    if (
      e.isComposing ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e
        .composedPath()
        .some((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName) || el?.isContentEditable)
    )
      return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.code)) {
      if (batch) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.type === 'keydown' && record && phase() === 'running') record.mixed = true;
    }
  }
  for (const type of ['keydown', 'keypress', 'keyup']) window.addEventListener(type, onKey, true);
  function onPointer(e) {
    if (batch && !e.composedPath().includes(host) && r?.containerEl.contains(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (record && r?.containerEl.contains(e.target)) record.mixed = true;
  }
  for (const type of ['mousedown', 'touchstart', 'touchend'])
    window.addEventListener(type, onPointer, { capture: true, passive: false });
  function beforeStep() {
    if (lab) tick(lab.now);
  }
  function afterStep() {
    if (lab) monitor();
  }
  function onReset() {
    if (!internalReset && record) finishRecord('restart');
    if (!batch) {
      active = pending || selectedSpec();
      pending = null;
    }
    nextDecision = null;
  }
  document.addEventListener('dino-lab-before-step', beforeStep);
  document.addEventListener('dino-lab-after-step', afterStep);
  document.addEventListener('dino-lab-reset', onReset);
  function frame(now) {
    if (stopped) return;
    if (r && page.Runner?.instance_ !== r) discover();
    if (!lab) {
      tick(now);
      monitor();
    }
    drawOverlay();
    animation = requestAnimationFrame(frame);
  }
  function visibility() {
    nextDecision = null;
  }
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', fit);
  const displayTimer = window.setInterval(updateDisplay, 200);
  function teardown() {
    stopped = true;
    clearTimeout(restartTimer);
    clearTimeout(probeTimer);
    clearInterval(displayTimer);
    cancelAnimationFrame(animation);
    if (batch) cancelBatch();
    handoff();
    for (const type of ['keydown', 'keypress', 'keyup'])
      window.removeEventListener(type, onKey, true);
    for (const type of ['mousedown', 'touchstart', 'touchend'])
      window.removeEventListener(type, onPointer, true);
    document.removeEventListener('dino-lab-before-step', beforeStep);
    document.removeEventListener('dino-lab-after-step', afterStep);
    document.removeEventListener('dino-lab-reset', onReset);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('resize', fit);
    host.remove();
    overlay.remove();
  }
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) teardown();
    else {
      if (batch) cancelBatch();
      nextDecision = null;
    }
  });
  GM_registerMenuCommand('Little Dino AI Lab：開啟控制台', () => open(true));
  syncPresets();
  syncControls();
  renderHistory();
  fit();
  discover();
  animation = requestAnimationFrame(frame);
})();
