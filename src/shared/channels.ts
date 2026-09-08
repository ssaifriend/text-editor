export const channels = {
  appBootstrap: 'app.bootstrap',
  fsOpen: 'fs.open',
  fsSave: 'fs.save',
  fsWatch: 'fs.watch',
  fsUnwatch: 'fs.unwatch',
  fsTree: 'fs.tree',
  fsCreate: 'fs.create',
  fsRename: 'fs.rename',
  fsDelete: 'fs.delete',
  dialogOpenFolder: 'dialog.openFolder',
  windowNew: 'window.new',
  sessionLoad: 'session.load',
  indexBuild: 'index.build',
  indexQuery: 'index.query',
  sessionSave: 'session.save',
  dialogOpenFile: 'dialog.openFile',
  dialogSaveFile: 'dialog.saveFile',
  dialogConfirmClose: 'dialog.confirmClose',
  configGet: 'config.get',
  keymapGet: 'keymap.get',
  ptySpawn: 'pty.spawn',
  ptyWrite: 'pty.write',
  ptyResize: 'pty.resize',
  ptyKill: 'pty.kill',
  ptyIsAlive: 'pty.isAlive',
  ptyAck: 'pty.ack',
  dirtyWrite: 'dirty.write',
  dirtyClear: 'dirty.clear',
  dirtyList: 'dirty.list',
  perfFirstPaint: 'perf.firstPaint',
  logWrite: 'log.write',
  configChanged: 'config.changed',
  keymapChanged: 'keymap.changed',
  commandRun: 'command.run',
  ptyData: 'pty.data',
  ptyExit: 'pty.exit',
  fsChanged: 'fs.changed',
  fsDeleted: 'fs.deleted',
  indexChanged: 'index.changed',
} as const

export type Channel = (typeof channels)[keyof typeof channels]

export const sendChannels: readonly Channel[] = [channels.perfFirstPaint, channels.logWrite, channels.ptyAck, channels.sessionSave]

export const pushChannels: readonly Channel[] = [
  channels.configChanged,
  channels.keymapChanged,
  channels.commandRun,
  channels.ptyData,
  channels.ptyExit,
  channels.fsChanged,
  channels.fsDeleted,
  channels.indexChanged,
]

export const channelList: readonly Channel[] = Object.values(channels).filter((c) => !pushChannels.includes(c))
