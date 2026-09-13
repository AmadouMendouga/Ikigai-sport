"use client";

// Boutique — porté depuis js/main.js#initShop. Filtre/trie/pagine côté
// client sur le catalogue déjà chargé (pas besoin de requêtes
// supplémentaires). L'état initial vient des paramètres d'URL comme
// l'original (?league=, ?promo=1, ?stock=1, ?tri=, ?q=), lus une seule fois
// au montage. Les interactions restent locales afin de ne pas toucher aux
// flux métier, au panier ou aux API.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { ProductCard } from "@/components/products/ProductCard";
import { stockInfo } from "@/lib/cart";
import type { League, Product, SiteSettings } from "@/lib/types";

const PER_PAGE = 12;

type SortOrder = "default" | "price-asc" | "price-desc";

export function Shop({
  products,
  leagues,
  settings,
}: {
  products: Product[];
  leagues: League[];
  settings: SiteSettings;
}) {
  const verified = settings.catalogDataVerified;

  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);
  const [onlyPromo, setOnlyPromo] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<SortOrder>("default");
  const [page, setPage] = useState(1);
  const filtersPanelRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const league = params.get("league");
    const q = params.get("q") || "";
    const tri = params.get("tri");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique de l'URL au montage
    if (league) setSelectedLeagues([league]);
    if (verified && params.get("promo") === "1") setOnlyPromo(true);
    if (verified && params.get("stock") === "1") setInStockOnly(true);
    if (q) {
      setSearch(q.trim().toLowerCase());
      setSearchInput(q);
    }
    if (tri === "prix-asc") setSort("price-asc");
    else if (tri === "prix-desc") setSort("price-desc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 901px)");
    const sync = (event?: MediaQueryListEvent) => {
      const panel = filtersPanelRef.current;
      if (!panel) return;
      if (event ? event.matches : desktop.matches) {
        panel.open = true;
      } else {
        // En mobile, les filtres commencent repliés afin de laisser les
        // produits visibles immédiatement. L'utilisateur garde ensuite le
        // contrôle du panneau tant que le breakpoint ne change pas.
        panel.removeAttribute("open");
      }
    };
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, []);

  const filtered = useMemo(() => {
    let list = products.slice();
    if (selectedLeagues.length) list = list.filter((p) => !!p.league && selectedLeagues.includes(p.league));
    if (onlyPromo) list = list.filter((p) => p.discountPct > 0);
    if (inStockOnly) list = list.filter((p) => stockInfo(p, verified).available);
    if (search) {
      list = list.filter(
        (p) => p.name.toLowerCase().includes(search) || p.team.toLowerCase().includes(search)
      );
    }
    if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
    else if (sort === "price-desc") list.sort((a, b) => b.price - a.price);
    return list;
  }, [products, selectedLeagues, onlyPromo, inStockOnly, search, sort, verified]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);
  const activeFilterCount = selectedLeagues.length + (onlyPromo ? 1 : 0) + (inStockOnly ? 1 : 0) + (search ? 1 : 0);

  function toggleLeague(key: string, checked: boolean) {
    setSelectedLeagues((prev) => (checked ? [...prev, key] : prev.filter((k) => k !== key)));
    setPage(1);
  }

  function clearSearch() {
    setSearch("");
    setSearchInput("");
    setPage(1);
  }

  function resetFilters() {
    setSelectedLeagues([]);
    setOnlyPromo(false);
    setInStockOnly(false);
    clearSearch();
    setSort("default");
    setPage(1);
  }

  function goToPage(p: number) {
    setPage(p);
    document.getElementById("shopGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="shop-layout">
      <aside id="catalogFilters" className="filters" aria-label="Filtres du catalogue">
        <details ref={filtersPanelRef} className="filters-panel">
          <summary>
            <span className="filters-summary-label">
              <Icon name="tune" size="sm" />
              Filtrer les produits
            </span>
            {activeFilterCount > 0 && <span className="filters-count" aria-label={`${activeFilterCount} filtres actifs`}>{activeFilterCount}</span>}
          </summary>
          <div className="filters-content">
            {leagues.length > 0 ? (
              <>
                <p className="filters-heading">Championnat</p>
                <div className="filter-group">
                  {leagues.map((league) => {
                    const count = products.filter((p) => p.league === league.key).length;
                    return (
                      <label className="filter-option" key={league.key}>
                        <input
                          type="checkbox"
                          checked={selectedLeagues.includes(league.key)}
                          onChange={(e) => toggleLeague(league.key, e.currentTarget.checked)}
                        />
                        <span>{league.label}</span>
                        <span className="count">{count}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            ) : null}

            {verified && (
              <div>
                <p className="filters-heading">Disponibilité</p>
                <div className="filter-group">
                  <label className="filter-option">
                    <input
                      type="checkbox"
                      checked={onlyPromo}
                      onChange={(e) => {
                        setOnlyPromo(e.currentTarget.checked);
                        setPage(1);
                      }}
                    />
                    <span>En promotion</span>
                  </label>
                  <label className="filter-option">
                    <input
                      type="checkbox"
                      checked={inStockOnly}
                      onChange={(e) => {
                        setInStockOnly(e.currentTarget.checked);
                        setPage(1);
                      }}
                    />
                    <span>En stock uniquement</span>
                  </label>
                </div>
              </div>
            )}

            {activeFilterCount > 0 && (
              <button type="button" className="shop-reset-btn" onClick={resetFilters}>
                <Icon name="refresh" size="sm" />
                Réinitialiser les filtres
              </button>
            )}

            <a className="btn btn-tonal btn-block" href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noopener">
              <Icon name="whatsapp" size="sm" />
              Besoin d&apos;aide ?
            </a>
          </div>
        </details>
      </aside>

      <div className="shop-content">
        <div className="shop-content-heading">
          <div>
            <span className="shop-eyebrow">Catalogue</span>
            <h2>Choisissez votre équipement</h2>
          </div>
          <span className="shop-total-badge">{products.length} article{products.length !== 1 ? "s" : ""}</span>
        </div>

        {leagues.length > 0 && (
          <div className="category-pills" role="group" aria-label="Filtrer par championnat">
            <button
              type="button"
              className={"category-pill" + (selectedLeagues.length === 0 ? " active" : "")}
              aria-pressed={selectedLeagues.length === 0}
              onClick={() => {
                setSelectedLeagues([]);
                setPage(1);
              }}
            >
              Tous
            </button>
            {leagues.map((league) => {
              const count = products.filter((p) => p.league === league.key).length;
              const active = selectedLeagues.includes(league.key);
              return (
                <button
                  key={league.key}
                  type="button"
                  className={"category-pill" + (active ? " active" : "")}
                  aria-pressed={active}
                  onClick={() => toggleLeague(league.key, !active)}
                >
                  {league.label}
                  <span className="count">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {activeFilterCount > 0 && (
          <div className="active-filters" aria-label="Filtres actifs">
            <span className="active-filters-label">Filtres actifs</span>
            <div className="active-filter-chips">
              {selectedLeagues.map((key) => {
                const league = leagues.find((item) => item.key === key);
                return (
                  <button key={key} type="button" className="active-filter-chip" onClick={() => toggleLeague(key, false)}>
                    {league?.label || key}
                    <Icon name="close" size="sm" />
                  </button>
                );
              })}
              {onlyPromo && (
                <button type="button" className="active-filter-chip" onClick={() => { setOnlyPromo(false); setPage(1); }}>
                  Promotions
                  <Icon name="close" size="sm" />
                </button>
              )}
              {inStockOnly && (
                <button type="button" className="active-filter-chip" onClick={() => { setInStockOnly(false); setPage(1); }}>
                  En stock
                  <Icon name="close" size="sm" />
                </button>
              )}
              {search && (
                <button type="button" className="active-filter-chip" onClick={clearSearch}>
                  « {searchInput.trim()} »
                  <Icon name="close" size="sm" />
                </button>
              )}
            </div>
            <button type="button" className="active-filters-clear" onClick={resetFilters}>Tout effacer</button>
          </div>
        )}

        {settings.showDemoNotice && (
          <div className="demo-note">
            <Icon name="info" />
            <div>
              <strong>Photos de démonstration.</strong> Les visuels produits sont des images de test — remplacez-les
              par vos vraies photos de produits.
            </div>
          </div>
        )}

        {!verified && (
          <div className="catalog-note" role="note">
            <Icon name="info" />
            <div>
              <strong>Catalogue en cours de vérification.</strong> Les prix et disponibilités affichés sont
              indicatifs et doivent être confirmés sur WhatsApp.
            </div>
          </div>
        )}

        <div className="toolbar">
          <span className="result-count" role="status" aria-live="polite" aria-atomic="true">
            {filtered.length} produit{filtered.length !== 1 ? "s" : ""} trouvé{filtered.length !== 1 ? "s" : ""}
          </span>
          <div className="toolbar-controls">
            <span className="field-wrap shop-search-wrap">
              <Icon name="search" />
              <label className="sr-only" htmlFor="shopSearch">
                Rechercher une équipe ou un produit
              </label>
              <input
                type="search"
                className="search-input"
                id="shopSearch"
                placeholder="Produit ou équipe..."
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.currentTarget.value);
                  setSearch(e.currentTarget.value.trim().toLowerCase());
                  setPage(1);
                }}
              />
              {searchInput && (
                <button type="button" className="shop-search-clear" aria-label="Effacer la recherche" onClick={clearSearch}>
                  <Icon name="close" size="sm" />
                </button>
              )}
            </span>
            <select
              className="sort-select"
              aria-label="Trier les produits"
              value={sort}
              onChange={(e) => setSort(e.currentTarget.value as SortOrder)}
            >
              <option value="default">Pertinence</option>
              <option value="price-asc">Prix : croissant</option>
              <option value="price-desc">Prix : décroissant</option>
            </select>
          </div>
        </div>

        <div className="product-grid" id="shopGrid" aria-label="Résultats du catalogue">
          {pageItems.length ? (
            pageItems.map((p) => <ProductCard key={p.slug} product={p} settings={settings} />)
          ) : (
            <div className="empty-state">
              <Icon name="search" />
              <div>
                <strong>Aucun produit trouvé.</strong>
                <br />
                Essayez d&apos;autres filtres ou écrivez-nous sur WhatsApp.
              </div>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <nav className="pagination" role="navigation" aria-label="Pagination des produits">
            <button
              type="button"
              disabled={currentPage === 1}
              aria-label="Page précédente"
              onClick={() => goToPage(currentPage - 1)}
            >
              <Icon name="chevron-left" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                className={p === currentPage ? "active" : undefined}
                aria-label={`Page ${p}`}
                aria-current={p === currentPage ? "page" : undefined}
                onClick={() => goToPage(p)}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              disabled={currentPage === totalPages}
              aria-label="Page suivante"
              onClick={() => goToPage(currentPage + 1)}
            >
              <Icon name="chevron-right" />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
