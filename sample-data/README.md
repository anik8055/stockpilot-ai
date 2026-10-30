# Sample data (fictional)

A synthetic electrical & hardware distributor for trying StockPilot. Every name, code, GSTIN and number is invented.
Upload in this order from **Imports**: `1_suppliers.csv` (Supplier list) → `2_products.csv` (Product master) →
`3_closing_stock.csv` (Stock balances) → `4_sales_history.csv` (Sales history) → `5_purchase_history.csv` (Purchase history).

Regenerate with fresh dates: `python3 scripts/make-sample-data.py sample-data` (sales end yesterday).
`node scripts/try-sample-data.mjs <app url> sample-data <screenshot dir>` imports it through the UI and saves screenshots.
