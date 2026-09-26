/** Routes the current run screen to its scene. */
import { G, type Scene } from './core/app';
import { session } from './state';

let current: string | null = null;

export async function go(force = false) {
  const r = session.run;
  let next: Scene;
  if (!r) {
    const m = await import('./scenes/title');
    next = new m.TitleScene();
    current = 'title';
    await G.go(next);
    return;
  }
  const k = r.screen.k;
  const key = `${k}:${r.floor}:${r.act}`;
  if (!force && key === current && G.scene) return;
  current = key;
  switch (k) {
    case 'map': case 'actStart': next = new (await import('./scenes/map')).MapScene(); break;
    case 'combat': {
      // geometry must be chosen before the scene's views are constructed
      (await import('./scenes/combat/layout')).applyCombatLayout();
      next = new (await import('./scenes/combat/combatScene')).CombatScene();
      break;
    }
    case 'reward': case 'bossRelic': next = new (await import('./scenes/reward')).RewardScene(); break;
    case 'shop': next = new (await import('./scenes/shop')).ShopScene(); break;
    case 'camp': next = new (await import('./scenes/camp')).CampScene(); break;
    case 'event': next = new (await import('./scenes/event')).EventScene(); break;
    case 'recruit': next = new (await import('./scenes/recruit')).RecruitScene(); break;
    case 'stargaze': next = new (await import('./scenes/stargaze')).StargazeScene(); break;
    case 'chest': next = new (await import('./scenes/chest')).ChestScene(); break;
    case 'pick': case 'cardChoice': next = new (await import('./scenes/pick')).PickScene(); break;
    case 'victory': case 'defeat': case 'hiddenChoice': next = new (await import('./scenes/runEnd')).RunEndScene(); break;
    default: next = new (await import('./scenes/map')).MapScene();
  }
  await G.go(next);
}

/** apply a run action, then route */
export async function act(a: Parameters<typeof session.act>[0]): Promise<string | null> {
  const err = session.act(a);
  if (!err) await go(true);
  return err;
}

export function resetRoute() { current = null; }
session.router = () => { void go(true); };
G.onProfileChange = () => { void go(true); };
