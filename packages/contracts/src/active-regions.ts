// The one authoritative active-region home (DOMAIN.md: the active regions are
// v1's nine, previously hand-synced across the generator's queue.ts and the
// client's config/regions.ts). Every consumer -- the scheduler and the client
// alike -- reads this one export instead of minting its own list.
export const ACTIVE_REGION_IDS: readonly string[] = [
	"7",
	"8",
	"9",
	"12",
	"13",
	"14",
	"17",
	"18",
	"19",
];
