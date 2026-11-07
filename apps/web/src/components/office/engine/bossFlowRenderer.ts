// Boss-flow overlays (P1.4–P1.6): the Boss's crown, hand-off papers, the queue board
// next to the Lead and the mini "subagent" sprite. Drawn after the z-sorted scene.

import { CharacterState, TILE_SIZE } from '../types'
import type { Character } from '../types'
import { CHARACTER_SITTING_OFFSET_PX } from '../constants'
import { getCharacterSprites } from '../sprites/spriteData'
import { getCachedSprite } from '../sprites/spriteCache'
import { getCharacterSprite } from './characters'

export interface BossFlowOverlays {
  taskBoard: { charId: number; count: number } | null
  subagentCues: ReadonlyMap<number, number>
  /** Receives the board's hit box in world px (null when not drawn) */
  setTaskBoardRect: (rect: { x: number; y: number; w: number; h: number } | null) => void
}

const CROWN = [
  '#f5c542', '', '#f5c542', '', '#f5c542',
  '#f5c542', '#f5c542', '#e8463c', '#f5c542', '#f5c542',
  '#d9a21b', '#d9a21b', '#d9a21b', '#d9a21b', '#d9a21b',
]
const CROWN_W = 5

/** Draw a pixel grid (row-major colors, '' = transparent) at world (wx, wy). */
function drawPixels(ctx: CanvasRenderingContext2D, pixels: string[], w: number, ox: number, oy: number, px: number): void {
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i]
    if (!c) continue
    ctx.fillStyle = c
    ctx.fillRect(ox + (i % w) * px, oy + Math.floor(i / w) * px, px, px)
  }
}

/** A sheet of paper with two text lines, top-left at screen (x, y), unit px. */
function drawPaper(ctx: CanvasRenderingContext2D, x: number, y: number, px: number): void {
  ctx.fillStyle = '#3a3a3a'
  ctx.fillRect(x - px, y - px, 6 * px, 7 * px)
  ctx.fillStyle = '#fbfbf2'
  ctx.fillRect(x, y, 4 * px, 5 * px)
  ctx.fillStyle = '#9aa0a6'
  ctx.fillRect(x + px, y + px, 2 * px, px)
  ctx.fillRect(x + px, y + 3 * px, 2 * px, px)
}

export function renderBossFlowOverlays(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  characterScale: number,
  overlays: BossFlowOverlays,
): void {
  const charZoom = zoom * characterScale
  const px = Math.max(1, Math.round(charZoom))
  ctx.save()
  ctx.imageSmoothingEnabled = false

  for (const ch of characters) {
    if (ch.matrixEffect) continue
    const sitting = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
    const sx = offsetX + ch.x * zoom
    const sy = offsetY + (ch.y + sitting) * zoom

    // Boss crown, just above the head
    if (ch.isBoss) {
      drawPixels(ctx, CROWN, CROWN_W, Math.round(sx - (CROWN_W * px) / 2), Math.round(sy - 25 * charZoom), px)
    }

    // Paper in hand while walking it over, or just received
    if (ch.carrying || (ch.paperTimer ?? 0) > 0) {
      drawPaper(ctx, Math.round(sx + 4 * charZoom), Math.round(sy - 13 * charZoom), px)
    }
  }

  // Mini subagent next to its Lead
  for (const [charId] of overlays.subagentCues) {
    const lead = characters.find((c) => c.id === charId)
    if (!lead || lead.matrixEffect) continue
    const sprites = getCharacterSprites(lead.palette, (lead.hueShift + 150) % 360)
    const sprite = getCharacterSprite({ ...lead, state: CharacterState.IDLE }, sprites)
    if (!sprite) continue
    const mini = getCachedSprite(sprite, charZoom * 0.55)
    const sitting = lead.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
    const mx = Math.round(offsetX + (lead.x - 11 * characterScale) * zoom - mini.width / 2)
    const my = Math.round(offsetY + (lead.y + sitting) * zoom - mini.height)
    ctx.globalAlpha = 0.9
    ctx.drawImage(mini, mx, my)
    ctx.globalAlpha = 1
    const font = `bold ${Math.max(6, Math.round(2.6 * charZoom))}px monospace`
    ctx.font = font
    ctx.textBaseline = 'top'
    const label = 'sub'
    const tw = Math.ceil(ctx.measureText(label).width)
    ctx.fillStyle = '#5b3fa0'
    ctx.fillRect(mx + mini.width / 2 - tw / 2 - px, my - 5 * px, tw + 2 * px, 4 * px)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, mx + mini.width / 2 - tw / 2, my - 5 * px)
  }

  // Queue board: a cork board beside the Lead holding one paper per queued item
  const board = overlays.taskBoard
  const lead = board ? characters.find((c) => c.id === board.charId) : undefined
  if (board && lead && !lead.matrixEffect) {
    const W = 14
    const H = 12
    const wx = lead.x + TILE_SIZE * 0.6
    const wy = lead.y - TILE_SIZE * 1.45
    overlays.setTaskBoardRect({ x: wx, y: wy, w: W, h: H + 6 })
    const bx = Math.round(offsetX + wx * zoom)
    const by = Math.round(offsetY + wy * zoom)
    const u = Math.max(1, zoom)
    // Legs
    ctx.fillStyle = '#5a3a1a'
    ctx.fillRect(bx + 2 * u, by + H * u, u, 6 * u)
    ctx.fillRect(bx + (W - 3) * u, by + H * u, u, 6 * u)
    // Frame + cork
    ctx.fillStyle = '#5a3a1a'
    ctx.fillRect(bx, by, W * u, H * u)
    ctx.fillStyle = '#c8955a'
    ctx.fillRect(bx + u, by + u, (W - 2) * u, (H - 2) * u)
    // Papers (up to 6), then a count badge
    const shown = Math.min(board.count, 6)
    for (let i = 0; i < shown; i++) {
      const col = i % 3
      const row = Math.floor(i / 3)
      ctx.fillStyle = '#fbfbf2'
      ctx.fillRect(bx + (2 + col * 4) * u, by + (2 + row * 4) * u, 3 * u, 3 * u)
      ctx.fillStyle = '#e8463c'
      ctx.fillRect(bx + (3 + col * 4) * u, by + (2 + row * 4) * u, u, u)
    }
    const label = String(board.count)
    const font = `bold ${Math.max(7, Math.round(4 * u))}px monospace`
    ctx.font = font
    ctx.textBaseline = 'top'
    const tw = Math.ceil(ctx.measureText(label).width)
    const badgeX = bx + W * u - tw / 2
    const badgeY = by - 3 * u
    ctx.fillStyle = '#222'
    ctx.fillRect(badgeX - 2 * u, badgeY - u, tw + 4 * u, 5 * u + 2)
    ctx.fillStyle = '#e8463c'
    ctx.fillRect(badgeX - u, badgeY - u + 1, tw + 2 * u, 5 * u)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, badgeX, badgeY)
  } else {
    overlays.setTaskBoardRect(null)
  }

  ctx.restore()
}
