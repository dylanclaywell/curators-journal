# Changelog

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
