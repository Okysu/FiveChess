/**
 * Debug APK for testing on a phone: android/ (Capacitor) → release/mingque-debug.apk.
 * JDK and Android SDK come from JAVA_HOME / ANDROID_HOME, falling back to the local ~/SDK install.
 *   npm run android:apk
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

const gradlew = path.resolve('android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const r = spawnSync(gradlew, ['assembleDebug', '--no-daemon', '-q'], { cwd: 'android', stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome } });
if (r.status !== 0) process.exit(r.status ?? 1);
const apk = 'android/app/build/outputs/apk/debug/app-debug.apk';
fs.mkdirSync('release', { recursive: true });
fs.copyFileSync(apk, 'release/mingque-debug.apk');
console.log(`release/mingque-debug.apk ${(fs.statSync(apk).size / 1048576).toFixed(1)} MB`);
