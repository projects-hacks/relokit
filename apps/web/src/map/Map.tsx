import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, type GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { AskResult } from '@relokit/client'
import type { PlanResult } from '@relokit/schema'
import 'maplibre-gl/dist/maplibre-gl.css'

const SAN_JOSE: [number, number] = [-121.94, 37.34]

const MAP_STYLES = {
  bright: 'https://tiles.openfreemap.org/styles/bright',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const

export type MapTheme = keyof typeof MAP_STYLES

/**
 * A pin's colour comes only from evidence that exists.
 *
 * Nothing here counts down towards an answer already known: a home leaves the
 * map when something was actually checked and actually failed. If the run
 * stalls, the map simply stops moving.
 */
export function Map({
  theme,
  plan,
  result,
  selected,
  shut,
  hovered,
  onSelect,
  onHover,
  onOpen,
}: {
  theme: MapTheme
  plan: PlanResult | null
  result: AskResult | null
  selected: string | null
  /** Shut on a phone until asked for. A canvas measured at zero height stays
   * zero until it is told to measure again. */
  shut?: boolean
  hovered: string | null
  onSelect: (entityId: string) => void
  onHover: (entityId: string | null) => void
  onOpen: (entityId: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  // feature-state is addressed by feature id, so the map keeps its own index of
  // which id belongs to which home. A plain record, because this component is
  // itself called Map and shadows the constructor.
  const featureIds = useRef<Record<string, number>>({})
  const lit = useRef<number | null>(null)
  // Bumped each time a style finishes loading. A style change empties the map
  // of our sources, so every drawing effect below re-runs off this and puts its
  // data back.
  const [styleReady, setStyleReady] = useState(0)
  const appliedTheme = useRef<MapTheme>(theme)

  // A canvas measured while its container was collapsed keeps that size until
  // it is told to measure again, so reopening the sheet would otherwise show a
  // sliver of map.
  useEffect(() => {
    if (shut) return
    const instance = map.current
    if (!instance) return
    const timer = setTimeout(() => instance.resize(), 60)
    return () => clearTimeout(timer)
  }, [shut])

  // Swapping the style keeps the camera where the reader left it, which is the
  // whole point of a theme toggle: the same picture in different colours.
  useEffect(() => {
    if (appliedTheme.current === theme) return
    appliedTheme.current = theme
    map.current?.setStyle(MAP_STYLES[theme])
  }, [theme])

  useEffect(() => {
    if (!container.current || map.current) return
    const instance = new MapLibreMap({
      container: container.current,
      style: MAP_STYLES[appliedTheme.current],
      center: SAN_JOSE,
      zoom: 10.5,
      attributionControl: { compact: true },
    })
    // The published basemap names a fill pattern its own sprite sheet does not
    // carry, and every load says so in the console. Nothing on screen wants it,
    // so it is answered with a transparent pixel rather than left to complain.
    instance.setMissingStyleImageResolver((id) => {
      instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) })
    })

    // Fires for the first style and again for every setStyle, which is what
    // makes the theme toggle safe: the sources come back with the style.
    instance.on('style.load', () => {
      instance.addSource('bounds', { type: 'geojson', data: empty() })
      instance.addLayer({
        id: 'bounds-line',
        type: 'line',
        source: 'bounds',
        paint: {
          'line-color': appliedTheme.current === 'bright' ? '#3a6ea5' : '#4da3ff',
          'line-width': 1,
          'line-dasharray': [4, 3],
          'line-opacity': 0.7,
        },
      })
      // The journey the number was measured on. Drawn under everything else,
      // because it is the ground the pins stand on rather than a thing to read.
      instance.addSource('route', { type: 'geojson', data: empty() })
      instance.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': 'rgba(8,23,41,0.8)', 'line-width': 6 },
      })
      instance.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#4da3ff', 'line-width': 3, 'line-opacity': 0.95 },
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
          'line-color': appliedTheme.current === 'bright' ? '#31536b' : '#7fd7ff',
          'line-width': 1.4,
          'line-dasharray': [2, 2],
          'line-opacity': 0.75,
        },
      })

      instance.addSource('asked', { type: 'geojson', data: empty() })
      instance.addLayer({
        id: 'asked-mark',
        type: 'circle',
        source: 'asked',
        paint: {
          'circle-radius': ['match', ['get', 'kind'], 'destination', 8, 'near', 8, 'area', 7, 6],
          'circle-color': [
            'match',
            ['get', 'kind'],
            'destination',
            '#ffd166',
            'near',
            '#c58fff',
            'area',
            '#9fb3c8',
            '#7fd7ff',
          ],
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

      // Eighty-eight homes downtown land on top of each other and only the
      // topmost can be clicked. Grouping them says how many are there and gives
      // a way in.
      instance.addSource('homes', {
        type: 'geojson',
        data: empty(),
        cluster: true,
        clusterRadius: 38,
        clusterMaxZoom: 13,
      })
      instance.addLayer({
        id: 'homes-cluster',
        type: 'circle',
        source: 'homes',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 30, 23],
          'circle-color': 'rgba(13,138,102,0.3)',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
      instance.addLayer({
        id: 'homes-cluster-count',
        type: 'symbol',
        source: 'homes',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
        },
        paint: {
          'text-color': '#0d5c45',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
        },
      })
      instance.addLayer({
        id: 'homes-dot',
        type: 'circle',
        source: 'homes',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['feature-state', 'lit'], false],
            10,
            ['==', ['get', 'verdict'], 'verified'],
            7,
            5,
          ],
          // The chosen one is ink, not a bigger green among greens: selection
          // has to be unmistakable at a glance, on either basemap.
          'circle-color': [
            'case',
            ['boolean', ['feature-state', 'lit'], false],
            '#16241f',
            [
              'match',
              ['get', 'verdict'],
              'verified',
              '#0d8a66',
              'unsure',
              '#c98a12',
              'out',
              '#c9502f',
              '#8595a0',
            ],
          ],
          'circle-opacity': ['case', ['==', ['get', 'verdict'], 'out'], 0.35, 0.95],
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'lit'], false],
            3.5,
            ['==', ['get', 'verdict'], 'verified'],
            2,
            0,
          ],
          'circle-stroke-color': '#ffffff',
        },
      })
      setStyleReady((count) => count + 1)
    })
    // A pin is a home. Clicking one opens it, the same as clicking its card, or
    // the map is decoration.
    instance.on('click', 'homes-dot', (event) => {
      const id = event.features?.[0]?.properties?.entity_id
      if (typeof id === 'string') {
        onSelect(id)
        onOpen(id)
      }
    })
    instance.on('click', 'homes-cluster', (event) => {
      const feature = event.features?.[0]
      if (!feature) return
      instance.easeTo({
        center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
        zoom: Math.min(16, instance.getZoom() + 2),
        duration: 500,
      })
    })
    instance.on('mousemove', 'homes-dot', (event) => {
      instance.getCanvas().style.cursor = 'pointer'
      const id = event.features?.[0]?.properties?.entity_id
      if (typeof id === 'string') onHover(id)
    })
    instance.on('mouseleave', 'homes-dot', () => {
      instance.getCanvas().style.cursor = ''
      onHover(null)
    })
    for (const layer of ['homes-cluster']) {
      instance.on('mouseenter', layer, () => {
        instance.getCanvas().style.cursor = 'pointer'
      })
      instance.on('mouseleave', layer, () => {
        instance.getCanvas().style.cursor = ''
      })
    }

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
  }, [plan, styleReady])

  // Framing is its own concern, and deliberately not tied to styleReady: a new
  // answer brings the camera to it, a theme change leaves the camera alone.
  // Camera moves work before any style has loaded, so this needs no guard.
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    if (plan?.search_bounds) {
      const { sw, ne } = plan.search_bounds
      instance.fitBounds(
        [
          [sw.lng, sw.lat],
          [ne.lng, ne.lat],
        ],
        { padding: 56, duration: 700 },
      )
      return
    }
    // A question that only named a place has no planned box; its answer can
    // still be far from where the camera happens to sit. Austin's gyms were
    // arriving on a map of San Jose.
    const points = (result?.entities ?? []).filter((e) => e.point).map((e) => e.point!)
    if (points.length === 0) return
    const lats = points.map((point) => point.lat)
    const lngs = points.map((point) => point.lng)
    instance.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 56, maxZoom: 14, duration: 700 },
    )
  }, [plan, result])

  useEffect(() => {
    const instance = map.current
    if (!instance || !result) return
    const verdicts: Record<string, string> = {}
    for (const entry of result.buckets.rejections) verdicts[entry.entity_id] = 'out'
    for (const entry of result.buckets.unverified) verdicts[entry.entity_id] = 'unsure'
    for (const entry of result.buckets.results) verdicts[entry.entity_id] = 'verified'

    const draw = () => {
      const withPoints = result.entities.filter((entity) => entity.point)
      featureIds.current = Object.fromEntries(
        withPoints.map((entity, index) => [entity.entity_id, index]),
      )
      const source = instance.getSource('homes') as GeoJSONSource | undefined
      source?.setData({
        type: 'FeatureCollection',
        features: result.entities
          .filter((entity) => entity.point)
          .map((entity, index) => ({
            type: 'Feature' as const,
            id: index,
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
    draw()
  }, [result, styleReady])

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
    // When the question named places to be near, those are the reference and
    // the city point is noise: a dotted line to "San Jose" says nothing about
    // a restaurant chosen for being near Santana Row.
    const named = checked.some((place) => place.kind === 'near' || place.kind === 'destination')
    const anchor =
      selected && result.anchor && !named
        ? [
            {
              label: result.anchor.label,
              kind: 'area' as const,
              point: result.anchor.point,
              said: 'the area you searched',
            },
          ]
        : []
    const places = [...anchor.filter((a) => !checked.some((c) => c.label === a.label)), ...checked]

    // Where the real journey is known, it stands in for the straight connector.
    // Drawing both would put a shortcut next to the route it is not.
    const routes = (entry?.evidence ?? []).filter((row) => row.route && row.route.length > 2)
    const routed = new Set(routes.map((row) => row.about?.label).filter(Boolean))

    const draw = () => {
      const line = instance.getSource('route') as GeoJSONSource | undefined
      line?.setData({
        type: 'FeatureCollection',
        features: routes.map((row) => ({
          type: 'Feature' as const,
          properties: { said: row.display_value },
          geometry: {
            type: 'LineString' as const,
            coordinates: row.route!.map((point) => [point.lng, point.lat]),
          },
        })),
      })

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
            ? places
                .filter((place) => !routed.has(place.label))
                .map((place) => ({
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

    draw()

    if (home?.point) {
      const points = [
        home.point,
        ...places.map((place) => place.point),
        ...routes.flatMap((row) => row.route!),
      ]
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
  }, [selected, result, styleReady])

  // One pin is lit at a time: whichever home the pointer or the list is on.
  useEffect(() => {
    const instance = map.current
    if (!instance || !instance.getSource('homes')) return
    const next = featureIds.current[hovered ?? selected ?? '']

    if (lit.current !== null && lit.current !== next) {
      instance.setFeatureState({ source: 'homes', id: lit.current }, { lit: false })
    }
    if (next !== undefined) {
      instance.setFeatureState({ source: 'homes', id: next }, { lit: true })
    }
    lit.current = next ?? null
  }, [hovered, selected, result, styleReady])

  return (
    <>
      <div className="map" ref={container} role="region" aria-label="Search map" />
      {!plan && !result && (
        <div className="map-empty">
          <b>Your search area will appear here</b>
          <span>Start with the place and priorities that matter to you.</span>
        </div>
      )}
      {result && (
        <ul className="legend">
          {/* Only what this answer actually put on the map. A key naming seven
              things over a map showing two is furniture. */}
          {result.buckets.results.length > 0 && (
            <li>
              <i style={{ background: '#0d8a66' }} /> cleared everything
            </li>
          )}
          {result.buckets.unverified.length > 0 && (
            <li>
              <i style={{ background: '#c98a12' }} /> could not be checked
            </li>
          )}
          {result.buckets.rejections.length > 0 && (
            <li>
              <i style={{ background: '#c9502f' }} /> ruled out
            </li>
          )}
          {result.evidence.some((row) => row.about?.kind === 'destination') && (
            <li>
              <i style={{ background: '#ffd166' }} /> where you are going
            </li>
          )}
          {result.evidence.some((row) => row.about?.kind === 'near') && (
            <li>
              <i style={{ background: '#c58fff' }} /> a place you asked to be near
            </li>
          )}
          {result.evidence.some((row) => row.about?.kind === 'poi') && (
            <li>
              <i style={{ background: '#7fd7ff' }} /> what was found nearby
            </li>
          )}
          {result.anchor && (
            <li>
              <i style={{ background: '#9fb3c8' }} /> the area you searched
            </li>
          )}
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
