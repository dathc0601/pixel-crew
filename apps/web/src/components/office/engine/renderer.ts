import { TileType, TILE_SIZE, CharacterState, Direction } from '../types'
import type { TileType as TileTypeVal, FurnitureInstance, Character, SpriteData, FloorColor } from '../types'
import { getCachedSprite, getOutlineSprite } from '../sprites/spriteCache'
import { getCharacterSprites, BUBBLE_PERMISSION_SPRITE, BUBBLE_WORKING_SPRITE, BUBBLE_WAITING_SPRITE } from '../sprites/spriteData'
import { getCharacterSprite, isSeatedIdle } from './characters'
import { getBossSprites } from '../sprites/bossLook'
import { renderZoneTint, zoneLabelDrawables } from './zoneRenderer'
import type { OfficeLayout } from '../types'
import { renderMatrixEffect } from './matrixEffect'
import { renderWithStaticLayer, staticCacheEnabled } from './staticLayer'
import { renderBossFlowOverlays, type BossFlowOverlays } from './bossFlowRenderer'
import { getColorizedFloorSprite, hasFloorSprites, WALL_COLOR } from '../floorTiles'
import { hasWallSprites, getWallInstances, wallColorToHex } from '../wallTiles'
import {
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  OUTLINE_Z_SORT_OFFSET,
  SELECTED_OUTLINE_ALPHA,
  HOVERED_OUTLINE_ALPHA,
  GHOST_PREVIEW_SPRITE_ALPHA,
  GHOST_PREVIEW_TINT_ALPHA,
  SELECTION_DASH_PATTERN,
  BUTTON_MIN_RADIUS,
  BUTTON_RADIUS_ZOOM_FACTOR,
  BUTTON_ICON_SIZE_FACTOR,
  BUTTON_LINE_WIDTH_MIN,
  BUTTON_LINE_WIDTH_ZOOM_FACTOR,
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  FALLBACK_FLOOR_COLOR,
  GRID_LINE_COLOR,
  VOID_TILE_OUTLINE_COLOR,
  VOID_TILE_DASH_PATTERN,
  GHOST_BORDER_HOVER_FILL,
  GHOST_BORDER_HOVER_STROKE,
  GHOST_BORDER_STROKE,
  GHOST_VALID_TINT,
  GHOST_INVALID_TINT,
  SELECTION_HIGHLIGHT_COLOR,
  DELETE_BUTTON_BG,
  ROTATE_BUTTON_BG,
  SPEECH_BUBBLE_FADE_SEC,
} from '../constants'

// ── Text measurement cache ──────────────────────────────────────
// Avoids calling ctx.measureText() every frame for the same text+font combo.
// When full, evicts the oldest half (insertion-order) instead of clearing all.
const textWidthCache = new Map<string, number>()
const TEXT_CACHE_MAX = 200

function measureTextCached(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  const key = `${font}|${text}`
  let w = textWidthCache.get(key)
  if (w !== undefined) return w
  ctx.font = font
  w = Math.ceil(ctx.measureText(text).width)
  // Evict oldest half when cache is full (Map maintains insertion order)
  if (textWidthCache.size >= TEXT_CACHE_MAX) {
    let toDelete = TEXT_CACHE_MAX >> 1
    for (const k of textWidthCache.keys()) {
      if (toDelete-- <= 0) break
      textWidthCache.delete(k)
    }
  }
  textWidthCache.set(key, w)
  return w
}

// ── Render functions ────────────────────────────────────────────

