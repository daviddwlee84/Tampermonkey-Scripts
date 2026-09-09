import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GAME = resolve(ROOT, 'playgrounds/dino');

// Adapt the pinned source in memory. Keep the upstream bytes and license intact.
export function localEngineSource(source) {
  function replace(from, to) {
    if (!source.includes(from)) throw new Error(`Pinned Dino source changed: ${from}`);
    source = source.replace(from, to);
  }
  replace(
    '(function () {',
    `(function () {
    var requestAnimationFrame = window.DinoLab.requestFrame;
    var cancelAnimationFrame = window.DinoLab.cancelFrame;`
  );
  replace(
    'return IS_IOS ? new Date().getTime() : performance.now();',
    'return window.DinoLab.now;'
  );
  replace(
    'this.dimensions.WIDTH = this.outerContainerEl.offsetWidth - padding * 2;\n            this.dimensions.WIDTH = Math.min(DEFAULT_WIDTH, this.dimensions.WIDTH);',
    'this.dimensions.WIDTH = DEFAULT_WIDTH;\n            if (this.canvas) return;'
  );
  for (const expression of [
    'getRandomNum(1, Obstacle.MAX_OBSTACLE_LENGTH)',
    'getRandomNum(0, yPosConfig.length - 1)',
    'getRandomNum(minGap, maxGap)',
    'getRandomNum(0, Obstacle.types.length - 1)',
  ])
    replace(expression, expression.replace('getRandomNum', 'window.DinoLab.randomInt'));
  replace(
    'Math.random() > 0.5 ? this.typeConfig.speedOffset',
    'window.DinoLab.random() > 0.5 ? this.typeConfig.speedOffset'
  );
  // Manual restarts also enter the same initialized state, without a CSS intro clock.
  replace(
    'this.playing = true;\n                this.crashed = false;',
    'this.playing = true;\n                this.activated = true;\n                this.playingIntro = false;\n                this.crashed = false;'
  );
  replace(
    'this.tRex.reset();\n                this.playSound',
    'this.tRex.reset();\n                this.tRex.xPos = this.tRex.config.START_X_POS;\n                this.playSound'
  );
  return source;
}

export async function startDinoServer({ port = 8787 } = {}) {
  const upstream = await readFile(resolve(GAME, 'vendor/upstream.js'), 'utf8');
  const html = await readFile(resolve(GAME, 'vendor/upstream.html'), 'utf8');
  const sounds = html.match(/<template id="audio-resources">[\s\S]*?<\/template>/)?.[0];
  if (!sounds) throw new Error('Pinned upstream audio template missing');
  const runner = localEngineSource(upstream);
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      let body, type;
      if (pathname === '/' || pathname === '/dino') {
        res.writeHead(302, { Location: '/dino/' }).end();
        return;
      }
      if (pathname === '/dino/runner.js') {
        body = runner;
        type = 'text/javascript';
      } else if (pathname === '/dino/dino-ai-lab.user.js') {
        body = await readFile(resolve(ROOT, 'userscripts/dino-ai-lab/dino-ai-lab.user.js'));
        type = 'text/javascript';
      } else {
        if (!pathname.startsWith('/dino/')) throw new Error('Not found');
        const relative = decodeURIComponent(pathname.slice('/dino/'.length)) || 'index.html';
        const file = resolve(GAME, relative);
        if (!file.startsWith(GAME + '/')) throw new Error('Not found');
        body = await readFile(file);
        type =
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.md': 'text/plain',
            '.txt': 'text/plain',
          }[extname(file)] || 'application/octet-stream';
        if (relative === 'index.html') body = body.toString().replace('<!-- AUDIO -->', sounds);
      }
      res.writeHead(200, {
        'Content-Type': `${type}${type.startsWith('text/') ? '; charset=utf-8' : ''}`,
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  await new Promise((yes, no) => {
    server.once('error', no);
    server.listen(port, '127.0.0.1', yes);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DINO_PORT || 8787);
  const server = await startDinoServer({ port });
  console.log(`Little Dino AI Lab: http://127.0.0.1:${server.address().port}/dino/`);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close(() => process.exit(0)));
}
