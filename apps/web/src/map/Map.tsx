import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, type GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { AskResult } from '@relokit/client'
import type { PlanResult } from '@relokit/schema'
import 'maplibre-gl/dist/maplibre-gl.css'

const SAN_JOSE: [number, number] = [-121.94, 37.34]

/**
 * A pin's colour comes only from evidence that exists.
 *
 * Nothing here counts down towards an answer already known: a home leaves the
 * map when something was actually checked and actually failed. If the run
 * stalls, the map simply stops moving.
 */
export function Map({
  plan,
  result,
  selected,
  onSelect,
}: {
  plan: PlanResult | null
  result: AskResult | null
  selected: string | null
  onSelect: (entityId: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    if (!container.current || map.current) return
    const instance = new MapLibreMap({
      container: container.current,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: SAN_JOSE,
      zoom: 10.5,
      attributionControl: { compact: true },
    })
    instance.on('load', () => {
      instance.addSource('bounds', { type: 'geojson', data: empty() })
      instance.addLayer({
        id: 'bounds-line',
        type: 'line',
        source: 'bounds',
        paint: {
          'line-color': '#4da3ff',
          'line-width': 1,
          'line-dasharray': [4, 3],
          'line-opacity': 0.7,
        },
      })
      instance.addSource('homes', { type: 'geojson', data: empty() })
      instance.addLayer({
        id: 'homes-dot',
        type: 'circle',
        source: 'homes',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'verdict'], 'verified'], 7, 5],
          'circle-color': [
            'match',
            ['get', 'verdict'],
            'verified',
            '#2fd39f',
            'unsure',
            '#e0a338',
            'out',
            '#e0674f',
            '#7a90ad',
          ],
          'circle-opacity': ['case', ['==', ['get', 'verdict'], 'out'], 0.35, 0.95],
          'circle-stroke-width': ['case', ['==', ['get', 'verdict'], 'verified'], 2, 0],
          'circle-stroke-color': 'rgba(47,211,159,0.35)',
        },
      })
    })
    // A pin is a home. Clicking one should open it, the same as clicking its
    // card, or the map is decoration.
    instance.on('click', 'homes-dot', (event) => {
      const id = event.features?.[0]?.properties?.entity_id
      if (typeof id === 'string') onSelect(id)
    })
    instance.on('mouseenter', 'homes-dot', () => {
      instance.getCanvas().style.cursor = 'pointer'
    })
    instance.on('mouseleave', 'homes-dot', () => {
      instance.getCanvas().style.cursor = ''
    })

    map.current = instance
    return () => {
      instance.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance || !plan?.search_bounds) return
    const { sw, ne } = plan.search_bounds
    const draw = () => {
      const source = instance.getSource('bounds') as GeoJSONSource | undefined
      source?.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [sw.lng, sw.lat],
              [ne.lng, sw.lat],
              [ne.lng, ne.lat],
              [sw.lng, ne.lat],
              [sw.lng, sw.lat],
            ],
          ],
        },
      })
      instance.fitBounds(
        [
          [sw.lng, sw.lat],
          [ne.lng, ne.lat],
        ],
        { padding: 56, duration: 700 },
      )
    }
    instance.isStyleLoaded() ? draw() : instance.once('load', draw)
  }, [plan])

  useEffect(() => {
    const instance = map.current
    if (!instance || !result) return
    const verdicts: Record<string, string> = {}
    for (const entry of result.buckets.rejections) verdicts[entry.entity_id] = 'out'
    for (const entry of result.buckets.unverified) verdicts[entry.entity_id] = 'unsure'
    for (const entry of result.buckets.results) verdicts[entry.entity_id] = 'verified'

    const draw = () => {
      const source = instance.getSource('homes') as GeoJSONSource | undefined
      source?.setData({
        type: 'FeatureCollection',
        features: result.entities
          .filter((entity) => entity.point)
          .map((entity) => ({
            type: 'Feature' as const,
            properties: {
              verdict: verdicts[entity.entity_id] ?? 'unchecked',
              title: entity.title,
              entity_id: entity.entity_id,
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [entity.point!.lng, entity.point!.lat],
            },
          })),
      })
    }
    instance.isStyleLoaded() ? draw() : instance.once('load', draw)
  }, [result])

  useEffect(() => {
    const instance = map.current
    if (!instance || !selected || !result) return
    const entity = result.entities.find((e) => e.entity_id === selected)
    if (entity?.point)
      instance.easeTo({ center: [entity.point.lng, entity.point.lat], duration: 600 })
  }, [selected, result])

  return <div className="map" ref={container} />
}

function empty(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}
