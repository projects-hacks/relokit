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
      // What the question asked for, rather than only what was found. A line
      // from the home to where you are going, the places that satisfied each
      // proximity requirement, and the requirement's own words on each.
      instance.addSource('links', { type: 'geojson', data: empty() })
      instance.addLayer({
        id: 'links-line',
        type: 'line',
        source: 'links',
        paint: {
          'line-color': '#7fd7ff',
          'line-width': 1.2,
          'line-dasharray': [2, 2],
          'line-opacity': 0.55,
        },
      })

      instance.addSource('asked', { type: 'geojson', data: empty() })
      instance.addLayer({
        id: 'asked-mark',
        type: 'circle',
        source: 'asked',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'kind'], 'destination'], 8, 6],
          'circle-color': ['match', ['get', 'kind'], 'destination', '#ffd166', '#7fd7ff'],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(8,23,41,0.85)',
        },
      })
      instance.addLayer({
        id: 'asked-label',
        type: 'symbol',
        source: 'asked',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-font': ['Noto Sans Regular'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#e8eef5',
          'text-halo-color': 'rgba(8,23,41,0.9)',
          'text-halo-width': 1.6,
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

  // Choosing a home answers "why this one?". The place you searched around, the
  // gym that satisfied the gym requirement, the shop that satisfied the shop:
  // each named, joined to the home, and all of them brought into view together.
  useEffect(() => {
    const instance = map.current
    if (!instance || !result) return

    const entry = [
      ...result.buckets.results,
      ...result.buckets.unverified,
      ...result.buckets.rejections,
    ].find((candidate) => candidate.entity_id === selected)
    const home = result.entities.find((e) => e.entity_id === selected)

    const checked = (entry?.evidence ?? [])
      .filter((row) => row.about)
      .map((row) => ({ ...row.about!, said: saidFor(result, row.constraint_id) }))

    // The place searched around is shown whether or not anything else was
    // asked. "Apartments near the university" asks for nothing except the
    // university, and a map that leaves it out is pins with no reason attached.
    const anchor =
      selected && result.anchor
        ? [
            {
              label: result.anchor.label,
              kind: 'destination' as const,
              point: result.anchor.point,
              said: 'what you searched around',
            },
          ]
        : []
    const places = [...anchor.filter((a) => !checked.some((c) => c.label === a.label)), ...checked]

    const draw = () => {
      const asked = instance.getSource('asked') as GeoJSONSource | undefined
      asked?.setData({
        type: 'FeatureCollection',
        features: places.map((place) => ({
          type: 'Feature' as const,
          properties: { kind: place.kind, label: place.label },
          geometry: { type: 'Point' as const, coordinates: [place.point.lng, place.point.lat] },
        })),
      })

      const links = instance.getSource('links') as GeoJSONSource | undefined
      links?.setData({
        type: 'FeatureCollection',
        features:
          home?.point && places.length > 0
            ? places.map((place) => ({
                type: 'Feature' as const,
                properties: { said: place.said },
                geometry: {
                  type: 'LineString' as const,
                  coordinates: [
                    [home.point!.lng, home.point!.lat],
                    [place.point.lng, place.point.lat],
                  ],
                },
              }))
            : [],
      })
    }

    if (instance.isStyleLoaded()) draw()
    else instance.once('load', draw)

    if (home?.point) {
      const points = [home.point, ...places.map((place) => place.point)]
      const lats = points.map((point) => point.lat)
      const lngs = points.map((point) => point.lng)
      instance.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 120, maxZoom: 15, duration: 700 },
      )
    }
  }, [selected, result])

  return (
    <>
      <div className="map" ref={container} />
      {result && (
        <ul className="legend">
          <li>
            <i style={{ background: '#2fd39f' }} /> cleared everything
          </li>
          <li>
            <i style={{ background: '#e0a338' }} /> could not be checked
          </li>
          <li>
            <i style={{ background: '#e0674f' }} /> ruled out
          </li>
          <li>
            <i style={{ background: '#ffd166' }} /> where you are going
          </li>
          <li>
            <i style={{ background: '#7fd7ff' }} /> what you asked to be near
          </li>
        </ul>
      )}
    </>
  )
}

/** The requirement's own words, for the line joining a home to what satisfied it. */
function saidFor(result: AskResult, constraintId: string): string {
  return (
    result.constraint_set.constraints.find((c) => c.id === constraintId)?.source_text ??
    constraintId
  )
}

function empty(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}
