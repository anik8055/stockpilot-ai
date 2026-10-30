"""
Generates a synthetic, upload-ready sample dataset for StockPilot AI: a fictional electrical & hardware distributor.
All names, codes, GSTINs and figures are invented. Deterministic (fixed seed).

Usage: python3 scripts/make-sample-data.py <out_dir> [YYYY-MM-DD (last sales day, default yesterday)]
"""
import csv
import datetime as dt
import math
import os
import random
import sys

out = sys.argv[1] if len(sys.argv) > 1 else "sample-data"
last_day = dt.date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else dt.date.today() - dt.timedelta(days=1)
DAYS = 150
rng = random.Random(2026)
os.makedirs(out, exist_ok=True)

# ---------------------------------------------------------------- suppliers (all fictional)
suppliers = [
    # name, contact, phone, email, gstin, address, city, state, lead days, terms
    ("Jaipur Cable House", "Rakesh Agarwal", "9829000101", "orders@jaipurcable.example", "08AAACJ1234K1Z5", "12 Sanganer Industrial Area", "Jaipur", "Rajasthan", 6, "30 days"),
    ("Delhi Switchgear Traders", "Amit Khanna", "9810000202", "sales@delhiswitchgear.example", "07AAFCD5678L1Z2", "45 Bhagirath Palace", "New Delhi", "Delhi", 4, "15 days"),
    ("Mumbai Lighting Co.", "Farah Shaikh", "9820000303", "supply@mumbailighting.example", "27AABCM9012M1Z8", "Lamington Road, Shop 7", "Mumbai", "Maharashtra", 8, "30 days"),
    ("Ludhiana Tools & Fasteners", "Gurpreet Singh", "9815000404", "tools@ludhianatools.example", "03AAGCL3456N1Z1", "Focal Point Phase 4", "Ludhiana", "Punjab", 10, "45 days"),
    ("Coimbatore Fan Works", "S. Ramesh", "9842000505", "dispatch@cbefans.example", "33AAHCC7890P1Z6", "SIDCO Industrial Estate", "Coimbatore", "Tamil Nadu", 12, "30 days"),
    ("Ahmedabad Pipes & Fittings", "Hetal Patel", "9825000606", "info@amdpipes.example", "24AAICA2345Q1Z3", "Naroda GIDC, Plot 88", "Ahmedabad", "Gujarat", 7, "21 days"),
]
SUP = {s[0]: s for s in suppliers}

