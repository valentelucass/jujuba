import { getSmoothStepPath, Position } from '@xyflow/react'
import { arrangeStages, NOTE_LINE_HEIGHT, NOTE_WIDTH, stageOutline } from './flowGeometry'
import { nodeKinds, type NodeKind, type SystemDiagram } from './systemDiagram'

const body = '#252329'
const ink = '#191619'
const panelMargin = 40
const notePadding = 8
const font = 'Geist Variable, Segoe UI, sans-serif'
const palettes: Record<NodeKind, [string, string]> = {
  start: ['#e4f6ec', '#216744'], end: ['#e4f6ec', '#216744'], connector: ['#e4f6ec', '#216744'],
  action: ['#fcebf4', '#904064'], document: ['#fcebf4', '#904064'], subprocess: ['#fcebf4', '#904064'],
  decision: ['#fff6dc', '#79570c'], inputOutput: ['#fff6dc', '#79570c'], extract: ['#fff6dc', '#79570c'],
}

function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  return text.replaceAll('\r\n', '\n').replace(/\n(?:[ \t]*\n){2,}/g, '\n\n').split('\n').flatMap((paragraph) => {
    const rows = []
    let line = ''
    for (let word of paragraph.split(/\s+/)) {
      const candidate = line ? line + ' ' + word : word
      if (context.measureText(candidate).width <= width) {
        line = candidate
        continue
      }
      if (line) rows.push(line)
      line = ''
      while (word && context.measureText(word).width > width) {
        const characters = Array.from(word)
        let index = 1
        while (index < characters.length && context.measureText(characters.slice(0, index + 1).join('')).width <= width) index++
        rows.push(characters.slice(0, index).join(''))
        word = characters.slice(index).join('')
      }
      line = word
    }
    rows.push(line)
    return rows
  })
}

