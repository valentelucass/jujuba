import { useEffect, useRef } from 'react'
import { init, use, type ECharts } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useTheme } from './Theme'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

export interface PlotPoint { time: number; average: number | null; peak?: number }
export const clock = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' })
export const stamp = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
export function bytes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return '—'
  const unit = value < 1 ? 0 : Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return quantity.format(value / 1024 ** unit) + ' ' + units[unit]
}

export function DatabaseMemoryChart({ points, live }: { points: PlotPoint[]; live: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<ECharts | null>(null)
  const { theme } = useTheme()
  const ready = points.some(point => point.average !== null)
  useEffect(() => {
    if (!ready || !container.current) return
    const graph = init(container.current)
    const observer = new ResizeObserver(() => graph.resize())
    chart.current = graph
    observer.observe(container.current)
    return () => { observer.disconnect(); graph.dispose(); chart.current = null }
  }, [ready])
  useEffect(() => {
    if (!ready || !chart.current || !container.current) return
    const css = getComputedStyle(container.current)
    const color = (name: string) => css.getPropertyValue(name).trim()
    const data = (field: 'average' | 'peak') => {
      const pairs: [number, number | '-'][] = []
      for (const [index, item] of points.entries()) {
        if (index && item.time - points[index - 1].time > (live ? 15000 : 300000)) pairs.push([item.time - 1, '-'])
        pairs.push([item.time, item[field] ?? '-'])
      }
      return pairs
    }
    const first = points[0].time, last = points[points.length - 1].time
    chart.current.setOption({
      animation: false, backgroundColor: 'transparent',
      grid: { left: 10, right: 14, top: 13, bottom: 5, containLabel: true },
      xAxis: { type: 'time', min: first === last ? first - 5000 : first, max: last,
        axisLabel: { hideOverlap: true, fontSize: 10, color: color('--muted'),
          formatter: (value: number) => (last - first > 86400000 ? stamp : clock).format(value) },
        splitLine: { show: false }, axisLine: { lineStyle: { color: color('--line') } } },
      yAxis: { type: 'value', min: 0, splitNumber: 3,
        axisLabel: { color: color('--muted'), fontSize: 10, formatter: (value: number) => bytes(value) },
        splitLine: { lineStyle: { color: color('--line'), type: 'dashed' } } },
      tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, backgroundColor: color('--surface'),
        borderColor: color('--line-strong'), textStyle: { color: color('--text') },
        valueFormatter: (value: unknown) => typeof value === 'number' ? bytes(value) : '—' },
      series: [
        { name: live ? 'Uso de memória' : 'Média', type: 'line', data: data('average'), symbol: 'circle',
          symbolSize: points.length > 40 ? 2 : 5, itemStyle: { color: color('--berry') }, areaStyle: { opacity: .08 } },
        ...(live ? [] : [{ name: 'Pico', type: 'line', data: data('peak'), symbolSize: 3, symbol: 'circle',
          lineStyle: { type: 'dashed', width: 1.5 }, itemStyle: { color: color('--gold') } }]),
      ],
    }, true)
  }, [points, live, theme, ready])
  return ready ? <div ref={container} className="dbm-plot" role="img" aria-label={live ? 'Uso de memória por amostra' : 'Média e pico de memória por intervalo de cinco minutos'} />
    : <div className="dbm-chart-empty">Sem medições de memória neste período.</div>
}