export function renderTileGrid(
  ctx: CanvasRenderingContext2D,
  tileMap: TileTypeVal[][],
  offsetX: number,
  offsetY: number,
  zoom: number,
  tileColors?: Array<FloorColor | null>,
  cols?: number,
  /** Only the tiles that touch this screen area (CSS px); omit for all of them */
  area?: Box,
): void {
  const s = TILE_SIZE * zoom
  const useSpriteFloors = hasFloorSprites()
  const tmRows = tileMap.length
  const tmCols = tmRows > 0 ? tileMap[0].length : 0
  const layoutCols = cols ?? tmCols
  const r0 = area ? Math.max(0, Math.floor((area.y0 - offsetY) / s) - 1) : 0
  const r1 = area ? Math.min(tmRows, Math.ceil((area.y1 - offsetY) / s) + 1) : tmRows
  const c0 = area ? Math.max(0, Math.floor((area.x0 - offsetX) / s) - 1) : 0
  const c1 = area ? Math.min(tmCols, Math.ceil((area.x1 - offsetX) / s) + 1) : tmCols

  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const tile = tileMap[r][c]

      if (tile === TileType.VOID) continue

      if (tile === TileType.WALL || !useSpriteFloors) {
        if (tile === TileType.WALL) {
          const colorIdx = r * layoutCols + c
          const wallColor = tileColors?.[colorIdx]
          ctx.fillStyle = wallColor ? wallColorToHex(wallColor) : WALL_COLOR
        } else {
          ctx.fillStyle = FALLBACK_FLOOR_COLOR
        }
        const x0 = Math.round(offsetX + c * s)
        const y0 = Math.round(offsetY + r * s)
        ctx.fillRect(x0, y0, Math.round(offsetX + (c + 1) * s) - x0, Math.round(offsetY + (r + 1) * s) - y0)
        continue
      }

      const colorIdx = r * layoutCols + c
      const color = tileColors?.[colorIdx] ?? { h: 0, s: 0, b: 0, c: 0 }
      const sprite = getColorizedFloorSprite(tile, color)
      const cached = getCachedSprite(sprite, zoom)
      // Snap to whole device pixels so fractional zooms leave no seams between tiles
      const x0 = Math.round(offsetX + c * s)
      const y0 = Math.round(offsetY + r * s)
      ctx.drawImage(cached, x0, y0, Math.round(offsetX + (c + 1) * s) - x0, Math.round(offsetY + (r + 1) * s) - y0)
    }
  }
}