export async function flowImage(diagram: SystemDiagram): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw { kind: 'file', message: 'Não foi possível criar a imagem do fluxograma.' }
  await document.fonts.ready

  const stages = arrangeStages(diagram)
  const boxes = new Map(stages.map((stage) => [stage.node.id, stage]))
  context.font = '15px ' + font
  const notes = (diagram.notes ?? []).filter(({ text }) => text.trim()).map(({ position, text }) => ({
    position, rows: wrap(context, text, NOTE_WIDTH - notePadding * 2),
  }))
  const items = [
    ...stages.map(({ position, geometry }) => ({ ...position, width: geometry.width, height: geometry.height })),
    ...notes.map(({ position, rows }) => ({ ...position, width: NOTE_WIDTH, height: rows.length * NOTE_LINE_HEIGHT + notePadding * 2 })),
  ]
  const left = Math.min(0, ...items.map(({ x }) => x)) - 38
  const top = Math.min(0, ...items.map(({ y }) => y)) - 38
  const right = Math.max(0, ...items.map(({ x, width }) => x + width)) + 38
  const bottom = Math.max(0, ...items.map(({ y, height }) => y + height)) + 38
  const zoom = Math.min(1.6, 1560 / Math.max(right - left, bottom - top))
  const graphWidth = Math.ceil((right - left) * zoom)
  const graphHeight = Math.ceil((bottom - top) * zoom)
  const width = Math.max(840, graphWidth + panelMargin * 2)
  const textWidth = width - panelMargin * 2
  context.font = '700 34px ' + font
  const title = wrap(context, diagram.title.trim() || 'Fluxograma', textWidth)
  context.font = '16px ' + font
  const sections = [
    { label: 'Resumo', items: diagram.summary.trim() ? [diagram.summary] : [] },
    { label: 'Requisitos', items: diagram.requirements, bullets: true },
    { label: 'Questões em aberto', items: diagram.openQuestions, bullets: true },
  ].filter((section) => section.items.length).map((section) => ({
    ...section, rows: section.items.map((text) => wrap(context, text, textWidth - (section.bullets ? 22 : 0))),
  }))
  const graphTop = panelMargin + title.length * 44 + 20
  const infoTop = graphTop + (items.length ? graphHeight + 26 : 0)
  const height = infoTop + sections.reduce((total, { rows }) =>
    total + 42 + rows.reduce((sum, item) => sum + item.length * 24 + 5, 0), 0) + panelMargin
  const pixelScale = Math.min(1, 4800 / height)
  canvas.width = Math.ceil(width * pixelScale)
  canvas.height = Math.ceil(height * pixelScale)
  context.scale(pixelScale, pixelScale)
  context.textBaseline = 'top'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = ink
  context.font = '700 34px ' + font
  title.forEach((line, index) => context.fillText(line, panelMargin, panelMargin + index * 44))

  if (items.length) {
    context.fillStyle = '#faf8fa'
    context.fillRect(panelMargin, graphTop, textWidth, graphHeight)
    context.save()
    context.translate((width - graphWidth) / 2 - left * zoom, graphTop - top * zoom)
    context.scale(zoom, zoom)
    for (const edge of diagram.edges) {
      const source = boxes.get(edge.from)
      const target = boxes.get(edge.to)
      if (!source || !target) continue
      const endX = target.position.x + target.geometry.width / 2
      const endY = target.position.y
      const [path, labelX, labelY] = getSmoothStepPath({
        sourceX: source.position.x + source.geometry.width / 2,
        sourceY: source.position.y + source.geometry.height - (source.node.kind === 'document' ? 12 : 0),
        targetX: endX, targetY: endY,
        sourcePosition: Position.Bottom, targetPosition: Position.Top,
      })
      context.strokeStyle = '#80642d'
      context.fillStyle = '#80642d'
      context.lineWidth = 1.6
      context.stroke(new Path2D(path))
      const arrow = new Path2D()
      arrow.moveTo(endX, endY)
      arrow.lineTo(endX - 4.5, endY - 8)
      arrow.lineTo(endX + 4.5, endY - 8)
      arrow.closePath()
      context.fill(arrow)
      if (edge.label.trim()) {
        context.font = '600 12px ' + font
        const labelWidth = context.measureText(edge.label).width
        context.fillStyle = '#faf8fa'
        context.fillRect(labelX - labelWidth / 2 - 4, labelY - 9, labelWidth + 8, 18)
        context.fillStyle = '#664609'
        context.fillText(edge.label, labelX - labelWidth / 2, labelY - 7)
      }
    }
    for (const { node, position, geometry } of stages) {
      context.save()
      context.translate(position.x, position.y)
      const { outline, detail } = stageOutline(node.kind, geometry)
      const [fill, stroke] = palettes[node.kind]
      context.fillStyle = fill
      context.strokeStyle = stroke
      context.lineWidth = 1.6
      context.fill(new Path2D(outline))
      context.stroke(new Path2D(outline))
      if (detail) context.stroke(new Path2D(detail))
      context.font = '650 13px ' + font
      const label = wrap(context, node.label.trim() || 'Sem nome', geometry.labelWidth)
      const rows = label.slice(0, 3)
      if (label.length > rows.length) rows[2] = rows[2].slice(0, -1) + '…'
      const y = geometry.labelY - (rows.length * 16 + 12) / 2
      context.textAlign = 'center'
      context.fillStyle = stroke
      context.font = '11px ' + font
      context.fillText(nodeKinds[node.kind], geometry.width / 2, y)
      context.fillStyle = ink
      context.font = '650 13px ' + font
      rows.forEach((row, index) => context.fillText(row, geometry.width / 2, y + 14 + index * 16, geometry.labelWidth))
      context.restore()
    }
    context.font = '15px ' + font
    context.fillStyle = body
    for (const { position, rows } of notes) {
      rows.forEach((line, index) => context.fillText(line, position.x + notePadding, position.y + notePadding + index * NOTE_LINE_HEIGHT))
    }
    context.restore()
  }

  let cursor = infoTop
  for (const { label, rows, bullets } of sections) {
    context.font = '650 18px ' + font
    context.fillStyle = ink
    context.fillText(label, panelMargin, cursor)
    cursor += 28
    context.font = '16px ' + font
    context.fillStyle = body
    for (const item of rows) {
      if (bullets) context.fillText('•', panelMargin + 3, cursor)
      for (const line of item) {
        context.fillText(line, panelMargin + (bullets ? 22 : 0), cursor)
        cursor += 24
      }
      cursor += 5
    }
    cursor += 14
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw { kind: 'file', message: 'Não foi possível gerar a imagem PNG do fluxograma.' }
  return new Uint8Array(await blob.arrayBuffer())
}