# ---------------------------------------------------------------- products
# sku, name, category, brand, unit, cost, price, min, max, lead, supplier, supplier code, location,
# daily demand, pattern, on-hand today
# pattern: steady | rising | falling | dead | slow | stockout (sold out ~2 weeks ago) | new (introduced recently)
P = [
    ("WR-FR-1.5-RD", "FR PVC Wire 1.5 sqmm Red (90 m coil)", "Wires & Cables", "Shaktiwire", "coil", 1180, 1450, 20, 80, None, "Jaipur Cable House", "JCH-FR15R", "A1", 2.6, "steady", 9),
    ("WR-FR-1.5-BK", "FR PVC Wire 1.5 sqmm Black (90 m coil)", "Wires & Cables", "Shaktiwire", "coil", 1180, 1450, 20, 80, None, "Jaipur Cable House", "JCH-FR15B", "A1", 2.2, "steady", 31),
    ("WR-FR-2.5-RD", "FR PVC Wire 2.5 sqmm Red (90 m coil)", "Wires & Cables", "Shaktiwire", "coil", 1890, 2290, 15, 60, None, "Jaipur Cable House", "JCH-FR25R", "A2", 1.8, "rising", 6),
    ("WR-FR-4.0-BK", "FR PVC Wire 4 sqmm Black (90 m coil)", "Wires & Cables", "Shaktiwire", "coil", 3020, 3590, 6, 25, None, "Jaipur Cable House", "JCH-FR40B", "A2", 0.5, "steady", 14),
    ("WR-FLEX-0.75", "Flexible Cable 0.75 sqmm 3-core (per m)", "Wires & Cables", "Shaktiwire", "m", 38, 52, 300, 1500, None, "Jaipur Cable House", "JCH-FX075", "A3", 42, "steady", 640),
    ("WR-CAT6-305", "CAT6 LAN Cable (305 m box)", "Wires & Cables", "NetLink", "box", 6400, 7800, 2, 8, 9, "Jaipur Cable House", "JCH-CAT6", "A4", 0.12, "slow", 7),
    ("SW-6A-1W", "Modular Switch 6A 1-Way", "Switches & Sockets", "Brightline", "pcs", 38, 59, 200, 900, None, "Delhi Switchgear Traders", "DST-S61W", "B1", 34, "steady", 410),
    ("SW-16A-1W", "Modular Switch 16A 1-Way", "Switches & Sockets", "Brightline", "pcs", 74, 109, 80, 400, None, "Delhi Switchgear Traders", "DST-S161W", "B1", 9, "steady", 37),
    ("SK-6A-3P", "Modular Socket 6A 3-Pin", "Switches & Sockets", "Brightline", "pcs", 62, 95, 120, 500, None, "Delhi Switchgear Traders", "DST-K63P", "B2", 14, "steady", 0),
    ("SK-16A-6P", "Modular Socket 16A 6-Pin", "Switches & Sockets", "Brightline", "pcs", 118, 175, 50, 250, None, "Delhi Switchgear Traders", "DST-K166P", "B2", 5, "steady", 88),
    ("PL-8M-WH", "Modular Cover Plate 8-Module White", "Switches & Sockets", "Brightline", "pcs", 96, 149, 60, 300, None, "Delhi Switchgear Traders", "DST-P8MW", "B3", 4.5, "steady", 132),
    ("PL-OLD-IVORY", "Cover Plate 6-Module Ivory (old series)", "Switches & Sockets", "Brightline", "pcs", 71, 99, 0, None, None, "Delhi Switchgear Traders", "DST-P6IV", "B9", 0, "dead", 240),
    ("MCB-SP-16", "MCB Single Pole 16A C-curve", "MCBs & DBs", "Voltex", "pcs", 148, 215, 60, 300, None, "Delhi Switchgear Traders", "DST-M1P16", "C1", 7.5, "steady", 18),
    ("MCB-SP-32", "MCB Single Pole 32A C-curve", "MCBs & DBs", "Voltex", "pcs", 152, 225, 40, 200, None, "Delhi Switchgear Traders", "DST-M1P32", "C1", 4.2, "steady", 95),
    ("MCB-DP-40", "MCB Double Pole 40A", "MCBs & DBs", "Voltex", "pcs", 520, 740, 15, 80, None, "Delhi Switchgear Traders", "DST-M2P40", "C2", 1.4, "steady", 22),
    ("RCCB-40-30", "RCCB 40A 30mA 2-Pole", "MCBs & DBs", "Voltex", "pcs", 1650, 2290, 6, 30, None, "Delhi Switchgear Traders", "DST-R4030", "C2", 0.6, "rising", 4),
    ("DB-8W-DD", "Distribution Board 8-Way Double Door", "MCBs & DBs", "Voltex", "pcs", 1320, 1790, 5, 25, None, "Delhi Switchgear Traders", "DST-DB8", "C3", 0.45, "steady", 26),
    ("DB-4W-SD-OLD", "Distribution Board 4-Way Single Door (discontinued)", "MCBs & DBs", "Voltex", "pcs", 610, 820, 0, None, None, "Delhi Switchgear Traders", "DST-DB4O", "C9", 0.03, "slow", 58),
    ("LED-9W-CW", "LED Bulb 9W Cool White B22", "Lighting", "Lumora", "pcs", 52, 85, 300, 1500, None, "Mumbai Lighting Co.", "MLC-B9CW", "D1", 48, "steady", 520),
    ("LED-12W-CW", "LED Bulb 12W Cool White B22", "Lighting", "Lumora", "pcs", 71, 115, 150, 800, None, "Mumbai Lighting Co.", "MLC-B12CW", "D1", 17, "steady", 46),
    ("LED-TUBE-20W", "LED Batten 20W 4 ft", "Lighting", "Lumora", "pcs", 186, 279, 80, 400, None, "Mumbai Lighting Co.", "MLC-T20", "D2", 8, "rising", 61),
    ("LED-PANEL-15", "LED Round Panel 15W Recessed", "Lighting", "Lumora", "pcs", 240, 365, 40, 200, None, "Mumbai Lighting Co.", "MLC-RP15", "D2", 3.2, "steady", 190),
    ("LED-FLOOD-50", "LED Flood Light 50W", "Lighting", "Lumora", "pcs", 690, 990, 10, 50, None, "Mumbai Lighting Co.", "MLC-FL50", "D3", 0.9, "steady", 12),
    ("LED-STRIP-5M", "LED Strip 5 m Warm White with driver", "Lighting", "Lumora", "pcs", 410, 620, 20, 100, None, "Mumbai Lighting Co.", "MLC-ST5", "D3", 0, "new", 40),
    ("CFL-18W", "CFL 18W Spiral (old stock)", "Lighting", "Lumora", "pcs", 88, 120, 0, None, None, "Mumbai Lighting Co.", "MLC-CFL18", "D9", 0, "dead", 310),
    ("FAN-CEIL-1200", "Ceiling Fan 1200 mm Brown", "Fans", "Aerobreeze", "pcs", 1480, 1990, 15, 60, 14, "Coimbatore Fan Works", "CFW-C1200B", "E1", 1.6, "falling", 47),
    ("FAN-CEIL-BLDC", "BLDC Ceiling Fan 1200 mm Energy Saver", "Fans", "Aerobreeze", "pcs", 2650, 3490, 6, 30, 14, "Coimbatore Fan Works", "CFW-BLDC", "E1", 0.8, "rising", 3),
    ("FAN-EXH-150", "Exhaust Fan 150 mm", "Fans", "Aerobreeze", "pcs", 640, 890, 10, 50, None, "Coimbatore Fan Works", "CFW-EX150", "E2", 1.1, "steady", 16),
    ("FAN-WALL-400", "Wall Fan 400 mm", "Fans", "Aerobreeze", "pcs", 1390, 1850, 8, 40, None, "Coimbatore Fan Works", "CFW-W400", "E2", 0.35, "falling", 64),
    ("PIPE-PVC-20", "PVC Conduit Pipe 20 mm (3 m length)", "Pipes & Conduits", "Duraflow", "pcs", 34, 52, 400, 2000, None, "Ahmedabad Pipes & Fittings", "APF-C20", "F1", 55, "steady", 0),
    ("PIPE-PVC-25", "PVC Conduit Pipe 25 mm (3 m length)", "Pipes & Conduits", "Duraflow", "pcs", 46, 69, 200, 1000, None, "Ahmedabad Pipes & Fittings", "APF-C25", "F1", 21, "steady", 260),
    ("BEND-20", "PVC Bend 20 mm", "Pipes & Conduits", "Duraflow", "pcs", 4.5, 8, 500, 3000, None, "Ahmedabad Pipes & Fittings", "APF-B20", "F2", 70, "steady", 1900),
    ("JBOX-RND-20", "Round Junction Box 20 mm 2-Way", "Pipes & Conduits", "Duraflow", "pcs", 9, 16, 300, 1500, None, "Ahmedabad Pipes & Fittings", "APF-J20", "F2", 26, "steady", 3400),
    ("TAPE-INS-BK", "Insulation Tape Black (pack of 10)", "Accessories", "Grip", "pack", 72, 110, 60, 300, None, "Ludhiana Tools & Fasteners", "LTF-TAPE10", "G1", 9, "steady", 75),
    ("TIE-200-100", "Cable Ties 200 mm (pack of 100)", "Accessories", "Grip", "pack", 48, 80, 50, 250, None, "Ludhiana Tools & Fasteners", "LTF-CT200", "G1", 6.5, "steady", 210),
    ("SCRW-8X25", "Wood Screw 8 x 25 mm (box of 100)", "Fasteners", "Ironclad", "box", 64, 99, 40, 200, None, "Ludhiana Tools & Fasteners", "LTF-WS825", "G2", 5, "steady", 44),
    ("ANCHOR-6", "Wall Plug Anchor 6 mm (pack of 100)", "Fasteners", "Ironclad", "pack", 36, 60, 50, 250, None, "Ludhiana Tools & Fasteners", "LTF-A6", "G2", 7, "steady", 118),
    ("TOOL-TESTER", "Line Tester Screwdriver", "Tools", "Ironclad", "pcs", 28, 49, 50, 300, None, "Ludhiana Tools & Fasteners", "LTF-TST", "G3", 4, "steady", 260),
    ("TOOL-PLIER-8", "Combination Plier 8 inch", "Tools", "Ironclad", "pcs", 210, 320, 15, 80, None, "Ludhiana Tools & Fasteners", "LTF-PL8", "G3", 1.2, "steady", 21),
    ("TOOL-DRILL-13", "Impact Drill 13 mm 650W", "Tools", "Ironclad", "pcs", 2350, 3150, 3, 15, 15, "Ludhiana Tools & Fasteners", "LTF-DR13", "G4", 0.15, "slow", 19),
    ("TOOL-CRIMP", "Crimping Tool for Lugs", "Tools", "Ironclad", "pcs", 540, 760, 5, 25, None, "Ludhiana Tools & Fasteners", "LTF-CRMP", "G4", 0, "dead", 33),
    ("EARTH-ROD-2M", "Copper Bonded Earthing Rod 2 m", "Earthing", "Duraflow", "pcs", 1180, 1590, 5, 25, None, "Ahmedabad Pipes & Fittings", "APF-ER2", "H1", 0.25, "steady", 11),
    ("WR-FR-6.0-RD", "FR PVC Wire 6 sqmm Red (90 m coil)", "Wires & Cables", "Shaktiwire", "coil", 4480, 5290, 3, 15, None, "Jaipur Cable House", "JCH-FR60R", "A2", 0.3, "stockout", 0),
]

