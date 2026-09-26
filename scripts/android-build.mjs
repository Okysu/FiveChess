/**
 * APK from android/ (Capacitor) → release/.
 *   npm run android:apk                  debug-signed: release/mingque-<version>-debug.apk (install straight onto a phone)
 *   node scripts/android-build.mjs --release
 *                                        with MINGQUE_KEYSTORE (+ _PASSWORD, MINGQUE_KEY_ALIAS, MINGQUE_KEY_PASSWORD):
 *                                        release-signed release/mingque-<version>.apk; without a key it falls back to debug
 * JDK 21+ and the Android SDK come from JAVA_HOME / ANDROID_HOME, falling back to the local ~/SDK install.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sdkRoot = path.join(os.homedir(), 'SDK');
// newest matching folder first (Capacitor 8 needs JDK 21)
const firstDir = (dir, re) => { try { return fs.readdirSync(dir).filter((f) => re.test(f)).sort().reverse().map((f) => path.join(dir, f))[0]; } catch { return undefined; } };
const javaHome = process.env.JAVA_HOME || firstDir(path.join(sdkRoot, 'jdk'), /^jdk-?(21|2[2-9])/);
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(sdkRoot, 'android');
if (!javaHome || !fs.existsSync(androidHome)) { console.error('JDK 21+ or Android SDK not found (set JAVA_HOME / ANDROID_HOME)'); process.exit(1); }
fs.writeFileSync('android/local.properties', `sdk.dir=${androidHome.replace(/\\/g, '\\\\')}\n`);

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const key = process.env.MINGQUE_KEYSTORE;
const release = process.argv.includes('--release') && !!key && fs.existsSync(key);
if (process.argv.includes('--release') && !release) console.warn('android: no MINGQUE_KEYSTORE — building a debug-signed APK instead');

const gradlew = path.resolve('android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (process.platform !== 'win32') fs.chmodSync(gradlew, 0o755);
const task = release ? 'assembleRelease' : 'assembleDebug';
const r = spawnSync(`"${gradlew}" ${task} --no-daemon -q`, { cwd: 'android', stdio: 'inherit', shell: true, env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome } });
if (r.status !== 0) process.exit(r.status ?? 1);

const built = release ? 'android/app/build/outputs/apk/release/app-release.apk' : 'android/app/build/outputs/apk/debug/app-debug.apk';
const out = `release/mingque-${version}${release ? '' : '-debug'}.apk`;
fs.mkdirSync('release', { recursive: true });
fs.copyFileSync(built, out);
console.log(`${out} ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
