export const channels = {
  appBootstrap: 'app.bootstrap',
  fsOpen: 'fs.open',
  fsSave: 'fs.save',
  dialogOpenFile: 'dialog.openFile',
  dialogSaveFile: 'dialog.saveFile',
  dialogConfirmClose: 'dialog.confirmClose',
  configGet: 'config.get',
  dirtyWrite: 'dirty.write',
  dirtyClear: 'dirty.clear',
  dirtyList: 'dirty.list',
  perfFirstPaint: 'perf.firstPaint',
  logWrite: 'log.write',
  configChanged: 'config.changed',
  commandRun: 'command.run',
} as const

export type Channel = (typeof channels)[keyof typeof channels]

export const sendChannels: readonly Channel[] = [channels.perfFirstPaint, channels.logWrite]

export const pushChannels: readonly Channel[] = [channels.configChanged, channels.commandRun]

export const channelList: readonly Channel[] = Object.values(channels).filter((c) => !pushChannels.includes(c))
