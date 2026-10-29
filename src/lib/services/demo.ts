import "server-only";
import { withAdmin, type Tx } from "@/lib/db";
import { addDays, todayIn, type ISODate } from "@/lib/domain/dates";

/**
 * Synthetic demo data for a fictional electrical-supplies wholesaler.
 * Everything generated here is fake and labelled as such (business name, supplier names, invoice refs).
 * Deterministic: the same seed always produces the same dataset.
 */

export const DEMO_LABEL = "Synthetic demo data";

type Profile = "fast" | "medium" | "slow" | "dead" | "rising" | "intermittent" | "new" | "falling";

type ProductSpec = {
  sku: string; name: string; category: string; brand: string; unit: string; cost: number; price: number;
  profile: Profile; rate: number; supplier: number; conversions?: [string, number][]; minStock?: number; maxStock?: number;
  moq?: number; pack?: number;
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Poisson sample (Knuth) — fine for small means. */
function poisson(r: () => number, mean: number) {
  if (mean <= 0) return 0;
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * (r() + r() + r() - 1.5) * 1.4));
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}

const SUPPLIERS = [
  { name: "Kaveri Wires & Cables (demo)", city: "Pune", lead: 5, phone: "+91 00000 00001" },
  { name: "Narmada Switchgear Traders (demo)", city: "Mumbai", lead: 7, phone: "+91 00000 00002" },
  { name: "Godavari Lighting Co. (demo)", city: "Nashik", lead: 10, phone: "+91 00000 00003" },
  { name: "Tapti Fans & Appliances (demo)", city: "Surat", lead: 14, phone: "+91 00000 00004" },
  { name: "Krishna Conduits & Fittings (demo)", city: "Aurangabad", lead: 4, phone: "+91 00000 00005" },
  { name: "Sabarmati Tools Depot (demo)", city: "Ahmedabad", lead: 8, phone: "+91 00000 00006" },
];

