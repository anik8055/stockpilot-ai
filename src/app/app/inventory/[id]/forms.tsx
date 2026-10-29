"use client";

import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client";
import { Field, Input, Select } from "@/components/ui";
import { addAliasAction, addUnitAction, adjustStockAction, removeAliasAction, removeSupplierTermsAction, removeUnitAction, supplierTermsAction, toggleActiveAction } from "../actions";

export function ArchiveButton({ id, active }: { id: string; active: boolean }) {
  return active ? (
    <ConfirmAction
      action={toggleActiveAction}
      hidden={{ id, active: "false" }}
      label="Archive"
      title="Archive this product?"
      body="It will be hidden from lists and recommendations. Its stock history, sales and purchase records are kept, and you can restore it any time."
      confirmLabel="Archive product"
    />
  ) : (
    <ConfirmAction action={toggleActiveAction} hidden={{ id, active: "true" }} label="Restore" title="Restore this product?" body="It will appear in lists and recommendations again." confirmLabel="Restore" variant="primary" />
  );
}

export function AdjustForm({ id, unit, current }: { id: string; unit: string; current: number }) {
  return (
    <ActionForm action={adjustStockAction} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end" resetOnSuccess>
      <input type="hidden" name="id" value={id} />
      <Field label={`Counted quantity (${unit})`} htmlFor="counted" hint={`System shows ${current}.`}>
        <Input id="counted" name="counted" inputMode="decimal" required />
      </Field>
      <Field label="Reason" htmlFor="reason">
        <Input id="reason" name="reason" placeholder="e.g. physical count, damaged, found in godown" required />
      </Field>
      <SubmitButton variant="secondary" pendingLabel="Saving…">Record count</SubmitButton>
    </ActionForm>
  );
}

export function UnitForm({ id, baseUnit }: { id: string; baseUnit: string }) {
  return (
    <ActionForm action={addUnitAction} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2" resetOnSuccess>
      <input type="hidden" name="id" value={id} />
      <Field label="Unit" htmlFor="unit">
        <Input id="unit" name="unit" placeholder="box" list="unit-list" required />
      </Field>
      <Field label={`= how many ${baseUnit}`} htmlFor="factor">
        <Input id="factor" name="factor" inputMode="decimal" placeholder="12" required />
      </Field>
      <datalist id="unit-list">
        {["box", "pack", "coil", "roll", "bundle", "dozen", "set", "carton"].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <SubmitButton variant="secondary">Add</SubmitButton>
    </ActionForm>
  );
}

export function RemoveButton({ kind, id, childId, label }: { kind: "unit" | "alias" | "supplier"; id: string; childId: string; label: string }) {
  const action = kind === "unit" ? removeUnitAction : kind === "alias" ? removeAliasAction : removeSupplierTermsAction;
  const key = kind === "unit" ? "unitId" : kind === "alias" ? "aliasId" : "spId";
  return (
    <ActionForm action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name={key} value={childId} />
      <SubmitButton variant="ghost" size="sm" className="text-danger" pendingLabel="…">
        <span aria-label={`Remove ${label}`}>Remove</span>
      </SubmitButton>
    </ActionForm>
  );
}

export function AliasForm({ id, suppliers }: { id: string; suppliers: { id: string; name: string }[] }) {
  return (
    <ActionForm action={addAliasAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" resetOnSuccess>
      <input type="hidden" name="id" value={id} />
      <Field label="Code" htmlFor="alias-value">
        <Input id="alias-value" name="value" required />
      </Field>
      <Field label="Type" htmlFor="alias-type">
        <Select id="alias-type" name="type" defaultValue="supplier_code">
          <option value="supplier_code">Supplier&apos;s code</option>
          <option value="alias">Other name / alias</option>
          <option value="old_sku">Old SKU</option>
        </Select>
      </Field>
      <Field label="Supplier (for supplier codes)" htmlFor="alias-supplier">
        <Select id="alias-supplier" name="supplierId" defaultValue="">
          <option value="">—</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </Field>
      <SubmitButton variant="secondary">Add code</SubmitButton>
    </ActionForm>
  );
}

export function SupplierTermsForm({ id, suppliers, baseUnit }: { id: string; suppliers: { id: string; name: string }[]; baseUnit: string }) {
  return (
    <ActionForm action={supplierTermsAction} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_auto] lg:items-end" resetOnSuccess>
      <input type="hidden" name="id" value={id} />
      <Field label="Supplier" htmlFor="sp-supplier">
        <Select id="sp-supplier" name="supplier_id" required defaultValue="">
          <option value="" disabled>Choose…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Their code" htmlFor="sp-sku">
        <Input id="sp-sku" name="supplier_sku" />
      </Field>
      <Field label={`Price / ${baseUnit}`} htmlFor="sp-price">
        <Input id="sp-price" name="purchase_price" inputMode="decimal" />
      </Field>
      <Field label={`Min. order (${baseUnit})`} htmlFor="sp-moq">
        <Input id="sp-moq" name="moq" inputMode="decimal" />
      </Field>
      <Field label={`Pack size (${baseUnit})`} htmlFor="sp-pack">
        <Input id="sp-pack" name="pack_size" inputMode="decimal" />
      </Field>
      <Field label="Lead time (days)" htmlFor="sp-lead">
        <Input id="sp-lead" name="lead_time_days" inputMode="numeric" />
      </Field>
      <SubmitButton variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}