days = [last_day - dt.timedelta(days=DAYS - 1 - i) for i in range(DAYS)]
customers = ["Gupta Electricals", "Om Sai Contractors", "Verma Builders", "Shree Ganesh Hardware", "City Interiors", "Walk-in customer",
             "Patel Electric Works", "Royal Constructions", "Kumar & Sons", "Bright Homes Pvt Ltd", "Sunrise Apartments (site)", "Metro Fit-outs"]


def poisson(lam):
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


def fmt(d):
    return d.strftime("%d/%m/%Y")


# ---------------------------------------------------------------- sales lines
sales = []
inv = 4100
for i, day in enumerate(days):
    if day.weekday() == 6:  # closed on Sundays
        continue
    t = i / (DAYS - 1)
    lines_today = []
    for p in P:
        sku, name, cat, brand, unit, cost, price, mn, mx, lead, sup, scode, loc, rate, pattern, onhand = p
        if pattern == "dead" or pattern == "new":
            continue
        if pattern == "rising":
            lam = rate * (0.55 + 0.9 * t)
        elif pattern == "falling":
            lam = rate * (1.7 - 1.4 * t)  # fans after summer
        elif pattern == "stockout":
            lam = rate if i < DAYS - 16 else 0  # sold out ~2 weeks ago
        else:
            lam = rate
        lam *= 1.25 if day.weekday() in (0, 5) else 1.0  # Monday/Saturday busier
        # the two currently out-of-stock fast movers ran dry in the last few days
        if sku in ("SK-6A-3P", "PIPE-PVC-20") and i >= DAYS - 4:
            lam = 0
        q = poisson(lam)
        if q:
            lines_today.append((sku, name, unit, q, price))
    rng.shuffle(lines_today)
    while lines_today:
        inv += 1
        n = rng.randint(1, 5)
        chunk, lines_today = lines_today[:n], lines_today[n:]
        cust = rng.choice(customers)
        for sku, name, unit, q, price in chunk:
            disc = rng.choice([0, 0, 0, 2, 5])
            rate_ = round(price * (100 - disc) / 100, 2)
            sales.append([fmt(day), f"INV-{inv}", cust, sku, name, q, unit, f"{rate_:.2f}", f"{q * rate_:.2f}"])

