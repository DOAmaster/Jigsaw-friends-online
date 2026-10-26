import { access, readFile, readdir } from 'node:fs/promises';
const required = ['netlify.toml', 'package.json', 'pnpm-lock.yaml', 'public/index.html', 'public/app.js', 'public/style.css', 'public/transport.js', 'netlify/functions/game.ts', 'src/game-service.mjs', 'src/puzzles.mjs'];
for (const file of required) await access(file);
const transport = await readFile('public/transport.js', 'utf8');
if (!transport.includes("'/.netlify/functions/game'")) throw new Error('Frontend is not calling the Netlify Function directly');
if (transport.includes('/api/game') || transport.includes('/api/room') || transport.includes('/api/action')) throw new Error('Legacy API route found in frontend transport');
const functions = await readdir('netlify/functions');
if (functions.length !== 1 || functions[0] !== 'game.ts') throw new Error(`Expected only game.ts under netlify/functions, found ${functions.join(', ')}`);
console.log('Static frontend and single Netlify Function source are ready.');
