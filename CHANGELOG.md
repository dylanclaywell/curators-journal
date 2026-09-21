# Changelog

## [0.11.0](https://github.com/dylanclaywell/curators-journal/compare/curators-journal-v0.10.0...curators-journal-v0.11.0) (2026-09-21)


### Features

* **bosses:** add boss detail with drops, fight prose and locations ([f9a7a46](https://github.com/dylanclaywell/curators-journal/commit/f9a7a466fc0199138ee46bb245bad190e59f1e3e))
* **bosses:** add the Bosses panel ([75a4619](https://github.com/dylanclaywell/curators-journal/commit/75a461998ff29b8952ab383cad3b56d75cce9ade))
* **bosses:** classify hiscore activities and build the boss list ([47c1196](https://github.com/dylanclaywell/curators-journal/commit/47c11967fc5b9dd70c622643b55ed983fced5b2c))
* **bosses:** generate the boss dataset from the wiki and the hiscores ([a6f79a4](https://github.com/dylanclaywell/curators-journal/commit/a6f79a485023817b57d5b79cbdde6fcf1595e7b9))
* **bosses:** refresh bosses weekly, and link them to quests both ways ([a6d6f10](https://github.com/dylanclaywell/curators-journal/commit/a6d6f108d412ecee074c1fe7192bb7ff03c25a27))
* **diaries:** settle 6e on a mode inside Quests, with the mode in the path ([07a6f38](https://github.com/dylanclaywell/curators-journal/commit/07a6f3804cf693168ada5ffe16d1c4aad061c54a))
* **items:** add src/data/items.json, trimmed to the items our drops name ([85ffbad](https://github.com/dylanclaywell/curators-journal/commit/85ffbad3dabd5f9c34a2551a50c01ab940b7d594))
* **prices:** add /api/prices, a Worker proxy for Grand Exchange prices ([8fbf4f6](https://github.com/dylanclaywell/curators-journal/commit/8fbf4f611d6215b2295c2bb09199ca6ef12dca6c))


### Bug Fixes

* **settings:** name every wiki-derived dataset in the credits ([58c0d9c](https://github.com/dylanclaywell/curators-journal/commit/58c0d9cdc73c55e6c1109f6780c16ebbabcba955))
* **shell:** collapse tab labels by width per tab, not by tab count ([da5b7aa](https://github.com/dylanclaywell/curators-journal/commit/da5b7aa8a0771ac29d2fed96fabf501cb35d5428))


### Refactors

* **bosses:** drop the hand-written list for the generated dataset ([6772e3d](https://github.com/dylanclaywell/curators-journal/commit/6772e3d960094181450b0e329f76f89e8cd2b0c0))
* **bosses:** rename ranked to scored, since they are different things ([6d5eb70](https://github.com/dylanclaywell/curators-journal/commit/6d5eb706cc5ef07b0c6a5b809574fb6be4afbff6))

## [0.10.0](https://github.com/dylanclaywell/curators-journal/compare/curators-journal-v0.9.0...curators-journal-v0.10.0) (2026-09-21)


### Features

* **diaries:** lock synced tiers and report them in settings ([3af48d8](https://github.com/dylanclaywell/curators-journal/commit/3af48d86b5a54e5149b8437da04b85c0141022a8))
* **diaries:** merge synced tiers into the task record ([b69334e](https://github.com/dylanclaywell/curators-journal/commit/b69334ee9ad997ce5344662cf5c9cd3413037d15))
* **settings:** save the account hash explicitly ([29e8777](https://github.com/dylanclaywell/curators-journal/commit/29e8777cacc710fd006dc757ee278932de1fa620))
* **sync:** accept an account hash from a /sync link ([2aa7b94](https://github.com/dylanclaywell/curators-journal/commit/2aa7b9482205357e16d9626879e1ca6013eb5392))
* **sync:** add clipboard paste and copy for the account hash ([b0c3d54](https://github.com/dylanclaywell/curators-journal/commit/b0c3d544e32296f3aa4ce1819f9bab886ede335a))
* **sync:** add diary tiers to the snapshot contract ([1737cca](https://github.com/dylanclaywell/curators-journal/commit/1737cca5a124e671f89833ef9e510f67e1633f89))
* **sync:** lead with copy in a browser tab and explain why ([c87e7cb](https://github.com/dylanclaywell/curators-journal/commit/c87e7cb31b06e4e92eb6ef797e5895e5811cde92))
* **worker:** store diary tiers in the sync snapshot ([89175f2](https://github.com/dylanclaywell/curators-journal/commit/89175f23fceeac1902781f80a8f1f578973cbc1d))


### Bug Fixes

* **quests:** lock progress options the snapshot already outranks ([ea12779](https://github.com/dylanclaywell/curators-journal/commit/ea12779579924128be47997a73f8cfa202353a02))


### Refactors

* **sync:** share one account hash validator ([0586149](https://github.com/dylanclaywell/curators-journal/commit/05861498c80b9ea3f797b1e9bdd1d25f795361b1))

## [0.9.0](https://github.com/dylanclaywell/curators-journal/compare/curators-journal-v0.8.0...curators-journal-v0.9.0) (2026-09-18)


### Features

* add the wiki's quick guides as per-quest walkthrough data ([4c3b270](https://github.com/dylanclaywell/curators-journal/commit/4c3b2701e7d2e5ea5ca289a3900d1a0fdbee791c))
* show a quest's quick guide in its detail panel ([eb9a779](https://github.com/dylanclaywell/curators-journal/commit/eb9a77909d8468dd6c1e2ca85aa20d2a7ccb6e0e))


### Chores

* refresh the quest and diary datasets from the wiki ([19a0622](https://github.com/dylanclaywell/curators-journal/commit/19a06226e2df58be283a86a4c1e5a9f7b2030825))
* refresh the quest and diary datasets from the wiki ([e9c2d33](https://github.com/dylanclaywell/curators-journal/commit/e9c2d330351a9223d64118758c8c66d8681e948a))

## [0.8.0](https://github.com/dylanclaywell/stagescape/compare/curators-journal-v0.7.0...curators-journal-v0.8.0) (2026-09-18)


### Features

* check the datasets against the wiki on a schedule ([3269c94](https://github.com/dylanclaywell/stagescape/commit/3269c94dc86a4bffd8038c4ae0dbb221d2422557))

## [0.7.0](https://github.com/dylanclaywell/stagescape/compare/curators-journal-v0.6.0...curators-journal-v0.7.0) (2026-09-18)


### Features

* add diary types and share the wiki plumbing between generators ([455afd9](https://github.com/dylanclaywell/stagescape/commit/455afd91340223ed71f69a2ecb015f04c98f553e))
* check off diary tasks individually, with ids that survive regeneration ([b7d5cd6](https://github.com/dylanclaywell/stagescape/commit/b7d5cd65fd046353cd2c132cca4c33c8ef6d305a))
* evaluate achievement diary tiers and tasks ([26cfd0c](https://github.com/dylanclaywell/stagescape/commit/26cfd0ca8f1d9bd75b307016dae8f4dba581b08d))
* generate the achievement diary dataset from the wiki ([aa58321](https://github.com/dylanclaywell/stagescape/commit/aa583214b3ffd37d9b16f473086efb2e5a5443f7))
* persist diary progress and carry it in the backup ([0a88062](https://github.com/dylanclaywell/stagescape/commit/0a880629035b9ad15a1eff2d541b40927b448022))
* show achievement diaries, two placements at once ([558ca76](https://github.com/dylanclaywell/stagescape/commit/558ca7611ed62dedff5076c552e5907abd828949))


### Chores

* add /checkpoint and take .memories off an MCP server ([181ce94](https://github.com/dylanclaywell/stagescape/commit/181ce94216c004b29e41edb3f329164297e7b73e))

## [0.6.0](https://github.com/dylanclaywell/stagescape/compare/curators-journal-v0.5.0...curators-journal-v0.6.0) (2026-09-16)


### Features

* add About panel with live window size readout ([4378cf3](https://github.com/dylanclaywell/stagescape/commit/4378cf38fa874d3148141a65c7ac0c2458288d30))
* add description, kills and rewards to quest detail (4g) ([4635ec0](https://github.com/dylanclaywell/stagescape/commit/4635ec0387c0fd08cb3f6d352ec7f1430769a044))
* add hiscores API route and parser ([f299aeb](https://github.com/dylanclaywell/stagescape/commit/f299aeb4be3a47344da652d87fa283d209b5f2b3))
* add hiscores store with offline-first persistence ([67e3d2d](https://github.com/dylanclaywell/stagescape/commit/67e3d2d1d9179f58869dffd0a53c564e81dea06d))
* add quest eligibility and plan ordering ([770f582](https://github.com/dylanclaywell/stagescape/commit/770f5822e2e97ba743bb9eb804b4e2aa7380555e))
* add responsive skills grid ([71dc1f3](https://github.com/dylanclaywell/stagescape/commit/71dc1f3f301b201e51c79c5253dd505c77b25211))
* add the D1 binding and the snapshot table ([9ade93c](https://github.com/dylanclaywell/stagescape/commit/9ade93cbdd3ecf8adc2c962c602461b537834d71))
* add the quest store, and let the hiscores store hydrate itself ([d226f00](https://github.com/dylanclaywell/stagescape/commit/d226f00af616e4d170e77e117e368b0de59c2b80))
* add the sync panel, and rename About to Settings ([dc7080d](https://github.com/dylanclaywell/stagescape/commit/dc7080d389f98f45ca9f29eac9ec2d7466cf8d51))
* add the sync route ([2039b49](https://github.com/dylanclaywell/stagescape/commit/2039b49502967ebc37f617cfe8dea6fc63393f8d))
* add the sync store and merge synced progress ([218d531](https://github.com/dylanclaywell/stagescape/commit/218d531442682a91f9120ec34a66ce2365303e4f))
* add the sync wire format and its validator ([8e1b5ed](https://github.com/dylanclaywell/stagescape/commit/8e1b5edfd4b5e019641456c6e230b4669b75af51))
* adopt Quest Journal art direction ([53faff1](https://github.com/dylanclaywell/stagescape/commit/53faff1e7ba609837762f9c1335b16d09346332d))
* animate goal reordering ([e054617](https://github.com/dylanclaywell/stagescape/commit/e05461767d3514dd2840361210bb368d13cdc88a))
* cross-check quest requirements against the Lua module ([440ea5e](https://github.com/dylanclaywell/stagescape/commit/440ea5eb4f58b54439b92a520bd6cae7e216510a))
* export/import for quest progress and settings (4b') ([ddb44af](https://github.com/dylanclaywell/stagescape/commit/ddb44afa7429dd786ea1c3e99f435df595efff0b))
* fetch and cache the wiki quest inventory ([20ba8ce](https://github.com/dylanclaywell/stagescape/commit/20ba8ce0dcfac23c52ac8e9b765ebff041ec0a64))
* generate and commit the quest dataset ([e8d826c](https://github.com/dylanclaywell/stagescape/commit/e8d826cd002b893e7bf5ef016c34732009156230))
* migrate to Cloudflare Workers with Static Assets ([6f4bee8](https://github.com/dylanclaywell/stagescape/commit/6f4bee8f952adfc8fd668bcef00a2128af32848d))
* move refresh-on-resume from StatsView to the shell (4f) ([168e541](https://github.com/dylanclaywell/stagescape/commit/168e5411c62f920126604cd71c5840da6f5ed063))
* parse quest requirements from wiki page templates ([8461e51](https://github.com/dylanclaywell/stagescape/commit/8461e513d4cbbdf941b4fd5fd8c1ddb18a198ddf))
* pull down to refresh, and fix two things the iPad found ([2f93e83](https://github.com/dylanclaywell/stagescape/commit/2f93e83998cc242f1d85c291f658eb2b99e96556))
* quest detail view, and oak-button quest rows (4d) ([6533058](https://github.com/dylanclaywell/stagescape/commit/65330583817e5aa948ceb5a8d0fa83dd740f0743))
* quest filters and add-to-queue (4c slice C) ([c9a558f](https://github.com/dylanclaywell/stagescape/commit/c9a558fec0a7fce4b73b3a8f9963d044d9b55c0a))
* Quests panel list and search (4c slice B) ([ab70750](https://github.com/dylanclaywell/stagescape/commit/ab70750ea20f29b76ee1455ee449d4851f2a6f47))
* queue from quest detail, and drop the queue's add button ([6cb3715](https://github.com/dylanclaywell/stagescape/commit/6cb3715f0541d00afa8203e4d78ed1853bb92310))
* render the queue as next-up plus a tabbed plan and goals ([b80798f](https://github.com/dylanclaywell/stagescape/commit/b80798fa35149bead3e58dec6084bdb0eaed56aa))
* reorder goals in the queue (4e′) ([d96acda](https://github.com/dylanclaywell/stagescape/commit/d96acda79814a02c8c4d76cca0228590cb238720))
* scaffold Vue 3 PWA on Cloudflare Pages ([8f4ef68](https://github.com/dylanclaywell/stagescape/commit/8f4ef68fd8faf62fa20fc9c4048f28d86d0168e5))
* shape quest types around what the wiki actually provides ([0242643](https://github.com/dylanclaywell/stagescape/commit/0242643a982a7777c74a103aa79f68d863246be6))
* show the items a quest needs on its detail page ([4d3554f](https://github.com/dylanclaywell/stagescape/commit/4d3554f51a355a397d02ba16589b623e3012b38b))
* show the whole prerequisite chain on quest detail ([ce1a95a](https://github.com/dylanclaywell/stagescape/commit/ce1a95a04937916d25e7c4981e5a131da8bad6da))
* split Queue and Quests into two panels (4c slice A) ([2b64581](https://github.com/dylanclaywell/stagescape/commit/2b64581cdad10befda0a2f87ff5551203b628949))
* start and finish quests from the queue ([415c056](https://github.com/dylanclaywell/stagescape/commit/415c056782fdf4d9078f6b5c8196d2b86fa5bbe0))
* tint level mentions and dress the item lists as a journal ([0902731](https://github.com/dylanclaywell/stagescape/commit/0902731e309813da6c1288211c9b3ca98b3a68ee))
* use Jagex skill icons fetched at build time ([1d10147](https://github.com/dylanclaywell/stagescape/commit/1d10147409daf7170c076b21f84eb206b8391912))


### Bug Fixes

* **ci:** pin node from .nvmrc, since wrangler now requires 22 ([1041c0f](https://github.com/dylanclaywell/stagescape/commit/1041c0fe6286232387cccd2277fcccda3bda6e0d))
* generate favicon.svg from the icon source ([4b2e41c](https://github.com/dylanclaywell/stagescape/commit/4b2e41cd64302e1590e095c689ce6b25de7a2f3e))
* keep the quests header above the list when scrolling ([ccb5cfa](https://github.com/dylanclaywell/stagescape/commit/ccb5cfa57c62f8cfe969744e4e8f9975364077ef))
* let goal order drive the plan instead of alphabetical id order ([d497bb6](https://github.com/dylanclaywell/stagescape/commit/d497bb64c8e15f6356511f1df3a4566c46e30d43))
* make quest status readable at a glance ([8cfb9aa](https://github.com/dylanclaywell/stagescape/commit/8cfb9aac66bd70184881ce6b90d66779e5ef9adf))
* return to the panel a quest was opened from ([09472d9](https://github.com/dylanclaywell/stagescape/commit/09472d934138cb89767a40d045e54591c1f5e913))
* update package-lock.json ([1e5d380](https://github.com/dylanclaywell/stagescape/commit/1e5d380490bf5363f1bf80b27b8f2f22145155c1))


### Performance

* keep localforage out of the initial bundle ([586ed85](https://github.com/dylanclaywell/stagescape/commit/586ed85db201e3029d5625e0233311d5a282b313))


### Refactors

* rename StageScape to Curator's Journal ([21b3cfb](https://github.com/dylanclaywell/stagescape/commit/21b3cfba84baa6d817dad3e9258f09ec5b2bbbdd))


### Chores

* **main:** release stagescape 0.2.0 ([d104f1d](https://github.com/dylanclaywell/stagescape/commit/d104f1d9dcec1edee4781273eb273a85afa782e7))
* **main:** release stagescape 0.2.0 ([aaf708f](https://github.com/dylanclaywell/stagescape/commit/aaf708f616c422307b0bdc839d1dfc5ecd666e17))
* **main:** release stagescape 0.3.0 ([aab9101](https://github.com/dylanclaywell/stagescape/commit/aab91010e67dda537995882d7e0b5bd04e177c70))
* **main:** release stagescape 0.3.0 ([2960d68](https://github.com/dylanclaywell/stagescape/commit/2960d68430bfefcc6c9c1e797f7a11747b24858d))
* **main:** release stagescape 0.3.1 ([4506816](https://github.com/dylanclaywell/stagescape/commit/45068163f59620615c8307cf404cd9b2a5fe1cf1))
* **main:** release stagescape 0.3.1 ([44b84e6](https://github.com/dylanclaywell/stagescape/commit/44b84e6ee2f8b22558a5bb7cd236427339b08dc9))
* **main:** release stagescape 0.4.0 ([ab9cbfc](https://github.com/dylanclaywell/stagescape/commit/ab9cbfc6ef729d5f4fb43b1f610a13f126559cae))
* **main:** release stagescape 0.4.0 ([3219c9e](https://github.com/dylanclaywell/stagescape/commit/3219c9e740747d4fdcfe9aa5a2dbef5eb30e9072))
* **main:** release stagescape 0.5.0 ([2b62903](https://github.com/dylanclaywell/stagescape/commit/2b62903da1dabc0554128f7cb4322f031e35f3f2))
* **main:** release stagescape 0.5.0 ([2e60ea7](https://github.com/dylanclaywell/stagescape/commit/2e60ea71a20ad155ea68413a480c4d1c6ab13d0a))
* merge main to pick up the prettier ignore fix ([07ebfd1](https://github.com/dylanclaywell/stagescape/commit/07ebfd15749f168c2cf5c509c56f9c60aade64de))
* replace the app icon with the Curator's Journal logo ([9946ce6](https://github.com/dylanclaywell/stagescape/commit/9946ce6590c304d639cbb398665606f000e60cf1))

## [0.5.0](https://github.com/dylanclaywell/stagescape/compare/stagescape-v0.4.0...stagescape-v0.5.0) (2026-09-12)


### Features

* add description, kills and rewards to quest detail (4g) ([4635ec0](https://github.com/dylanclaywell/stagescape/commit/4635ec0387c0fd08cb3f6d352ec7f1430769a044))

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
