/**
 * 检查更新 (PC and Android clients): read latest.json from the newest GitHub Release, directly or — when GitHub is
 * slow or blocked — through a gh proxy mirror. The route that answered is also used for the download link.
 * The website never checks: it is updated in place by the deploy.
 */
import { APP_VERSION, compareVersions, type VersionLog } from './version';

export const RELEASE_REPO = 'Okysu/FiveChess';
/** mirrors that forward github.com release downloads (tried in order when the direct request fails) */
export const GH_PROXIES = ['https://gh-proxy.com/', 'https://ghfast.top/', 'https://ghproxy.net/'];
export const MANIFEST_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download/latest.json`;
const DIRECT_TIMEOUT = 5000;
const PROXY_TIMEOUT = 8000;

export interface ReleaseManifest {
  version: string;
  tag: string;
  date: string;
  page: string;
  assets: { pcSetup: string; pcPortable: string; android: string };
  changelog: VersionLog[];
}
export interface Route { kind: 'direct' | 'proxy'; prefix: string; label: string }
export type UpdateResult =
  | { status: 'latest'; route: Route; manifest: ReleaseManifest }
  | { status: 'available'; route: Route; manifest: ReleaseManifest; logs: VersionLog[] }
  | { status: 'offline' };

export type Fetcher = (url: string, ms: number) => Promise<string | null>;

function parse(text: string | null): ReleaseManifest | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as ReleaseManifest;
    return typeof m.version === 'string' && m.assets && Array.isArray(m.changelog) ? m : null;
  } catch { return null; }
}

/** direct first (short timeout), then each proxy; the first that returns a valid manifest wins */
export async function findRoute(fetcher: Fetcher): Promise<{ route: Route; manifest: ReleaseManifest } | null> {
  const direct = parse(await fetcher(MANIFEST_URL, DIRECT_TIMEOUT));
  if (direct) return { route: { kind: 'direct', prefix: '', label: '直连 GitHub' }, manifest: direct };
  for (const prefix of GH_PROXIES) {
    const m = parse(await fetcher(prefix + MANIFEST_URL, PROXY_TIMEOUT));
    if (m) return { route: { kind: 'proxy', prefix, label: `加速镜像（${new URL(prefix).host}）` }, manifest: m };
  }
  return null;
}

export async function checkForUpdate(fetcher: Fetcher, current = APP_VERSION): Promise<UpdateResult> {
  const hit = await findRoute(fetcher);
  if (!hit) return { status: 'offline' };
  const { route, manifest } = hit;
  if (compareVersions(manifest.version, current) <= 0) return { status: 'latest', route, manifest };
  const logs = manifest.changelog.filter((v) => compareVersions(v.version, current) > 0 && compareVersions(v.version, manifest.version) <= 0);
  return { status: 'available', route, manifest, logs };
}

/** a release asset through the chosen route */
export function viaRoute(route: Route, url: string): string {
  return route.prefix + url;
}
