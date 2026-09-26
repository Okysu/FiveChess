/** the only native hooks the game uses (src/game/platform.ts): quit and window fullscreen */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mingqueNative', {
  platform: 'desktop',
  quit: () => ipcRenderer.send('mq:quit'),
  setFullscreen: (on) => ipcRenderer.send('mq:fullscreen', !!on),
  isFullscreen: () => ipcRenderer.sendSync('mq:isFullscreen'),
});
