-- Date a product was first stocked, when known. Used so a newly added item is not mistaken for dead stock.
-- NULL = unknown (e.g. imported from a billing system): the item is assumed to have existed for the whole sales history.
ALTER TABLE products ADD COLUMN introduced_on date;
