import type { ThemeName } from '@renderer/store/prefs'

// Colors follow Mattermost's built-in themes so the app feels familiar.
export interface Theme {
  label: string
  dark: boolean
  sidebarBg: string
  sidebarText: string
  sidebarUnreadText: string
  sidebarTextHoverBg: string
  sidebarTextActiveBorder: string
  sidebarTextActiveColor: string
  sidebarHeaderBg: string
  sidebarHeaderTextColor: string
  sidebarTeamBarBg: string
  onlineIndicator: string
  awayIndicator: string
  dndIndicator: string
  mentionBg: string
  mentionColor: string
  centerChannelBg: string
  centerChannelColor: string
  newMessageSeparator: string
  linkColor: string
  buttonBg: string
  buttonColor: string
  errorTextColor: string
  mentionHighlightBg: string
  mentionHighlightLink: string
}

export const THEMES: Record<Exclude<ThemeName, 'system'>, Theme> = {
  denim: {
    label: 'Denim',
    dark: false,
    sidebarBg: '#1e325c',
    sidebarText: '#ffffff',
    sidebarUnreadText: '#ffffff',
    sidebarTextHoverBg: '#28427b',
    sidebarTextActiveBorder: '#5d89ea',
    sidebarTextActiveColor: '#ffffff',
    sidebarHeaderBg: '#192a4d',
    sidebarHeaderTextColor: '#ffffff',
    sidebarTeamBarBg: '#14213e',
    onlineIndicator: '#3db887',
    awayIndicator: '#ffbc1f',
    dndIndicator: '#d24b4e',
    mentionBg: '#ffffff',
    mentionColor: '#1e325c',
    centerChannelBg: '#ffffff',
    centerChannelColor: '#3f4350',
    newMessageSeparator: '#cc8f00',
    linkColor: '#386fe5',
    buttonBg: '#1c58d9',
    buttonColor: '#ffffff',
    errorTextColor: '#d24b4e',
    mentionHighlightBg: '#ffd470',
    mentionHighlightLink: '#1b1d22'
  },
  sapphire: {
    label: 'Sapphire',
    dark: false,
    sidebarBg: '#174ab5',
    sidebarText: '#ffffff',
    sidebarUnreadText: '#ffffff',
    sidebarTextHoverBg: '#2a58ba',
    sidebarTextActiveBorder: '#57b5f0',
    sidebarTextActiveColor: '#ffffff',
    sidebarHeaderBg: '#1542a2',
    sidebarHeaderTextColor: '#ffffff',
    sidebarTeamBarBg: '#133a91',
    onlineIndicator: '#3db887',
    awayIndicator: '#ffbc1f',
    dndIndicator: '#d24b4e',
    mentionBg: '#ffffff',
    mentionColor: '#174ab5',
    centerChannelBg: '#ffffff',
    centerChannelColor: '#3f4350',
    newMessageSeparator: '#15b7b7',
    linkColor: '#1c58d9',
    buttonBg: '#1c58d9',
    buttonColor: '#ffffff',
    errorTextColor: '#d24b4e',
    mentionHighlightBg: '#7ff0f0',
    mentionHighlightLink: '#0d6e6e'
  },
  quartz: {
    label: 'Quartz',
    dark: false,
    sidebarBg: '#f4f4f6',
    sidebarText: '#090a0b',
    sidebarUnreadText: '#2d3039',
    sidebarTextHoverBg: '#dfe0e4',
    sidebarTextActiveBorder: '#32a4ec',
    sidebarTextActiveColor: '#2d3039',
    sidebarHeaderBg: '#e8e9ed',
    sidebarHeaderTextColor: '#2d3039',
    sidebarTeamBarBg: '#dddfe4',
    onlineIndicator: '#3db887',
    awayIndicator: '#f5ab00',
    dndIndicator: '#d24b4e',
    mentionBg: '#1c58d9',
    mentionColor: '#ffffff',
    centerChannelBg: '#ffffff',
    centerChannelColor: '#3f4350',
    newMessageSeparator: '#15b7b7',
    linkColor: '#1c58d9',
    buttonBg: '#1c58d9',
    buttonColor: '#ffffff',
    errorTextColor: '#d24b4e',
    mentionHighlightBg: '#7ff0f0',
    mentionHighlightLink: '#0d6e6e'
  },
  indigo: {
    label: 'Indigo',
    dark: true,
    sidebarBg: '#151e32',
    sidebarText: '#ffffff',
    sidebarUnreadText: '#ffffff',
    sidebarTextHoverBg: '#222c3f',
    sidebarTextActiveBorder: '#1c58d9',
    sidebarTextActiveColor: '#ffffff',
    sidebarHeaderBg: '#11192a',
    sidebarHeaderTextColor: '#dddfe4',
    sidebarTeamBarBg: '#0b1121',
    onlineIndicator: '#3db887',
    awayIndicator: '#f5ab00',
    dndIndicator: '#d24b4e',
    mentionBg: '#1c58d9',
    mentionColor: '#ffffff',
    centerChannelBg: '#111827',
    centerChannelColor: '#dddfe4',
    newMessageSeparator: '#81a3ef',
    linkColor: '#5d89ea',
    buttonBg: '#1c58d9',
    buttonColor: '#ffffff',
    errorTextColor: '#d24b4e',
    mentionHighlightBg: '#133a91',
    mentionHighlightLink: '#a4f4f4'
  },
  onyx: {
    label: 'Onyx',
    dark: true,
    sidebarBg: '#202228',
    sidebarText: '#ffffff',
    sidebarUnreadText: '#ffffff',
    sidebarTextHoverBg: '#25262a',
    sidebarTextActiveBorder: '#1592e0',
    sidebarTextActiveColor: '#ffffff',
    sidebarHeaderBg: '#24272d',
    sidebarHeaderTextColor: '#ffffff',
    sidebarTeamBarBg: '#1b1d22',
    onlineIndicator: '#3db887',
    awayIndicator: '#f5ab00',
    dndIndicator: '#d24b4e',
    mentionBg: '#1592e0',
    mentionColor: '#ffffff',
    centerChannelBg: '#191b1f',
    centerChannelColor: '#e3e4e8',
    newMessageSeparator: '#1adbdb',
    linkColor: '#1592e0',
    buttonBg: '#1592e0',
    buttonColor: '#ffffff',
    errorTextColor: '#da6c6e',
    mentionHighlightBg: '#0d6e6e',
    mentionHighlightLink: '#a4f4f4'
  }
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

export function resolveTheme(name: ThemeName): Theme {
  if (name === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? THEMES.onyx : THEMES.denim
  }
  return THEMES[name] ?? THEMES.denim
}

export function applyTheme(name: ThemeName): void {
  const theme = resolveTheme(name)
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme)) {
    if (typeof v === 'string' && v.startsWith('#')) root.style.setProperty(`--${kebab(k)}`, v)
  }
  root.dataset.dark = theme.dark ? 'true' : 'false'
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
}