function buildCatalogue(r: () => number): ProductSpec[] {
  const out: ProductSpec[] = [];
  const profiles: Profile[] = ["fast", "fast", "medium", "medium", "medium", "slow", "slow", "dead", "rising", "intermittent", "new", "falling"];
  const pick = (i: number) => profiles[i % profiles.length];
  const rateFor: Record<Profile, () => number> = {
    fast: () => 4 + r() * 8, medium: () => 0.8 + r() * 2, slow: () => 0.04 + r() * 0.12, dead: () => 0.6,
    rising: () => 1 + r() * 2, intermittent: () => 0.5 + r(), new: () => 1.5 + r() * 2, falling: () => 2 + r() * 2,
  };
  let i = 0;
  const used = new Set<string>();
  const code = (prefix: string, name: string) => {
    const base = `${prefix}-${name.split(/[\s()-]+/).map((w) => (/^\d/.test(w) ? w.replace(/[^0-9A-Za-z]/g, "") : w.charAt(0))).join("").toUpperCase()}`;
    let c = base;
    for (let k = 2; used.has(c); k++) c = `${base}${k}`;
    used.add(c);
    return c;
  };
  const add = (p: Omit<ProductSpec, "profile" | "rate">) => {
    const profile = pick(i++);
    out.push({ ...p, profile, rate: Math.round(rateFor[profile]() * 100) / 100 });
  };
  for (const [sq, cost] of [[0.75, 1250], [1, 1580], [1.5, 2150], [2.5, 3380], [4, 5240], [6, 7790]] as const) {
    for (const colour of ["Red", "Black", "Blue"]) {
      add({ sku: `FRW-${String(sq).replace(".", "")}-${colour.slice(0, 3).toUpperCase()}`, name: `FR PVC Copper Wire ${sq} sqmm ${colour}`, category: "Wires & Cables", brand: "Demo Polycab-type", unit: "m", cost: Math.round((cost / 90) * 100) / 100, price: Math.round((cost / 90) * 1.22 * 100) / 100, supplier: 0, conversions: [["coil", 90]], pack: 90, minStock: 180 });
    }
  }
  for (const amp of [6, 10, 16, 20, 25, 32, 40, 63]) {
    for (const pole of ["SP", "DP"]) {
      const cost = (pole === "SP" ? 165 : 420) + amp * 2;
      add({ sku: `MCB-${pole}-${amp}A`, name: `MCB ${amp}A ${pole === "SP" ? "Single Pole" : "Double Pole"} C-Curve`, category: "Switchgear", brand: "Demo Havells-type", unit: "pcs", cost, price: Math.round(cost * 1.3), supplier: 1, conversions: [["box", 12]], moq: 12 });
    }
  }
  for (const [n, cost] of [["RCCB 40A 30mA DP", 1650], ["RCCB 63A 30mA 4P", 3950], ["Isolator 63A DP", 560], ["DB 8 Way SPN", 1150], ["DB 12 Way TPN", 3850], ["Changeover Switch 63A", 2400]] as const) {
    add({ sku: code("SWG", n), name: n, category: "Switchgear", brand: "Demo Legrand-type", unit: "pcs", cost, price: Math.round(cost * 1.28), supplier: 1 });
  }
  for (const w of [9, 12, 15, 20]) {
    add({ sku: `LED-BLB-${w}W`, name: `LED Bulb ${w}W Cool Day Light B22`, category: "Lighting", brand: "Demo Philips-type", unit: "pcs", cost: 48 + w * 3, price: Math.round((48 + w * 3) * 1.45), supplier: 2, conversions: [["box", 50]], pack: 10 });
  }
  for (const w of [10, 18, 24]) {
    add({ sku: `LED-PNL-${w}W`, name: `LED Slim Panel ${w}W Round`, category: "Lighting", brand: "Demo Syska-type", unit: "pcs", cost: 140 + w * 9, price: Math.round((140 + w * 9) * 1.4), supplier: 2 });
  }
  for (const [n, cost] of [["LED Batten 20W 4ft", 210], ["LED Flood Light 50W", 780], ["LED Street Light 30W", 1350], ["Emergency Light Rechargeable", 640]] as const) {
    add({ sku: code("LGT", n), name: n, category: "Lighting", brand: "Demo Wipro-type", unit: "pcs", cost, price: Math.round(cost * 1.38), supplier: 2 });
  }
  for (const [n, cost] of [["Ceiling Fan 1200mm Brown", 1720], ["Ceiling Fan 1200mm White", 1720], ["BLDC Ceiling Fan 1200mm", 3150], ["Exhaust Fan 250mm", 1050], ["Wall Fan 400mm", 2050], ["Pedestal Fan 400mm", 2350]] as const) {
    add({ sku: code("FAN", n), name: n, category: "Fans", brand: "Demo Crompton-type", unit: "pcs", cost, price: Math.round(cost * 1.22), supplier: 3 });
  }
  for (const [n, cost] of [["Modular Switch 6A 1-Way", 28], ["Modular Switch 16A 1-Way", 62], ["Modular Socket 6A 3-Pin", 74], ["Modular Socket 16A 3-Pin", 128], ["Modular Plate 8M White", 115], ["Fan Regulator Step 5", 290], ["Bell Push Switch", 34], ["USB Charger Module Dual", 540]] as const) {
    add({ sku: code("MOD", n), name: n, category: "Switches & Sockets", brand: "Demo Anchor-type", unit: "pcs", cost, price: Math.round(cost * 1.35), supplier: 1, conversions: [["box", 20]], pack: 10 });
  }
  for (const [mm, cost] of [[20, 38], [25, 52], [32, 79]] as const) {
    add({ sku: `PVC-CND-${mm}`, name: `PVC Conduit Pipe ${mm}mm (3m length)`, category: "Conduits & Fittings", brand: "Demo Precision-type", unit: "pcs", cost, price: Math.round(cost * 1.3), supplier: 4, conversions: [["bundle", 25]], moq: 25 });
    add({ sku: `PVC-BND-${mm}`, name: `PVC Bend ${mm}mm`, category: "Conduits & Fittings", brand: "Demo Precision-type", unit: "pcs", cost: Math.round(cost / 5), price: Math.round((cost / 5) * 1.4), supplier: 4, conversions: [["pack", 50]] });
    add({ sku: `PVC-JBX-${mm}`, name: `Junction Box ${mm}mm 4-Way`, category: "Conduits & Fittings", brand: "Demo Precision-type", unit: "pcs", cost: Math.round(cost / 3), price: Math.round((cost / 3) * 1.4), supplier: 4 });
  }
  for (const [n, cost] of [["Insulation Tape 18mm Black", 9], ["Cable Tie 200mm (pack of 100)", 55], ["Wall Plug 6mm (pack of 100)", 45], ["Screw 25mm (pack of 100)", 60], ["Earthing Electrode GI 2m", 980], ["Wire Stripper Plier 6in", 210], ["Digital Multimeter Basic", 690], ["Line Tester Screwdriver", 38], ["Soldering Iron 25W", 260], ["Drill Bit Set HSS 13pc", 520]] as const) {
    add({ sku: code("ACC", n), name: n, category: "Tools & Accessories", brand: "Demo Taparia-type", unit: n.includes("pack") ? "pack" : "pcs", cost, price: Math.round(cost * 1.45), supplier: 5 });
  }
  // A deliberate near-duplicate description for the data-quality check
  add({ sku: "ACC-TAPE-BLK-OLD", name: "insulation tape black 18mm", category: "Tools & Accessories", brand: "Demo Taparia-type", unit: "pcs", cost: 9, price: 13, supplier: 5 });
  return out;
}

