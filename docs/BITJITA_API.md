---
type: doc
title: BitJita API integration runbook
description: Current BitJita endpoint inventory, BitCraft Codex usage map, contract watchpoints, and refresh procedure.
tags: [data, bitjita, api, integration, runbook]
status: stable
generated:
  by: ebt-skills/okf-v0.2
  at: "2026-08-30T23:37:14Z"
---
# BitJita API integration runbook

This is the project-facing map of the [live BitJita API documentation](https://bitjita.com/docs/api). BitJita owns the endpoint catalog; this runbook owns how BitCraft Codex interprets and consumes it. The live documentation is the discovery source of record and must be checked again before adding or changing an integration.

The documented base URL is `https://bitjita.com`. The current server client uses that value by default, permits a server-side `BITJITA_BASE_URL` override, sends JSON headers plus `User-Agent: bccodex`, and applies a ten-second timeout. It does not send a BitJita credential ([HTTP client](../app/utils/bitjita.server.ts#L20-L105)). All responses remain untrusted until validated at the application boundary; [Data](./DATA.md) owns the binding trust and transformation rules.

## BitCraft Codex coverage

BitCraft Codex currently calls 13 of the 82 documented surfaces.

| Method and upstream path | Client operation | Current scope |
|---|---|---|
| `GET /api/players?q=...` | `searchPlayers` | Username search; accepts the documented `{ players }` envelope and also tolerates a direct array or `{ data }` list ([client](../app/utils/bitjita.server.ts#L438-L455)). |
| `GET /api/players/[id]` | `getPlayerById` | Player detail from the documented `{ player }` envelope ([client](../app/utils/bitjita.server.ts#L463-L466)). |
| `GET /api/players/[id]/inventories` | `getPlayerInventories` | Player inventory containers plus Item and Cargo catalogs ([client](../app/utils/bitjita.server.ts#L474-L476)). |
| `GET /api/items/[itemId]` | `getItemById` | Item detail; accepts either a direct item or the documented `{ item }` envelope ([client](../app/utils/bitjita.server.ts#L484-L496)). |
| `GET /api/market/item/[itemId]` | `getMarketItemById` | The `item` specialization of the documented flexible market-detail route ([client](../app/utils/bitjita.server.ts#L504-L510)). |
| `POST /api/market/prices/bulk` | `getMarketPricesBulk` | Item IDs only; the upstream route also supports Cargo IDs and claim-scoped aggregation ([client](../app/utils/bitjita.server.ts#L518-L527)). |
| `GET /api/claims/[id]/inventories` | `getClaimInventories` | Claim buildings, stalls, and Item/Cargo catalogs ([client](../app/utils/bitjita.server.ts#L535-L537)). |
| `GET /api/players/[id]/housing` | `getPlayerHousing` | Player housing list ([client](../app/utils/bitjita.server.ts#L545-L547)). |
| `GET /api/players/[id]/housing/[houseId]` | `getPlayerHousingDetails` | Housing inventories and Item/Cargo catalogs ([client](../app/utils/bitjita.server.ts#L556-L561)). |
| `GET /api/crafts` | `getCrafts` | Filters by claim, player, region, completion state, or skill ([client](../app/utils/bitjita.server.ts#L570-L585)). |
| `GET /api/claims` | `getClaims` | Search, pagination, sorting, ordering, and region filtering ([client](../app/utils/bitjita.server.ts#L593-L605)). |
| `GET /api/claims/[id]` | `getClaimDetails` | Claim detail from the documented `{ claim }` envelope ([client](../app/utils/bitjita.server.ts#L613-L616)). |
| `GET /api/claims/[id]/members` | `getClaimMembers` | Claim membership and permissions ([client](../app/utils/bitjita.server.ts#L624-L625)). |

## Contract watchpoints

- The upstream page is an endpoint guide, not an executable schema. Terms such as `array` and `object` do not define every field, nullability rule, numeric representation, or alternate envelope.
- The page summarizes player-inventory `items` and `cargos` as arrays, while the current player-inventory schema requires record maps ([schema](../app/utils/bitjita.server.ts#L128-L133)). Confirm a representative wire response under explicit live-probe authorization before changing that boundary.
- The page describes housing location fields as numbers. The client deliberately accepts number, string, or `null`, and treats `locationRegionId` as optional ([schema](../app/utils/bitjita.server.ts#L159-L184)).
- Claim inventories accept array or record catalogs, buildings or stalls, several container identifiers, and snake_case or camelCase content fields. Preserve those variants unless current response evidence disproves them ([schema](../app/utils/bitjita.server.ts#L273-L333)).
- Item and Cargo identity is not interchangeable. The flexible market-detail route uses `item` or `cargo`; the price-history documentation separately uses plural `items` or `cargo`. Copy the exact segment required by the selected endpoint.
- Entity IDs and coin or quantity values may exceed safe JavaScript integer precision. Preserve documented digit strings as strings unless a boundary contract explicitly proves a safe numeric domain.

## Full documented surface

The live page currently advertises 82 surfaces: 80 under `/api` and two static experience exports. Placeholder notation is reproduced as published; BitJita currently mixes square brackets and braces.

### Auth, chat, and core catalogs

```text
POST /api/auth/chat/validate
GET  /api/chat
GET  /api/buildings
GET  /api/buildings/[id]
GET  /api/cargo
GET  /api/cargo/[id]
GET  /api/items
GET  /api/items/[itemId]
GET  /api/skills
```

### Claims

```text
GET /api/claims
GET /api/claims/[id]
GET /api/claims/[id]/buildings
GET /api/claims/[id]/citizens
GET /api/claims/[id]/construction
GET /api/claims/[id]/inventories
GET /api/claims/[id]/layout
GET /api/claims/[id]/members
GET /api/claims/[id]/recruitment
GET /api/claims/[id]/research
GET /api/claims/{id}/market/listings
```

### Crafting and world data

```text
GET /api/crafts
GET /api/crafts/[craftId]
GET /api/crafts/[craftId]/contributions
GET /api/creatures
GET /api/creatures/[id]
GET /api/deployables
GET /api/deployables/[id]
GET /api/food
GET /api/food/[itemId]
GET /api/resources
GET /api/resources/[resourceId]
GET /api/wind
GET /api/world-events
```

### Empires, regions, and collectibles

```text
GET /api/collectibles
GET /api/collectibles/[id]
GET /api/empires
GET /api/empires/[id]
GET /api/empires/[id]/claims
GET /api/empires/[id]/towers
GET /api/regions
GET /api/regions/status
```

### Market and economy

```text
GET  /api/hexite-exchange
GET  /api/hexite-exchange/history
GET  /api/logs/storage
GET  /api/market
GET  /api/market/[itemOrCargo]/[itemId]
GET  /api/market/[itemOrCargo]/[itemId]/price-history
GET  /api/market/deals
GET  /api/market/player/[playerId]
GET  /api/market/player/[playerId]/history
GET  /api/market/player/[playerId]/trades
POST /api/market/prices/bulk
```

### Players

```text
GET /api/players
GET /api/players/[id]
GET /api/players/[id]/buffs
GET /api/players/[id]/crafts
GET /api/players/[id]/equipment
GET /api/players/[id]/equipment/presets
GET /api/players/[id]/exploration
GET /api/players/[id]/housing
GET /api/players/[id]/housing/[houseId]
GET /api/players/[id]/inventories
GET /api/players/[id]/market
GET /api/players/[id]/market-collections
GET /api/players/[id]/passive-crafts
GET /api/players/[id]/skill-rankings
GET /api/players/[id]/stats
GET /api/players/[id]/traveler-tasks
GET /api/players/[id]/vault
```

### Leaderboards and aggregate statistics

```text
GET /api/leaderboard/cargo/[cargoId]
GET /api/leaderboard/exploration
GET /api/leaderboard/items/[itemId]
GET /api/leaderboard/playtime
GET /api/leaderboard/skills
GET /api/stats/hexcoin
GET /api/stats/skills
GET /api/stats/trade-volume
GET /api/status
GET /api/status/chart
GET /api/status/dau-mau
```

### Static experience exports

```text
GET /static/experience/levels.csv
GET /static/experience/levels.json
```

## Refresh procedure

1. Open the [live API documentation](https://bitjita.com/docs/api) and confirm the advertised endpoint count.
2. Compare its method-and-path inventory with **Full documented surface**. Do not infer a rename from similar paths.
3. Compare every route in **BitCraft Codex coverage** with the client call, query/body parameters, response envelope, and executable schema.
4. When explicit authorization permits a live endpoint probe, capture a representative response for a used route before changing its schema. The documentation summary alone is not wire evidence.
5. Update this runbook, the client boundary, affected transforms, and meaningful boundary tests together when a used contract changes. Endpoint additions that BitCraft Codex does not consume require only an inventory update here.

## Related documents

- [Data](./DATA.md) owns source-of-record, trust, validation, caching, freshness, and privacy contracts.
- [Architecture](./ARCHITECTURE.md) owns the route-to-service-to-upstream dependency boundary.
- [Testing](./TESTING.md) owns the verification required when an upstream contract changes.