with open(os.path.join(out, "4_sales_history.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Invoice Date", "Invoice No", "Party Name", "Item Code", "Item Name", "Qty", "Unit", "Rate", "Amount"])
    w.writerows(sales)

# ---------------------------------------------------------------- purchase history (supplier bills)
purchases = []
bill = 700
sold = {}
for r in sales:
    sold[r[3]] = sold.get(r[3], 0) + r[5]
for p in P:
    sku, name, cat, brand, unit, cost, price, mn, mx, lead, sup, scode, loc, rate, pattern, onhand = p
    total = sold.get(sku, 0)
    if pattern == "dead":
        # bought long ago, nothing since — one old bill inside the window
        purchases.append((days[3], sup, sku, name, max(onhand, 10), unit, cost))
        continue
    if pattern == "new":
        purchases.append((days[-9], sup, sku, name, onhand, unit, cost))
        continue
    n = 3 if total > 40 else 2
    for k in range(n):
        d = days[int((k + 0.3) * DAYS / n)]
        qty = max(1, round(total / n * rng.uniform(0.9, 1.15)))
        c = cost
        if sku == "WR-FR-2.5-RD" and k == n - 1:
            c = round(cost * 1.14, 2)  # latest bill 14% dearer (visible in the supplier price history)
        elif k < n - 1:
            c = round(cost * rng.uniform(0.95, 0.99), 2)
        purchases.append((d, sup, sku, name, qty, unit, c))
