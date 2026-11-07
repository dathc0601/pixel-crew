# Changelog

## [0.2.0](https://github.com/dathc0601/pixel-crew/compare/v0.1.101...v0.2.0) (2026-11-07)


### Features

* **config:** add the validated, hot-reloaded office config section ([b923e0f](https://github.com/dathc0601/pixel-crew/commit/b923e0fe265fca63c8d47322c55268536bd0a805))
* **gateway:** add a token-free demo mode with scripted agents ([f6d2180](https://github.com/dathc0601/pixel-crew/commit/f6d21807ee46e292a420639a20834322a08475b2))
* **gateway:** attach external Claude Code sessions to the team ([fc94d71](https://github.com/dathc0601/pixel-crew/commit/fc94d7160fda6786c5d7a9c193708fd645df17b8))
* **gateway:** exit cleanly when the desktop shell closes stdin ([604d407](https://github.com/dathc0601/pixel-crew/commit/604d40704b2ebcd48fa5b41c54f59382ddad05b9))
* **gateway:** hire a Lead, four devs and a reviewer in demo mode ([3575ac4](https://github.com/dathc0601/pixel-crew/commit/3575ac4d9cbcf055ca2a33be15be7e95ecc25855))
* **gateway:** one-time QR pairing links and device-bound sessions ([e2ad610](https://github.com/dathc0601/pixel-crew/commit/e2ad610662ba3f13bca19e2a3d416a61a785e7a4))
* **gateway:** pixel-crew claude-attachable launcher for live-mode sessions ([59f64ac](https://github.com/dathc0601/pixel-crew/commit/59f64ac1a44b59b7cf8f13241575417b972147f3))
* **gateway:** wire BOSS_ASSIGN, the work pool and owner-only office config ([8c9a226](https://github.com/dathc0601/pixel-crew/commit/8c9a22644583ad4cf261109b7b72188789af49a8))
* **gateway:** wire RESUME_POOL / CANCEL_WORK_ITEM and drop the END_PROJECT greet run ([dabfd1f](https://github.com/dathc0601/pixel-crew/commit/dabfd1f50a83410580fe0cfe445f23afad45b834))
* **orchestrator:** add the work-item Dispatcher, hand-off timing and Lead policy ([ac0b327](https://github.com/dathc0601/pixel-crew/commit/ac0b327d1f4ec987b2119d899d8db9024305e774))
* **orchestrator:** hold restored work items until the owner resumes them ([75921ed](https://github.com/dathc0601/pixel-crew/commit/75921eddc1a6f437a49880e8d425f362a0d825b2))
* **orchestrator:** portable spawn, PATH lookup and process-tree kills ([9607e58](https://github.com/dathc0601/pixel-crew/commit/9607e5871ad2d909eeec257a33361e25c3bccfc8))
* **orchestrator:** small AgentDriver layer with Claude fork and live drivers ([b08883c](https://github.com/dathc0601/pixel-crew/commit/b08883ce621d8880922e7c39d062ee2c8f55b9f4))
* rename the fork to Pixel Crew ([46b74ca](https://github.com/dathc0601/pixel-crew/commit/46b74ca7e8ea83cb9dc827b3d2f33a24d6475e27))
* **shared:** add Boss flow protocol and safe event parsing ([d5546cd](https://github.com/dathc0601/pixel-crew/commit/d5546cd28c7b3fcc2380e1c2022e32788ca93db5))
* **shared:** add pool resume/cancel commands, held work items and GATEWAY_INFO ([5c9a3b6](https://github.com/dathc0601/pixel-crew/commit/5c9a3b66cf029edf1bd8588947368ee080547575))
* **shared:** ATTACH_EXTERNAL / DETACH_AGENT commands and attach fields on AGENT_CREATED ([cd124b8](https://github.com/dathc0601/pixel-crew/commit/cd124b8c2406664e069972d9f9ee0f07910f6811))
* **shared:** pairing v2 protocol (pair links, devices list, per-device revoke) ([0556de0](https://github.com/dathc0601/pixel-crew/commit/0556de046cbd68c8b11c19de254b37d57e980bed))
* validate theme packs and role packs, document the extension points ([a8e2904](https://github.com/dathc0601/pixel-crew/commit/a8e2904d5e9ca2d6e08f5cbcc7d60a4da1fa308d))
* **web:** add hand-off choreography, the Boss character and an idle-sleeping loop ([2f2a442](https://github.com/dathc0601/pixel-crew/commit/2f2a4424a2cabd53d90319551b52409c285b9391))
* **web:** add Pixel Crew's own office art set ([ab46c02](https://github.com/dathc0601/pixel-crew/commit/ab46c0290d1093a882866ebd0825f242226c5c5b))
* **web:** add the Boss composer, task board, office settings and DEMO badge ([886c615](https://github.com/dathc0601/pixel-crew/commit/886c615d992850aefe74682718aa5eb7ea16cfed))
* **web:** add zones to the layout format and a real floor plan ([35a27a4](https://github.com/dathc0601/pixel-crew/commit/35a27a4efe3cac6275bfd58d9e32c82ce15573a5))
* **web:** Join team / Leave team for external Claude sessions ([6c5d089](https://github.com/dathc0601/pixel-crew/commit/6c5d089c0a2904ba8f84e367dbaaed0afad5f842))
* **web:** keep the office readable on phones ([58e345d](https://github.com/dathc0601/pixel-crew/commit/58e345d69cc12e0276ec525f062c2025927c54ca))
* **web:** load extra office themes as data-only files ([4f81e60](https://github.com/dathc0601/pixel-crew/commit/4f81e60f70d21d647bbbabd6c08495c0564dc814))
* **web:** open the pixel office by default; console mode is opt-in ([27abeff](https://github.com/dathc0601/pixel-crew/commit/27abeff1bb585ecd9695d6f316b417f5e6bf7448))
* **web:** paint zones in the layout editor ([5c64442](https://github.com/dathc0601/pixel-crew/commit/5c644424f4248183024a1750b8cd6d2e75cd0893))
* **web:** pair from a QR link and manage devices in office settings ([88b26be](https://github.com/dathc0601/pixel-crew/commit/88b26be52f1eb0efe8100bbdddd93e3a78559409))
* **web:** phone remote: office view, approvals tray and 44 px touch targets ([dea9698](https://github.com/dathc0601/pixel-crew/commit/dea9698fdbda088567eccf1af5a4ab222818ee9d))
* **web:** show internal team prompts as short human lines ([45cce45](https://github.com/dathc0601/pixel-crew/commit/45cce4541b4ff2c4d80c2b686a23b69f8eb2b61b))
* **web:** show working vs idle at a glance and label the rooms ([585b10a](https://github.com/dathc0601/pixel-crew/commit/585b10ac09035c30ad3d42b4d48a2df58f670ba7))
* **web:** subscribe to logs of the open agent panes only ([459f210](https://github.com/dathc0601/pixel-crew/commit/459f2108b3006245229a08ccfe9ed4ae42f3891d))


### Bug fixes

* **desktop:** build on Windows and Linux, run on system Node 22+, tighten capabilities and CSP ([94d2e05](https://github.com/dathc0601/pixel-crew/commit/94d2e05931d359d091ad08c6ce1683e31a37e28e))
* **gateway:** ship role packs in dist/agents so the built gateway finds them ([44e7ff6](https://github.com/dathc0601/pixel-crew/commit/44e7ff675daebb90c57b62545b60b1fa53402ed9))
* **gateway:** Windows-safe backend detection, path guards and Claude project keys ([ae84388](https://github.com/dathc0601/pixel-crew/commit/ae84388f0d8dc616e6066c6b31b37066249fa768))
* **orchestrator:** keep a Boss task that is still walking over when the Lead finishes ([ac52f84](https://github.com/dathc0601/pixel-crew/commit/ac52f845f7eb31975db0754e1de69984f270db7a))
* **orchestrator:** prefer the exact PATH key in command lookup ([0e04d2f](https://github.com/dathc0601/pixel-crew/commit/0e04d2f66f48e3d4c37233a10cbc756a4f63f4b5))
* **orchestrator:** removing an idle agent no longer posts a stray task-cancelled message ([6186397](https://github.com/dathc0601/pixel-crew/commit/61863970f46f25653f372a184d1314d73a8373cf))
* **orchestrator:** run git without a shell in worktree isolation ([9e06f0b](https://github.com/dathc0601/pixel-crew/commit/9e06f0b7790a2739bcd8d5049d6ef340ea29d35f))
* **security:** close the unauthenticated owner-token hole (P0.1) ([5f6f16a](https://github.com/dathc0601/pixel-crew/commit/5f6f16a7107c8d8276e40d3b75679e06cda595e0))
* **security:** default agents to auto permission mode, gate the rest (P0.2) ([1b15031](https://github.com/dathc0601/pixel-crew/commit/1b15031cbc46abd11f5d87eff4ab29cc3e4e3ab4))
* **security:** serve previews from a separate, sandboxed origin (P0.3) ([066f4b7](https://github.com/dathc0601/pixel-crew/commit/066f4b73230dfa14e05effc9fbfddee518621278))
* split paths on both separators in the web UI and memory ([4e78afd](https://github.com/dathc0601/pixel-crew/commit/4e78afd01b42021b84b7b8271371018b403639a3))
* stop writing role packs to ~/.claude/agents, pass them per run ([5b48472](https://github.com/dathc0601/pixel-crew/commit/5b48472bd20ce7662825edf8920a1bd093cbc58f))
* **web:** create the AudioContext only after the first user gesture ([bac9ba5](https://github.com/dathc0601/pixel-crew/commit/bac9ba5b0f17100bb9cdad85db0c12d64222f05f))
* **web:** drop status words from result lines in the chat log ([20bb955](https://github.com/dathc0601/pixel-crew/commit/20bb9558839dcf04ae1331a9db71f6231b8d3d9f))
* **web:** drop unknown gateway events instead of throwing ([f8aad6c](https://github.com/dathc0601/pixel-crew/commit/f8aad6c4ec133e97fd27d33c222a61f90a99fa07))
* **web:** exact static-layer redraws at every DPR ([b45727b](https://github.com/dathc0601/pixel-crew/commit/b45727b67076db80e07db0b9bdb7541b8319ed60))
* **web:** fit the office between the overlays on phones ([4a6ab49](https://github.com/dathc0601/pixel-crew/commit/4a6ab496d43e00b27c2e235be82b066824f8c5cb))
* **web:** name the process in the kill confirm for external sessions ([5da641e](https://github.com/dathc0601/pixel-crew/commit/5da641e1cc48f78ac4e6db7bab779fa3a962d729))
* **web:** print debug logs only in dev builds or with localStorage.pixelCrewDebug ([5b30400](https://github.com/dathc0601/pixel-crew/commit/5b30400b5b22db79bf9564bcc671b8a3845ede06))
* **web:** serve an offline page when the gateway is down, never reject in the SW ([41e297b](https://github.com/dathc0601/pixel-crew/commit/41e297b9dee6cb8c75c37028c282ced657cc997e))
* **web:** show the Lead in the right panel after a reload ([dac5805](https://github.com/dathc0601/pixel-crew/commit/dac580557866df273bd9fbc67f15bf43e432912b))
* **web:** show when the gateway is offline instead of dropping commands silently ([052a363](https://github.com/dathc0601/pixel-crew/commit/052a36375c957c24efd3383b1e9116b906d86aa9))
* **web:** splash screen says Pixel Crew instead of Open Office ([456bdef](https://github.com/dathc0601/pixel-crew/commit/456bdef563e40363eb8a9474b9332b5aece28ff9))
* **web:** stop the side panel flicker loop after Join team ([fa92617](https://github.com/dathc0601/pixel-crew/commit/fa92617a042d3bcc5b5c3efdf73f222a15857a5b))


### Performance

* **gateway:** batch log chunks and send logs only to open panes ([a5d1fdb](https://github.com/dathc0601/pixel-crew/commit/a5d1fdb84bbd976a4faf717fd06192d05b882923))
* **gateway:** cut daemon idle cost ([5f5c377](https://github.com/dathc0601/pixel-crew/commit/5f5c377d5392a659c8164d836edaa8ff7eab84dd))
* **web:** cache the static office in an offscreen layer ([54a08c4](https://github.com/dathc0601/pixel-crew/commit/54a08c4553f4a5c4344142c3a90d0a389402e5c3))
* **web:** cap the office at 15 fps on touch-first screens and save-data ([e618fdc](https://github.com/dathc0601/pixel-crew/commit/e618fdc6c9a469f402119e48c8189d2bcea5acc6))
* **web:** keep Zod out of the browser bundle ([1c52a2a](https://github.com/dathc0601/pixel-crew/commit/1c52a2a26d00457a20a9a4b0c5c31a47602e6c4b))
* **web:** load markdown and the confirm dialog on first use ([89d3bc6](https://github.com/dathc0601/pixel-crew/commit/89d3bc6af0635c8549a8900c9a644b3894a2f673))
* **web:** self-host the fonts instead of loading Google Fonts ([91c0c15](https://github.com/dathc0601/pixel-crew/commit/91c0c15f468bd99320931755f9134fbbddfcd9a0))
* **web:** tick only when needed, cap walks at 30 fps, pause when unseen ([27b9df4](https://github.com/dathc0601/pixel-crew/commit/27b9df4569e0aa992bd44642a18741eb6cecf2d6))


### Documentation

* attach Claude sessions (Phase 2a) research, design and manual test script ([15c88a3](https://github.com/dathc0601/pixel-crew/commit/15c88a3281d53cc58c300e18d53e8e6e5b0e7abd))
* contributing guide with release steps, security policy and code of conduct ([cb45866](https://github.com/dathc0601/pixel-crew/commit/cb45866129b2fcf0d098037316905492f1fcf351))
* demo recording of the Boss → Lead → devs flow and screenshots ([7660f21](https://github.com/dathc0601/pixel-crew/commit/7660f2180c98e0cecc26e06cebe8aac9ae3e3690))
* desktop app install notes for unsigned builds ([f9cd041](https://github.com/dathc0601/pixel-crew/commit/f9cd0414261b237d99f502357bf2344796dc103d))
* explain how to get the pixel-crew command from source; run CI on feat/ and fix/ branches ([72ed806](https://github.com/dathc0601/pixel-crew/commit/72ed806f46e2655596ae7157298dfc8235f35aac))
* guide for adding an AI vendor (AgentDriver direction for Phase 2) ([16d3d3f](https://github.com/dathc0601/pixel-crew/commit/16d3d3f96e7a1d0aebb417d5ab873fbec6e5762e))
* Phase 6 status, v1 summary and project notes ([7c1eb6f](https://github.com/dathc0601/pixel-crew/commit/7c1eb6f1338564320422fc9febeebddd768a94dd))
* phone remote guide (LAN, Tailscale serve, Cloudflare Access) and Phase 5 status ([9a2a472](https://github.com/dathc0601/pixel-crew/commit/9a2a47248343b24bd56ac4c19407ea5909616c88))
* **plan:** record Phase 1 daemon status ([844f8ad](https://github.com/dathc0601/pixel-crew/commit/844f8adf28a3a7f35b6d43789cdabeb1fab3c987))
* record Phase 1 UI status and document the Boss flow and demo mode ([24c9233](https://github.com/dathc0601/pixel-crew/commit/24c923335ed91e68f910d3970e5046ca493c13bc))
* record Phase 3 status, office art sources and the layout notes ([851dfc5](https://github.com/dathc0601/pixel-crew/commit/851dfc560e585476430f212ea90a4b634ab843ac))
* record Phase 4 measurements and status ([58e1e11](https://github.com/dathc0601/pixel-crew/commit/58e1e11b662355c738422574c957c70400da5510))
* rewrite the README for Pixel Crew and add a Vietnamese version ([24c0694](https://github.com/dathc0601/pixel-crew/commit/24c0694814206f8fcef4518a8355cf1e55bbd275))
* role packs are passed per run with --agents, never written to ~/.claude ([52de07a](https://github.com/dathc0601/pixel-crew/commit/52de07a914a781c6ccc699122a95a180c35ffd0a))
* track the fork improvement plan and mark Phase 0 status ([ba0eae0](https://github.com/dathc0601/pixel-crew/commit/ba0eae0c542dc4f1d6f1144622bdd6daec46fc9d))


### CI

* bump minor for features before 1.0 and cut 0.2.0 as the first release ([90bd939](https://github.com/dathc0601/pixel-crew/commit/90bd9390349e169777756bca0020a32f6e9480ab))
