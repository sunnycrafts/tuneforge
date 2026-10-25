const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  pin: (on) => ipcRenderer.invoke('window-pin', on),
  windowState: () => ipcRenderer.invoke('window-state'),
  onWindowState: (cb) => ipcRenderer.on('window-state', (_, s) => cb(s)),

  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSettings: (partial) => ipcRenderer.invoke('settings-set', partial),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  getHistory: () => ipcRenderer.invoke('history-get'),
  clearHistory: () => ipcRenderer.invoke('history-clear'),
  exportHistory: () => ipcRenderer.invoke('history-export'),
  log: (type, msg, detail) => ipcRenderer.send('log', { type, msg, detail }),
  onLog: (cb) => ipcRenderer.on('log-added', (_, e) => cb(e)),

  pathForFile: (file) => (webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : file.path),
  expandPaths: (paths) => ipcRenderer.invoke('expand-paths', paths),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolders: () => ipcRenderer.invoke('pick-folders'),
  pickFolder: (opts) => ipcRenderer.invoke('pick-folder', opts),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  itunesFolder: () => ipcRenderer.invoke('itunes-folder'),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_, files) => cb(files)),

  probe: (p, withThumb) => ipcRenderer.invoke('probe', p, withThumb),
  coverFull: (p) => ipcRenderer.invoke('cover-full', p),

  convertBegin: () => ipcRenderer.invoke('convert-begin'),
  convertCancel: () => ipcRenderer.invoke('convert-cancel'),
  convertOne: (job) => ipcRenderer.invoke('convert-one', job),
  onConvertProgress: (cb) => ipcRenderer.on('convert-progress', (_, d) => cb(d)),

  identify: (filePath, override) => ipcRenderer.invoke('identify', { filePath, override }),
  completeCandidate: (c) => ipcRenderer.invoke('complete-candidate', c),
  writeTags: (opts) => ipcRenderer.invoke('tags-write', opts),
});
