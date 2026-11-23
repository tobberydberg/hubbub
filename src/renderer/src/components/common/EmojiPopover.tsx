import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react'
import { Popover, type Anchor } from './Menu'

interface Props {
  anchor: Anchor
  onSelect: (emoji: string) => void
  onClose: () => void
}

export function EmojiPopover({ anchor, onSelect, onClose }: Props) {
  const dark = document.documentElement.dataset.dark === 'true'
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <EmojiPicker
        theme={dark ? Theme.DARK : Theme.LIGHT}
        emojiStyle={EmojiStyle.NATIVE}
        lazyLoadEmojis
        autoFocusSearch
        width={352}
        height={420}
        previewConfig={{ showPreview: false }}
        onEmojiClick={(e) => {
          onSelect(e.emoji)
          onClose()
        }}
      />
    </Popover>
  )
}