export interface ZDrawable {
  zY: number
  draw: (ctx: CanvasRenderingContext2D) => void
  /** Screen-space bounds (CSS px) covering every pixel draw() may touch; used by the static layer */
  box?: Box
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Walls and furniture as z-sorted drawables. */
export function furnitureDrawables(furniture: FurnitureInstance[], offsetX: number, offsetY: number, zoom: number): ZDrawable[] {
  const out: ZDrawable[] = []
  for (const f of furniture) {
    const cached = getCachedSprite(f.sprite, zoom)
    const fx = offsetX + f.x * zoom
    const fy = offsetY + f.y * zoom
    out.push({
      zY: f.zY,
      draw: (c) => {
        c.drawImage(cached, fx, fy)
      },
      box: { x0: fx, y0: fy, x1: fx + cached.width, y1: fy + cached.height },
    })
  }
  return out
}

/** Characters (with their hover/selection outline and spawn effect) as z-sorted drawables. */
export function characterDrawables(
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  selectedAgentId: number | null,
  hoveredAgentId: number | null,
  characterScale = 1,
): ZDrawable[] {
  const drawables: ZDrawable[] = []
  const charZoom = zoom * characterScale
  for (const ch of characters) {
    const sprites = ch.isBoss ? getBossSprites(ch.palette) : getCharacterSprites(ch.palette, ch.hueShift)
    const spriteData = getCharacterSprite(ch, sprites)
    if (!spriteData) continue
    const cached = getCachedSprite(spriteData, charZoom)
    // Seated idle agents lean back from the desk they face
    const lean = isSeatedIdle(ch) ? (ch.dir === Direction.UP ? 2 : ch.dir === Direction.DOWN ? -1 : 0) : 0
    const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX + lean : 0
    const drawX = Math.round(offsetX + ch.x * zoom - cached.width / 2)
    const drawY = Math.round(offsetY + (ch.y + sittingOffset) * zoom - cached.height)
    // The outline is one sprite pixel wider on each side; the spawn effect stays inside the sprite
    const pad = Math.ceil(charZoom) + 1
    const box = { x0: drawX - pad, y0: drawY - pad, x1: drawX + cached.width + pad, y1: drawY + cached.height + pad }

    const charZY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET

    // Matrix spawn/despawn effect
    if (ch.matrixEffect) {
      const mDrawX = drawX
      const mDrawY = drawY
      const mSpriteData = spriteData
      const mCh = ch
      drawables.push({
        zY: charZY,
        draw: (c) => {
          renderMatrixEffect(c, mCh, mSpriteData, mDrawX, mDrawY, charZoom)
        },
        box,
      })
      continue
    }

    // White outline: full opacity for selected, 50% for hover
    const isSelected = selectedAgentId !== null && ch.id === selectedAgentId
    const isHovered = hoveredAgentId !== null && ch.id === hoveredAgentId
    if (isSelected || isHovered) {
      const outlineAlpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA
      const outlineData = getOutlineSprite(spriteData)
      const outlineCached = getCachedSprite(outlineData, charZoom)
      const olDrawX = drawX - charZoom
      const olDrawY = drawY - charZoom
      drawables.push({
        zY: charZY - OUTLINE_Z_SORT_OFFSET,
        draw: (c) => {
          c.save()
          c.globalAlpha = outlineAlpha
          c.drawImage(outlineCached, olDrawX, olDrawY)
          c.restore()
        },
        box,
      })
    }

    drawables.push({
      zY: charZY,
      draw: (c) => {
        c.drawImage(cached, drawX, drawY)
      },
      box,
    })
  }
  return drawables
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  furniture: FurnitureInstance[],
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  selectedAgentId: number | null,
  hoveredAgentId: number | null,
  characterScale = 1,
  extra?: ZDrawable[],
): void {
  const drawables: ZDrawable[] = [
    ...(extra ?? []),
    ...furnitureDrawables(furniture, offsetX, offsetY, zoom),
    ...characterDrawables(characters, offsetX, offsetY, zoom, selectedAgentId, hoveredAgentId, characterScale),
  ]

  // Sort by Y (lower = in front = drawn later); the sort is stable, so ties keep this order
  drawables.sort((a, b) => a.zY - b.zY)

  for (const d of drawables) {
    d.draw(ctx)
  }
}

// ── Edit mode overlays ──────────────────────────────────────────

export function renderGridOverlay(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  rows: number,
  tileMap?: TileTypeVal[][],
): void {
  const s = TILE_SIZE * zoom
  ctx.strokeStyle = GRID_LINE_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let c = 0; c <= cols; c++) {
    const x = offsetX + c * s + 0.5
    ctx.moveTo(x, offsetY)
    ctx.lineTo(x, offsetY + rows * s)
  }
  for (let r = 0; r <= rows; r++) {
    const y = offsetY + r * s + 0.5
    ctx.moveTo(offsetX, y)
    ctx.lineTo(offsetX + cols * s, y)
  }
  ctx.stroke()

  // Void tiles: dashed outline
  if (tileMap) {
    ctx.save()
    ctx.strokeStyle = VOID_TILE_OUTLINE_COLOR
    ctx.lineWidth = 1
    ctx.setLineDash(VOID_TILE_DASH_PATTERN)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (tileMap[r]?.[c] === TileType.VOID) {
          ctx.strokeRect(offsetX + c * s + 0.5, offsetY + r * s + 0.5, s - 1, s - 1)
        }
      }
    }
    ctx.restore()
  }
}

