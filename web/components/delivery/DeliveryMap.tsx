"use client";

// Carte intégrée du trajet de livraison — Leaflet + fonds OpenStreetMap
// (gratuit, sans clé API ni facturation, cohérent avec le choix Cloudinary
// plutôt que Firebase Storage fait ailleurs dans ce projet). Chargé
// dynamiquement dans useEffect : Leaflet touche `window`/`document` au
// chargement, un import statique casserait le rendu serveur du composant.
// Utilisé à la fois par l'admin (components/admin/OrdersAdmin.tsx) et par
// les pages publiques de partage de position (components/delivery/
// LocationSharingForm.tsx) — client ET livreur doivent pouvoir se voir
// mutuellement, pas seulement l'admin.
//
// Deux pistes distinctes (client et livreur, qui varie — Djimi lui-même ou
// une aide ponctuelle, CLAUDE.md) : chacune son marqueur en forme d'épingle
// avec un bonhomme (icône Tabler i-person réutilisée telle quelle) et sa
// couleur, plutôt qu'un point générique — inspiré des écrans de suivi
// Gozem/Yango/Bolt. Une piste sans donnée n'affiche simplement rien tant
// que personne n'a partagé sa position.
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LocationPoint } from "@/lib/actions/orders";
import { cleanTrackPoints, distanceMeters, routeLocationIssue, type RouteLocationIssue } from "@/lib/location";
import { parseNavigationRoute, navigationProgress, navigationSpeed, navigationHeading, navigationDistance, type NavigationRoute, type NavigationPosition } from "@/lib/navigation";
import { Icon } from "@/components/icons/Icon";

