/** the native hooks the game uses (src/game/platform.ts): quit, window fullscreen, update check fetch, open a link */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mingqueNative', {
  platform: 'desktop',
  quit: () => ipcRenderer.send('mq:quit'),
  setFullscreen: (on) => ipcRenderer.send('mq:fullscreen', !!on),
  isFullscreen: () => ipcRenderer.sendSync('mq:isFullscreen'),
  fetchText: (url, ms) => ipcRenderer.invoke('mq:fetch', url, ms),
  openExternal: (url) => ipcRenderer.send('mq:openExternal', url),
});
