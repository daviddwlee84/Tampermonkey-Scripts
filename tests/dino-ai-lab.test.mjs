import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { chromium, firefox } from 'playwright';
import { startDinoServer, localEngineSource } from '../scripts/dino-server.mjs';

const SOURCE = await readFile(
  new URL('../userscripts/dino-ai-lab/dino-ai-lab.user.js', import.meta.url),
  'utf8'
);
const ORIGINAL = await readFile(
  new URL('../userscripts/dino-ai-lab/history/GoogleLittleDinosaurAI.2016.txt', import.meta.url),
  'utf8'
);
const UPSTREAM = await readFile(
  new URL('../playgrounds/dino/vendor/upstream.js', import.meta.url),
  'utf8'
);
const CORE_SOURCE = SOURCE.split('// BEGIN DINO CORE')[1]
  .split('\n')
  .slice(1)
  .join('\n')
  .split('// END DINO CORE')[0];
const core = vm.runInNewContext(CORE_SOURCE + '; Core');
const OUT = new URL('../.preview/dino-ai-lab/', import.meta.url).pathname;
const clone = (v) => JSON.parse(JSON.stringify(v));

function historicalDecision(snapshot) {
  const actions = [],
    t = snapshot.trex;
  const rex = {
    xPos: t.x,
    yPos: t.y,
    config: t.config,
    jumping: t.jumping,
    ducking: t.ducking,
    speedDrop: t.speedDrop,
    setDuck(value) {
      this.ducking = value;
      actions.push({ type: 'duck', value });
    },
    startJump() {
      actions.push({ type: 'jump' });
    },
    setSpeedDrop() {
      actions.push({ type: 'drop' });
    },
  };
  const context = vm.createContext({ document: { addEventListener() {} } });
  vm.runInContext(ORIGINAL, context);
  context.runner = {
    isRunning: () => true,
    currentSpeed: snapshot.speed,
    tRex: rex,
    horizon: {
      obstacles: snapshot.obstacles.map((o) => ({
        xPos: o.x,
        yPos: o.y,
        typeConfig: { width: o.typeWidth, height: o.height },
      })),
    },
    distanceRan: 1,
    distanceMeter: { getActualDistance: () => 1, config: { ACHIEVEMENT_DISTANCE: 100 } },
  };
  context.tRex = rex;
  vm.runInContext('updateLittleDino()', context);
  return actions;
}

describe('historical and pure models', () => {
  it('preserves the historical bytes and pinned upstream revision', async () => {
    const historical = await readFile(
      new URL('../userscripts/dino-ai-lab/history/GoogleLittleDinosaurAI.2016.txt', import.meta.url)
    );
    assert.equal(
      createHash('sha256').update(historical).digest('hex'),
      'c2f6b77b5bdf5be70151eb67bddbe7bbe574f68988e65e8edabfbffdf5bb5fb4'
    );
    assert.equal(
      createHash('sha256').update(UPSTREAM).digest('hex'),
      'e7a50d337bdbe4299068de034e4564cfe5fd45ca9257ded37b6ada9330cedf0f'
    );
  });
  it('agrees with the original program on 600 varied states, including its first-obstacle and width quirks', () => {
    let seed = 41;
    const random = (n) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) % n;
    };
    for (let i = 0; i < 600; i++) {
      const s = {
        speed: 6 + random(701) / 100,
        trex: {
          x: 50,
          y: random(2) ? 93 : 35,
          jumping: !!random(2),
          ducking: !!random(2),
          speedDrop: !!random(2),
          config: { WIDTH: 44, HEIGHT: 47 },
        },
        obstacles: Array.from({ length: random(4) }, () => ({
          x: random(650) - 80,
          y: [50, 75, 90, 100, 105][random(5)],
          height: 25 + random(26),
          typeWidth: 17 + random(30),
        })),
      };
      assert.deepEqual(
        clone(core.legacy(s).actions),
        historicalDecision(s),
        `state ${i}: ${JSON.stringify(s)}`
      );
    }
  });
  it('rejects upstream drift instead of silently applying partial clock patches', () => {
    assert.throws(
      () => localEngineSource(UPSTREAM.replace('getRandomNum(minGap, maxGap)', 'changed()')),
      /Pinned Dino source changed/
    );
    const source = localEngineSource(UPSTREAM);
    assert.match(source, /window.DinoLab.random\(\) > 0.5/);
    assert.match(source, /return window.DinoLab.now/);
  });
  it('excludes mixed and cancelled runs from statistics and validates parameters', () => {
    assert.deepEqual(
      clone(
        core.summarize([
          { score: 10, end: 'crash' },
          { score: 20, end: 'limit' },
          { score: 999, end: 'cancel' },
          { score: 999, end: 'crash', mixed: true },
        ])
      ),
      { count: 2, average: 15, median: 15, best: 20 }
    );
    assert.deepEqual(clone(core.settings({ margin: 100, latency: -5, earlyRelease: false })), {
      margin: 20,
      latency: 0,
      earlyRelease: false,
      fastDrop: true,
    });
  });
});

