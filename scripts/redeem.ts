/**
 * 兑换码 generator / decoder (offline; see src/engine/redeem.ts).
 *   npx tsx scripts/redeem.ts --type=xp --amount=5000                 one code, never expires, random serial
 *   npx tsx scripts/redeem.ts --type=xp --amount=2000 --days=30 --count=10 --serial=100
 *                                                                     10 codes (serials 100…109), valid 30 days
 *   npx tsx scripts/redeem.ts --until=2026-12-31 --amount=800         valid through a date
 *   npx tsx scripts/redeem.ts --decode=XXXXX-XXXXX-XXXXX-XXXXX-XXXXX   what a code contains
 * Each code works once per profile (type + param + serial), so give every player-facing code its own serial.
 */
import { decodeRedeem, encodeRedeem, expiryDate, expiryDay, isExpired, REDEEM_TYPES } from '../src/engine/redeem';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const fmtDay = (d: number) => (d === 0 ? '永久有效' : `有效期至 ${expiryDate(d).toISOString().slice(0, 10)}（UTC）`);

if (args.decode) {
  const r = decodeRedeem(String(args.decode));
  if (!r.ok) { console.error(`无效：${{ format: '格式不对', check: '校验失败（输错或被改过）', version: '版本不支持' }[r.error]}`); process.exit(1); }
  const c = r.code;
  console.log(JSON.stringify({ type: r.typeDef?.key ?? `未知类型 ${c.type}`, amount: c.amount, param: c.param, serial: c.serial, expiry: fmtDay(c.expiry), expired: isExpired(c) }, null, 2));
  process.exit(0);
}

const type = REDEEM_TYPES.find((t) => t.key === String(args.type ?? 'xp'));
if (!type) { console.error(`未知类型 ${args.type}；可用：${REDEEM_TYPES.map((t) => t.key).join(', ')}`); process.exit(1); }
const amount = Number(args.amount ?? 1000);
const count = Number(args.count ?? 1);
const expiry = args.until ? expiryDay(new Date(`${args.until}T00:00:00Z`)) : args.days ? expiryDay(new Date()) + Number(args.days) : 0;
const serial0 = args.serial !== undefined ? Number(args.serial) : Math.floor(Math.random() * (2 ** 20 - count));
console.log(`${type.describe(amount, 0)} · ${fmtDay(expiry)} · 序号 ${serial0}${count > 1 ? `…${serial0 + count - 1}` : ''}`);
for (let i = 0; i < count; i++) console.log(encodeRedeem({ type: type.id, param: Number(args.param ?? 0), amount, expiry, serial: serial0 + i }));
