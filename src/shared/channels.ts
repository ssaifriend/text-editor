export const channels = {
  appBootstrap: 'app.bootstrap',
  fsOpen: 'fs.open',
  fsSave: 'fs.save',
  dialogOpenFile: 'dialog.openFile',
  dialogSaveFile: 'dialog.saveFile',
  configGet: 'config.get',
  dirtyWrite: 'dirty.write',
  dirtyClear: 'dirty.clear',
  dirtyList: 'dirty.list',
  perfFirstPaint: 'perf.firstPaint',
  logWrite: 'log.write',
  configChanged: 'config.changed',
} as const

export type Channel = (typeof channels)[keyof typeof channels]

export const sendChannels: readonly Channel[] = [channels.perfFirstPaint, channels.logWrite]

export const pushChannels: readonly Channel[] = [channels.configChanged]

export const channelList: readonly Channel[] = Object.values(channels).filter((c) => !pushChannels.includes(c))
