/** 检查更新: route choice (direct, then gh proxies), version comparison, which logs a client is shown. */
import { describe, expect, it } from 'vitest';
import { checkForUpdate, findRoute, GH_PROXIES, MANIFEST_URL, viaRoute, type ReleaseManifest } from '../src/game/update';
import { compareVersions } from '../src/game/version';

const manifest = (version: string): ReleaseManifest => ({
  version, tag: `v${version}`, date: '2026-09-27', page: 'https://github.com/x',
  assets: { pcSetup: 'https://github.com/a/setup.exe', pcPortable: 'https://github.com/a/portable.exe', android: 'https://github.com/a/app.apk' },
  changelog: [
    { version: '1.0.4', date: '', title: 'd', sections: {} },
    { version: '1.0.3', date: '', title: 'c', sections: {} },
    { version: '1.0.2', date: '', title: 'b', sections: {} },
    { version: '1.0.1', date: '', title: 'a', sections: {} },
  ],
});

describe('检查更新', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.0.2', '1.0.2')).toBe(0);
    expect(compareVersions('0.9', '1.0.0')).toBe(-1);
  });

  it('uses the direct route when GitHub answers', async () => {
    const asked: string[] = [];
    const hit = await findRoute(async (url) => { asked.push(url); return JSON.stringify(manifest('1.0.3')); });
    expect(hit?.route.kind).toBe('direct');
    expect(asked).toEqual([MANIFEST_URL]);
    expect(viaRoute(hit!.route, 'https://github.com/a/app.apk')).toBe('https://github.com/a/app.apk');
  });

  it('falls back to the first working proxy and downloads through it', async () => {
    const hit = await findRoute(async (url) => (url.startsWith(GH_PROXIES[1]!) ? JSON.stringify(manifest('1.0.3')) : null));
    expect(hit?.route.kind).toBe('proxy');
    expect(hit?.route.prefix).toBe(GH_PROXIES[1]);
    expect(viaRoute(hit!.route, 'https://github.com/a/app.apk')).toBe(`${GH_PROXIES[1]}https://github.com/a/app.apk`);
  });

  it('a broken answer counts as a failed route', async () => {
    const hit = await findRoute(async (url) => (url === MANIFEST_URL ? '<html>blocked</html>' : url.startsWith(GH_PROXIES[0]!) ? JSON.stringify(manifest('1.0.3')) : null));
    expect(hit?.route.prefix).toBe(GH_PROXIES[0]);
  });

  it('reports offline, latest, or the versions the client missed', async () => {
    expect((await checkForUpdate(async () => null, '1.0.2')).status).toBe('offline');
    expect((await checkForUpdate(async () => JSON.stringify(manifest('1.0.2')), '1.0.2')).status).toBe('latest');
    const r = await checkForUpdate(async () => JSON.stringify(manifest('1.0.4')), '1.0.2');
    expect(r.status).toBe('available');
    if (r.status === 'available') expect(r.logs.map((l) => l.version)).toEqual(['1.0.4', '1.0.3']);
  });
});
