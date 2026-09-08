export const channels = {
  appBootstrap: 'app.bootstrap',
  fsOpen: 'fs.open',
  fsSave: 'fs.save',
  dialogOpenFile: 'dialog.openFile',
  dialogSaveFile: 'dialog.saveFile',
  perfFirstPaint: 'perf.firstPaint',
} as const

export type Channel = (typeof channels)[keyof typeof channels]

export const channelList: readonly Channel[] = Object.values(channels)

export const sendChannels: readonly Channel[] = [channels.perfFirstPaint]
