"use client";

import { useId, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { FCFA } from "@/lib/cart";
import { customerOrderGroup, customerOrderMessage, type CustomerOrderView, type OrderGroup } from "@/lib/customerOrderView";
import { ORDER_STATUS_LABELS } from "@/lib/orderWorkflow";
import { usePrivatePolling } from "@/lib/hooks/usePrivatePolling";
import { orderDate } from "@/components/account/OrderTimeline";

export function OrderHistory({ orders, sport }: { orders: CustomerOrderView[]; sport: string }) {
  const id = useId();
  const panelId = `${id}-panel`;
  const [tab, setTab] = useState<OrderGroup>(orders.some((order) => customerOrderGroup(order) === "active") || !orders.length ? "active" : orders.some((order) => customerOrderGroup(order) === "scheduled") ? "scheduled" : "history");
  const { data, warning, refreshing, refresh } = usePrivatePolling("/api/customer/orders", orders, 20000);
  const groups = {
    active: data.filter((order) => customerOrderGroup(order) === "active"),
    scheduled: data.filter((order) => customerOrderGroup(order) === "scheduled"),
    history: data.filter((order) => customerOrderGroup(order) === "history"),
  };
  const tabs: OrderGroup[] = ["active", "scheduled", "history"];
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, current: OrderGroup) {
    let next: OrderGroup;
    if (event.key === "Home") next = tabs[0];
    else if (event.key === "End") next = tabs[tabs.length - 1];
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const offset = event.key === "ArrowRight" ? 1 : -1;
      next = tabs[(tabs.indexOf(current) + offset + tabs.length) % tabs.length];
    } else return;
    event.preventDefault();
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`${id}-tab-${next}`)?.focus());
  }
  return <>
    <div className="ik-orders-toolbar"><div className="ik-order-tabs" role="tablist" aria-label="Filtrer mes commandes">
      {([["active", "En cours"], ["scheduled", "Planifiées"], ["history", "Historique"]] as const).map(([key, label]) => <button type="button" role="tab" id={`${id}-tab-${key}`} aria-selected={tab === key} aria-controls={panelId} tabIndex={tab === key ? 0 : -1} key={key} onClick={() => setTab(key)} onKeyDown={(event) => handleTabKey(event, key)}>{label}<span aria-label={`${groups[key].length} commande${groups[key].length > 1 ? "s" : ""}`}>{groups[key].length}</span></button>)}
    </div><button type="button" className="ik-round-button" aria-label="Actualiser mes commandes" disabled={refreshing} onClick={() => void refresh()}><Icon name="refresh" /></button></div>
    <p className="sr-only" role="status" aria-live="polite">{refreshing ? "Actualisation des commandes en cours" : ""}</p>
    {warning ? <p className="ik-inline-warning" role="status">{warning}</p> : null}
    <div className="ik-order-list" role="tabpanel" id={panelId} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}>
      {groups[tab].map((order) => <article key={order.id} className="ik-order-card">
        <div className="ik-order-card-head"><span className="ik-order-parcel" aria-hidden="true"><Icon name="inventory" /></span>
          <div><strong>IKIGAI Sport</strong><p><time dateTime={order.createdAt}>{orderDate(order.createdAt)}</time> · #{order.id.slice(-6).toUpperCase()}</p></div>
          <span className={`ik-order-badge ik-order-badge--${order.status}`}>{ORDER_STATUS_LABELS[order.status]}</span>
        </div>
        <div className="ik-order-summary"><h2>{order.summary}</h2>{order.total !== null ? <strong>{FCFA(order.total)}</strong> : null}</div>
        {order.deliverySlot && !["livree", "annulee"].includes(order.status) ? <p className="ik-order-slot"><Icon name="schedule" size="sm" />Créneau convenu : {order.deliverySlot}</p> : null}
        <p className="ik-muted">{customerOrderMessage(order)}</p>
        <Link href={`/${sport}/compte/commandes/${encodeURIComponent(order.id)}`} className="ik-order-detail-link">Voir le détail et l’avancement<Icon name="arrow-forward" size="sm" /></Link>
      </article>)}
      {!groups[tab].length ? <div className="ik-account-empty"><Icon name="inventory" size="xl" /><h2>{tab === "history" ? "Votre historique commence ici" : tab === "scheduled" ? "Aucun créneau planifié" : "Aucune commande en cours"}</h2><p className="ik-muted">{tab === "scheduled" ? "Les commandes avec un créneau convenu apparaîtront ici jusqu’au départ du livreur." : "Retrouvez vos équipements préférés dans la boutique."}</p><Link href={`/${sport}/boutique`} className="btn btn-primary">Explorer la boutique<Icon name="arrow-forward" size="sm" /></Link></div> : null}
    </div>
  </>;
}
