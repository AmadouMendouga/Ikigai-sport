"use client";

// Private reads use GET; writes return committed fields for the affected row.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/admin/Drawer";
import { DeliveryMap } from "@/components/delivery/DeliveryMap";
import { Icon } from "@/components/icons/Icon";
import { StatefulButton } from "@/components/StatefulButton";
import { showToast } from "@/components/Toast";
import {
  createOrderAction,
  markOrderDeliveredAction,
  reportDeliveryIncidentAction,
  updateDeliverySlotAction,
  updateOrderAddressAction,
  updateOrderStatusAction,
  getOrCreateLocationTokenAction,
  setCourierPayoutAction,
  type LocationPoint,
} from "@/lib/actions/orders";
import { assignCourierToOrderAction, rejectCourierAction, setCourierActiveAction } from "@/lib/actions/couriers";
import type { Courier, Order, OrderItem, Product, SiteSettings } from "@/lib/types";
import type { DeliveryIncidentType, OrderStatus } from "@/lib/types";
import { canGenerateTrackingLink, normalizeOrderStatus, ORDER_STATUS_LABELS, ORDER_STATUS_OPTIONS } from "@/lib/orderWorkflow";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type AdminOrderUpdates = { patchOrder: (id: string, patch: Partial<Order>) => void; reloadOrders: () => Promise<void> };
const OrderUpdates = createContext<AdminOrderUpdates | null>(null);
function useOrderUpdates() {
  const updates = useContext(OrderUpdates);
  if (!updates) throw new Error("OrdersAdmin provider missing");
  return updates;
}