export function renderGhostBorder(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  rows: number,
  ghostHoverCol: number,
  ghostHoverRow: number,
): void {
  const s = TILE_SIZE * zoom
  ctx.save()

  const ghostTiles: Array<{ c: number; r: number }> = []
  for (let c = -1; c <= cols; c++) {
    ghostTiles.push({ c, r: -1 })
    ghostTiles.push({ c, r: rows })
  }
  for (let r = 0; r < rows; r++) {
    ghostTiles.push({ c: -1, r })
    ghostTiles.push({ c: cols, r })
  }

  for (const { c, r } of ghostTiles) {
    const x = offsetX + c * s
    const y = offsetY + r * s
    const isHovered = c === ghostHoverCol && r === ghostHoverRow
    if (isHovered) {
      ctx.fillStyle = GHOST_BORDER_HOVER_FILL
      ctx.fillRect(x, y, s, s)
    }
    ctx.strokeStyle = isHovered ? GHOST_BORDER_HOVER_STROKE : GHOST_BORDER_STROKE
    ctx.lineWidth = 1
    ctx.setLineDash(VOID_TILE_DASH_PATTERN)
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1)
  }

  ctx.restore()
}

export function renderGhostPreview(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteData,
  col: number,
  row: number,
  valid: boolean,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const cached = getCachedSprite(sprite, zoom)
  const x = offsetX + col * TILE_SIZE * zoom
  const y = offsetY + row * TILE_SIZE * zoom
  ctx.save()
  ctx.globalAlpha = GHOST_PREVIEW_SPRITE_ALPHA
  ctx.drawImage(cached, x, y)
  ctx.globalAlpha = GHOST_PREVIEW_TINT_ALPHA
  ctx.fillStyle = valid ? GHOST_VALID_TINT : GHOST_INVALID_TINT
  ctx.fillRect(x, y, cached.width, cached.height)
  ctx.restore()
}

export function renderSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const s = TILE_SIZE * zoom
  const x = offsetX + col * s
  const y = offsetY + row * s
  ctx.save()
  ctx.strokeStyle = SELECTION_HIGHLIGHT_COLOR
  ctx.lineWidth = 2
  ctx.setLineDash(SELECTION_DASH_PATTERN)
  ctx.strokeRect(x + 1, y + 1, w * s - 2, h * s - 2)
  ctx.restore()
}

export interface ButtonBounds {
  cx: number
  cy: number
  radius: number
}

export function renderDeleteButton(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  _h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): ButtonBounds {
  const s = TILE_SIZE * zoom
  const cx = offsetX + (col + w) * s + 1
  const cy = offsetY + row * s - 1
  const radius = Math.max(BUTTON_MIN_RADIUS, zoom * BUTTON_RADIUS_ZOOM_FACTOR)

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = DELETE_BUTTON_BG
  ctx.fill()

  ctx.strokeStyle = '#fff'
  ctx.lineWidth = Math.max(BUTTON_LINE_WIDTH_MIN, zoom * BUTTON_LINE_WIDTH_ZOOM_FACTOR)
  ctx.lineCap = 'round'
  const xSize = radius * BUTTON_ICON_SIZE_FACTOR
  ctx.beginPath()
  ctx.moveTo(cx - xSize, cy - xSize)
  ctx.lineTo(cx + xSize, cy + xSize)
  ctx.moveTo(cx + xSize, cy - xSize)
  ctx.lineTo(cx - xSize, cy + xSize)
  ctx.stroke()
  ctx.restore()

  return { cx, cy, radius }
}

export function renderRotateButton(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  _w: number,
  _h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): ButtonBounds {
  const s = TILE_SIZE * zoom
  const radius = Math.max(BUTTON_MIN_RADIUS, zoom * BUTTON_RADIUS_ZOOM_FACTOR)
  const cx = offsetX + col * s - 1
  const cy = offsetY + row * s - 1

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = ROTATE_BUTTON_BG
  ctx.fill()

  ctx.strokeStyle = '#fff'
  ctx.lineWidth = Math.max(BUTTON_LINE_WIDTH_MIN, zoom * BUTTON_LINE_WIDTH_ZOOM_FACTOR)
  ctx.lineCap = 'round'
  const arcR = radius * BUTTON_ICON_SIZE_FACTOR
  ctx.beginPath()
  ctx.arc(cx, cy, arcR, -Math.PI * 0.8, Math.PI * 0.7)
  ctx.stroke()
  const endAngle = Math.PI * 0.7
  const endX = cx + arcR * Math.cos(endAngle)
  const endY = cy + arcR * Math.sin(endAngle)
  const arrowSize = radius * 0.35
  ctx.beginPath()
  ctx.moveTo(endX + arrowSize * 0.6, endY - arrowSize * 0.3)
  ctx.lineTo(endX, endY)
  ctx.lineTo(endX + arrowSize * 0.7, endY + arrowSize * 0.5)
  ctx.stroke()
  ctx.restore()

  return { cx, cy, radius }
}

