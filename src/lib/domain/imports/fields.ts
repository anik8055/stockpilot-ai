export type ImportKind = "products" | "stock_snapshot" | "sales" | "purchases" | "suppliers";
export type FieldType = "text" | "number" | "money" | "date" | "unit" | "int";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  /** Normalised header spellings that map to this field with high confidence. */
  synonyms: string[];
};

const sku = (required = true): FieldDef => ({
  key: "sku",
  label: "SKU / Item code",
  type: "text",
  required,
  synonyms: ["sku", "item code", "itemcode", "product code", "code", "part number", "part no", "part no.", "partno", "item no", "item number", "stock code", "article code", "material code", "alias"],
});

const productName = (required: boolean): FieldDef => ({
  key: "name",
  label: "Product name",
  type: "text",
  required,
  synonyms: ["item name", "product", "product name", "stock item", "stock item name", "item", "name of item", "description of goods", "particulars", "item description", "name"],
});

export const IMPORT_KINDS: Record<ImportKind, { label: string; description: string; fields: FieldDef[] }> = {
  products: {
    label: "Product master",
    description: "Your item list: codes, names, units, prices and stock settings. Creates or updates products by SKU.",
    fields: [
      sku(),
      productName(true),
      { key: "barcode", label: "Barcode", type: "text", synonyms: ["barcode", "ean", "upc", "bar code"] },
      { key: "description", label: "Description", type: "text", synonyms: ["description", "details", "remarks"] },
      { key: "category", label: "Category", type: "text", synonyms: ["category", "group", "stock group", "item group", "product group", "sub group"] },
      { key: "brand", label: "Brand", type: "text", synonyms: ["brand", "make", "manufacturer", "company"] },
      { key: "mpn", label: "Manufacturer part no.", type: "text", synonyms: ["mpn", "manufacturer part number", "oem no", "oem number", "oe number", "mfr part no"] },
      { key: "base_unit", label: "Unit", type: "unit", synonyms: ["unit", "uom", "units", "unit of measure", "base unit"] },
      { key: "purchase_cost", label: "Purchase cost", type: "money", synonyms: ["purchase rate", "cost price", "unit cost", "cost", "purchase price", "rate", "landing cost", "buying price"] },
      { key: "selling_price", label: "Selling price", type: "money", synonyms: ["selling price", "sale price", "sales rate", "mrp", "price", "selling rate", "sale rate"] },
      { key: "min_stock", label: "Minimum stock", type: "number", synonyms: ["min stock", "minimum stock", "min qty", "reorder level", "minimum level", "min level"] },
      { key: "max_stock", label: "Maximum stock", type: "number", synonyms: ["max stock", "maximum stock", "max qty", "maximum level", "max level"] },
      { key: "safety_stock", label: "Safety stock", type: "number", synonyms: ["safety stock", "buffer stock", "buffer"] },
      { key: "lead_time_days", label: "Lead time (days)", type: "int", synonyms: ["lead time", "lead time days", "lead days", "delivery days"] },
      { key: "storage_location", label: "Storage location", type: "text", synonyms: ["location", "rack", "bin", "godown", "storage location", "shelf"] },
      { key: "supplier_name", label: "Supplier", type: "text", synonyms: ["vendor", "supplier", "supplier name", "vendor name", "party", "party name"] },
      { key: "supplier_sku", label: "Supplier item code", type: "text", synonyms: ["supplier code", "vendor code", "supplier item code", "supplier sku", "vendor item code"] },
      { key: "quantity", label: "Current stock (optional)", type: "number", help: "Only used if you choose to record it as a stock count.", synonyms: ["qty", "quantity", "closing stock", "closing qty", "stock", "current stock", "balance qty", "on hand", "stock qty", "closing balance"] },
    ],
  },
  stock_snapshot: {
    label: "Stock balances (stock count)",
    description: "Closing stock from your billing system or a physical count. StockPilot records the difference as an adjustment — re-importing the same file changes nothing.",
    fields: [
      sku(),
      productName(false),
      { key: "quantity", label: "Quantity on hand", type: "number", required: true, synonyms: ["qty", "quantity", "closing stock", "closing qty", "stock", "current stock", "balance qty", "on hand", "stock qty", "closing balance", "physical stock", "counted qty"] },
      { key: "unit", label: "Unit", type: "unit", synonyms: ["unit", "uom", "units"] },
      { key: "unit_cost", label: "Unit cost (optional)", type: "money", synonyms: ["rate", "cost", "unit cost", "purchase rate", "cost price", "closing rate"] },
    ],
  },
  sales: {
    label: "Sales history",
    description: "Item-wise sales from your billing system. Used to measure demand only — it does not reduce stock again.",
    fields: [
      { key: "date", label: "Sale date", type: "date", required: true, synonyms: ["date", "invoice date", "bill date", "sale date", "voucher date", "txn date", "transaction date"] },
      sku(),
      productName(false),
      { key: "quantity", label: "Quantity sold", type: "number", required: true, synonyms: ["sales qty", "quantity sold", "qty sold", "qty", "quantity", "billed qty", "sold qty"] },
      { key: "unit", label: "Unit", type: "unit", synonyms: ["unit", "uom", "units"] },
      { key: "invoice_ref", label: "Invoice / bill no.", type: "text", synonyms: ["invoice no", "invoice number", "bill no", "bill number", "voucher no", "voucher number", "invoice", "ref no", "inv no"] },
      { key: "unit_price", label: "Unit price", type: "money", synonyms: ["rate", "unit price", "sale rate", "selling price", "price"] },
      { key: "line_total", label: "Line amount", type: "money", synonyms: ["amount", "value", "line total", "total", "net amount", "taxable value", "sales value"] },
      { key: "customer", label: "Customer", type: "text", synonyms: ["customer", "party", "party name", "customer name", "buyer"] },
    ],
  },
  purchases: {
    label: "Purchase history",
    description: "Item-wise purchases. Used for supplier and price history — it does not add stock (stock comes from stock balances and goods receipts).",
    fields: [
      { key: "date", label: "Purchase date", type: "date", required: true, synonyms: ["date", "bill date", "invoice date", "purchase date", "voucher date", "grn date"] },
      sku(),
      productName(false),
      { key: "quantity", label: "Quantity", type: "number", required: true, synonyms: ["qty", "quantity", "purchase qty", "received qty", "billed qty"] },
      { key: "unit", label: "Unit", type: "unit", synonyms: ["unit", "uom", "units"] },
      { key: "supplier_name", label: "Supplier", type: "text", synonyms: ["vendor", "supplier", "supplier name", "vendor name", "party", "party name"] },
      { key: "bill_ref", label: "Bill / invoice no.", type: "text", synonyms: ["bill no", "invoice no", "invoice number", "bill number", "voucher no", "supplier invoice no", "ref no"] },
      { key: "unit_cost", label: "Unit cost", type: "money", synonyms: ["purchase rate", "cost price", "unit cost", "rate", "cost", "price"] },
      { key: "line_total", label: "Line amount", type: "money", synonyms: ["amount", "value", "line total", "total", "net amount", "taxable value"] },
    ],
  },
  suppliers: {
    label: "Supplier list",
    description: "Vendor names and contact details. Creates or updates suppliers by name.",
    fields: [
      { key: "name", label: "Supplier name", type: "text", required: true, synonyms: ["vendor", "supplier", "supplier name", "vendor name", "party", "party name", "name"] },
      { key: "contact_person", label: "Contact person", type: "text", synonyms: ["contact person", "contact", "contact name"] },
      { key: "phone", label: "Phone", type: "text", synonyms: ["phone", "mobile", "phone no", "mobile no", "contact no", "whatsapp"] },
      { key: "email", label: "Email", type: "text", synonyms: ["email", "email id", "e-mail", "mail"] },
      { key: "gstin", label: "GSTIN", type: "text", synonyms: ["gstin", "gst no", "gst number", "gstin/uin", "gst"] },
      { key: "address", label: "Address", type: "text", synonyms: ["address", "address line 1", "street"] },
      { key: "city", label: "City", type: "text", synonyms: ["city", "town"] },
      { key: "state", label: "State", type: "text", synonyms: ["state"] },
      { key: "lead_time_days", label: "Lead time (days)", type: "int", synonyms: ["lead time", "lead time days", "delivery days"] },
      { key: "payment_terms", label: "Payment terms", type: "text", synonyms: ["payment terms", "credit days", "terms"] },
    ],
  },
};

export function fieldsFor(kind: ImportKind): FieldDef[] {
  return IMPORT_KINDS[kind].fields;
}

export function normalizeHeader(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[ _]/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9.%/ -]+/g, " ")
    .replace(/[-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}
