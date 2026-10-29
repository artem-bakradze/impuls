# Zone of display: radius vs Direct regions

Task 4.1 of `replace-direct-sandbox`. Checked on 2026-10-29 against the Direct API v5 documentation.

## Findings

- `AdGroups.add` takes geography only as `RegionIds` (a minus sign excludes a region). There is no field for a
  point, a radius or a polygon. Source: https://yandex.ru/dev/direct/doc/ru/adgroups/add
- Region ids come from `Dictionaries.get` with `DictionaryNames: ["GeoRegions"]`
  (`GeoRegionId`, `GeoRegionName`, `GeoRegionType`, `ParentId`).
- The radius around an address that the wizard and settings offer («карта с радиусом», business-onboarding and
  campaign-settings specs) therefore cannot be passed to Direct through API v5.

## Decision for the MVP

- The service passes the business city (the first part of the address, «Москва, ул. Профсоюзная, 1» → «Москва»)
  in `Targeting.city`. The Direct adapter maps it to the `City` region with the same name from `GeoRegions`
  (cached per adapter instance). An unknown city fails the launch with `UNKNOWN_CITY` instead of falling back
  to a wider region.
- The radius stays in the service (settings, agent context) but does not narrow the Direct targeting.
  `UpdateGeo` changes only the stored radius.

## Open: needs a spec change

Showing ads in a whole city while the owner chose 3 km is a user-visible difference from the specs. Options for a
separate OpenSpec change to `business-onboarding` and `campaign-settings`:

1. Replace the radius with a city choice (and districts for Moscow and Saint Petersburg, if `GeoRegions` lists them as
   regions — to be checked on the first approved contract run).
2. Keep the radius as a hint for ad texts and phrases («у метро Профсоюзная») and say plainly in the wizard that ads are
   shown across the city.

Also to check on the first approved run: whether district-level regions exist in `GeoRegions` and how the city name
should be matched for cities with the same name in different regions.