// OpenFreeMap : tuiles vectorielles gratuites, sans clé API, sans limite —
// contrairement à CARTO (testé : exige désormais une clé, "API KEY REQUIRED"
// en filigrane). Un vrai style sombre existe ("dark"), pas besoin du filtre
// CSS d'assombrissement qu'on utilisait pour les tuiles OSM classiques.
// "positron" (épuré) plutôt que "liberty" (coloré) : le fond ne doit pas
// concurrencer visuellement les tracés et marqueurs, qui sont l'info utile.
function styleUrlForTheme(dark: boolean): string {
  return `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;
}

export interface DeliveryTrack {
  points: LocationPoint[];
  current: NavigationPosition | null;
  sharing: boolean;
}

const PERSON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">' +
  '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />' +
  '<path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /></svg>';

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

// Épingle (badge arrondi + pointe) plutôt qu'un simple cercle : "pourquoi ce
// ne sont pas des bonhommes" — le repère de position doit se reconnaître au
// premier coup d'œil, comme sur Bolt/Gozem/Yango, pas juste un point coloré.
function markerHtml(role: "customer" | "courier", sharing: boolean): string {
  return (
    `<div class="dlv-marker dlv-marker--${role}${sharing ? "" : " idle"}">` +
    '<span class="badge">' +
    PERSON_SVG +
    "</span>" +
    '<span class="tail"></span>' +
    '<span class="ring"></span>' +
    "</div>"
  );
}
const MARKER_ICON_SIZE: [number, number] = [32, 42];
const MARKER_ICON_ANCHOR: [number, number] = [16, 38];

// OSRM : service d'itinéraire routier gratuit, sans clé API (instance de
// démonstration publique — pas de garantie de disponibilité, voir le
// commentaire plus bas où l'appel est fait). Le but de la carte est
// justement d'aider le livreur à retrouver le client : les deux positions
// seules (ou leurs traces de déplacement passé) ne suffisent pas, il faut le
// chemin réel entre les deux, en suivant les rues.
async function fetchRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }, signal: AbortSignal): Promise<NavigationRoute | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return parseNavigationRoute(await res.json());
  } catch {
    return null; // best effort — une carte sans itinéraire routé reste utilisable (marqueurs + traces)
  }
}

// Fait « se dessiner » l'itinéraire du livreur vers le client. Leaflet rend
// chaque polyligne en <path> SVG : pathLength="1" rend sa longueur relative
// (1 = tout le tracé, quel que soit le zoom), et la classe is-drawing lance
// l'animation CSS dlv-route-draw (app/lmi.css). Elle est retirée en fin
// d'animation pour que le trait redevienne un trait plein ordinaire. Purement
// décoratif : ne déplace ni marqueur ni caméra, la position affichée reste
// celle du GPS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- polylignes Leaflet réelles, importées dynamiquement
function playRouteDraw(layers: any[]) {
  // Page en arrière-plan (écran verrouillé, autre onglet) : le navigateur gèle
  // les animations à leur première image, le tracé resterait invisible jusqu'au
  // retour. On l'affiche donc directement, sans effet.
  if (document.hidden) return;
  for (const layer of layers) {
    const path = layer?.getElement?.() as SVGPathElement | undefined;
    if (!path) continue;
    const done = () => path.classList.remove("is-drawing");
    path.setAttribute("pathLength", "1");
    done();
    void path.getBoundingClientRect(); // force le redémarrage si la classe était déjà là
    path.classList.add("is-drawing");
    path.addEventListener("animationend", done, { once: true });
    // Filet de sécurité : quoi qu'il arrive à l'animation, le trait redevient
    // plein. Un itinéraire qui ne s'affiche pas serait pire que pas d'effet.
    setTimeout(done, 1500);
  }
}

export function DeliveryMap({
  customer,
  courier,
  fullScreen = false,
  darkMap = false,
  showRouteStats = false,
  viewportKey,
  navigationMode = false,
  routingEnabled = true,
}: {
  customer: DeliveryTrack;
  courier: DeliveryTrack;
  /** Suivi public (page /livraison/[token]) : la carte occupe tout l'écran plutôt
   * qu'une vignette de 400px — retour client du 06/09/2026, elle doit rester
   * visible en permanence pendant l'usage plutôt que de défiler hors champ. */
  fullScreen?: boolean;
  /** Écran livreur : fond sombre systématique (lisibilité en conduite), sans
   * dépendre du thème clair/sombre choisi côté client. */
  darkMap?: boolean;
  /** Écran livreur : bandeau distance/temps restant/heure d'arrivée en haut,
   * calculé depuis l'itinéraire OSRM déjà récupéré — remplace le petit badge
   * "En direct" plutôt que de l'empiler. */
  showRouteStats?: boolean;
  /** Recalcule la taille de la carte lorsque le panneau change. */
  viewportKey?: string;
  navigationMode?: boolean;
  routingEnabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [routeStatus, setRouteStatus] = useState<"waiting" | "loading" | "ready" | "unavailable">("waiting");
  const [routeStats, setRouteStats] = useState<{ distanceKm: number; minutes: number; arrival: string } | null>(null);
  const [routeIssue, setRouteIssue] = useState<RouteLocationIssue>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [route, setRoute] = useState<NavigationRoute | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const progress = route ? navigationProgress(route, courier.current, clock) : null;
  const speed = navigationSpeed(courier.current, clock);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- type Leaflet réel, importé dynamiquement (pas de dépendance de type au niveau module)
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- calque MapLibre réel (binding Leaflet), importé dynamiquement
  const glLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- objets Leaflet réels, importés dynamiquement
  type TrackLayers = { line: any; marker: any | null; accuracy: any | null };
  const tracksRef = useRef<{ customer: TrackLayers; courier: TrackLayers } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- polyligne Leaflet réelle
  const routeLineRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- halo Leaflet sous le tracé
  const routeHaloRef = useRef<any>(null);
  const routeRequestRef = useRef(0);
  const routeAbortRef = useRef<AbortController | null>(null);
  const routeResolvedRef = useRef(false);
  // Vrai tant qu'un itinéraire est affiché : l'effet de tracé ne joue qu'à son
  // apparition, pas à chaque recalcul (toutes les 30 s pendant la course).
  const routeShownRef = useRef(false);
  const viewportRef = useRef<Array<{ lat: number; lng: number }>>([]);
  // Évite de rappeler OSRM à chaque sondage (toutes les 6s) si personne n'a
  // vraiment bougé — voir le throttle plus bas.
  const routeStateRef = useRef<{ from: { lat: number; lng: number }; to: { lat: number; lng: number }; fetchedAt: number } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    Promise.all([import("leaflet"), import("@maplibre/maplibre-gl-leaflet")]).then(([L, { maplibreGL }]) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;

      const start = customer.current || courier.current;
      // attributionControl: false — le calque MapLibre ajoute la sienne
      // automatiquement (obligatoire pour OpenFreeMap), doublon sinon.
      // maxBounds/maxBoundsViscosity/minZoom : recommandés tels quels par
      // l'exemple officiel de @maplibre/maplibre-gl-leaflet ("restrict bounds
      // to avoid max latitude issues with MapLibre GL" / "prevent sync issues
      // at zoom 0") — sans ça, fitBounds() plantait ("Cannot read properties
      // of null (reading '0')"), reproduit et corrigé ici.
      const map = L.map(containerRef.current, {
        // Pas de boutons +/- en plein écran (public) : le pincement suffit sur
        // mobile et l'écran doit rester dégagé, façon Bolt/Gozem. Gardés pour
        // la vignette admin (OrdersAdmin), utilisée surtout à la souris.
        zoomControl: !fullScreen,
        attributionControl: false,
        maxBounds: [
          [180, -Infinity],
          [-180, Infinity],
        ],
        maxBoundsViscosity: 1,
        minZoom: 1,
      }).setView([start?.lat ?? 4.0511, start?.lng ?? 9.7679], 14);
      glLayerRef.current = maplibreGL({ style: styleUrlForTheme(darkMap || isDarkTheme()) }).addTo(map);

      // Couleurs Leaflet en dur (l'API attend une vraie chaîne, pas une
      // variable CSS) — mêmes valeurs que --tertiary (client, retiré de
      // l'orange le 08/09/2026) et --secondary (livreur) dans app/lmi.css :
      // chaque piste garde une seule couleur du marqueur au tracé, pour
      // rester lisible même quand les deux se croisent.
      mapRef.current = map;
      map.on("dragstart", () => setAutoFollow(false));
      tracksRef.current = {
        customer: { line: L.polyline([], { color: "#1e2440", weight: 4, opacity: 0.85 }).addTo(map), marker: null, accuracy: null },
        courier: { line: L.polyline([], { color: "#22C55E", weight: 4, opacity: 0.85 }).addTo(map), marker: null, accuracy: null },
      };
      // Itinéraire routier vert avec un halo contrasté. Les historiques
      // restent réservés à l'administration.
      routeHaloRef.current = L.polyline([], { color: darkMap || isDarkTheme() ? "#092715" : "#ffffff", weight: 11, opacity: .9, lineCap: "round", className: "dlv-route-path" }).addTo(map);
      routeLineRef.current = L.polyline([], {
        color: "#22C55E",
        weight: navigationMode ? 6 : 5,
        opacity: 0.95,
        lineCap: "round",
        className: "dlv-route-path",
      }).addTo(map);
      map.invalidateSize();
      setMapReady(true);
    }).catch(() => { if (!cancelled) setMapError(true); });

    // Réagit si l'admin bascule clair/sombre (bouton de thème) pendant que
    // le tiroir est ouvert : MapLibre sait changer de style en place (pas
    // besoin de recréer le calque).
    const observer = new MutationObserver(() => {
      if (darkMap) return; // toujours sombre, indépendant du thème choisi côté client
      glLayerRef.current?.getMaplibreMap()?.setStyle(styleUrlForTheme(isDarkTheme()));
      routeHaloRef.current?.setStyle({ color: isDarkTheme() ? "#092715" : "#ffffff" });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // En plein écran, le conteneur n'a plus une taille fixe : il occupe
    // l'espace restant dans une colonne flex, à côté du panneau du bas (voir
    // .dlv-screen). Un seul réajustement peu après le montage (la mise en
    // page flex se stabilise) plutôt qu'un ResizeObserver continu : ce
    // dernier a provoqué un plantage réel dès qu'une position était
    // partagée (constaté le 06/09/2026, y compris différé en rAF) —
    // probablement resize()/invalidateSize() appelés pendant un déplacement
    // de caméra MapLibre (fitBounds/setView, voir l'effet suivant). Un
    // léger décalage de mise en page est un compromis largement préférable
    // à une page qui plante.
    const resizeTimer = setTimeout(() => {
      mapRef.current?.invalidateSize();
      glLayerRef.current?.getMaplibreMap()?.resize();
    }, 250);

    return () => {
      cancelled = true;
      routeRequestRef.current += 1;
      routeAbortRef.current?.abort();
      observer.disconnect();
      clearTimeout(resizeTimer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        glLayerRef.current = null;
        tracksRef.current = null;
        routeLineRef.current = null;
        routeHaloRef.current = null;
        routeStateRef.current = null;
        routeShownRef.current = false;
        viewportRef.current = [];
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialisation unique, la mise à jour se fait dans l'effet suivant
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const timer = setTimeout(() => {
      try {
        mapRef.current?.stop();
        mapRef.current?.invalidateSize({ animate: false, pan: false });
        viewportRef.current = [];
      } catch {
        // Les commandes de livraison restent utilisables pendant le chargement.
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [mapReady, viewportKey]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const tracks = tracksRef.current;
    if (!map || !L || !tracks) return;

    const lasts: [number, number][] = [];

    for (const [role, track] of [
      ["customer", customer],
      ["courier", courier],
    ] as const) {
      const t = tracks[role];
      // La vue publique montre la route utile, pas le bruit du GPS brut. Le
      // trajet nettoyé reste disponible dans le tiroir d'administration.
      const visiblePoints = fullScreen ? [] : cleanTrackPoints(track.points);
      const latLngs = visiblePoints.map((p) => [p.lat, p.lng] as [number, number]);
      t.line.setLatLngs(latLngs);

      const last = track.current || (track.points.length ? track.points[track.points.length - 1] : null);
      if (!last) {
        t.marker?.remove();
        t.accuracy?.remove();
        t.marker = null;
        t.accuracy = null;
        continue;
      }

      const heading = role === "courier" ? navigationHeading(track.current, clock) : null;
      const isNavigationMarker = navigationMode && role === "courier";
      const html = isNavigationMarker
        ? `<div class="dlv-navigation-marker${track.sharing ? "" : " idle"}">${heading === null
          ? '<span class="dlv-navigation-dot"></span>'
          : `<svg viewBox="0 0 32 32" aria-hidden="true" style="transform:rotate(${heading}deg)"><path d="M16 3 27 28 16 22 5 28Z" fill="#22C55E" stroke="#fff" stroke-width="2" stroke-linejoin="round" /></svg>`}</div>`
        : markerHtml(role, track.sharing);
      const icon = L.divIcon({ className: "", html, iconSize: isNavigationMarker ? [44, 44] : MARKER_ICON_SIZE, iconAnchor: isNavigationMarker ? [22, 22] : MARKER_ICON_ANCHOR });
      if (!t.marker) {
        t.marker = L.marker([last.lat, last.lng], { icon, title: role === "courier" ? "Position du livreur" : "Point de livraison", alt: role === "courier" ? "Livreur" : "Client" }).addTo(map);
      } else {
        t.marker.setLatLng([last.lat, last.lng]).setIcon(icon);
      }
      if (last.accuracy && last.accuracy > 8) {
        if (!t.accuracy) {
          t.accuracy = L.circle([last.lat, last.lng], {
            radius: last.accuracy,
            color: role === "customer" ? "#1e2440" : "#22C55E",
            fillOpacity: 0.08,
            opacity: 0.3,
            weight: 1,
          }).addTo(map);
        } else {
          t.accuracy.setLatLng([last.lat, last.lng]).setRadius(last.accuracy);
        }
      } else if (t.accuracy) {
        t.accuracy.remove();
        t.accuracy = null;
      }
      lasts.push([last.lat, last.lng]);
    }

    // Itinéraire livreur → client, tant que les deux partagent une position.
    // Throttlé (30s + 25m de mouvement minimum) pour ne pas saturer
    // l'instance OSRM publique. Après un échec, réessaie même à l'arrêt ;
    // n'affiche pas un ancien itinéraire comme s'il venait d'être calculé.
    const issue = routingEnabled && customer.current && courier.current ? routeLocationIssue(customer.current, courier.current) : null;
    setRouteIssue(issue);
    if (routingEnabled && customer.current && courier.current && routeLineRef.current && !issue) {
      const from = courier.current;
      const to = customer.current;
      const prev = routeStateRef.current;
      const stale = !prev || Date.now() - prev.fetchedAt > 30000;
      const moved = !prev || distanceMeters(prev.from, from) > 25 || distanceMeters(prev.to, to) > 25;
      if (stale && (moved || !routeResolvedRef.current || (route && navigationProgress(route, from, clock).kind === "off-route"))) {
        routeStateRef.current = { from, to, fetchedAt: Date.now() };
        const requestId = ++routeRequestRef.current;
        routeAbortRef.current?.abort();
        const controller = new AbortController();
        routeAbortRef.current = controller;
        const timeout = setTimeout(() => controller.abort(), 10000);
        setRouteStatus("loading");
        fetchRoute(from, to, controller.signal).then((result) => {
          if (requestId !== routeRequestRef.current) return;
          routeResolvedRef.current = Boolean(result);
          if (!result) {
            setRouteStatus("unavailable");
            setRouteStats(null);
            setRoute(null);
            routeHaloRef.current?.setLatLngs([]);
            routeLineRef.current?.setLatLngs([]);
            routeShownRef.current = false;
            return;
          }
          setRouteStatus("ready");
          setRoute(result);
          routeHaloRef.current?.setLatLngs(result.coords);
          routeLineRef.current?.setLatLngs(result.coords);
          if (!routeShownRef.current) playRouteDraw([routeHaloRef.current, routeLineRef.current]);
          routeShownRef.current = true;
          setRouteStats({
            distanceKm: result.distanceMeters / 1000,
            minutes: Math.round(result.durationSeconds / 60),
            arrival: new Date(Date.now() + result.durationSeconds * 1000).toLocaleTimeString("fr-FR", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          });
        }).finally(() => clearTimeout(timeout));
      }
    } else {
      setRoute(null);
      routeHaloRef.current?.setLatLngs([]);
      routeLineRef.current?.setLatLngs([]);
      routeShownRef.current = false;
      routeRequestRef.current += 1;
      routeAbortRef.current?.abort();
      routeResolvedRef.current = false;
      routeStateRef.current = null;
      setRouteStats(null);
      setRouteStatus("waiting");
    }

    if (lasts.length && autoFollow) {
      // Passe par les méthodes de LEAFLET (fitBounds/setView), pas par
      // l'API MapLibre (getMaplibreMap().fitBounds/easeTo) : le pont
      // @maplibre/maplibre-gl-leaflet ne synchronise que dans un sens
      // (Leaflet → MapLibre, voir _transformGL dans son code source) —
      // piloter la caméra MapLibre directement déplace le fond de carte
      // sans que Leaflet le sache, et les marqueurs/tracés (objets Leaflet)
      // restent positionnés sur l'ancienne vue : décalage visible entre les
      // tuiles et les marqueurs dès que les deux points sont un peu éloignés
      // (repéré le 06/09/2026 avec deux positions à ~2km d'écart). Piloter
      // Leaflet laisse le pont faire la synchronisation lui-même, dans le
      // sens pour lequel il est prévu.
      const previous = viewportRef.current;
      const moved = previous.length !== lasts.length || lasts.some((point, index) => {
        const old = previous[index];
        return !old || distanceMeters(old, { lat: point[0], lng: point[1] }) > 20;
      });
      if (!moved) return;
      viewportRef.current = lasts.map(([lat, lng]) => ({ lat, lng }));

      // Sans animation : un déplacement de caméra animé pendant que MapLibre
      // charge de nouvelles tuiles (vraie position, pas la donnée de test
      // fixe utilisée en développement) a été corrélé à un plantage réel de
      // la page (constaté le 06/09/2026) — un saut immédiat est moins
      // élégant mais fiable. Protégé par try/catch : mieux vaut une carte
      // qui ne recentre pas cette fois qu'une page qui plante.
      try {
        if (navigationMode && courier.current) {
          map.setView([courier.current.lat, courier.current.lng], 16, { animate: false });
        } else if (lasts.length > 1 && !issue) {
          map.fitBounds(lasts, { padding: [40, 40], animate: false, maxZoom: 16 });
        } else {
          const focus = courier.current || customer.current;
          if (focus) map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { animate: false });
        }
      } catch {
        // best effort — voir commentaire ci-dessus
      }
    }
  }, [customer, courier, fullScreen, autoFollow, mapReady, navigationMode, routingEnabled, route, clock]);

  function recenter() {
    const map = mapRef.current;
    const positions = [customer.current, courier.current].filter(Boolean) as Array<{ lat: number; lng: number }>;
    if (!map || !positions.length) return;
    setAutoFollow(true);
    viewportRef.current = positions;
    try {
      const issue = routingEnabled && customer.current && courier.current ? routeLocationIssue(customer.current, courier.current) : null;
      if (navigationMode && courier.current) map.setView([courier.current.lat, courier.current.lng], 16, { animate: false });
      else if (positions.length > 1 && !issue) map.fitBounds(positions.map((p) => [p.lat, p.lng]), { padding: [40, 40], animate: false, maxZoom: 16 });
      else {
        const focus = courier.current || customer.current || positions[0];
        map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { animate: false });
      }
    } catch {
      // Le suivi reprendra automatiquement à la prochaine mesure.
    }
  }

  function overview() {
    const map = mapRef.current;
    if (!map || !route) return;
    setAutoFollow(false);
    try { map.fitBounds(route.coords, { paddingTopLeft: [30, 170], paddingBottomRight: [60, 36], maxZoom: 16, animate: false }); } catch { /* no camera animation during a tile refresh */ }
  }
  const next = progress?.kind === "ready" ? progress.next : null;
  const navSeconds = progress?.kind === "ready" ? progress.remainingSeconds : null;
  const navMeters = progress?.kind === "ready" ? progress.remainingMeters : null;
  const waitingLabel = routeStatus === "loading" ? "Calcul de l’itinéraire…" : progress?.kind === "off-route" ? "Vous avez quitté l’itinéraire" : progress?.kind === "uncertain" ? "Vérification de votre position" : "En attente d’un GPS précis";

  return (
    <div className="dlv-map-frame" data-navigation={navigationMode} style={fullScreen ? { position: "relative", flex: "1 1 auto", minHeight: 0 } : { position: "relative" }}>
      <div
        ref={containerRef}
        role="img"
        aria-label="Carte de livraison — position du client, du livreur, et itinéraire suggéré entre les deux ; le détail (statut, dernière position, nombre de points) est repris en texte juste en dessous"
        style={
          fullScreen
            ? { width: "100%", height: "100%" }
            : { width: "100%", height: 400, borderRadius: "var(--r-card)", overflow: "hidden" }
        }
      />
      {navigationMode && mapReady ? <div className="dlv-map-tools" aria-label="Commandes de la carte">
        <button type="button" onClick={() => { setAutoFollow(false); mapRef.current?.zoomIn(1, { animate: false }); }} aria-label="Zoomer"><Icon name="add" /></button>
        <button type="button" onClick={() => { setAutoFollow(false); mapRef.current?.zoomOut(1, { animate: false }); }} aria-label="Dézoomer"><Icon name="remove" /></button>
        {route ? <button type="button" onClick={overview} aria-label="Voir tout l’itinéraire"><Icon name="expand" /></button> : null}
      </div> : null}
      {(customer.current || courier.current) ? (
        <button type="button" className="dlv-recenter" onClick={recenter} aria-label={navigationMode ? "Suivre ma position" : "Recentrer la carte sur la livraison"} aria-pressed={autoFollow} title="Recentrer la carte">
          <Icon name="location" />
        </button>
      ) : null}
      {mapError ? <div className="dlv-route-warning" role="status">La carte est indisponible. Les détails de la livraison restent accessibles.</div> : routeIssue ? (
        <div className="dlv-route-warning" role="alert">
          {routeIssue === "positions_trop_eloignees"
            ? "Positions incohérentes : vérifiez la position du client avant de partir."
            : "Itinéraire suspendu : une position est trop ancienne. Relancez le partage GPS."}
        </div>
      ) : null}
      {navigationMode && route && !routeIssue && !mapError ? (
        <div className="dlv-navigation-hud">
          <div className="dlv-next-turn">
            <span className="dlv-turn-icon" aria-hidden="true"><TurnArrow modifier={next?.modifier || "straight"} /></span>
            <div><strong>{next && routeStatus === "ready" ? navigationDistance(next.distanceMeters) : "Itinéraire"}</strong>
              <p>{routeStatus !== "ready" || progress?.kind !== "ready" ? waitingLabel : next?.instruction || "Suivez l’itinéraire"}</p>
              {next?.road && routeStatus === "ready" ? <small>{next.road}</small> : null}
            </div>
          </div>
          <div className="dlv-navigation-metrics">
            <div><strong>{navSeconds === null ? "—" : navSeconds < 60 ? "< 1" : Math.ceil(navSeconds / 60)}<small> min</small></strong><span>Estimation hors trafic</span></div>
            <div><strong>{speed === null ? "—" : speed}<small> km/h</small></strong><span>Vitesse GPS</span></div>
            <div><strong>{navMeters === null ? "—" : navigationDistance(navMeters)}</strong><span>Restants</span></div>
          </div>
        </div>
      ) : showRouteStats && routeStats && !routeIssue && !mapError ? (
        <div className="dlv-route-stats">
          <div>
            <strong>{routeStats.minutes} min</strong>
            <span>Trajet estimé</span>
          </div>
          <div className="sep" />
          <div>
            <strong>{routeStats.distanceKm < 10 ? routeStats.distanceKm.toFixed(1) : Math.round(routeStats.distanceKm)} km</strong>
            <span>Distance</span>
          </div>
          <div className="sep" />
          <div>
            <strong>{routeStats.arrival}</strong>
            <span>Arrivée estimée</span>
          </div>
        </div>
      ) : !routeIssue && !mapError ? (
        <div className="dlv-live-badge" role="status">
          <Icon name={routeStatus === "unavailable" ? "cloud-off" : "location"} size="sm" />
          {!routingEnabled ? "Suivi GPS inactif" : routeStatus === "loading" ? "Calcul de l’itinéraire…" : routeStatus === "unavailable" ? "Itinéraire indisponible · nouvelle tentative automatique" : !courier.current ? "En attente de la position du livreur" : !customer.current ? "En attente du lieu de livraison" : "Positions reçues"}
        </div>
      ) : null}
    </div>
  );
}

function TurnArrow({ modifier }: { modifier: string }) {
  if (modifier === "arrive") return <Icon name="location" />;
  const left = modifier.includes("left");
  const right = modifier.includes("right");
  return <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
    {modifier === "roundabout" ? <path d="M24 43V34a12 12 0 1 1 12-12V7m-7 7 7-7 7 7" /> : modifier === "uturn" ? <path d="M36 40V18a12 12 0 0 0-24 0v12m-7-7 7 7 7-7" /> : left || right ? <g transform={left ? "translate(48 0) scale(-1 1)" : undefined}><path d="M12 40V25a10 10 0 0 1 10-10h18m-10-9 10 9-10 9" /></g> : <path d="M24 40V8m-12 12L24 8l12 12" />}
  </svg>;
}
