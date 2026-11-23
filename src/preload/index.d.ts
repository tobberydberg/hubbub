import type { HubbubApi } from '@shared/ipc'

declare global {
  interface Window {
    hubbub: HubbubApi
  }
}

export {}