export async function createDemoWorkspace(userId: string): Promise<string> {
  return withAdmin(async (tx) => {
    const existing = await tx.maybeOne<{ id: string }>(
      `SELECT b.id FROM businesses b JOIN memberships m ON m.business_id = b.id WHERE m.user_id = $1 AND b.is_demo AND b.deleted_at IS NULL LIMIT 1`,
      [userId],
    );
    if (existing) return existing.id;
    const b = await tx.one<{ id: string }>(
      `INSERT INTO businesses (name, industry, city, state, is_demo, plan_code, plan_status, created_by)
       VALUES ('Demo: Shree Ganesh Electricals (synthetic data)', 'electrical', 'Pune', 'Maharashtra', true, 'demo', 'active', $1) RETURNING id`,
      [userId],
    );
    await tx.query("INSERT INTO memberships (business_id, user_id, role) VALUES ($1, $2, 'owner')", [b.id, userId]);
    await seedDemoData(tx, b.id, userId, todayIn("Asia/Kolkata"));
    return b.id;
  });
}

/** Inserts the synthetic dataset into an existing business (owner connection). */
export async function seedDemoData(tx: Tx, businessId: string, userId: string, today: ISODate, seed = 20260101) {
  const r = rng(seed);
  const DAYS = 180;
  const start = addDays(today, -DAYS);
  const end = addDays(today, -1);

  const supplierIds: string[] = [];
  for (const s of SUPPLIERS) {
    const row = await tx.one<{ id: string }>(
      `INSERT INTO suppliers (business_id, name, city, state, phone, default_lead_time_days, payment_terms, notes)
       VALUES ($1, $2, $3, 'Maharashtra', $4, $5, '30 days credit', $6) RETURNING id`,
      [businessId, s.name, s.city, s.phone, s.lead, `${DEMO_LABEL} — not a real company.`],
    );
    supplierIds.push(row.id);
  }

  const catalogue = buildCatalogue(r);
  const snapshotDays = [start, addDays(today, -90), addDays(today, -30), end];
  const snapshotIds: Record<ISODate, string> = {};
  for (const d of snapshotDays) {
    const s = await tx.one<{ id: string }>(
      "INSERT INTO stock_snapshots (business_id, snapshot_at, created_by) VALUES ($1, $2::date + time '20:00' AT TIME ZONE 'Asia/Kolkata', $3) RETURNING id",
      [businessId, d, userId],
    );
    snapshotIds[d] = s.id;
  }

  const sales: { pid: string; date: ISODate; qty: number; price: number }[] = [];
  const purchases: { pid: string; sid: string; date: ISODate; qty: number; cost: number; ref: string }[] = [];
  let poCandidates: { pid: string; sid: string; qty: number; cost: number }[] = [];

  for (const [idx, p] of catalogue.entries()) {
    const introduced = p.profile === "new" ? addDays(today, -20) : null;
    const prod = await tx.one<{ id: string }>(
      `INSERT INTO products (business_id, sku, name, category, brand, base_unit, purchase_cost, selling_price, preferred_supplier_id,
                             min_stock, max_stock, safety_stock, introduced_on, storage_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13) RETURNING id`,
      [businessId, p.sku, p.name, p.category, p.brand, p.unit, p.cost, p.price, supplierIds[p.supplier], p.minStock ?? null, p.maxStock ?? null, introduced, `Rack ${String.fromCharCode(65 + (idx % 8))}-${(idx % 12) + 1}`],
    );
    for (const [code, factor] of p.conversions ?? []) {
      await tx.query("INSERT INTO product_units (business_id, product_id, unit_code, factor_to_base) VALUES ($1,$2,$3,$4)", [businessId, prod.id, code, factor]);
    }
    await tx.query(
      `INSERT INTO supplier_products (business_id, supplier_id, product_id, supplier_sku, purchase_price, moq, pack_size, price_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
      [businessId, supplierIds[p.supplier], prod.id, `S${p.supplier + 1}-${p.sku}`, p.cost, p.moq ?? null, p.pack ?? null],
    );
    // a second, slightly dearer supplier for some items → supplier price comparison
    if (idx % 5 === 0) {
      const alt = (p.supplier + 1) % SUPPLIERS.length;
      await tx.query(
        `INSERT INTO supplier_products (business_id, supplier_id, product_id, supplier_sku, purchase_price, price_updated_at)
         VALUES ($1,$2,$3,$4,$5, now())`,
        [businessId, supplierIds[alt], prod.id, `ALT-${p.sku}`, Math.round(p.cost * 1.06 * 100) / 100],
      );
    }

    // ---- simulate daily demand, sales capped by stock (so stockouts are real), and purchasing
    const lead = SUPPLIERS[p.supplier].lead;
    let stock = Math.round(p.rate * (35 + r() * 30)) + (p.profile === "dead" ? 25 : 2);
    if (p.profile === "new") stock = 0;
    const pending: { arrive: ISODate; qty: number }[] = [];
    let ledgerBalance = 0;
    let receiptNo = 0;
    const careless = idx % 7 === 3; // some items are re-ordered late → stockouts

    for (let d = start; d <= end; d = addDays(d, 1)) {
      const dayIdx = Math.round((Date.parse(d) - Date.parse(start)) / 86400000); // 0 … DAYS-1
      // arrivals
      for (const pe of pending.filter((x) => x.arrive <= d)) {
        pending.splice(pending.indexOf(pe), 1);
        stock += pe.qty;
        receiptNo++;
        const jump = p.profile === "falling" && receiptNo > 3 ? 1.55 : 1; // suspicious cost change
        purchases.push({ pid: prod.id, sid: supplierIds[p.supplier], date: d, qty: pe.qty, cost: Math.round(p.cost * (0.97 + r() * 0.06) * jump * 100) / 100, ref: `DEMO-PB-${idx}-${receiptNo}` });
      }
      // demand
      let mean = p.rate;
      if (p.profile === "dead") mean = dayIdx < 45 ? p.rate : 0;
      if (p.profile === "rising") mean = dayIdx >= DAYS - 30 ? p.rate * 3 : p.rate;
      if (p.profile === "falling") mean = dayIdx >= DAYS - 45 ? p.rate * 0.4 : p.rate;
      if (p.profile === "new") mean = introduced && d >= introduced ? p.rate : 0;
      const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (weekday === 0) mean *= 0.15; // most shops sell little on Sunday
      let demandQty = p.profile === "intermittent" ? (r() < 0.06 ? Math.round(5 + r() * 20) : 0) : poisson(r, mean);
      if (p.unit === "m" && demandQty > 0) demandQty = Math.round(demandQty * 10); // wire sold by the metre
      const sold = Math.min(stock, demandQty);
      if (sold > 0) {
        sales.push({ pid: prod.id, date: d, qty: sold, price: p.price });
        stock -= sold;
      }
      // replenishment policy (with some carelessness)
      const onOrder = pending.reduce((s, x) => s + x.qty, 0);
      const dailyMean = (p.unit === "m" ? p.rate * 10 : p.rate) * 0.9;
      const rop = dailyMean * (lead + (careless ? -lead + 1 : 4));
      if (p.profile !== "dead" && (p.profile !== "new" || (introduced && d >= introduced)) && stock + onOrder <= rop && dailyMean > 0.05) {
        let qty = Math.ceil(dailyMean * (lead + 25));
        if (p.pack) qty = Math.ceil(qty / p.pack) * p.pack;
        if (p.moq) qty = Math.max(qty, p.moq);
        pending.push({ arrive: addDays(d, lead + (r() < 0.2 ? 3 : 0)), qty });
      }
      // stock counts on snapshot days
      if (snapshotIds[d]) {
        const delta = Math.round((stock - ledgerBalance) * 1000) / 1000;
        await tx.query(
          "INSERT INTO stock_snapshot_lines (business_id, snapshot_id, product_id, counted_qty, system_qty_before) VALUES ($1,$2,$3,$4,$5)",
          [businessId, snapshotIds[d], prod.id, stock, ledgerBalance],
        );
        if (delta !== 0) {
          await tx.query(
            `INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, occurred_at, source_type, source_id, idempotency_key, note, created_by)
             VALUES ($1,$2,$3,$4,$5::date + time '20:00' AT TIME ZONE 'Asia/Kolkata','snapshot',$6,$7,$8,$9)`,
            [businessId, prod.id, d === start ? "opening" : "snapshot_adjustment", delta, d, snapshotIds[d], `snapshot:${snapshotIds[d]}:${prod.id}`, DEMO_LABEL, userId],
          );
          ledgerBalance = stock;
        }
      }
    }
    if (pending.length && idx % 3 === 0) poCandidates.push({ pid: prod.id, sid: supplierIds[p.supplier], qty: pending[0].qty, cost: p.cost });
  }

  // Bulk insert sales and purchase history
  await tx.query(
    `INSERT INTO sales_lines (business_id, product_id, sold_on, quantity, unit_price, line_total, dedupe_key)
     SELECT $1, pid, d, q, pr, round(q * pr, 2), 'demo:' || pid || ':' || d
       FROM unnest($2::uuid[], $3::date[], $4::numeric[], $5::numeric[]) AS t(pid, d, q, pr)`,
    [businessId, sales.map((s) => s.pid), sales.map((s) => s.date), sales.map((s) => s.qty), sales.map((s) => s.price)],
  );
  await tx.query(
    `INSERT INTO purchase_history_lines (business_id, supplier_id, product_id, purchased_on, bill_ref, quantity, unit_cost, line_total, dedupe_key)
     SELECT $1, sid, pid, d, ref, q, c, round(q * c, 2), 'demo:' || ref
       FROM unnest($2::uuid[], $3::uuid[], $4::date[], $5::text[], $6::numeric[], $7::numeric[]) AS t(sid, pid, d, ref, q, c)`,
    [businessId, purchases.map((p) => p.sid), purchases.map((p) => p.pid), purchases.map((p) => p.date), purchases.map((p) => p.ref), purchases.map((p) => p.qty), purchases.map((p) => p.cost)],
  );
  await tx.query("UPDATE stock_snapshots SET line_count = (SELECT count(*) FROM stock_snapshot_lines l WHERE l.snapshot_id = stock_snapshots.id) WHERE business_id = $1", [businessId]);

  // One supplier PO already sent (inbound stock) and one draft, so purchasing screens have content.
  poCandidates = poCandidates.slice(0, 6);
  const bySupplier = new Map<string, typeof poCandidates>();
  for (const c of poCandidates) bySupplier.set(c.sid, [...(bySupplier.get(c.sid) ?? []), c]);
  let poNo = 0;
  for (const [sid, lines] of [...bySupplier.entries()].slice(0, 2)) {
    poNo++;
    const status = poNo === 1 ? "sent" : "draft";
    const total = lines.reduce((s, l) => s + Math.round(l.qty * l.cost * 100) / 100, 0);
    const po = await tx.one<{ id: string }>(
      `INSERT INTO purchase_orders (business_id, po_number, supplier_id, status, order_date, expected_date, notes, subtotal, total, created_by, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, CASE WHEN $4 = 'sent' THEN now() ELSE NULL END) RETURNING id`,
      [businessId, `PO-${String(poNo).padStart(4, "0")}`, sid, status, addDays(today, -3), addDays(today, 4), DEMO_LABEL, total, userId],
    );
    let ln = 0;
    for (const l of lines) {
      ln++;
      await tx.query(
        `INSERT INTO purchase_order_lines (business_id, purchase_order_id, line_no, product_id, quantity, unit, unit_factor, unit_price, line_total)
         SELECT $1, $2, $3, $4, $5::numeric, base_unit, 1, $6::numeric, round($5::numeric * $6::numeric, 2) FROM products WHERE id = $4`,
        [businessId, po.id, ln, l.pid, l.qty, l.cost],
      );
    }
  }
  await tx.query("INSERT INTO document_counters (business_id, kind, next_value) VALUES ($1, 'po', $2)", [businessId, poNo + 1]);
  await tx.query(
    "INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,'demo.seeded','business',$4,$3)",
    [businessId, userId, JSON.stringify({ products: catalogue.length, salesLines: sales.length, purchaseLines: purchases.length }), businessId],
  );
  return { products: catalogue.length, sales: sales.length, purchases: purchases.length };
}
