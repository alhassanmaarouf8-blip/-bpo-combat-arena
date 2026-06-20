import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreAnswer } from './panelscorer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const wavPath = path.resolve('C:\\Users\\lenovo\\Downloads\\answer.wav');
  const buf = await fs.readFile(wavPath);

  await Promise.race([
    (async () => {
      const cliStyle = await scoreAnswer(buf, { mimeType: 'audio/wav', level: 'a2-b1', scenarioId: 'general', userId: 'cli' });
      const routerStyle = await scoreAnswer(buf, { mimeType: 'audio/wav', level: 'a2-b1', scenarioId: 'general', userId: 'router' });
      const match = JSON.stringify(cliStyle) === JSON.stringify(routerStyle);
      const out = { cli: cliStyle, router: routerStyle, match };
      console.log(JSON.stringify(out, null, 2));
      process.exit(match ? 0 : 2);
    })(),
    (async () => {
      await new Promise((res) => setTimeout(res, 60000));
      console.error(JSON.stringify({ error: 'parity_timeout', afterMs: 60000 }));
      process.exit(3);
    })(),
  ]);
}

main().catch((e) => { console.error(e); process.exit(1); });