// ── Speech bubbles ──────────────────────────────────────────────

export function renderBubbles(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  characterScale = 1,
): void {
  const charZoom = zoom * characterScale
  for (const ch of characters) {
    if (!ch.bubbleType) continue

    const sprite = ch.bubbleType === 'permission'
      ? BUBBLE_PERMISSION_SPRITE
      : ch.bubbleType === 'working'
        ? BUBBLE_WORKING_SPRITE
        : BUBBLE_WAITING_SPRITE

    let alpha = 1.0
    if (ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC
    }

    const cached = getCachedSprite(sprite, charZoom)
    const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0
    const bubbleX = Math.round(offsetX + ch.x * zoom - cached.width / 2)
    const bubbleY = Math.round(offsetY + (ch.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX * characterScale) * zoom - cached.height - 1 * zoom)

    ctx.save()
    if (alpha < 1.0) ctx.globalAlpha = alpha
    ctx.drawImage(cached, bubbleX, bubbleY)
    ctx.restore()
  }
}

// ── Text speech bubbles ─────────────────────────────────────────

export function renderSpeechBubbles(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  characterScale = 1,
): void {
  const charZoom = zoom * characterScale
  const px = Math.max(1, Math.round(charZoom))

  for (const ch of characters) {
    if (!ch.speechText) continue

    let alpha = 1.0
    if (ch.speechTimer < SPEECH_BUBBLE_FADE_SEC) {
      alpha = Math.max(0, ch.speechTimer / SPEECH_BUBBLE_FADE_SEC)
    }
    if (alpha <= 0) continue

    const fontSize = Math.max(7, Math.round(4.5 * charZoom))
    const font = `${fontSize}px monospace`
    const textW = measureTextCached(ctx, ch.speechText, font)
    const textH = fontSize
    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.font = font

    const padX = 3 * px
    const padY = 2 * px
    const boxW = textW + padX * 2
    const boxH = textH + padY * 2
    const tailH = 3 * px

    const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0
    const bubbleX = Math.round(offsetX + ch.x * zoom - boxW / 2)
    const bubbleY = Math.round(
      offsetY + (ch.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX * characterScale) * zoom - boxH - tailH - 4 * px
    )

    if (alpha < 1.0) ctx.globalAlpha = alpha

    // Pixel-art style: outer border (dark)
    ctx.fillStyle = '#333'
    ctx.fillRect(bubbleX - px, bubbleY, boxW + 2 * px, boxH + px)
    ctx.fillRect(bubbleX, bubbleY - px, boxW, boxH + 2 * px)

    // White fill
    ctx.fillStyle = '#fff'
    ctx.fillRect(bubbleX, bubbleY, boxW, boxH)

    // Pixel tail — small triangle pointing down
    const tailCX = Math.round(bubbleX + boxW / 2)
    // Border of tail
    ctx.fillStyle = '#333'
    ctx.fillRect(tailCX - 2 * px, bubbleY + boxH, 4 * px, px)
    ctx.fillRect(tailCX - px, bubbleY + boxH + px, 2 * px, px)
    ctx.fillRect(tailCX, bubbleY + boxH + 2 * px, px, px)
    // White interior of tail
    ctx.fillStyle = '#fff'
    ctx.fillRect(tailCX - px, bubbleY + boxH, 2 * px, px)
    ctx.fillRect(tailCX, bubbleY + boxH + px, px, px)

    // Text
    ctx.fillStyle = '#222'
    ctx.textBaseline = 'top'
    ctx.fillText(ch.speechText, bubbleX + padX, bubbleY + padY)

    ctx.restore()
  }
}

