# 命阙

国风 roguelike 卡牌构筑。执命者带着一副牌走进倒悬的命阙：主帅与副将、献牌为源、应对窗口与余烬、天命判定、双排战线——每张牌既是出牌，也是资源。

全部画面为统一的**木版年画**风格：卡框、按钮、面板、图标、立绘都是生成的贴图，代码里不画任何界面图形（`npm run check:ui` 强制检查）。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 校验数据 → 检查界面 → 类型检查 → 打包图集 → 生成鸣谢 → 构建到 dist/
npm test           # 界面检查 + 引擎/内容测试
```

需要 Node 20+。存档保存在浏览器 IndexedDB（带版本迁移）。

## 客户端（PC / 安卓）

同一套 Web 代码打包成客户端，不维护第二套界面：PC 用 **Electron**，安卓用 **Capacitor**。`npm run build:native` 构建客户端版 `dist/`（字体改为内置的离线子集 `assets/fonts/`，不注册 service worker）。平台差异只在 `src/game/platform.ts`：PC 有「退出游戏」和窗口全屏，安卓返回键等同 Esc（关闭弹窗/取消选择，否则最小化）。

```bash
npm run desktop          # 构建并在 Electron 窗口中运行
npm run desktop:dev      # 窗口直接连 npm run dev（热更新）
npm run desktop:smoke    # 启动 → 截图到 .cache/desktop-smoke.png → 报告页面错误 → 退出
npm run desktop:pack     # release/：mingque-setup-<版本>.exe（安装包）与 mingque-portable-<版本>.exe（免安装）
npm run android:apk      # release/mingque-debug.apk（调试签名，可直接装到手机测试）
```

- Electron 窗口从私有地址 `https://mingque.game/` 读取打包内的 `dist/`（不联网），存档在应用数据目录；F11 / Alt+Enter 切换全屏，窗口大小与全屏状态会记住。
- 安卓工程在 `android/`：横屏锁定、全屏沉浸、刘海区域由游戏内「HUD 安全区」处理。需要 JDK 21+ 与 Android SDK 36（`JAVA_HOME` / `ANDROID_HOME`，默认读取 `~/SDK/`）。图标与启动图：`npx tsx scripts/android-assets.ts`。
- 改了文案或内容后运行 `npm run fonts` 重新生成字体子集。

## 内容规模

| 类别 | 数量 |
|---|---|
| 卡牌 | 356（6 流派：赤·焚阳宗 / 玄·镇岳门 / 青·万木庭 / 金·观星阁 / 紫·幽弈坊 / 素·中立） |
| 主帅 / 副将 | 10 / 20 |
| 敌人 / 遭遇战 | 96 / 77（每幕普通、精英、首领，另有终局） |
| 遗物 / 规则改变型 | 94 / 30 |
| 丹药 | 26 |
| 事件 | 42 |
| 逆命（难度） | 15 级 |

完整表格：`npm run export:tables` → [docs/数据表/](docs/数据表/)。

## 目录

```
src/engine/      纯 TypeScript 规则引擎：动作 → 结算 → 事件流，种子随机，可在 Node 中运行
  combat/        战斗（任务栈、触发队列、应对链、天命判定、战线）、自动出牌 AI、难度曲线 tuning.ts
  run/           冒险层：地图、节点、奖励、商店、事件
src/data/        全部内容 JSON（zod 校验，DSL 见 docs/内容DSL.md）
src/game/        PixiJS 表现层：场景、界面（ui/skin.ts 是唯一的贴图渲染入口）、演出、音频
scripts/         数据校验、平衡模拟、美术生成、图集打包、表格导出、鸣谢生成
assets/          生成的素材 + manifest.json（每张图的来源、提示词、后处理）+ atlas/
art-src/         风格参考图（style_refs/）等素材源文件
docs/            设计文档、DSL、美术风格圣经、UI 研究笔记、平衡报告、数据表
electron/        PC 客户端外壳（main.cjs / preload.cjs）
android/         安卓客户端工程（Capacitor 生成）
godot/           已暂停的 Godot 移植：规则引擎已逐步对齐，界面未完成（改用 Electron / Capacitor）
```

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run validate` | 校验全部内容数据（引用、关键词、遭遇战、事件战斗） |
| `npm run sim -- --runs=10` | 自动模拟整局冒险，输出 [docs/平衡报告.md](docs/平衡报告.md) |
| `npm run export:tables` | 导出内容表（Markdown + JSON） |
| `npm run pack:atlas` | 把小贴图打包成运行时图集 `assets/atlas/` |
| `npm run credits` | 由 manifest 生成 `CREDITS.md` 与游戏内鸣谢页数据 |
| `npm run fonts` | 生成客户端内置字体子集 `assets/fonts/` |
| `npm run gen:sheets -- --only=card` | 合图生成美术（一次请求多张，再自动切图） |
| `npm run gen:art -- --only=background` | 单张生成美术（背景等全屏图） |

## 美术生成

美术只在本地/构建期生成，**密钥绝不进入前端产物**：

1. 复制 `.env.example` 为 `.env`，填入 `ASSET_GEN_API_KEY`（`.env` 已被 git 忽略）。
2. `npm run gen:sheets` 按类别合图生成：卡牌 3×3、敌人 4×2、首领/立绘 3×1、图标/遗物/丹药 4×3，按轮廓或白色分隔缝自动切图；切失败的格子留给下一轮。
3. `npm run gen:art` 生成背景等单张图。结果按提示词哈希缓存，改提示词才会重画。
4. 风格锁定见 [docs/美术风格圣经.md](docs/美术风格圣经.md)；参考图在 `art-src/style_refs/`。

> 当前密钥为多会话共享的临时密钥，正式发布前请联系密钥所有者轮换。

## 平衡

难度曲线集中在 `src/engine/combat/tuning.ts`（按幕 × 普通/精英/首领的敌方生命与伤害倍率，外加个别遭遇战修正），逆命加成叠加其上。意图预览与实际结算走同一套伤害计算。模拟 AI 为一步前瞻贪心，报告用于相对比较。

## 许可与鸣谢

见 [CREDITS.md](CREDITS.md)（游戏内：标题页「鸣谢」）。
