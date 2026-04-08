import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import { Howl, Howler } from 'howler'

export const AUDIO_URLS = {
  musicRun: '/assets/audio/music/run-bgm.mp3',
  jump: '/assets/audio/sfx/jump.ogg',
  land: '/assets/audio/sfx/land.ogg',
  coin: '/assets/audio/sfx/coin.ogg',
  break: '/assets/audio/sfx/break.ogg',
  fall: '/assets/audio/sfx/fall.ogg',
} as const

export type GameAudioControls = {
  /** Call after user gesture if needed; also runs once on first pointerdown. */
  unlock: () => void
  playJump: () => void
  playLand: () => void
  playCoin: () => void
  playBreak: () => void
  playFall: () => void
  setRunMusic: (playing: boolean) => void
}

type HowlBank = {
  music: Howl
  jump: Howl
  land: Howl
  coin: Howl
  break: Howl
  fall: Howl
}

const GameAudioContext = createContext<GameAudioControls | null>(null)

function createHowls(): HowlBank {
  return {
    music: new Howl({
      src: [AUDIO_URLS.musicRun],
      loop: true,
      volume: 0.32,
      html5: true,
    }),
    jump: new Howl({ src: [AUDIO_URLS.jump], volume: 0.55 }),
    land: new Howl({ src: [AUDIO_URLS.land], volume: 0.45 }),
    coin: new Howl({ src: [AUDIO_URLS.coin], volume: 0.5 }),
    break: new Howl({ src: [AUDIO_URLS.break], volume: 0.42 }),
    fall: new Howl({ src: [AUDIO_URLS.fall], volume: 0.5 }),
  }
}

let bank: HowlBank | null = null

function getBank(): HowlBank {
  if (!bank) bank = createHowls()
  return bank
}

export function GameAudioProvider({ children }: { children: ReactNode }) {
  const unlock = useCallback(() => {
    getBank()
    if (Howler.ctx?.state === 'suspended') void Howler.ctx.resume()
  }, [])

  useEffect(() => {
    const onFirst = () => unlock()
    window.addEventListener('pointerdown', onFirst, { passive: true })
    return () => window.removeEventListener('pointerdown', onFirst)
  }, [unlock])

  const value = useMemo<GameAudioControls>(
    () => ({
      unlock,
      playJump: () => {
        const h = getBank().jump
        const id = h.play()
        if (id !== undefined) h.volume(0.55, id)
      },
      playLand: () => {
        const h = getBank().land
        const id = h.play()
        if (id !== undefined) h.volume(0.45, id)
      },
      playCoin: () => {
        const h = getBank().coin
        const id = h.play()
        if (id !== undefined) h.volume(0.52, id)
      },
      playBreak: () => {
        const h = getBank().break
        const id = h.play()
        if (id !== undefined) h.volume(0.42, id)
      },
      playFall: () => {
        const h = getBank().fall
        const id = h.play()
        if (id !== undefined) h.volume(0.5, id)
      },
      setRunMusic: (playing: boolean) => {
        if (!playing) {
          bank?.music.stop()
          return
        }
        const m = getBank().music
        if (!m.playing()) m.play()
      },
    }),
    [unlock],
  )

  return <GameAudioContext.Provider value={value}>{children}</GameAudioContext.Provider>
}

export function useGameAudio(): GameAudioControls {
  const ctx = useContext(GameAudioContext)
  if (!ctx) throw new Error('useGameAudio must be used within GameAudioProvider')
  return ctx
}