// ── Agent name badges ────────────────────────────────────────────

export function renderNameBadges(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  characterScale = 1,
): void {
  const charZoom = zoom * characterScale
  const px = Math.max(1, Math.round(charZoom))

  for (const ch of characters) {
    if (!ch.label) continue
    if (ch.matrixEffect === 'despawn') continue

    const fontSize = Math.max(6, Math.round(3.5 * charZoom))
    const font = `bold ${fontSize}px monospace`
    const textW = measureTextCached(ctx, ch.label, font)
    const textH = fontSize
    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.font = font

    const padX = 2 * px
    const padY = 1 * px
    const boxW = textW + padX * 2
    const boxH = textH + padY * 2

    const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0
    // Position above the character head — bubbles drawn later will naturally overlap
    const BADGE_VERTICAL_OFFSET_PX = 26
    const badgeX = Math.round(offsetX + ch.x * zoom - boxW / 2)
    const badgeY = Math.round(offsetY + (ch.y + sittingOff - BADGE_VERTICAL_OFFSET_PX * characterScale) * zoom - boxH)

    const bgColor = ch.labelColor ?? '#8a7a6a'

    // Pixel-art border (darker version of bg)
    ctx.fillStyle = '#222'
    ctx.fillRect(badgeX - px, badgeY, boxW + 2 * px, boxH + px)
    ctx.fillRect(badgeX, badgeY - px, boxW, boxH + 2 * px)

    // Colored fill
    ctx.fillStyle = bgColor
    ctx.fillRect(badgeX, badgeY, boxW, boxH)

    // White text
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'top'
    ctx.fillText(ch.label, badgeX + padX, badgeY + padY)

    ctx.restore()
  }
}

// ── Editor render state ─────────────────────────────────────────

export interface EditorRenderState {
  showGrid: boolean
  ghostSprite: SpriteData | null
  ghostCol: number
  ghostRow: number
  ghostValid: boolean
  selectedCol: number
  selectedRow: number
  selectedW: number
  selectedH: number
  hasSelection: boolean
  isRotatable: boolean
  deleteButtonBounds: ButtonBounds | null
  rotateButtonBounds: ButtonBounds | null
  showGhostBorder: boolean
  ghostBorderHoverCol: number
  ghostBorderHoverRow: number
}

