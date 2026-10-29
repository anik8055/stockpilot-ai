import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { productFacets } from "@/lib/services/catalog";
import { requireTenant, tx } from "@/lib/tenant";
import { createProductAction } from "../actions";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const t = await requireTenant("inventory.edit");
  const { suppliers } = await tx(t, (db) => productFacets(db, t.businessId));
  return (
    <>
      <PageHeader title="Add product" back={{ href: "/app/inventory", label: "Products" }} description="For many products at once, import your item list instead." />
      <Panel>
        <ProductForm action={createProductAction} suppliers={suppliers} submitLabel="Add product" showOpening values={{ base_unit: "pcs" }} />
      </Panel>
    </>
  );
}
