-- RC5.2 data migration — apply FIRST, then run `pnpm reindex`.
-- No schema changes (attributeSchema is a Json column; Listing.attributes is jsonb).
--
-- Step 1: Rename attribute key 'type' → 'itemType' in all listing.attributes.
--   Affects listings in categories: ordenadores, electrodomésticos, accesorios, muebles.
--   The old key 'type' collided silently with the ListingType enum field in toDocument();
--   renaming to 'itemType' removes the collision and makes the attribute filterable.
UPDATE "Listing"
SET attributes = (attributes::jsonb - 'type') || jsonb_build_object('itemType', attributes::jsonb->>'type')
WHERE attributes::jsonb ? 'type';

-- Step 2: Normalize calzado 'size' from JSON number to JSON string.
--   The seed used type:'number' for calzado; SearchQueryDto.size is @IsString(), so
--   Meilisearch filter ?size=38 never matched documents where size was stored as 38 (number).
--   Cast to string so the stored value matches the query string.
UPDATE "Listing" l
SET attributes = (attributes::jsonb - 'size') || jsonb_build_object('size', attributes::jsonb->>'size')
WHERE l."categoryId" = (SELECT id FROM "Category" WHERE slug = 'calzado')
  AND attributes::jsonb ? 'size'
  AND jsonb_typeof(attributes::jsonb->'size') = 'number';