function statusBadge(order: Order) {
  const status = normalizeOrderStatus(order.status);
  if (status === "livree") return <span className="badge badge-stock-ok"><Icon name="check-circle" size="sm" />Livrée</span>;
  if (status === "annulee" || status === "reportee") return <span className="badge badge-stock-low"><Icon name="error" size="sm" />{ORDER_STATUS_LABELS[status]}</span>;
  return (
    <span className="badge badge-stock-low">
      <Icon name="hourglass" size="sm" />
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

function reviewRequestLink(order: Order, siteUrl: string, businessName: string): string {
  const url = `${siteUrl.replace(/\/$/, "")}/avis/${order.reviewToken}`;
  const msg =
    `Bonjour ${order.customerName} 👋 merci pour votre commande chez ${businessName} !\n\n` +
    `Pourriez-vous nous laisser un avis en quelques secondes ? ${url}\n\n` +
    "Merci beaucoup !";
  return `https://wa.me/${order.customerPhone}?text=${encodeURIComponent(msg)}`;
}

function orderUpdateLink(order: Order, businessName: string): string {
  const status = normalizeOrderStatus(order.status);
  const slot = order.deliverySlot ? ` Créneau prévu : ${order.deliverySlot}.` : "";
  const messages: Partial<Record<OrderStatus, string>> = {
    recue: "Nous avons bien reçu votre commande. Nous vérifions maintenant la disponibilité et le paiement.",
    confirmee: "Votre commande est confirmée. Nous vous informerons dès le début de sa préparation.",
    preparation: "Votre commande est en préparation.",
    prete: `Votre commande est prête à être livrée.${slot}`,
    livreur_assigne: `Un livreur a été affecté à votre commande.${slot} Le suivi sera envoyé au moment de son départ.`,
    en_route: "Votre livreur est en route. Utilisez le lien de suivi envoyé séparément pour partager votre position.",
    arrivee: "Votre livreur est arrivé au point de rendez-vous. Gardez votre code de remise à portée de main.",
    reportee: `Votre livraison doit être reprogrammée.${slot} Nous vous contactons pour convenir de la suite.`,
    annulee: "Votre commande a été annulée. Contactez-nous si vous avez besoin d'aide concernant le paiement.",
  };
  const msg = `Bonjour ${order.customerName} 👋\n\n${messages[status] || `Votre commande est maintenant : ${ORDER_STATUS_LABELS[status]}.`}\n\n${businessName}`;
  return `https://wa.me/${order.customerPhone}?text=${encodeURIComponent(msg)}`;
}

function customerLocationRequestLink(order: Order, siteUrl: string, token: string): string {
  const url = `${siteUrl.replace(/\/$/, "")}/livraison/${token}`;
  const msg =
    `Bonjour ${order.customerName} 👋 votre livreur IKIGAI Sport est maintenant en route. Pour faciliter la remise, partagez votre position ici : ${url}\n\n` +
    "Le lien est réservé à cette livraison et vous pouvez arrêter le partage à tout moment.";
  return `https://wa.me/${order.customerPhone}?text=${encodeURIComponent(msg)}`;
}

// Qui livre varie (Djimi ou une aide ponctuelle, CLAUDE.md) — pas de numéro
// fixe à qui envoyer automatiquement, contrairement au client. On copie donc
// le lien brut pour que l'admin l'envoie lui-même à qui livre cette fois.
function courierLocationUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/livraison/${token}`;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `il y a ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `il y a ${hours} h`;
}

// Rafraîchit la carte toutes les 6s, uniquement pendant que le tiroir est
// ouvert — pas de sondage en arrière-plan pour chaque commande de la liste.
const MAP_POLL_MS = 6000;

function LocationMapDrawer({
  order,
  open,
  onClose,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
}) {
  const [customerTrack, setCustomerTrack] = useState({
    points: [] as LocationPoint[],
    current: order.liveLocation,
    sharing: order.locationSharing,
  });
  const [courierTrack, setCourierTrack] = useState({
    points: [] as LocationPoint[],
    current: order.courierLiveLocation,
    sharing: order.courierLocationSharing,
  });

  const [mapError, setMapError] = useState("");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    async function poll() {
      if (document.hidden) { timer = setTimeout(poll, MAP_POLL_MS); return; }
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const response = await fetch(`/api/admin/orders/${encodeURIComponent(order.id)}/location`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Lecture impossible");
        const view = await response.json();
        if (cancelled) return;
        setCustomerTrack(view.customer); setCourierTrack(view.courier); setMapError("");
      } catch {
        if (!cancelled) setMapError("La carte n’a pas pu être actualisée. Dernières positions conservées.");
      } finally {
        clearTimeout(timeout);
        if (!cancelled) timer = setTimeout(poll, MAP_POLL_MS);
      }
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); controller?.abort(); };
  }, [open, order.id]);

  function statusLine(label: string, track: typeof customerTrack) {
    if (!track.current) return null;
    return (
      <p className="sub">
        <strong>{label}</strong> — {track.sharing ? "partage actif" : "partage arrêté"} · dernière position{" "}
        {timeAgo(track.current.updatedAt)}
        {track.points.length ? ` · ${track.points.length} point${track.points.length > 1 ? "s" : ""}` : ""}
      </p>
    );
  }

  return (
    <Drawer open={open} onClose={onClose} title={`Trajet — ${order.customerName}`} titleIcon="location">
      <DeliveryMap customer={customerTrack} courier={courierTrack} />
      {mapError ? <p role="status" className="sub">{mapError}</p> : null}
      <div style={{ marginTop: 12, display: "flex", gap: 14, fontSize: ".78rem", color: "var(--on-surface-variant)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#1e2440", display: "inline-block" }} />
          Client
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#22C55E", display: "inline-block" }} />
          Livreur
        </span>
        {customerTrack.current && courierTrack.current ? (
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 2, background: "#1e3a8a", display: "inline-block" }} />
            Itinéraire suggéré
          </span>
        ) : null}
      </div>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {statusLine("Client", customerTrack)}
        {statusLine("Livreur", courierTrack)}
        {!customerTrack.current && !courierTrack.current ? (
          <p className="sub">Aucune position partagée pour le moment.</p>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {customerTrack.current ? (
            <a
              className="btn btn-tonal btn-sm"
              href={`https://www.google.com/maps?q=${customerTrack.current.lat},${customerTrack.current.lng}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="location" size="sm" />
              Client dans Maps
            </a>
          ) : null}
          {courierTrack.current ? (
            <a
              className="btn btn-tonal btn-sm"
              href={`https://www.google.com/maps?q=${courierTrack.current.lat},${courierTrack.current.lng}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="location" size="sm" />
              Livreur dans Maps
            </a>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}

function RoleLocationRow({
  order,
  settings,
  role,
  label,
  token,
  location,
  sharing,
  couriers,
  assignedCourierId,
}: {
  order: Order;
  settings: SiteSettings;
  role: "customer" | "courier";
  label: string;
  token: string | null;
  location: Order["liveLocation"];
  sharing: boolean;
  /** Uniquement pour role === "courier" : livreurs enregistrés parmi lesquels choisir. */
  couriers?: Courier[];
  assignedCourierId?: string | null;
}) {
  const { patchOrder } = useOrderUpdates();
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);

  async function requestCustomer() {
    setLoading(true);
    // Ouvert tout de suite, dans le même tick que le clic (geste utilisateur) :
    // si l'ouverture attend la fin de getOrCreateLocationTokenAction ci-dessous,
    // le navigateur la traite comme un pop-up non sollicité et la bloque
    // silencieusement — d'où le « premier clic ne fait rien, le deuxième
    // marche » (le jeton est alors déjà en cache, plus d'attente avant
    // l'ouverture). Pas de `noopener` ici : on doit garder la référence pour
    // naviguer l'onglet une fois le jeton prêt ; wa.me est un domaine de
    // confiance, le compromis est sûr.
    const newTab = window.open("about:blank", "_blank");
    try {
      let t = token;
      if (!t) {
        const result = await getOrCreateLocationTokenAction(order.id, "customer");
        if (!result.ok) {
          newTab?.close();
          alert(result.error);
          return;
        }
        t = result.token;
        patchOrder(order.id, result.patch);
      }
      const url = customerLocationRequestLink(order, settings.siteUrl, t);
      if (newTab) newTab.location.href = url;
      else window.open(url, "_blank");
    } finally {
      setLoading(false);
    }
  }

  async function requestCourier() {
    setLoading(true);
    try {
      let t = token;
      if (!t) {
        const result = await getOrCreateLocationTokenAction(order.id, "courier");
        if (!result.ok) {
          alert(result.error);
          return;
        }
        t = result.token;
        patchOrder(order.id, result.patch);
      }
      await navigator.clipboard.writeText(courierLocationUrl(settings.siteUrl, t));
      showToast("Lien copié — envoyez-le à qui livre cette commande", "check-circle");
    } catch {
      alert("Impossible de copier le lien. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value || null;
    setAssigning(true);
    try {
      const result = await assignCourierToOrderAction(order.id, id);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      patchOrder(order.id, result.patch);
      if (id) showToast("Livreur assigné — il verra la livraison sur son lien personnel", "check-circle");
    } finally {
      setAssigning(false);
    }
  }

  // Choix d'un livreur enregistré : liste au-dessus du lien ponctuel, qui
  // reste la solution de secours (aide occasionnelle, aucun livreur
  // enregistré disponible — voir Courier dans lib/types.ts).
  const courierPicker =
    role === "courier" && couriers ? (
      <select
        aria-label="Assigner un livreur enregistré"
        value={assignedCourierId || ""}
        onChange={handleAssignChange}
        disabled={assigning}
        style={{ fontSize: ".76rem", padding: "3px 6px", maxWidth: 150 }}
      >
        <option value="">Lien ponctuel (manuel)</option>
        {couriers
          .filter((c) => c.active || c.id === assignedCourierId)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </select>
    ) : null;

  if (!location) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="sub" style={{ minWidth: 44 }}>
            {label}
          </span>
          <button
            type="button"
            className="btn btn-tonal btn-sm"
            disabled={loading}
            onClick={role === "customer" ? requestCustomer : requestCourier}
          >
            <Icon name="location" size="sm" />
            {token ? "Renvoyer" : "Demander"}
          </button>
        </div>
        {courierPicker}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            background: sharing ? "var(--secondary)" : "var(--on-surface-variant)",
          }}
        />
        <span className="sub">
          {label} · {sharing ? "actif" : "arrêté"} · {timeAgo(location.updatedAt)}
        </span>
      </div>
      {courierPicker}
    </div>
  );
}

// Montant payé au livreur pour CETTE course — décidé au cas par cas (pas de
// barème automatique, confirmé le 06/09/2026), saisi une fois la commande
// livrée. Alimente "Mes gains" sur le tableau de bord du livreur enregistré.
function CourierPayoutField({ order }: { order: Order }) {
  const [value, setValue] = useState(order.courierPayout ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return;
    setSaving(true);
    try {
      const result = await setCourierPayoutAction(order.id, amount);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      showToast("Montant enregistré", "check-circle");
    } catch {
      alert("Enregistrement non confirmé. Vérifiez votre connexion puis réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
      <span className="sub" style={{ minWidth: 44 }}>
        Payé
      </span>
      <input
        type="number"
        min={0}
        step={100}
        aria-label="Montant payé au livreur (FCFA)"
        value={value}
        onChange={(e) => setValue(e.target.value === "" ? "" : Number(e.target.value))}
        style={{ width: 90, fontSize: ".78rem", padding: "3px 6px" }}
        placeholder="FCFA"
      />
      <button type="button" className="icon-btn" aria-label="Enregistrer le montant" disabled={saving} onClick={save}>
        <Icon name="check-circle" size="sm" />
      </button>
    </div>
  );
}

function LocationCell({ order, settings, couriers }: { order: Order; settings: SiteSettings; couriers: Courier[] }) {
  const [mapOpen, setMapOpen] = useState(false);
  const customerToken = order.locationToken;
  const courierToken = order.courierLocationToken;
  const customerLocation = order.liveLocation;
  const courierLocation = order.courierLiveLocation;
  const customerSharing = order.locationSharing;
  const courierSharing = order.courierLocationSharing;
  const assignedCourierId = order.assignedCourierId;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {canGenerateTrackingLink(normalizeOrderStatus(order.status), "customer") ? (
        <RoleLocationRow order={order} settings={settings} role="customer" label="Client" token={customerToken} location={customerLocation} sharing={customerSharing} />
      ) : (
        <span className="sub">Client · suivi disponible au départ</span>
      )}
      {canGenerateTrackingLink(normalizeOrderStatus(order.status), "courier") ? (
        <RoleLocationRow order={order} settings={settings} role="courier" label="Livreur" token={courierToken} location={courierLocation} sharing={courierSharing} couriers={couriers} assignedCourierId={assignedCourierId} />
      ) : (
        <span className="sub">Livreur · commande non prête</span>
      )}
      {order.status === "livree" && assignedCourierId ? <CourierPayoutField order={order} /> : null}
      {customerLocation || courierLocation || ["en_route", "arrivee"].includes(order.status) ? (
        <button
          type="button"
          className="sub"
          style={{
            color: "var(--primary)",
            fontWeight: 600,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
          onClick={() => setMapOpen(true)}
        >
          Voir le trajet
        </button>
      ) : null}
      {mapOpen ? <LocationMapDrawer order={order} open onClose={() => setMapOpen(false)} /> : null}
    </div>
  );
}

function DeliverySlotCell({ order }: { order: Order }) {
  const { patchOrder } = useOrderUpdates();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(order.deliverySlot || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await updateDeliverySlotAction(order.id, value);
      if (!result.ok) return alert(result.error);
      setEditing(false);
      patchOrder(order.id, result.patch);
    } catch {
      showToast("Enregistrement non confirmé. Réessayez après vérification de la connexion.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <input autoFocus aria-label="Créneau de livraison" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ex. Mardi 14 h–17 h" onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} />
        <button type="button" className="icon-btn" aria-label="Enregistrer le créneau" disabled={saving} onClick={save}><Icon name="check-circle" size="sm" /></button>
      </div>
    );
  }
  return <button type="button" className="icon-btn" style={{ width: "auto", padding: "4px 8px" }} onClick={() => setEditing(true)}><Icon name="schedule" size="sm" /><span className="sub">{order.deliverySlot || "À convenir"}</span></button>;
}

function StatusControl({ order }: { order: Order }) {
  const { patchOrder } = useOrderUpdates();
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState("");
  const status = normalizeOrderStatus(order.status);
  async function change(next: OrderStatus) {
    if (next === status || pendingStatus) return;
    setPendingStatus(next); setError("");
    try {
      const result = await updateOrderStatusAction(order.id, next, status);
      if (!result.ok) { setError(result.error); return; }
      patchOrder(order.id, result.patch);
      showToast(`Commande : ${ORDER_STATUS_LABELS[next]}`, "check-circle");
    } catch { setError("Modification non confirmée. Actualisez avant de réessayer."); }
    finally { setPendingStatus(null); }
  }
  return <div className="adm-status-control" aria-busy={Boolean(pendingStatus)}>
    {statusBadge(order)}
    {status !== "livree" ? <select aria-label="Modifier l'état de la commande" value={pendingStatus || status} disabled={Boolean(pendingStatus)} onChange={(event) => change(event.target.value as OrderStatus)}>
      {ORDER_STATUS_OPTIONS.filter((option) => option.value !== "livree").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : null}
    {pendingStatus ? <span className="sub" role="status">Enregistrement…</span> : null}
    {error ? <p className="adm-inline-error" role="alert">{error}</p> : null}
  </div>;
}

const INCIDENT_LABELS: Record<DeliveryIncidentType, string> = {
  client_injoignable: "Client injoignable",
  adresse_incorrecte: "Adresse incorrecte",
  livreur_indisponible: "Livreur indisponible",
  report_client: "Report demandé par le client",
  autre: "Autre incident",
};

function IncidentControl({ order }: { order: Order }) {
  const { patchOrder } = useOrderUpdates();
  const [saving, setSaving] = useState(false);
  async function report(type: DeliveryIncidentType) {
    const note = window.prompt("Ajoutez une précision utile (facultatif) :", order.deliveryIncidentNote || "") ?? "";
    setSaving(true);
    try {
      const result = await reportDeliveryIncidentAction(order.id, type, note);
      if (!result.ok) return alert(result.error);
      showToast("Incident enregistré — livraison reportée", "error");
      patchOrder(order.id, result.patch);
    } catch {
      showToast("Enregistrement non confirmé. Réessayez après vérification de la connexion.", "error");
    } finally {
      setSaving(false);
    }
  }
  async function clear() {
    setSaving(true);
    try {
      const result = await reportDeliveryIncidentAction(order.id, null);
      if (!result.ok) return alert(result.error);
      patchOrder(order.id, result.patch);
    } catch {
      showToast("Enregistrement non confirmé. Réessayez après vérification de la connexion.", "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div>
      <select aria-label="Signaler un incident" defaultValue="" disabled={saving || order.status === "livree" || order.status === "annulee"} onChange={(e) => { if (e.target.value) report(e.target.value as DeliveryIncidentType); e.currentTarget.value = ""; }} style={{ fontSize: ".76rem", padding: "4px 6px" }}>
        <option value="">Signaler un incident…</option>
        {Object.entries(INCIDENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {order.deliveryIncidentType ? <div className="sub" style={{ marginTop: 5, color: "var(--error)" }}>{INCIDENT_LABELS[order.deliveryIncidentType]}{order.deliveryIncidentNote ? ` · ${order.deliveryIncidentNote}` : ""} <button type="button" className="icon-btn" style={{ width: "auto", minHeight: 0, padding: "2px 5px" }} disabled={saving} onClick={clear}>Effacer</button></div> : null}
    </div>
  );
}

function AddressCell({ order }: { order: Order }) {
  const { patchOrder } = useOrderUpdates();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(order.address || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateOrderAddressAction(order.id, value);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      setEditing(false);
      patchOrder(order.id, result.patch);
    } catch {
      showToast("Enregistrement non confirmé. Réessayez après vérification de la connexion.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          autoFocus
          aria-label="Adresse ou zone de livraison"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Adresse / zone"
          style={{ minWidth: 160 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button type="button" className="icon-btn" aria-label="Enregistrer l'adresse" disabled={saving} onClick={save}>
          <Icon name="check-circle" size="sm" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="icon-btn"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "auto", padding: "4px 8px" }}
      onClick={() => setEditing(true)}
    >
      <Icon name="location" size="sm" />
      <span className="sub" style={{ maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {order.address || "Non renseignée"}
      </span>
    </button>
  );
}

function NewOrderForm({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const { reloadOrders } = useOrderUpdates();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderSummary, setOrderSummary] = useState("");
  const [address, setAddress] = useState("");
  const [deliverySlot, setDeliverySlot] = useState("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [pickSlug, setPickSlug] = useState("");
  const [pickSize, setPickSize] = useState("");
  const [pickQty, setPickQty] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const pickedProduct = products.find((p) => p.slug === pickSlug);

  function addItem() {
    const qty = Number(pickQty);
    if (!pickSlug || !pickSize || !Number.isFinite(qty) || qty < 1) return;
    setItems((list) => [...list, { slug: pickSlug, size: pickSize, qty }]);
    setPickSlug("");
    setPickSize("");
    setPickQty("1");
  }
  function removeItem(index: number) {
    setItems((list) => list.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await createOrderAction({ customerName, customerPhone, orderSummary, address, deliverySlot, items });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      showToast("Commande enregistrée", "check-circle");
      onClose();
      void reloadOrders();
    } catch {
      setError("Échec de l'enregistrement. Vérifiez votre connexion et réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error ? (
        <div className="adm-warn">
          <Icon name="error" />
          <div>{error}</div>
        </div>
      ) : null}
      <div className="adm-field">
        <label>Nom du client</label>
        <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      </div>
      <div className="adm-field">
        <label>Numéro WhatsApp</label>
        <input
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder="237655634265"
          inputMode="tel"
        />
      </div>
      <div className="adm-field">
        <label>Résumé de la commande</label>
        <textarea
          value={orderSummary}
          onChange={(e) => setOrderSummary(e.target.value)}
          placeholder="2x PSG domicile L, 1x OM domicile M"
        />
      </div>

      <div className="adm-field">
        <label>Articles vendus — met à jour le stock</label>
        {items.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {items.map((item, i) => {
              const p = products.find((x) => x.slug === item.slug);
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "6px 10px",
                    background: "var(--surface-container-low)",
                    borderRadius: "var(--r-item)",
                  }}
                >
                  <span className="sub">
                    {item.qty}x {p?.name || item.slug} ({item.size})
                  </span>
                  <button type="button" className="icon-btn danger" aria-label="Retirer cet article" onClick={() => removeItem(i)}>
                    <Icon name="close" size="sm" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <select
            aria-label="Choisir un maillot"
            value={pickSlug}
            onChange={(e) => {
              setPickSlug(e.target.value);
              setPickSize("");
            }}
            style={{ flex: "1 1 160px" }}
          >
            <option value="">Choisir un maillot…</option>
            {products.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name} ({p.stock} en stock)
              </option>
            ))}
          </select>
          <select
            aria-label="Taille"
            value={pickSize}
            onChange={(e) => setPickSize(e.target.value)}
            disabled={!pickedProduct}
            style={{ flex: "0 1 90px" }}
          >
            <option value="">Taille</option>
            {pickedProduct?.sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            aria-label="Quantité"
            value={pickQty}
            onChange={(e) => setPickQty(e.target.value)}
            style={{ flex: "0 1 64px" }}
          />
          <button type="button" className="btn btn-tonal btn-sm" onClick={addItem} disabled={!pickSlug || !pickSize}>
            <Icon name="add" size="sm" />
            Ajouter
          </button>
        </div>
        <p className="hint" style={{ fontSize: ".78rem", color: "var(--on-surface-variant)", margin: "6px 0 0" }}>
          Laissez vide si vous préférez juste décrire la commande sans toucher au stock.
        </p>
      </div>

      <div className="adm-field">
        <label>Adresse / zone de livraison</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Ex. Bonamoussadi, derrière la pharmacie…"
        />
        <p className="hint" style={{ fontSize: ".78rem", color: "var(--on-surface-variant)", margin: "4px 0 0" }}>
          Pas encore connue ? Laissez vide, vous pourrez la renseigner plus tard depuis le tableau.
        </p>
      </div>
      <div className="adm-field">
        <label>Créneau de livraison</label>
        <input value={deliverySlot} onChange={(e) => setDeliverySlot(e.target.value)} placeholder="Ex. Mardi, entre 14 h et 17 h" />
        <p className="hint" style={{ fontSize: ".78rem", color: "var(--on-surface-variant)", margin: "4px 0 0" }}>
          Indiquez le créneau convenu avec le client. Il pourra être modifié plus tard.
        </p>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={handleSave} disabled={saving}>
        <Icon name="check-circle" size="sm" />
        {saving ? "Enregistrement…" : "Enregistrer la commande"}
      </button>
    </>
  );
}

// Liste des livreurs enregistrés (voir /livreur/inscription) — l'admin ne les
// crée pas ici, il partage juste le lien d'inscription ; il peut seulement
// désactiver un profil qui ne livre plus (un livreur désactivé disparaît du
// menu déroulant de RoleLocationRow, mais reste sélectionnable là où il est
// déjà assigné, pour ne pas casser une livraison en cours).
function CouriersDrawer({
  open,
  onClose,
  couriers,
  siteUrl,
  onToggle,
  onReject,
}: {
  open: boolean;
  onClose: () => void;
  couriers: Courier[];
  siteUrl: string;
  onToggle: (id: string, active: boolean) => void;
  onReject: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const registerUrl = `${siteUrl.replace(/\/$/, "")}/livreur/inscription`;

  async function reject(courier: Courier) {
    if (!confirm(`Refuser la demande de « ${courier.name} » ? Elle sera supprimée.`)) return;
    setBusyId(courier.id);
    try {
      const result = await rejectCourierAction(courier.id);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      onReject(courier.id);
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(courier: Courier) {
    setBusyId(courier.id);
    try {
      const result = await setCourierActiveAction(courier.id, !courier.active);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      onToggle(courier.id, !courier.active);
    } finally {
      setBusyId(null);
    }
  }

  async function copyRegisterLink() {
    try {
      await navigator.clipboard.writeText(registerUrl);
      showToast("Lien copié — partagez-le avec vos livreurs", "check-circle");
    } catch {
      alert("Impossible de copier le lien.");
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Livreurs enregistrés" titleIcon="shipping">
      <p className="sub" style={{ marginBottom: 14 }}>
        Un livreur s&apos;enregistre lui-même via ce lien et apparaît ci-dessous « à valider ». Il ne peut recevoir de
        livraison qu&apos;une fois sa demande validée ici.
      </p>
      <button type="button" className="btn btn-tonal btn-block" style={{ marginBottom: 20 }} onClick={copyRegisterLink}>
        <Icon name="publish" size="sm" />
        Copier le lien d&apos;inscription
      </button>

      {couriers.length === 0 ? (
        <div className="adm-empty">
          <Icon name="shipping" />
          <div>Aucun livreur enregistré pour le moment.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {couriers.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 12px",
                background: "var(--surface-container-low)",
                borderRadius: "var(--r-item)",
              }}
            >
              <div>
                <div className="name">{c.name}</div>
                <div className="sub">{c.phone}</div>
                {c.pendingApproval ? <span className="badge badge-stock-low">À valider</span> : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {c.pendingApproval ? (
                  <button type="button" className="btn btn-tonal btn-sm" disabled={busyId === c.id} onClick={() => reject(c)}>
                    Refuser
                  </button>
                ) : null}
                <button type="button" className={c.pendingApproval ? "btn btn-primary btn-sm" : "btn btn-tonal btn-sm"} disabled={busyId === c.id} onClick={() => toggle(c)}>
                  {c.pendingApproval ? "Valider" : c.active ? "Désactiver" : "Réactiver"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

export function OrdersAdmin({
  initialOrders,
  products,
  settings,
  initialCouriers,
}: {
  initialOrders: Order[];
  products: Product[];
  settings: SiteSettings;
  initialCouriers: Courier[];
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const patchOrder = useCallback((id: string, patch: Partial<Order>) => {
    revision.current++;
    setOrders((rows) => rows.map((order) => order.id === id ? { ...order, ...patch } : order));
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [couriersOpen, setCouriersOpen] = useState(false);
  const [couriers, setCouriers] = useState(initialCouriers);
  const pendingCouriers = couriers.filter((c) => c.pendingApproval).length;
  const [formNonce, setFormNonce] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const reloadOrders = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const version = revision.current;
    setRefreshing(true);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/admin/orders", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Actualisation impossible");
      const data = await response.json();
      if (controller.signal.aborted || version !== revision.current) return;
      setOrders(data.orders); setCouriers(data.couriers); setRefreshError("");
    } catch {
      if (requestRef.current === controller) setRefreshError("Actualisation indisponible. Vos dernières données restent affichées.");
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) { setRefreshing(false); requestRef.current = null; }
    }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden && !requestRef.current) void reloadOrders(); }, 30000);
    const onFocus = () => { if (!document.hidden && !requestRef.current) void reloadOrders(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onFocus); requestRef.current?.abort(); };
  }, [reloadOrders]);

  const [view, setView] = useState("");
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("view");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- filtre initial provenant du tableau de bord
    if (initial && ["pending", "delivery", "review"].includes(initial)) setView(initial);
  }, []);
  const filteredOrders = orders.filter((order) => {
    const status = normalizeOrderStatus(order.status);
    if (view === "pending" && !["recue", "confirmee", "preparation", "prete"].includes(status)) return false;
    if (view === "delivery" && !["livreur_assigne", "en_route", "arrivee"].includes(status)) return false;
    if (view === "review" && order.paymentStatus !== "review" && !order.inventoryIssue) return false;
    if (view && !["pending", "delivery", "review"].includes(view) && status !== view) return false;
    return [order.customerName, order.customerPhone, order.orderSummary, order.address, order.id].filter(Boolean).join(" ").toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr"));
  });

  function openNewOrder() {
    setFormNonce((n) => n + 1);
    setDrawerOpen(true);
  }

  async function markDelivered(order: Order) {
    setBusyId(order.id);
    try {
      const result = await markOrderDeliveredAction(order.id);
      if (!result.ok) {
        alert(result.error);
        return;
      }
      showToast("Commande marquée livrée", "check-circle");
      patchOrder(order.id, result.patch);
    } catch {
      showToast("La livraison n’a pas pu être confirmée. Actualisez avant de réessayer.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <OrderUpdates.Provider value={{ patchOrder, reloadOrders }}><section>
      <div className="adm-page-heading"><div><p className="ik-eyebrow">Opérations</p><h1>Commandes et livraisons</h1><p>Retrouvez un client, préparez sa commande et suivez sa livraison.</p></div></div>
      <div className="adm-info">
        <Icon name="info" />
        <div>
          Faites avancer chaque commande selon la réalité : reçue, confirmée, préparée, prête, affectée puis en route.
          Le lien de position du client n&apos;est disponible qu&apos;après le départ du livreur. Une fois livrée, un lien
          d&apos;avis à usage unique est généré.
        </div>
      </div>
      {refreshError ? <p className="adm-inline-error" role="status">{refreshError}</p> : null}
      <div className="adm-toolbar">
        <button type="button" className="btn btn-tonal btn-sm" onClick={() => void reloadOrders()} disabled={refreshing}><Icon name="refresh" size="sm" />{refreshing ? "Actualisation…" : "Actualiser"}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={openNewOrder}>
          <Icon name="add" size="sm" />
          Nouvelle commande
        </button>
        <button type="button" className="btn btn-tonal btn-sm" onClick={() => setCouriersOpen(true)}>
          <Icon name="shipping" size="sm" />
          Livreurs ({couriers.filter((c) => c.active).length})
          {pendingCouriers > 0 ? <span className="badge badge-stock-low">{pendingCouriers} à valider</span> : null}
        </button>
        <label className="field-wrap grow"><Icon name="search" /><input className="search-input" type="search" aria-label="Rechercher une commande" placeholder="Client, téléphone, article…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select className="sort-select" aria-label="Filtrer les commandes" value={view} onChange={(event) => setView(event.target.value)}>
          <option value="">Toutes les commandes</option><option value="pending">À préparer</option><option value="delivery">Livraisons en cours</option><option value="review">Paiements à vérifier</option>
          {ORDER_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="adm-count" aria-live="polite">
          {filteredOrders.length} commande{filteredOrders.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table adm-orders-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Commande</th>
              <th style={{ width: 180 }}>Adresse / zone</th>
              <th style={{ width: 150 }}>Créneau</th>
              <th style={{ width: 170 }}>Position en direct</th>
              <th style={{ width: 150 }}>État</th>
              <th style={{ width: 260 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="adm-empty">
                    <Icon name="shipping" />
                    <div>Aucune commande ne correspond à ces critères.</div>
                  </div>
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => (
                <tr key={order.id} id={`order-${order.id}`}>
                  <td>
                    <div className="name">{order.customerName}</div>
                    <div className="sub">{order.customerPhone}</div>
                  </td>
                  <td>
                    <div className="sub">{order.orderSummary}</div>
                    {order.paymentStatus === "review" || order.inventoryIssue ? (
                      <div className="adm-warn" style={{ marginTop: 8 }}>
                        <Icon name="error" size="sm" />
                        <div>
                          <strong>Paiement reçu — stock à vérifier</strong>
                          {order.paymentFailureReason ? <div>{order.paymentFailureReason}</div> : null}
                        </div>
                      </div>
                    ) : null}
                  </td>
                  <td data-label="Adresse / zone">
                    <AddressCell order={order} />
                  </td>
                  <td data-label="Créneau"><DeliverySlotCell order={order} /></td>
                  <td data-label="Suivi GPS">
                    <LocationCell order={order} settings={settings} couriers={couriers} />
                  </td>
                  <td data-label="État"><StatusControl order={order} /></td>
                  <td>
                    <div className="adm-row-actions">
                      {normalizeOrderStatus(order.status) === "arrivee" ? (
                        <button
                          type="button"
                          className="btn btn-tonal btn-sm"
                          disabled={busyId === order.id}
                          onClick={() => markDelivered(order)}
                        >
                          <Icon name="check-circle" size="sm" />
                          Marquer livrée
                        </button>
                      ) : order.reviewSubmitted ? (
                        <span className="badge badge-new">
                          <Icon name="star" size="sm" />
                          Avis reçu
                        </span>
                      ) : order.reviewToken ? (
                        <StatefulButton
                          className="btn btn-whatsapp btn-sm"
                          href={reviewRequestLink(order, settings.siteUrl, settings.businessName)}
                          target="_blank"
                          rel="noopener"
                          onRun={() => wait(600)}
                        >
                          <Icon name="whatsapp" size="sm" />
                          Demander un avis
                        </StatefulButton>
                      ) : null}
                      {order.status !== "livree" ? (
                        <StatefulButton className="btn btn-whatsapp btn-sm" href={orderUpdateLink(order, settings.businessName)} target="_blank" rel="noopener" onRun={() => wait(400)}>
                          <Icon name="whatsapp" size="sm" />Informer le client
                        </StatefulButton>
                      ) : null}
                      <IncidentControl order={order} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Nouvelle commande" titleIcon="shipping">
        <NewOrderForm key={formNonce} products={products} onClose={() => setDrawerOpen(false)} />
      </Drawer>

      <CouriersDrawer
        open={couriersOpen}
        onClose={() => setCouriersOpen(false)}
        couriers={couriers}
        siteUrl={settings.siteUrl}
        onToggle={(id, active) => setCouriers((list) => list.map((c) => (c.id === id ? { ...c, active, pendingApproval: active ? false : c.pendingApproval } : c)))}
        onReject={(id) => setCouriers((list) => list.filter((c) => c.id !== id))}
      />
    </section></OrderUpdates.Provider>
  );
}
