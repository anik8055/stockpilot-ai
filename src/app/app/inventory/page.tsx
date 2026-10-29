import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { formatINR, formatQty } from "@/lib/domain/money";
import { listProducts, productFacets, type ProductListParams } from "@/lib/services/catalog";
import { requireTenant, tx } from "@/lib/tenant";

export const metadata: Metadata = { title: "Products" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function InventoryPage(props: PageProps<"/app/inventory">) {
  const t = await requireTenant();
  const sp = await props.searchParams;
  const params: ProductListParams = {
    q: str(sp.q),
    category: str(sp.category) || undefined,
    supplierId: str(sp.supplier) || undefined,
    status: (["active", "inactive", "all"].includes(str(sp.status) ?? "") ? str(sp.status) : "active") as ProductListParams["status"],
    stock: (["out", "in"].includes(str(sp.stock) ?? "") ? str(sp.stock) : "all") as ProductListParams["stock"],
    sort: (["name", "sku", "on_hand", "value", "updated"].includes(str(sp.sort) ?? "") ? str(sp.sort) : "name") as ProductListParams["sort"],
    dir: str(sp.dir) === "desc" ? "desc" : "asc",
    page: Number(str(sp.page)) || 1,
  };
  const [{ rows, total, page, pageSize }, facets] = [await tx(t, (db) => listProducts(db, t.businessId, params)), await tx(t, (db) => productFacets(db, t.businessId))];
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (over: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const merged = { q: params.q, category: params.category, supplier: params.supplierId, status: params.status, stock: params.stock, sort: params.sort, dir: params.dir, page: params.page, ...over };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) u.set(k, String(v));
    return `?${u.toString()}`;
  };
  const sortLink = (key: NonNullable<ProductListParams["sort"]>, label: string, align: "left" | "right" = "left") => {
    const active = params.sort === key;
    const dir = active && params.dir === "asc" ? "desc" : "asc";
    return (
      <Th align={align} aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={qs({ sort: key, dir, page: 1 })} className="hover:text-ink">
          {label}
          {active ? (params.dir === "asc" ? " ↑" : " ↓") : ""}
        </Link>
      </Th>
    );
  };

  return (
    <>
      <PageHeader
        title="Products"
        description={`${total.toLocaleString("en-IN")} product${total === 1 ? "" : "s"}${params.status === "active" ? " (active)" : ""}`}
        actions={
          <>
            <a href="/api/products/export" className={buttonClass("secondary")}>Export CSV</a>
            <LinkButton href="/app/imports/new?kind=products" variant="secondary">Import</LinkButton>
            <LinkButton href="/app/inventory/new">Add product</LinkButton>
          </>
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]" role="search">
        <label className="sr-only" htmlFor="q">Search</label>
        <Input id="q" name="q" type="search" placeholder="Search name, SKU, barcode or supplier code" defaultValue={params.q} />
        <label className="sr-only" htmlFor="category">Category</label>
        <Select id="category" name="category" defaultValue={params.category ?? ""}>
          <option value="">All categories</option>
          {facets.categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="supplier">Supplier</label>
        <Select id="supplier" name="supplier" defaultValue={params.supplierId ?? ""}>
          <option value="">All suppliers</option>
          {facets.suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="stock">Stock</label>
        <Select id="stock" name="stock" defaultValue={params.stock}>
          <option value="all">Any stock</option>
          <option value="in">In stock</option>
          <option value="out">Out of stock</option>
        </Select>
        <label className="sr-only" htmlFor="status">Status</label>
        <Select id="status" name="status" defaultValue={params.status}>
          <option value="active">Active</option>
          <option value="inactive">Archived</option>
          <option value="all">All</option>
        </Select>
        <button className={buttonClass("secondary")} type="submit">Filter</button>
      </form>

      {rows.length === 0 ? (
        total === 0 && !params.q && !params.category && !params.supplierId && params.stock === "all" ? (
          <EmptyState title="No products yet" action={<LinkButton href="/app/imports/new?kind=products">Import your item list</LinkButton>}>
            Import the item master from your billing system, or add products one by one.
          </EmptyState>
        ) : (
          <EmptyState title="No products match these filters" action={<LinkButton href="/app/inventory" variant="secondary">Clear filters</LinkButton>} />
        )
      ) : (
        <div className="rounded-lg border border-line bg-surface">
          <Table minWidth={860}>
            <thead>
              <tr>
                {sortLink("sku", "SKU")}
                {sortLink("name", "Product")}
                <Th>Category</Th>
                <Th>Supplier</Th>
                {sortLink("on_hand", "In stock", "right")}
                <Th align="right">Cost</Th>
                {sortLink("value", "Stock value", "right")}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const onHand = Number(p.on_hand);
                const cost = p.purchase_cost === null ? null : Number(p.purchase_cost);
                return (
                  <tr key={p.id} className="hover:bg-paper/60">
                    <Td className="whitespace-nowrap text-muted">{p.sku}</Td>
                    <Td>
                      <Link href={`/app/inventory/${p.id}`} className="font-medium text-ink hover:text-signal">{p.name}</Link>
                      {!p.active && <Badge className="ml-2">Archived</Badge>}
                      {p.brand && <span className="block text-xs text-muted">{p.brand}</span>}
                    </Td>
                    <Td className="text-muted">{p.category ?? "—"}</Td>
                    <Td className="text-muted">{p.supplier_name ?? "—"}</Td>
                    <Td align="right" className={onHand <= 0 ? "text-danger" : ""}>
                      {formatQty(onHand)} <span className="text-xs text-muted">{p.base_unit}</span>
                    </Td>
                    <Td align="right">{cost === null ? <span className="text-faint">—</span> : formatINR(cost)}</Td>
                    <Td align="right">{cost === null || onHand <= 0 ? <span className="text-faint">—</span> : formatINR(onHand * cost, { whole: true })}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <nav className="flex items-center justify-between border-t border-line px-4 py-3 text-sm" aria-label="Pagination">
            <span className="text-muted">
              Page {page} of {pages}
            </span>
            <span className="flex gap-2">
              {page > 1 ? <Link className={buttonClass("secondary", "sm")} href={qs({ page: page - 1 })}>Previous</Link> : <span className={buttonClass("secondary", "sm", "pointer-events-none opacity-50")}>Previous</span>}
              {page < pages ? <Link className={buttonClass("secondary", "sm")} href={qs({ page: page + 1 })}>Next</Link> : <span className={buttonClass("secondary", "sm", "pointer-events-none opacity-50")}>Next</span>}
            </span>
          </nav>
        </div>
      )}
    </>
  );
}