// ── Main frame ──────────────────────────────────────────────────

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  tileMap: TileTypeVal[][],
  furniture: FurnitureInstance[],
  characters: Character[],
  zoom: number,
  panX: number,
  panY: number,
  selectedAgentId: number | null,
  hoveredAgentId: number | null,
  tileColors?: Array<FloorColor | null>,
  layoutCols?: number,
  layoutRows?: number,
  editor?: EditorRenderState,
  backgroundImage?: HTMLImageElement | null,
  characterScale?: number,
  bossFlow?: BossFlowOverlays,
  zoneLayout?: OfficeLayout,
): { offsetX: number; offsetY: number } {
  const charScale = characterScale ?? 1
  // Clear
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  const cols = layoutCols ?? (tileMap.length > 0 ? tileMap[0].length : 0)
  const rows = layoutRows ?? tileMap.length

  // Center map in viewport + pan offset
  const mapW = cols * TILE_SIZE * zoom
  const mapH = rows * TILE_SIZE * zoom
  const offsetX = Math.floor((canvasWidth - mapW) / 2) + Math.round(panX)
  const offsetY = Math.floor((canvasHeight - mapH) / 2) + Math.round(panY)

  const paintFloor = (c: CanvasRenderingContext2D, area?: Box) => {
    // Background image (from room ZIP import) replaces the tile floor
    if (backgroundImage) {
      c.save()
      c.imageSmoothingEnabled = false
      c.drawImage(backgroundImage, offsetX, offsetY, mapW, mapH)
      c.restore()
      return
    }
    renderTileGrid(c, tileMap, offsetX, offsetY, zoom, tileColors, layoutCols, area)
  }
  // Walls, furniture and room names (walls come from the background image when there is one)
  const staticItems = (): ZDrawable[] => {
    const wallInstances = !backgroundImage && hasWallSprites()
      ? getWallInstances(tileMap, tileColors, layoutCols)
      : []
    const labels = zoneLayout && !backgroundImage ? zoneLabelDrawables(zoneLayout, offsetX, offsetY, zoom) : []
    return [...labels, ...furnitureDrawables(wallInstances.length > 0 ? [...wallInstances, ...furniture] : furniture, offsetX, offsetY, zoom)]
  }

  // Outside the editor the static scene comes from a cached layer (P4.2); only the
  // characters' areas are redrawn each frame
  const cached = !editor && staticCacheEnabled() && renderWithStaticLayer(
    ctx,
    [tileMap, furniture, tileColors, layoutCols, backgroundImage, zoneLayout, zoom, offsetX, offsetY, hasFloorSprites(), hasWallSprites()],
    paintFloor,
    staticItems,
    characterDrawables(characters, offsetX, offsetY, zoom, selectedAgentId, hoveredAgentId, charScale),
  )
  if (!cached) {
    paintFloor(ctx)
    // Zone tint while editing (room names are z-sorted with the scene below)
    if (zoneLayout && editor && !backgroundImage) renderZoneTint(ctx, zoneLayout, offsetX, offsetY, zoom)
    const items = staticItems()
    renderScene(ctx, [], characters, offsetX, offsetY, zoom, selectedAgentId, hoveredAgentId, charScale, items)
  }

  // Boss crown, hand-off papers, queue board, subagent cue
  if (bossFlow) renderBossFlowOverlays(ctx, characters, offsetX, offsetY, zoom, charScale, bossFlow)

  // Agent name badges (drawn before bubbles so bubbles cover them)
  renderNameBadges(ctx, characters, offsetX, offsetY, zoom, charScale)

  // Speech bubbles (always on top)
  renderBubbles(ctx, characters, offsetX, offsetY, zoom, charScale)
  renderSpeechBubbles(ctx, characters, offsetX, offsetY, zoom, charScale)

  // Editor overlays
  if (editor) {
    if (editor.showGrid) {
      renderGridOverlay(ctx, offsetX, offsetY, zoom, cols, rows, tileMap)
    }
    if (editor.showGhostBorder) {
      renderGhostBorder(ctx, offsetX, offsetY, zoom, cols, rows, editor.ghostBorderHoverCol, editor.ghostBorderHoverRow)
    }
    if (editor.ghostSprite && editor.ghostCol >= 0) {
      renderGhostPreview(ctx, editor.ghostSprite, editor.ghostCol, editor.ghostRow, editor.ghostValid, offsetX, offsetY, zoom)
    }
    if (editor.hasSelection) {
      renderSelectionHighlight(ctx, editor.selectedCol, editor.selectedRow, editor.selectedW, editor.selectedH, offsetX, offsetY, zoom)
      editor.deleteButtonBounds = renderDeleteButton(ctx, editor.selectedCol, editor.selectedRow, editor.selectedW, editor.selectedH, offsetX, offsetY, zoom)
      if (editor.isRotatable) {
        editor.rotateButtonBounds = renderRotateButton(ctx, editor.selectedCol, editor.selectedRow, editor.selectedW, editor.selectedH, offsetX, offsetY, zoom)
      } else {
        editor.rotateButtonBounds = null
      }
    } else {
      editor.deleteButtonBounds = null
      editor.rotateButtonBounds = null
    }
  }

  return { offsetX, offsetY }
}
