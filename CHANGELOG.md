# Changelog

## [0.4.0](https://github.com/dylanclaywell/stagescape/compare/stagescape-v0.3.1...stagescape-v0.4.0) (2026-09-12)


### Features

* add the quest store, and let the hiscores store hydrate itself ([d226f00](https://github.com/dylanclaywell/stagescape/commit/d226f00af616e4d170e77e117e368b0de59c2b80))
* animate goal reordering ([e054617](https://github.com/dylanclaywell/stagescape/commit/e05461767d3514dd2840361210bb368d13cdc88a))
* export/import for quest progress and settings (4b') ([ddb44af](https://github.com/dylanclaywell/stagescape/commit/ddb44afa7429dd786ea1c3e99f435df595efff0b))
* move refresh-on-resume from StatsView to the shell (4f) ([168e541](https://github.com/dylanclaywell/stagescape/commit/168e5411c62f920126604cd71c5840da6f5ed063))
* pull down to refresh, and fix two things the iPad found ([2f93e83](https://github.com/dylanclaywell/stagescape/commit/2f93e83998cc242f1d85c291f658eb2b99e96556))
* quest detail view, and oak-button quest rows (4d) ([6533058](https://github.com/dylanclaywell/stagescape/commit/65330583817e5aa948ceb5a8d0fa83dd740f0743))
* quest filters and add-to-queue (4c slice C) ([c9a558f](https://github.com/dylanclaywell/stagescape/commit/c9a558fec0a7fce4b73b3a8f9963d044d9b55c0a))
* Quests panel list and search (4c slice B) ([ab70750](https://github.com/dylanclaywell/stagescape/commit/ab70750ea20f29b76ee1455ee449d4851f2a6f47))
* queue from quest detail, and drop the queue's add button ([6cb3715](https://github.com/dylanclaywell/stagescape/commit/6cb3715f0541d00afa8203e4d78ed1853bb92310))
* render the queue as next-up plus a tabbed plan and goals ([b80798f](https://github.com/dylanclaywell/stagescape/commit/b80798fa35149bead3e58dec6084bdb0eaed56aa))
* reorder goals in the queue (4e′) ([d96acda](https://github.com/dylanclaywell/stagescape/commit/d96acda79814a02c8c4d76cca0228590cb238720))
* show the items a quest needs on its detail page ([4d3554f](https://github.com/dylanclaywell/stagescape/commit/4d3554f51a355a397d02ba16589b623e3012b38b))
* show the whole prerequisite chain on quest detail ([ce1a95a](https://github.com/dylanclaywell/stagescape/commit/ce1a95a04937916d25e7c4981e5a131da8bad6da))
* split Queue and Quests into two panels (4c slice A) ([2b64581](https://github.com/dylanclaywell/stagescape/commit/2b64581cdad10befda0a2f87ff5551203b628949))
* start and finish quests from the queue ([415c056](https://github.com/dylanclaywell/stagescape/commit/415c056782fdf4d9078f6b5c8196d2b86fa5bbe0))
* tint level mentions and dress the item lists as a journal ([0902731](https://github.com/dylanclaywell/stagescape/commit/0902731e309813da6c1288211c9b3ca98b3a68ee))


### Bug Fixes

* let goal order drive the plan instead of alphabetical id order ([d497bb6](https://github.com/dylanclaywell/stagescape/commit/d497bb64c8e15f6356511f1df3a4566c46e30d43))
* return to the panel a quest was opened from ([09472d9](https://github.com/dylanclaywell/stagescape/commit/09472d934138cb89767a40d045e54591c1f5e913))
* update package-lock.json ([1e5d380](https://github.com/dylanclaywell/stagescape/commit/1e5d380490bf5363f1bf80b27b8f2f22145155c1))

## [0.3.1](https://github.com/dylanclaywell/stagescape/compare/stagescape-v0.3.0...stagescape-v0.3.1) (2026-09-10)


### Bug Fixes

* **ci:** pin node from .nvmrc, since wrangler now requires 22 ([1041c0f](https://github.com/dylanclaywell/stagescape/commit/1041c0fe6286232387cccd2277fcccda3bda6e0d))

## [0.3.0](https://github.com/dylanclaywell/stagescape/compare/stagescape-v0.2.0...stagescape-v0.3.0) (2026-09-10)


### Features

* add quest eligibility and plan ordering ([770f582](https://github.com/dylanclaywell/stagescape/commit/770f5822e2e97ba743bb9eb804b4e2aa7380555e))
* cross-check quest requirements against the Lua module ([440ea5e](https://github.com/dylanclaywell/stagescape/commit/440ea5eb4f58b54439b92a520bd6cae7e216510a))
* fetch and cache the wiki quest inventory ([20ba8ce](https://github.com/dylanclaywell/stagescape/commit/20ba8ce0dcfac23c52ac8e9b765ebff041ec0a64))
* generate and commit the quest dataset ([e8d826c](https://github.com/dylanclaywell/stagescape/commit/e8d826cd002b893e7bf5ef016c34732009156230))
* parse quest requirements from wiki page templates ([8461e51](https://github.com/dylanclaywell/stagescape/commit/8461e513d4cbbdf941b4fd5fd8c1ddb18a198ddf))
* shape quest types around what the wiki actually provides ([0242643](https://github.com/dylanclaywell/stagescape/commit/0242643a982a7777c74a103aa79f68d863246be6))


### Performance

* keep localforage out of the initial bundle ([586ed85](https://github.com/dylanclaywell/stagescape/commit/586ed85db201e3029d5625e0233311d5a282b313))

## [0.2.0](https://github.com/dylanclaywell/stagescape/compare/stagescape-v0.1.0...stagescape-v0.2.0) (2026-09-10)


### Features

* add About panel with live window size readout ([4378cf3](https://github.com/dylanclaywell/stagescape/commit/4378cf38fa874d3148141a65c7ac0c2458288d30))
* add hiscores API route and parser ([f299aeb](https://github.com/dylanclaywell/stagescape/commit/f299aeb4be3a47344da652d87fa283d209b5f2b3))
* add hiscores store with offline-first persistence ([67e3d2d](https://github.com/dylanclaywell/stagescape/commit/67e3d2d1d9179f58869dffd0a53c564e81dea06d))
* add responsive skills grid ([71dc1f3](https://github.com/dylanclaywell/stagescape/commit/71dc1f3f301b201e51c79c5253dd505c77b25211))
* adopt Quest Journal art direction ([53faff1](https://github.com/dylanclaywell/stagescape/commit/53faff1e7ba609837762f9c1335b16d09346332d))
* migrate to Cloudflare Workers with Static Assets ([6f4bee8](https://github.com/dylanclaywell/stagescape/commit/6f4bee8f952adfc8fd668bcef00a2128af32848d))
* scaffold Vue 3 PWA on Cloudflare Pages ([8f4ef68](https://github.com/dylanclaywell/stagescape/commit/8f4ef68fd8faf62fa20fc9c4048f28d86d0168e5))
* use Jagex skill icons fetched at build time ([1d10147](https://github.com/dylanclaywell/stagescape/commit/1d10147409daf7170c076b21f84eb206b8391912))