purchases.sort(key=lambda x: (x[0], x[1]))
rows = []
last_key = None
for d, sup, sku, name, qty, unit, c in purchases:
    if (d, sup) != last_key:
        bill += 1
        last_key = (d, sup)
    rows.append([fmt(d), sup, f"{SUP[sup][0].split()[0][:3].upper()}/{d.year % 100}-{bill}", sku, name, qty, unit, f"{c:.2f}", f"{qty * c:.2f}"])
with open(os.path.join(out, "5_purchase_history.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Bill Date", "Supplier", "Bill No", "Item Code", "Item Name", "Qty", "Unit", "Purchase Rate", "Amount"])
    w.writerows(rows)

# ---------------------------------------------------------------- suppliers
with open(os.path.join(out, "1_suppliers.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Supplier Name", "Contact Person", "Mobile", "Email", "GSTIN", "Address", "City", "State", "Lead Time Days", "Payment Terms"])
    w.writerows(suppliers)

# ---------------------------------------------------------------- products (Tally-style export with a title row)
with open(os.path.join(out, "2_products.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Sample Electricals & Hardware (fictional) — Stock Item Master"])
    w.writerow([])
    w.writerow(["Item Code", "Item Name", "Stock Group", "Brand", "UOM", "Purchase Rate", "MRP", "Reorder Level", "Max Level", "Lead Time Days", "Vendor", "Vendor Item Code", "Rack"])
    for p in P:
        sku, name, cat, brand, unit, cost, price, mn, mx, lead, sup, scode, loc, rate, pattern, onhand = p
        w.writerow([sku, name, cat, brand, unit, cost, price, mn, "" if mx is None else mx, "" if lead is None else lead, sup, scode, loc])

# ---------------------------------------------------------------- closing stock (as on today)
with open(os.path.join(out, "3_closing_stock.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Item Code", "Item Name", "Closing Qty", "UOM", "Rate"])
    for p in P:
        sku, name, cat, brand, unit, cost, price, mn, mx, lead, sup, scode, loc, rate, pattern, onhand = p
        w.writerow([sku, name, onhand, unit, cost])

print(f"{len(P)} products, {len(suppliers)} suppliers, {len(sales)} sales lines, {len(rows)} purchase lines, sales {fmt(days[0])} – {fmt(days[-1])}")
