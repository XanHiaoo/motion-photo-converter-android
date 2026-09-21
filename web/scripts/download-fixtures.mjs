import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'tests', 'fixtures');
const fixtures = [
  {
    name: 'samsung_motion_photo.heic',
    kind: 'Samsung Galaxy S22 Ultra Motion Photo',
    source: 'https://github.com/g0ddest/sm_motion_photo/blob/master/tests/data/photo-sg22-ultra.heic',
    url: 'https://raw.githubusercontent.com/g0ddest/sm_motion_photo/master/tests/data/photo-sg22-ultra.heic',
  },
  {
    name: 'apple_live_photo.jpg',
    kind: 'Apple Live Photo key image',
    source: 'https://github.com/LimitPoint/LivePhoto/tree/master/Sample%20Code/Live%20Photos',
    url: 'https://raw.githubusercontent.com/LimitPoint/LivePhoto/master/Sample%20Code/Live%20Photos/keyPhoto.jpg',
  },
  {
    name: 'apple_live_photo.mov',
    kind: 'Apple Live Photo paired video',
    source: 'https://github.com/LimitPoint/LivePhoto/tree/master/Sample%20Code/Live%20Photos',
    url: 'https://raw.githubusercontent.com/LimitPoint/LivePhoto/master/Sample%20Code/Live%20Photos/pairedVideo.mov',
  },
];

await mkdir(destination, { recursive: true });
const provenance = [];

async function fetchWithRetry(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw lastError;
}

for (const fixture of fixtures) {
  const response = await fetchWithRetry(fixture.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(destination, fixture.name), bytes);
  provenance.push({
    name: fixture.name,
    kind: fixture.kind,
    source: fixture.source,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  console.log(`Downloaded ${fixture.name} (${bytes.length} bytes)`);
}
await writeFile(path.join(destination, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
