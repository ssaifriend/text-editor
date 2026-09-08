import { writeFile } from 'node:fs/promises'
import { BrowserWindow } from 'electron'

export const writeHtml = (path: string, html: string): Promise<void> => writeFile(path, html, 'utf8')

export const writePdf = async (path: string, html: string): Promise<void> => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await writeFile(path, pdf)
  } finally {
    window.destroy()
  }
}
