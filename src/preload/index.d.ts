import type { MoruApi } from './index'

declare global {
  interface Window {
    moru: MoruApi
  }
}

export {}
