import { useEffect, useRef } from 'react'
import { Map as MapLibreMap } from 'maplibre-gl'
import type { PlanResult } from '@relokit/schema'
import 'maplibre-gl/dist/maplibre-gl.css'

/**
 * Day one renders what the plan knows: the search box and the cluster grid. Pins
 * arrive on Sunday and are coloured only by evidence that actually exists.
 */
export function Map({ result }: { result: PlanResult }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current || !result.search_bounds) return
    const { sw, ne } = result.search_bounds

    const map = new MapLibreMap({
      container: container.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: [
        [sw.lng, sw.lat],
        [ne.lng, ne.lat],
      ],
      fitBoundsOptions: { padding: 24 },
    })

    map.on('load', () => {
      map.addSource('bounds', {
        type: 'geojson',
        data: {
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
        },
      })
      map.addLayer({
        id: 'bounds-line',
        type: 'line',
        source: 'bounds',
        paint: { 'line-color': '#2f6fed', 'line-width': 1.5, 'line-dasharray': [3, 2] },
      })

      map.addSource('clusters', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: result.clusters.map((c) => ({
            type: 'Feature',
            properties: { id: c.cluster_id },
            geometry: { type: 'Point', coordinates: [c.centroid.lng, c.centroid.lat] },
          })),
        },
      })
      map.addLayer({
        id: 'cluster-dots',
        type: 'circle',
        source: 'clusters',
        paint: {
          'circle-radius': 6,
          'circle-color': '#2f6fed',
          'circle-opacity': 0.25,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#2f6fed',
        },
      })
    })

    return () => map.remove()
  }, [result])

  return <div className="map" ref={container} />
}