function shim(initial = {}) {
  window.GM_getValue = (key, fallback) =>
    JSON.parse(localStorage.getItem(key) || 'null') ?? initial[key] ?? fallback;
  window.GM_setValue = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  window.GM_registerMenuCommand = () => {};
  window.unsafeWindow = window;
}

for (const engine of (process.env.DINO_BROWSERS || 'chromium,firefox').split(',')) {
  describe(`dino / ${engine}`, { concurrency: false }, () => {
    let browser,
      server,
      origin,
      contexts = [],
      pageErrors = [];
    before(async () => {
      await mkdir(OUT, { recursive: true });
      server = await startDinoServer({ port: 0 });
      origin = `http://127.0.0.1:${server.address().port}`;
      browser = await { chromium, firefox }[engine].launch();
    });
    after(async () => {
      await browser?.close();
      await new Promise((resolve) => server?.close(resolve));
    });
    afterEach(async () => {
      for (const context of contexts) await context.close();
      contexts = [];
      assert.deepEqual(pageErrors, []);
      pageErrors = [];
    });

    async function open({
      initial,
      width = 1280,
      colorScheme = 'light',
      inject = true,
      reference = false,
    } = {}) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme });
      contexts.push(context);
      await context.addInitScript({
        content: `(${shim.toString()})(${JSON.stringify(initial || {})});`,
      });
      if (reference)
        await context.route('**/runner.js', (route) =>
          route.fulfill({
            contentType: 'text/javascript',
            body: localEngineSource(UPSTREAM).replace(
              '})();',
              'window.DinoReference = { Trex: Trex, checkForCollision: checkForCollision };\n})();'
            ),
          })
        );
      const page = await context.newPage();
      page.on('pageerror', (e) => pageErrors.push(e.message));
      const unexpected = [];
      page.on('request', (request) => {
        if (!request.url().startsWith(origin) && !request.url().startsWith('data:'))
          unexpected.push(request.url());
      });
      await page.goto(origin + '/dino/');
      await page.waitForFunction(() => window.Runner?.instance_?.tRex);
      await page.addScriptTag({ content: CORE_SOURCE + '; window.TestCore = Core;' });
      if (inject) {
        await page.addScriptTag({ content: SOURCE });
        await page.locator('#toggle').click();
      }
      assert.deepEqual(unexpected, [], 'Local game and script need no external requests');
      return page;
    }

    it('matches the engine jump integrator and collision implementation at multiple speeds and stances', async () => {
      const page = await open({ inject: false, reference: true });
      const result = await page.evaluate(() => {
        const r = Runner.instance_,
          core = TestCore,
          differences = [];
        DinoLab.pause();
        for (const speed of [6, 9, 13])
          for (const action of ['hold', 'release', 'drop']) {
            r.tRex.reset();
            r.tRex.startJump(speed);
            const t = core.snapshot(r).trex;
            for (let frame = 0; frame < 65 && t.jumping; frame++) {
              if (frame === 12 && action === 'release') {
                r.tRex.endJump();
                if (t.reachedMin && t.velocity < t.config.DROP_VELOCITY)
                  t.velocity = t.config.DROP_VELOCITY;
              }
              if (frame === 18 && action === 'drop') {
                r.tRex.setSpeedDrop();
                t.speedDrop = true;
                t.velocity = 1;
              }
              core.advanceTrex(t);
              r.tRex.updateJump(core.DT);
              if (
                t.y !== r.tRex.yPos ||
                t.velocity !== r.tRex.jumpVelocity ||
                t.jumping !== r.tRex.jumping
              )
                differences.push({ speed, action, frame, predicted: t.y, actual: r.tRex.yPos });
            }
          }
        r.tRex.reset();
        for (const duck of [false, true])
          for (const size of [1, 3])
            for (const y of [50, 75, 90, 100])
              for (let x = 0; x < 150; x += 3) {
                if (r.tRex.ducking !== duck) r.tRex.setDuck(duck);
                const obstacle = {
                  xPos: x,
                  yPos: y,
                  size,
                  width: 25 * size,
                  typeConfig: { width: 25, height: 40 },
                  collisionBoxes: [{ x: 0, y: 0, width: 25 * size, height: 40 }],
                };
                const s = core.snapshot({ ...r, horizon: { obstacles: [obstacle] } });
                if (
                  !!DinoReference.checkForCollision(obstacle, r.tRex) !==
                  core.collides(s.trex, s.obstacles[0])
                )
                  differences.push({ duck, size, x, y });
              }
        return differences;
      });
      assert.deepEqual(result, []);
    });

    it('keeps settings, presets, keyboard isolation, immediate and next-run changes coherent', async () => {
      const page = await open();
      await page.locator('#strategy').selectOption('predictive');
      await page.locator('#parameters').evaluate((el) => (el.open = true));
      await page.locator('#margin').fill('7');
      await page.locator('#margin').press('Tab');
      await page.locator('#preset-name').pressSequentially('speed 2016');
      assert.equal(
        await page.evaluate(() => Runner.instance_.activated),
        false,
        'Space in the panel does not start the game'
      );
      await page.locator('#save-preset').click();
      assert.match(await page.locator('#preset').textContent(), /speed 2016/);
      await page.locator('#start').click();
      await page.locator('#timing').selectOption('next');
      await page.locator('#strategy').selectOption('legacy');
      assert.equal(await page.locator('#pending').isVisible(), true);
      assert.match(await page.locator('#status').textContent(), /Predictive/);
      await page.locator('#timing').selectOption('now');
      await page.waitForFunction(() =>
        document
          .getElementById('dino-ai-lab-ui')
          .shadowRoot.getElementById('status')
          .textContent.includes('混合')
      );
      await page.locator('#start').click();
      const first = await page.evaluate(
        () => JSON.parse(localStorage.getItem('dinoAiLab.records.v1'))[0]
      );
      assert.equal(first.mixed, true);
      await page.reload();
      await page.addScriptTag({ content: SOURCE });
      await page.locator('#toggle').click();
      assert.equal(await page.locator('#strategy').inputValue(), 'legacy');
      assert.match(await page.locator('#preset').textContent(), /speed 2016/);
      await page.locator('#parameters').evaluate((el) => (el.open = true));
      await page.locator('#preset').selectOption({ label: 'speed 2016' });
      await page.locator('#load-preset').click();
      assert.equal(await page.locator('#margin').inputValue(), '7');
      await page.locator('#preset-name').fill('renamed');
      await page.locator('#rename-preset').click();
      assert.match(await page.locator('#preset').textContent(), /renamed/);
      await page.locator('#delete-preset').click();
      assert.doesNotMatch(await page.locator('#preset').textContent(), /renamed/);
    });

    it('mounts once and gives narrow/light/dark layouts independent display toggles', async () => {
      const page = await open({ width: 390, colorScheme: 'dark' });
      await page.addScriptTag({ content: SOURCE });
      assert.equal(await page.locator('#dino-ai-lab-ui').count(), 1);
      await page.locator('summary').filter({ hasText: '資訊顯示' }).click();
      for (const key of ['metrics', 'reason', 'boxes', 'trajectory', 'stats'])
        await page.locator(`[data-info=${key}]`).check();
      await page.locator('#strategy').selectOption('predictive');
      await page.locator('#start').click();
      await page.screenshot({ path: `${OUT}/narrow-${engine}.png` });
      const rect = await page.locator('#panel').boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
      await page.locator('[data-info=boxes]').uncheck();
      await page.locator('[data-info=trajectory]').uncheck();
      await page.waitForFunction(
        () => document.getElementById('dino-ai-lab-overlay').style.display === 'none'
      );
      await page.locator('#close').click();
      assert.equal(await page.locator('#panel').isVisible(), false);
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.locator('#toggle').click();
      await page.screenshot({ path: `${OUT}/light-${engine}.png` });
    });

    it('discovers a delayed Runner without mounting duplicate controls', async () => {
      const page = await open({ inject: false });
      await page.evaluate(() => {
        window.DelayedRunner = window.Runner;
        delete window.Runner;
      });
      await page.addScriptTag({ content: SOURCE });
      assert.equal(await page.locator('#start').isDisabled(), true);
      await page.evaluate(() => {
        window.Runner = window.DelayedRunner;
      });
      await page.waitForFunction(
        () => !document.getElementById('dino-ai-lab-ui').shadowRoot.getElementById('start').disabled
      );
      assert.equal(await page.locator('#dino-ai-lab-ui').count(), 1);
    });

    it('restarts after death, applies queued settings, and cancels a pending restart', async () => {
      const page = await open();
      await page.locator('#autoRestart').check();
      await page.locator('#restartDelay').fill('500');
      await page.locator('#restartDelay').press('Tab');
      await page.locator('#start').click();
      await page.locator('#timing').selectOption('next');
      await page.locator('#strategy').selectOption('predictive');
      await page.evaluate(() => Runner.instance_.gameOver());
      await page.waitForFunction(() => Runner.instance_.playCount === 2);
      await page.waitForFunction(() =>
        document
          .getElementById('dino-ai-lab-ui')
          .shadowRoot.getElementById('status')
          .textContent.includes('Predictive')
      );
      assert.equal(await page.locator('#pending').isVisible(), false);
      await page.locator('#restartDelay').fill('1500');
      await page.locator('#restartDelay').press('Tab');
      await page.evaluate(() => Runner.instance_.gameOver());
      await page.waitForFunction(
        () => JSON.parse(localStorage.getItem('dinoAiLab.records.v1')).length === 2
      );
      await page.locator('#autoRestart').uncheck();
      await page.waitForTimeout(1700);
      assert.equal(await page.evaluate(() => Runner.instance_.playCount), 2);
      const data = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('dinoAiLab.records.v1'))
      );
      assert.equal(data[0].mixed, false);
      assert.equal(data[1].strategy, 'predictive');
    });

    it('keeps pause/resume and manual handover separate from death, with no leftover duck', async () => {
      const page = await open();
      await page.locator('#start').click();
      await page.locator('#pause').click();
      const frame = await page.evaluate(() => DinoLab.frames);
      await page.waitForTimeout(120);
      assert.equal(await page.evaluate(() => DinoLab.frames), frame);
      assert.equal(await page.evaluate(() => localStorage.getItem('dinoAiLab.records.v1')), null);
      await page.evaluate(() => Runner.instance_.tRex.setDuck(true));
      await page.locator('#enable').click();
      assert.equal(await page.evaluate(() => Runner.instance_.tRex.ducking), false);
      await page.locator('#pause').click();
      await page.waitForFunction((n) => DinoLab.frames > n, frame);
      await page.locator('#start').click();
      assert.equal(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem('dinoAiLab.records.v1'))[0].mixed
        ),
        true
      );
    });

    it(
      'runs seeded A/B through the UI, exports complete evidence, and cancels cleanly',
      { timeout: 60000 },
      async () => {
        const page = await open();
        await page.locator('[data-tab=experiment]').click();
        await page.locator('#rounds').fill('2');
        await page.locator('#limit').fill('20');
        await page.locator('#batch-rate').selectOption('20');
        await page.locator('#batch-start').click();
        assert.equal(await page.locator('#strategy').isDisabled(), true);
        await page.keyboard.press('Space');
        await page.waitForFunction(
          () =>
            document
              .getElementById('dino-ai-lab-ui')
              .shadowRoot.getElementById('batch-status')
              .textContent.startsWith('已完成'),
          null,
          { timeout: 40000 }
        );
        const data = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('dinoAiLab.records.v1'))
        );
        assert.equal(data.length, 4);
        assert.ok(data.every((r) => !r.mixed));
        for (let i = 0; i < data.length; i += 2) {
          assert.equal(data[i].seed, data[i + 1].seed);
          const a = data[i].obstacles,
            b = data[i + 1].obstacles,
            length = Math.min(a.length, b.length);
          assert.ok(length > 1);
          assert.deepEqual(
            a.slice(0, length),
            b.slice(0, length),
            'same obstacle prefix for each pair'
          );
        }
        const [json] = await Promise.all([
          page.waitForEvent('download'),
          page.locator('#batch-json').click(),
        ]);
        const exported = JSON.parse(await readFile(await json.path(), 'utf8'));
        assert.equal(exported.experiment.results.length, 4);
        await page.screenshot({ path: `${OUT}/experiment-${engine}.png` });
        await page.locator('#rounds').fill('10');
        await page.locator('#batch-start').click();
        await page.locator('#batch-cancel').click();
        assert.match(await page.locator('#batch-status').textContent(), /已取消/);
        assert.equal(await page.locator('#batch-start').isEnabled(), true);
        assert.equal(await page.evaluate(() => DinoLab.paused), true);
      }
    );

    it(
      'has identical physical outcomes and action traces at 1x and 20x, including diagnostics toggles',
      { timeout: 40000 },
      async () => {
        const page = await open({ initial: { 'dinoAiLab.v1': { strategy: 'predictive' } } });
        const results = [];
        for (const rate of [1, 20]) {
          await page.evaluate((rate) => {
            const r = Runner.instance_;
            if (!window.actionOriginals) {
              window.actionOriginals = {};
              for (const key of ['startJump', 'setDuck', 'endJump', 'setSpeedDrop']) {
                actionOriginals[key] = r.tRex[key];
                r.tRex[key] = function (...args) {
                  window.actionTrace?.push([DinoLab.frames, key, ...args]);
                  return actionOriginals[key].apply(this, args);
                };
              }
            }
            window.actionTrace = [];
            window.testDone = false;
            DinoLab.setRate(rate);
            DinoLab.reset(20160324);
            const stop = () => {
              if (DinoLab.frames >= 540 || r.crashed) {
                DinoLab.pause();
                window.testDone = true;
                document.removeEventListener('dino-lab-after-step', stop);
              }
            };
            document.addEventListener('dino-lab-after-step', stop);
          }, rate);
          if (rate === 20) {
            await page.setViewportSize({ width: 390, height: 1000 });
            await page.locator('summary').filter({ hasText: '資訊顯示' }).click();
            for (const key of ['metrics', 'reason', 'boxes', 'trajectory', 'stats'])
              await page.locator(`[data-info=${key}]`).check();
          }
          await page.waitForFunction(() => window.testDone, null, { timeout: 20000 });
          results.push(
            await page.evaluate(() => ({
              frames: DinoLab.frames,
              distance: Runner.instance_.distanceRan,
              speed: Runner.instance_.currentSpeed,
              trace: actionTrace,
              obstacles: DinoLab.obstacleLog,
              crashed: Runner.instance_.crashed,
            }))
          );
        }
        assert.deepEqual(results[0], results[1]);
        assert.ok(results[0].trace.length > 0);
      }
    );

    it(
      'runs a fixed high-speed suite without changing the game rules',
      { timeout: 240000 },
      async () => {
        const page = await open({ inject: false });
        const results = [];
        for (const speed of [6, 9, 13]) {
          for (const seed of [7, 19, 20160324]) {
            await page.evaluate(
              ({ speed, seed }) => {
                DinoLab.reset(seed);
                DinoLab.pause();
                Runner.instance_.currentSpeed = speed;
                window.scenarioActions = 0;
              },
              { speed, seed }
            );
            // Yield between five-second simulation slices, like the production
            // scheduler. One long evaluate can monopolize Firefox's main thread.
            for (let slice = 0; slice < 12; slice++) {
              const crashed = await page.evaluate(() => {
                const r = Runner.instance_,
                  core = TestCore;
                for (let frame = 0; frame < 300 && !r.crashed; frame++) {
                  const decision = core.predictive(core.snapshot(r), core.DEFAULTS);
                  for (const a of decision.actions) {
                    window.scenarioActions++;
                    if (a.type === 'jump') r.tRex.startJump(r.currentSpeed);
                    if (a.type === 'duck' && r.tRex.ducking !== a.value) r.tRex.setDuck(a.value);
                    if (a.type === 'release') r.tRex.endJump();
                    if (a.type === 'drop') r.tRex.setSpeedDrop();
                  }
                  DinoLab.step();
                }
                return r.crashed;
              });
              if (crashed) break;
            }
            results.push(
              await page.evaluate(
                ({ speed, seed }) => ({
                  speed,
                  seed,
                  crashed: Runner.instance_.crashed,
                  seconds: Runner.instance_.runningTime / 1000,
                  actions: window.scenarioActions,
                  obstacles: DinoLab.obstacleLog.length,
                }),
                { speed, seed }
              )
            );
            console.log(
              `high-speed ${engine}: speed ${speed}, seed ${seed}, ${results.at(-1).seconds.toFixed(1)} s`
            );
          }
        }
        assert.ok(results.every((r) => r.actions > 0 && r.obstacles > 5));
        assert.ok(
          results.every((r) => !r.crashed),
          JSON.stringify(results)
        );
      }
    );
  });
}
