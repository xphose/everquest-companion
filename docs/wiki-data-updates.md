# Wiki data updates

The companion checks eqlwiki.com for reference-data changes once a day while it is
running. An overdue check starts after launch. **Check now** starts a manual check;
concurrent requests share the same refresh instead of starting duplicate downloads.

This updates item information, NPC drops and locations, quest references, and the
journal's source walkthroughs. Live character, inventory, and quest-progress checks
keep their own existing schedules. Refreshing reference data does not write to the
game or change a character's saved progress, tracking, corrections, or settings.

## What the status means

The app distinguishes the data currently in use, the last successful wiki check,
and any downloaded update waiting for the next launch. A successful check can find
no changes. Its timestamp does not mean every wiki page was edited that day, or
that every statement has been verified against the current game patch.

Updates download in the background and take effect together on the next companion
launch. The app keeps one reference-data version throughout a session, including
the Rust engine, maps, gear views, quest journal, and Adventure overlay. It does not
restart during gameplay to apply a download.

If the wiki is unavailable or returns incomplete data, the app keeps its last good
data and reports that the check did not finish. Downloaded caches are kept in the
operating system's application-data directory. A fresh installation also carries
a bundled catalog so browsing remains available offline.

## Fetch and storage rules

- Use the MediaWiki API's change history to fetch changed pages in batches. Check
  that retained history covers the previous successful check; reconcile the full
  catalog when it does not. An incomplete scan must not advance the checkpoint.
- Serialize requests, allow at least one second between them, and use `maxlag=5`.
  Respect rate limits, server backoff requests, timeouts, and cancellation.
- Reuse the existing item, NPC, quest, and walkthrough parsers. Preserve item
  aliases and exact quest identities. A source mention is not proof of a required
  ingredient or a reward.
- Validate and save all four datasets as one versioned update. Keep the active
  version immutable until the next launch; an engine restart within the same
  session must still use that active version.
- Keep downloaded data separate from personal progress and from the tracked
  repository. Request public wiki content only; do not upload game logs,
  character identities, exports, or usage data as part of a refresh.

The updater follows [MediaWiki's API etiquette](https://www.mediawiki.org/wiki/API:Etiquette)
and [recent-changes API](https://www.mediawiki.org/wiki/API:RecentChanges).
It refreshes reference facts, not application code, curated game-mechanics rules,
spell-memory layouts, images, or map geometry. Those still follow their existing
update paths. Wiki edits can improve coverage, but cannot establish undocumented
drop rates or make an incomplete loot list exhaustive.
