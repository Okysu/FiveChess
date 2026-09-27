/** When and how the clients check for updates: once per launch from the title screen, or by hand from 设置. */
import { G } from './core/app';
import { session } from './state';
import { fetchText, isNativeApp } from './platform';
import { checkForUpdate } from './update';
import { toast } from './ui/widgets';

let checkedThisLaunch = false;

/** auto: silent unless there is something new (and not a version the player skipped); manual: always reports */
export async function runUpdateCheck(manual: boolean) {
  if (!isNativeApp) { if (manual) toast('网页版会自动保持最新'); return; }
  if (!manual && checkedThisLaunch) return;
  checkedThisLaunch = true;
  if (manual) toast('正在检查更新……');
  const r = await checkForUpdate(fetchText);
  if (r.status === 'offline') { if (manual) toast('连不上更新服务器（直连与加速线路都失败），请稍后再试'); return; }
  if (r.status === 'latest') { if (manual) toast(`已是最新版本 ${r.manifest.version}（${r.route.label}）`); return; }
  if (!manual && session.settings.skippedVersion === r.manifest.version) return;
  // don't stack on top of another dialog (e.g. 命书新章): wait until the modal layer is clear
  for (let i = 0; i < 240 && G.modalLayer.children.length; i++) await new Promise((res) => setTimeout(res, 500));
  const { openUpdateDialog } = await import('./ui/changelog');
  openUpdateDialog(r, { onSkip: () => { session.settings.skippedVersion = r.manifest.version; void session.saveSettings(); } });
}
