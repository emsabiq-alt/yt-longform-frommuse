# YT Longform Studio - Sequence Diagrams and Project Memory

This document is a working memory map for the project. It combines sequence
diagrams with notes that should help the next coding session resume quickly.

## Project Memory Snapshot

- User's latest direction (2026-09-13): keep **20 minutes**, enrich the storyboard,
  and preserve the supplied phone/tablet mockups and spotlight. This supersedes
  the earlier 12-minute default. Use `YT_DURATION_SEC=1200`, `YT_SCENE_COUNT=36`
  in local, GitHub Actions, and Vercel environments. OpenAI speed remains 1.08
  with `config.openai.ttsInstructions` for a lively, clear documentary voice.
- Start with ~2,280 words / 8-9 chapters (raised from six on 2026-09-13 so each
  chapter stays narrow and YouTube chapter thumbnails vary more). `generateFullItem()` now measures TTS
  before generating visuals, includes fixed hook/intro/outro durations, and asks
  `enrichLongformDraft()` for new sourced examples, evidence, and perspectives
  when short. Up to three passes / 48 scenes; original narration, chapters,
  spotlight and mediaSource survive insertion. Audio hashes allow reuse after
  reindexing; full narration is retained in the exported storyboard JSON.
- `duration-control.js` fits measured audio using render tempo 0.98–1.12x,
  retimes captions/word triggers, and quantizes scene/subscene durations to frames.
  FFprobe checks final MP4 against the target with a one-second tolerance.
  Impossible fits stop before publishing; never shorten the script or insert
  long silence to reach 20 minutes. Legacy drafts without `durationLocked` keep
  their prior timing behavior. Initial draft gating (`assertNarrationLongEnough`
  and `minimumNarrationWords`) accommodates initial 32-36 scene drafts when
  `durationLocked` is active, leaving duration completion to `enrichLongformDraft()`
  and tempo fitting instead of forcing single-call LLM prompt rewrites that hit output limits.
  AI output quality still requires reviewing a real run.
- Mockups use the existing `assets/phone-mockup.png` and `assets/tablet-mockup.png`.
  Spread ~6–8 relevant placements and up to 22 matched spotlights across the story.
  Prompt and normalizer both use four visual segments, including the end of each
  scene's narration; grid 2x2 generation remains compatible.
- Spotlight has a third type (2026-09-13): `compare`, an animated 2-bar chart
  overlay (pure ASS `\org`/`\fscy`/`\t` scale-from-baseline, no new render
  dependency) for scenes that explicitly compare two named magnitudes (e.g.
  "22x lebih dahsyat dari X", or two numbers with units). Only AI-authored —
  never auto-extracted by `extractAutoSpotlight()`, since guessing a compare
  pair from free text risks fabricating numbers. `normalizeSpotlight()` rejects
  it unless both `value`/`compareValue` are finite positive numbers and both
  labels are present. Shares the same phrase-sync/quota pipeline as
  keypoint/figure (`planSceneSpotlights`), just with a longer card duration
  (6s vs 4.5s) since it has more to read.
- Cold open is now a "flash-forward" (2026-09-13), not a generic setup
  question. `plan.hook` must describe a specific striking moment/fact from the
  MIDDLE/END of the story (question or statement, 15-25 words), and the new
  `plan.flashForwardSceneIndex` field says which scene's visual to use for that
  teaser — `resolveFlashForwardSceneIndex()` validates/defaults it to a
  non-reaction scene around 65% through the story if the AI omits or misaims
  it (never scene 1, since the whole point is spoiling something that hasn't
  happened yet). `insertEnrichmentScenes()` remaps it through `indexMap` when
  scenes get re-indexed by storyboard enrichment. `longform-render.js`'s cold
  open now looks up this scene instead of always `renderScenes[0]`, with the
  old first-scene behavior kept only as a fallback for legacy items missing
  the field. Verified with a real render (QA fixture, 4 distinct-colored
  scenes): cold-open frame showed scene 3's color, not scene 1's.
- Top-left corner overlay is a chapter label now (2026-09-13), not the video
  title repeated for the whole runtime — the title is redundant on screen
  (already on thumbnail/YouTube title). `longform-render.js`'s
  `writeContentCaptionAss()` groups render scenes into contiguous chapter runs
  via `groupScenesForChapterOverlay()` (merges runs starting <10s apart, same
  idea as `buildChapterList()` but also tracks each group's endSec, which that
  function doesn't need) and emits one "BAB N · NAME" event per run, timed to
  when that chapter is actually on screen. `sceneTitleOverlay()` (the old
  static-title version) was removed entirely.
- Overlay text sizing revised again same day after watching a real render:
  first pass hard-truncated long chapter names to 1 line + ellipsis, but the
  user found that "aneh" and asked for the FULL name instead, wrapped smaller
  rather than cut. `fitOverlayText()` (shared by the chapter label AND the
  cold-open hook caption) tries a few (chars-per-line, max-lines, font-size)
  tiers in order and picks the first one that fits the WHOLE text with no
  words dropped; if none of the tiers fit, the last tier is forced with no
  line cap so text is never silently lost. This also fixed a real truncation
  bug: `writeColdOpenCaptionAss` used to hard-slice to 4 lines via
  `splitLines()` (which drops any line past `maxLines`), and the flash-forward
  hook (now 15-25 words, up from 15-20) could overflow that budget — a real
  generated video's hook got cut off mid-sentence because of this.
- Real-render feedback fixes (2026-09-14), all from watching an actual
  generated "Anak Krakatau" video:
  - Mockup/device-overlay images repeated the same subject across many scenes
    (Serper searches for the dominant topic keep returning the same top
    photos). `news-image.js#ensureNewsImages` now tracks `usedSubjects` (a
    normalized-text Set) across both the mediaSource pass and the fallback
    candidate-scene pass, and skips a scene if its resolved query/headline was
    already used — each real-world subject gets at most one mockup per video.
  - Spotlight card fonts (keypoint/figure/compare) enlarged (~15-20%) per user
    request; panel/card heights bumped to match so text doesn't clip.
  - Narration stated wrong years repeatedly. Added an explicit accuracy
    guardrail to both the main storyboard prompt and the enrichment prompt:
    only state a year/date when genuinely confident it's correct, prefer a
    relative phrase ("beberapa dekade kemudian") over a specific year when
    unsure. This is a prompt-level mitigation, not a hard guarantee — AI
    narration should still be spot-checked before publish.
  - Speech tempo/speed was explicitly NOT touched — user likes the current
    pacing, the actual complaint was factual accuracy, not delivery speed.
- Purpose: generate Indonesian YouTube longform educational videos with AI story
  planning, image/B-roll generation, per-scene TTS, subtitle alignment, FFmpeg
  rendering, remote hosting upload, and YouTube publishing.
- Main Node entrypoints: `src/run-once.js`, `src/server.js`,
  `src/preflight.js`, `src/rerender.js`, `src/upload-only.js`,
  `src/sftp-cleanup.js`.
- Vercel API entrypoints: `api/auth.js`, `api/state.js`, `api/run.js`,
  `api/queue.js`, `api/preflight.js`.
- Local desktop app: `app/yt_studio.py`, which runs Node commands locally and
  parses progress markers from stdout.
- Public dashboard: `public/index.html`, `public/app.js`, `public/styles.css`.
- Persistent state: `data/items.json` for active local items and
  `data/memory.json` for compact long-term continuity memory. Remote hosting
  mirrors state under `state/items.json` and `state/memory.json`.
- Generated assets: `generated/images`, `generated/clips`, `generated/audio`,
  `generated/thumbnails`, `generated/videos`, `generated/storyboards`,
  `generated/work`.
- Core invariant before render: every non-reaction scene must have at least one
  video clip or image for each visual segment, and at least one scene audio
  entry must exist.
- External services: OpenAI for story/image/TTS/transcription, ElevenLabs for
  alternative TTS, Pexels for B-roll, Wikipedia for optional fact grounding,
  SFTP/FTP for media hosting, GitHub Actions for cloud generation, YouTube Data
  API for publish/trending/playlist.

## 1. Dashboard Generate Through Vercel and GitHub Actions

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Browser as public/app.js
  participant Auth as api/auth.js
  participant RunApi as api/run.js
  participant Utils as api/_utils.js
  participant GitHub as GitHub Actions API
  participant Workflow as yt-longform-generate.yml
  participant Runner as src/run-once.js
  participant Remote as SFTP/FTP hosting
  participant YouTube as YouTube API

  User->>Browser: Open dashboard and submit PIN
  Browser->>Auth: POST /api/auth { pin }
  Auth->>Utils: checkLoginRate, safeEqual, setSessionCookie
  Auth-->>Browser: ok + session cookie
  User->>Browser: Click Generate Sekarang
  Browser->>RunApi: POST /api/run with topic/category/scenes/etc.
  RunApi->>Utils: requireAuth, clamp inputs
  RunApi->>GitHub: workflow_dispatch
  GitHub-->>RunApi: 204 queued
  RunApi-->>Browser: status queued
  GitHub->>Workflow: Start workflow job
  Workflow->>Workflow: checkout, setup Node, restore cache
  Workflow->>Workflow: install FFmpeg/deps, npm run check, npm test, preflight
  Workflow->>Runner: npm run run:once -- inputs
  Runner->>Remote: import remote items/memory if enabled
  Runner->>Runner: generateFullItem()
  Runner->>Remote: upload assets and state
  Runner->>YouTube: publish video and thumbnail
  Runner->>Remote: sync state again after publish
  Runner-->>Workflow: done JSON + progress logs
```

## 2. Dashboard State, Runs, and Queue

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Browser as public/app.js
  participant StateApi as api/state.js
  participant QueueApi as api/queue.js
  participant PreflightApi as api/preflight.js
  participant Utils as api/_utils.js
  participant Hosting as PUBLIC_BASE_URL/state
  participant GitHub as GitHub Actions API
  participant Remote as SFTP/FTP state writer

  Browser->>StateApi: GET /api/state every 15s
  StateApi->>Utils: requireAuth
  StateApi->>Hosting: fetch items.json and queue.json
  StateApi->>GitHub: list recent workflow runs
  alt latest run is queued/in_progress
    StateApi->>GitHub: fetch jobs and steps for active run
  end
  StateApi-->>Browser: config, activeRun, recentRuns, items, queue, stats

  User->>Browser: Add queue item
  Browser->>QueueApi: POST /api/queue
  QueueApi->>Utils: buildQueueItem, read queue.json
  QueueApi->>Remote: upload state/queue.json
  QueueApi-->>Browser: queue item

  User->>Browser: Run queued item
  Browser->>QueueApi: POST /api/queue { run_now: true }
  QueueApi->>Remote: persist updated queue
  QueueApi->>GitHub: workflow_dispatch with queue item inputs
  QueueApi->>Remote: mark item dispatched
  QueueApi-->>Browser: dispatched queue item

  User->>Browser: Run diagnostics
  Browser->>PreflightApi: GET /api/preflight
  PreflightApi->>Utils: read state, recent run, remote config
  PreflightApi-->>Browser: checks
```

## 3. Longform Generation Pipeline

```mermaid
sequenceDiagram
  autonumber
  participant Runner as src/run-once.js
  participant Storage as src/storage.js
  participant Pipeline as src/pipeline.js
  participant Topic as src/topic-engine.js
  participant Continuity as src/continuity-engine.js
  participant Story as src/longform-story-engine.js
  participant Wiki as src/wikipedia.js
  participant OpenAI as OpenAI API
  participant Pexels as Pexels API
  participant TTS as ElevenLabs/OpenAI TTS
  participant Render as src/longform-render.js
  participant Remote as src/remote.js
  participant YouTube as src/youtube-publisher.js

  Runner->>Storage: listContextItems()
  Runner->>Pipeline: generateFullItem(input)
  Pipeline->>Storage: listContextItems()
  Pipeline->>Story: createLongformDraft(input, existingItems)
  alt topic is empty
    Story->>Topic: pickFreshTopic(category)
    Topic->>Continuity: loadHistory and check freshness
    Topic->>OpenAI: requestIdeaJson for fresh ideas
  end
  Story->>Wiki: fetchWikipediaFacts(topic)
  Story->>OpenAI: requestKnowledgeJson(prompt)
  Story->>OpenAI: generateViralTitle if enabled
  Story->>Storage: write storyboard JSON
  Pipeline->>Storage: save draft item

  Pipeline->>Pexels: search and download B-roll per selected visual segment
  Pipeline->>OpenAI: generate fallback scene images (2x2 grid per scene, split into 4 panels)
  Pipeline->>TTS: generate per-scene audio
  Pipeline->>OpenAI: transcribe audio segments
  Pipeline->>TTS: generate cold-open hook audio if enabled
  Pipeline->>OpenAI: generate thumbnail if enabled
  Pipeline->>Render: renderAndPersist(item)
  Render-->>Pipeline: video asset path/url/duration
  Pipeline->>Storage: save rendered item
  Pipeline-->>Runner: item + warnings

  opt remote enabled
    Runner->>Remote: absolutizeGeneratedUrls()
    Runner->>Storage: mergeMemoryItems([item])
    Runner->>Storage: saveItem(item)
    Runner->>Remote: uploadGeneratedStateAndAssets(item)
  end
  opt YouTube enabled
    Runner->>YouTube: publishToYoutube(video, meta, thumbnail)
    Runner->>YouTube: addToPlaylistByCategory()
    Runner->>Storage: saveItem(item)
    Runner->>Storage: mergeMemoryItems([item])
    Runner->>Remote: sync state/assets again if remote enabled
  end
```

## 4. Render Assembly

```mermaid
sequenceDiagram
  autonumber
  participant Pipeline as src/pipeline.js
  participant Render as src/longform-render.js
  participant Assets as assets/*
  participant FFmpeg as ffmpeg/ffprobe
  participant Work as generated/work/<item-id>
  participant Output as generated/videos

  Pipeline->>Render: renderLongformVideo(item)
  Render->>Assets: select background music
  Render->>Assets: select bumper intro/outro
  Render->>Assets: select category intro/outro
  Render->>Render: buildSceneAudioTiming from per-scene audio
  loop each scene
    alt sceneType is reaction
      Render->>Assets: select reaction clip by cue/text
      Render->>FFmpeg: makeReactionSegment()
    else scene has media segments
      Render->>Render: resolveSceneMediaList()
      alt media is Pexels video
        Render->>FFmpeg: makeVideoSegment with optional overlay
      else media is image
        Render->>FFmpeg: makeImageSegment with Ken Burns zoom
      end
      Render->>FFmpeg: concat subsegments if needed
    end
    FFmpeg-->>Work: content-segment-N.mp4
  end
  Render->>FFmpeg: concat content visual segments
  Render->>Work: write ASS subtitle file
  Render->>FFmpeg: burn subtitles
  Render->>FFmpeg: add logo watermark
  Render->>FFmpeg: build audio timeline from scene audio + music
  Render->>FFmpeg: mux content video and audio
  opt cold open enabled
    Render->>FFmpeg: render hook visual, ASS, audio, mux
  end
  Render->>FFmpeg: transcode bumper intro/outro
  Render->>FFmpeg: render intro and outro
  Render->>FFmpeg: concat final parts
  FFmpeg-->>Output: final MP4
  Render-->>Pipeline: video asset metadata
```

## 5. Local Desktop App Run

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant App as app/yt_studio.py
  participant Env as .env / app/config.json
  participant Node as npm scripts
  participant Runner as src/run-once.js / upload-only.js
  participant Storage as data/items.json
  participant UI as CustomTkinter UI

  User->>App: Launch run-app.bat or run-app.vbs
  App->>App: check_dependencies()
  alt dependency missing
    App->>App: setup wizard downloads Node/FFmpeg and npm install
  end
  App->>Env: load config and editable env fields
  App->>Storage: read local data/items.json
  App-->>UI: render dashboard and library

  User->>App: Jalankan Lokal
  App->>Node: npm run run:once -- params
  Node->>Runner: execute pipeline
  Runner-->>App: stdout lines
  App->>App: parse @@PROGRESS markers
  App->>App: parse @@LOCAL_OUTPUT marker
  App-->>UI: update stage bars and output buttons
  App->>Storage: refresh local items after success

  User->>App: Upload existing video
  App->>Node: npm run upload:once -- --id item-id
  Node->>Runner: publish item to YouTube
  Runner-->>App: @@UPLOAD_SUCCESS marker
  App-->>UI: mark upload/publish complete
```

## 6. Continuity Memory Loop

```mermaid
sequenceDiagram
  autonumber
  participant Runner as src/run-once.js
  participant Storage as src/storage.js
  participant Memory as data/memory.json
  participant Topic as src/topic-engine.js
  participant Continuity as src/continuity-engine.js
  participant Remote as PUBLIC_BASE_URL/state

  opt remote enabled before generation
    Runner->>Remote: fetch state/items.json and state/memory.json
    Runner->>Storage: save remote items locally
    Runner->>Storage: mergeMemoryItems(remote items + memory)
  end

  Topic->>Continuity: loadHistory(80)
  Continuity->>Storage: listContextItems()
  Storage->>Storage: combine data/items.json + data/memory.json
  Continuity-->>Topic: compact history
  Topic->>Continuity: checkFreshness(candidate)
  Continuity-->>Topic: fresh or blocked with reason

  Runner->>Storage: mergeMemoryItems([final item])
  Storage->>Memory: write compact memory item
  opt remote enabled
    Runner->>Remote: upload state/memory.json
  end
```

## 7. Story Engine Detail

```mermaid
sequenceDiagram
  autonumber
  participant Pipeline as src/pipeline.js
  participant Story as src/longform-story-engine.js
  participant Topic as src/topic-engine.js
  participant Format as src/format-engine.js
  participant Viral as src/viral-angle-library.js
  participant Continuity as src/continuity-engine.js
  participant Trends as src/youtube-trends.js
  participant Wiki as src/wikipedia.js
  participant OpenAI as OpenAI API
  participant Title as src/title-engine.js
  participant Language as src/story-language.js
  participant Storage as src/storage.js

  Pipeline->>Story: createLongformDraft(rawInput)

  alt topic is empty
    Story->>Topic: pickFreshTopic(category)
    Topic->>Format: pickFormatType()
    Format-->>Topic: formatType (listicle/deep-dive/etc)
    Topic->>Viral: pickViralAngle()
    Viral-->>Topic: viralAngle (id + label)
    Topic->>Continuity: loadHistory(80)
    Continuity->>Storage: listContextItems()
    Storage-->>Continuity: items + memory combined
    Continuity-->>Topic: compact history string
    Topic->>Trends: buildTrendingContext()
    Trends-->>Topic: trending topics for prompt
    Topic->>OpenAI: requestIdeaJson(prompt with history + trends)
    OpenAI-->>Topic: batch of 5+ topic ideas
    Topic->>Continuity: checkFreshness(each candidate)
    Continuity-->>Topic: first fresh idea
    Topic-->>Story: { topic, category, angle, formatType, viralAngle }
  else topic provided
    Story->>Format: pickFormatType()
    Story->>Viral: pickViralAngle()
  end

  Story->>Story: normalizeInput(seed)
  Story->>Wiki: fetchWikipediaFacts(topic)
  Wiki-->>Story: wiki facts + sources (CC BY-SA)
  Story->>Story: buildPrompt(input, wiki)
  Story->>OpenAI: requestKnowledgeJson(prompt)
  OpenAI-->>Story: raw plan JSON

  Story->>Story: normalizePlan(plan, input)
  Story->>Format: buildScenePattern(formatType, sceneCount)
  Format-->>Story: scene type sequence
  Story->>Format: resolveSceneType(scene, pattern)

  alt viral title enabled
    Story->>Title: generateViralTitle(plan, input)
    Title->>OpenAI: requestKnowledgeJson(title prompt)
    OpenAI-->>Title: viral title
    Title-->>Story: viral title string
  end

  alt narration too short
    Story->>OpenAI: requestKnowledgeJson(expansion prompt)
    OpenAI-->>Story: expanded plan
  end

  Story->>Language: polishPlanForLayAudience(plan)
  Language-->>Story: simplified narration
  Story->>Storage: save storyboard JSON
  Story-->>Pipeline: complete item draft
```

## 8. Media Pipeline Detail

```mermaid
sequenceDiagram
  autonumber
  participant Pipeline as src/pipeline.js
  participant Pexels as src/pexels.js
  participant PexelsAPI as Pexels API
  participant OpenAI as src/openai.js
  participant DALLE as OpenAI Images API
  participant Storage as src/storage.js
  participant Config as src/config.js

  Note over Pipeline: Phase 1 — Pexels B-roll (priority)
  Pipeline->>Config: check pexels.apiKey and pexels.preferVideo
  alt Pexels enabled
    Pipeline->>Pipeline: filter non-reaction scenes

    alt semantic selection enabled
      Pipeline->>Pexels: scoreSceneVisualConcreteness(each scene)
      Pexels-->>Pipeline: concreteness scores
      Pipeline->>Pipeline: rank scenes by score, pick top 50%
    else alternating mode
      Pipeline->>Pipeline: pick even-indexed scenes
    end

    loop each pexels scene × each visualSegment
      Pipeline->>Pipeline: check existing clips (skip if found)
      Pipeline->>Pexels: fetchPexelsClipForScene(scene)
      Pexels->>PexelsAPI: GET /videos/search?query=keywords
      PexelsAPI-->>Pexels: video results
      Pexels->>Pexels: filter by duration, relevance
      Pexels->>Pexels: download best clip to generated/clips/
      Pexels-->>Pipeline: clip metadata (path, pexelsId, segmentIndex)
      Pipeline->>Storage: saveItem(item) with new clip
      Note over Pipeline: rate limit 200ms
    end
  end

  Note over Pipeline: Phase 2 — DALL-E Images (fallback)
  Pipeline->>Pipeline: filter scenes without clips

  loop each image scene × each visualSegment
    Pipeline->>Pipeline: check existing clips OR images (skip if found)
    Pipeline->>OpenAI: generateSceneImage(scene, size, quality)
    OpenAI->>DALLE: POST /images/generations
    DALLE-->>OpenAI: base64 image data
    OpenAI->>OpenAI: save to generated/images/
    OpenAI-->>Pipeline: image metadata (path, segmentIndex)

    alt policy violation error
      Pipeline->>Pipeline: build safe fallback prompt
      Pipeline->>OpenAI: generateSceneImage(safeScene)
      OpenAI-->>Pipeline: safe image + recoveredFrom flag
    end

    Pipeline->>Storage: saveItem(item) with new image
  end
```

## 9. TTS and Subtitle Pipeline

```mermaid
sequenceDiagram
  autonumber
  participant Pipeline as src/pipeline.js
  participant ElevenLabs as src/elevenlabs.js
  participant ELAPI as ElevenLabs API
  participant OpenAITTS as src/openai.js
  participant OAIAPI as OpenAI TTS/Whisper API
  participant Util as src/util.js
  participant Cost as src/cost.js
  participant Storage as src/storage.js

  Note over Pipeline: Per-scene TTS generation
  Pipeline->>Pipeline: determine provider (elevenlabs or openai)

  loop each scene in plan.scenes
    Pipeline->>Util: normalizeTtsText(narration)
    Util-->>Pipeline: cleaned text

    alt provider is elevenlabs
      Pipeline->>ElevenLabs: generateElevenLabsSpeech(text, voiceId)
      ElevenLabs->>ELAPI: POST /text-to-speech/{voiceId}
      alt ElevenLabs success
        ELAPI-->>ElevenLabs: audio stream
        ElevenLabs-->>Pipeline: { path, url }
      else ElevenLabs fails
        ElevenLabs-->>Pipeline: error
        Note over Pipeline: fallback to OpenAI
        Pipeline->>OpenAITTS: generateOpenAiSpeech(text, voice, instructions)
        OpenAITTS->>OAIAPI: POST /audio/speech
        OAIAPI-->>OpenAITTS: audio data
        OpenAITTS-->>Pipeline: { path, url }
      end
    else provider is openai
      Pipeline->>OpenAITTS: generateOpenAiSpeech(text, voice, instructions)
      OpenAITTS->>OAIAPI: POST /audio/speech
      OAIAPI-->>OpenAITTS: audio data
      OpenAITTS-->>Pipeline: { path, url }
    end

    Note over Pipeline: Whisper transcription for subtitles
    Pipeline->>OpenAITTS: transcribeSpeechSegments(audioPath)
    OpenAITTS->>OAIAPI: POST /audio/transcriptions (whisper-1)
    OAIAPI-->>OpenAITTS: timestamped segments
    OpenAITTS-->>Pipeline: whisper segments
    Pipeline->>Util: alignCaptionsToSource(text, whisperSegments)
    Util-->>Pipeline: aligned captions [{start, end, text}]

    Pipeline->>Pipeline: accumulate sceneAudio entry
  end

  Pipeline->>Cost: estimateTtsUsd(totalChars, provider)
  Cost-->>Pipeline: ttsUsd
  Pipeline->>Storage: saveItem(item) with sceneAudio + cost

  Note over Pipeline: Cold open hook TTS (optional)
  alt cold open enabled AND plan.hook exists
    Pipeline->>Util: normalizeTtsText(plan.hook)
    Pipeline->>ElevenLabs: or OpenAITTS (same fallback logic)
    Pipeline->>Pipeline: save hookAudio to item.assets
    Pipeline->>Cost: update ttsUsd
    Pipeline->>Storage: saveItem(item)
  end
```

## 10. Thumbnail Generation Flow

```mermaid
sequenceDiagram
  autonumber
  participant Pipeline as src/pipeline.js
  participant Thumbnail as src/thumbnail.js
  participant OpenAI as src/openai.js
  participant OAIAPI as OpenAI API
  participant PureImage as pureimage (canvas)
  participant FFmpeg as ffmpeg
  participant Storage as src/storage.js

  Pipeline->>Thumbnail: generateThumbnail(item)
  Thumbnail->>Thumbnail: determine style (cinematic or vector)

  Note over Thumbnail: Step 1 — AI generates visual details
  Thumbnail->>OpenAI: requestKnowledgeJson(thumbnail prompt)
  OpenAI->>OAIAPI: POST /chat/completions
  OAIAPI-->>OpenAI: JSON { judul, temaUtama, elemenVisual }
  OpenAI-->>Thumbnail: visualDetails

  Note over Thumbnail: Step 2 — DALL-E generates thumbnail image
  Thumbnail->>Thumbnail: build DALL-E prompt from visualDetails
  Thumbnail->>OpenAI: generateSceneImage(thumbnailPrompt, 1536x1024)
  OpenAI->>OAIAPI: POST /images/generations
  OAIAPI-->>OpenAI: base64 PNG
  OpenAI-->>Thumbnail: raw image path

  Note over Thumbnail: Step 3 — FFmpeg optimization
  Thumbnail->>FFmpeg: convert PNG to optimized JPEG (quality 92)
  FFmpeg-->>Thumbnail: optimized JPEG path

  Note over Thumbnail: Step 4 — Text overlay with pureimage
  Thumbnail->>PureImage: registerFont("Bebas Neue")
  Thumbnail->>PureImage: decodeJPEGFromStream(image)
  Thumbnail->>PureImage: draw text with black outline + white fill
  Thumbnail->>PureImage: encodeJPEGToStream(output, quality 95)
  PureImage-->>Thumbnail: final thumbnail JPEG

  Thumbnail-->>Pipeline: { path, url, style }
  Pipeline->>Storage: saveItem(item) with thumbnail
```

## 11. SFTP Upload and State Sync

```mermaid
sequenceDiagram
  autonumber
  participant Runner as src/run-once.js
  participant Remote as src/remote.js
  participant Config as remoteConfig()
  participant SFTP as ssh2-sftp-client
  participant FTP as basic-ftp
  participant Storage as src/storage.js
  participant FS as filesystem

  Runner->>Remote: uploadGeneratedStateAndAssets({ item })
  Remote->>Config: assertRemoteConfig()
  Config-->>Remote: { driver, host, port, user, pass, remoteDir }

  Remote->>Remote: retryRemote(fn, 3 attempts)

  alt driver is sftp
    Remote->>SFTP: connect({ host, port, username, password/privateKey })
    SFTP-->>Remote: connected
    Remote->>SFTP: mkdir(remoteDir, recursive)
  else driver is ftp
    Remote->>FTP: access({ host, port, user, password })
    FTP-->>Remote: connected
    Remote->>FTP: ensureDir(remoteDir)
  end

  Note over Remote: Upload item-specific assets
  loop each asset (video, thumbnail, images)
    Remote->>FS: check fileExists(asset.path)
    Remote->>Remote: remotePathFromAssetUrl(asset.url)
    Remote->>SFTP: mkdir parent dir
    Remote->>SFTP: put(localPath, remotePath)
  end

  Note over Remote: Upload state files
  Remote->>FS: readFile(data/items.json)
  Remote->>SFTP: upload stream to state/items.json
  Remote->>FS: readFile(data/memory.json)
  Remote->>SFTP: upload stream to state/memory.json

  alt upload fails
    Remote->>Remote: wait (attempt × 3000ms)
    Remote->>Remote: retry (up to 3 attempts)
  end

  SFTP-->>Remote: all uploads complete
  Remote->>SFTP: end()
  Remote-->>Runner: success
```

## 12. YouTube Publish and Playlist

```mermaid
sequenceDiagram
  autonumber
  participant Runner as src/run-once.js
  participant Publisher as src/youtube-publisher.js
  participant Playlist as src/youtube-playlist.js
  participant Meta as src/youtube-meta.js
  participant Google as Google OAuth2
  participant YT as YouTube Data API v3
  participant Storage as src/storage.js
  participant Remote as src/remote.js

  Runner->>Runner: check dailyUploadLimit
  Runner->>Meta: buildTitle(item)
  Meta-->>Runner: normalized title (≤65 chars)
  Runner->>Meta: buildDescription(item)
  Meta-->>Runner: description with wiki attribution

  Runner->>Publisher: publishToYoutube({ videoPath, title, description, tags, thumbnailPath })

  Note over Publisher: Step 1 — Get access token
  Publisher->>Google: POST /token (refresh_token grant)
  Google-->>Publisher: access_token

  Note over Publisher: Step 2 — Resumable video upload
  Publisher->>YT: POST /upload/youtube/v3/videos (resumable, metadata)
  YT-->>Publisher: session URL (Location header)
  Publisher->>YT: PUT session URL (video file stream)
  YT-->>Publisher: { id: videoId, ... }

  Note over Publisher: Step 3 — Custom thumbnail upload
  alt custom thumbnail enabled
    Publisher->>Publisher: check file size (≤2MB)
    loop up to thumbnailUploadAttempts
      Publisher->>YT: POST /upload/youtube/v3/thumbnails/set (JPEG stream)
      alt success
        YT-->>Publisher: ok
      else failure
        Publisher->>Publisher: wait (attempt × 3000ms), retry
      end
    end
  end

  Publisher-->>Runner: { videoId, url, thumbnailStatus }

  Note over Runner: Step 4 — Auto-playlist
  Runner->>Publisher: getYoutubeAccessToken()
  Publisher-->>Runner: accessToken
  Runner->>Playlist: addToPlaylistByCategory({ videoId, category, accessToken })
  Playlist->>Playlist: resolve playlistId from config map
  alt playlist found for category
    Playlist->>YT: POST /youtube/v3/playlistItems
    YT-->>Playlist: inserted
  else no playlist mapping
    alt default playlist configured
      Playlist->>YT: POST /youtube/v3/playlistItems (default)
      YT-->>Playlist: inserted
    else skip
      Playlist-->>Runner: skipped
    end
  end

  Runner->>Storage: saveItem(item) with publish data
  Runner->>Storage: mergeMemoryItems([item])
  opt remote enabled
    Runner->>Remote: uploadGeneratedStateAndAssets({ item })
  end
```

## 13. Module Dependency Graph

```mermaid
graph TD
  subgraph "Entrypoints"
    RunOnce["src/run-once.js"]
    Server["src/server.js"]
    Preflight["src/preflight.js"]
    Rerender["src/rerender.js"]
    UploadOnly["src/upload-only.js"]
    SftpCleanup["src/sftp-cleanup.js"]
  end

  subgraph "Pipeline Core"
    Pipeline["src/pipeline.js"]
    StoryEngine["src/longform-story-engine.js"]
    TopicEngine["src/topic-engine.js"]
    FormatEngine["src/format-engine.js"]
    ViralAngle["src/viral-angle-library.js"]
    TitleEngine["src/title-engine.js"]
    ContinuityEngine["src/continuity-engine.js"]
    StoryLanguage["src/story-language.js"]
    Render["src/longform-render.js"]
  end

  subgraph "External APIs"
    OpenAI["src/openai.js"]
    ElevenLabs["src/elevenlabs.js"]
    PexelsModule["src/pexels.js"]
    Wikipedia["src/wikipedia.js"]
    YTPublisher["src/youtube-publisher.js"]
    YTPlaylist["src/youtube-playlist.js"]
    YTTrends["src/youtube-trends.js"]
    YTMeta["src/youtube-meta.js"]
  end

  subgraph "Infrastructure"
    Config["src/config.js"]
    Storage["src/storage.js"]
    Remote["src/remote.js"]
    Progress["src/progress.js"]
    Cost["src/cost.js"]
    Util["src/util.js"]
    Thumbnail["src/thumbnail.js"]
  end

  subgraph "Vercel API"
    ApiUtils["api/_utils.js"]
    ApiAuth["api/auth.js"]
    ApiState["api/state.js"]
    ApiRun["api/run.js"]
    ApiQueue["api/queue.js"]
    ApiPreflight["api/preflight.js"]
  end

  subgraph "Desktop App"
    YTStudio["app/yt_studio.py"]
  end

  RunOnce --> Pipeline
  RunOnce --> Remote
  RunOnce --> Storage
  RunOnce --> YTPublisher
  RunOnce --> YTPlaylist
  RunOnce --> YTMeta
  RunOnce --> Config
  RunOnce --> Progress

  Server --> Pipeline
  Server --> Storage
  Server --> StoryEngine
  Server --> Config

  Pipeline --> StoryEngine
  Pipeline --> OpenAI
  Pipeline --> PexelsModule
  Pipeline --> ElevenLabs
  Pipeline --> Render
  Pipeline --> Thumbnail
  Pipeline --> Storage
  Pipeline --> Cost
  Pipeline --> Progress
  Pipeline --> Util

  StoryEngine --> TopicEngine
  StoryEngine --> FormatEngine
  StoryEngine --> ViralAngle
  StoryEngine --> TitleEngine
  StoryEngine --> StoryLanguage
  StoryEngine --> Wikipedia
  StoryEngine --> OpenAI
  StoryEngine --> Config
  StoryEngine --> Cost
  StoryEngine --> Util

  TopicEngine --> ContinuityEngine
  TopicEngine --> FormatEngine
  TopicEngine --> ViralAngle
  TopicEngine --> StoryLanguage
  TopicEngine --> YTTrends
  TopicEngine --> OpenAI
  TopicEngine --> Util

  Render --> Config
  Render --> Util
  Render --> Progress

  Thumbnail --> OpenAI
  Thumbnail --> Config
  Thumbnail --> Util

  Remote --> Config

  ApiAuth --> ApiUtils
  ApiState --> ApiUtils
  ApiRun --> ApiUtils
  ApiQueue --> ApiUtils
  ApiPreflight --> ApiUtils

  YTStudio -.->|npm scripts| RunOnce
  YTStudio -.->|npm scripts| UploadOnly
```

## Things To Remember Next Time

- Do not treat `data/items.json` as code. It can be very large and is runtime
  state. Use schema knowledge from storage and summary commands unless a task
  specifically needs item contents.
- Do not open `.env` casually. Use `.env.example` or app/env field definitions
  unless a task explicitly requires secrets.
- Local app and Vercel dashboard are different control surfaces:
  - Vercel dashboard reads remote state and dispatches GitHub Actions.
  - Desktop app reads local `data/items.json` and runs local npm scripts.
- Progress is stdout-based. Any change to `@@PROGRESS`, `@@LOCAL_OUTPUT`, or
  `@@UPLOAD_SUCCESS` must be coordinated with `app/yt_studio.py` and
  `src/server.js` SSE parsing.
- `assertReadyToRender()` is the render gate. If media generation behavior
  changes, update `test/pipeline.test.js`.
- `data/memory.json` is compact continuity memory, not a full item archive. The
  code keeps up to 2000 compact entries.
- Wikipedia grounding adds CC BY-SA source attribution in YouTube descriptions.
  If grounding behavior changes, keep `test/grounding.test.js` aligned.
- Pexels selection is heuristic and intentionally cheap. Concrete visual
  keywords get video priority; abstract scenes fall back to images.
- Pexels candidate semantics are fully ranking-first: hard rejections are
  ONLY technical (excluded id, duration, no landscape mp4). All slug-token
  signals — query coverage AND `mustMatchTerms` — are ranking weights, never
  rejection gates. Rationale: Pexels URL slugs are often generic
  (e.g. "video-855") while the Pexels search API already returns results
  ordered by query relevance, so `selectPexelsCandidate` uses `searchRank`
  (API result order) as the tie-break when slug scores are equal (including
  all-zero). Identity protection (New York vs New Jersey) still works via
  score weights: a matching slug always outranks a mismatched one.
  `PEXELS_MIN_RELEVANCE` is deprecated and ignored.
- Clip quota is `PEXELS_CLIP_RATIO` (default 0.7): up to 70% of eligible
  visual segments get video clips, floor-rounded, minimum 1. The remaining
  segments use generated images.
- Image generation uses a 2x2 grid strategy (`IMAGE_GRID_MODE`, default on):
  each image/summary scene has exactly 4 sequential `visualSegments`, and one
  OpenAI image call produces a 2x2 photorealistic grid that
  `splitGridImage()` (FFmpeg) crops into four 1280x720 panels with a 2% gutter
  inset. Panels for segments already covered by Pexels clips are discarded.
  Grid quality is `IMAGE_GRID_QUALITY` (default medium). If a scene needs only
  1 segment, or the grid call fails after a safe-prompt retry, the pipeline
  falls back to the legacy single-image-per-segment path
  (`generateSceneImage`). `IMAGE_GRID_MODE=off` restores the legacy behavior
  entirely. Grid behavior tests live in `test/grid-image.test.js`.
- Visual switches are synced to speech: `computeSegmentDurations()` in
  `longform-render.js` matches each visualSegment's `narrativeContext`
  (a verbatim 3-8 word phrase from the scene narration, enforced by the
  storyboard prompt) against the word timeline interpolated from
  `sceneCaptions` (Whisper timings), so images change exactly when that idea
  is spoken. Falls back to equal split when captions are missing, phrases
  don't match (score < 0.5), or ordering can't be kept monotonic with the
  minimum sub-segment duration. Tests: `test/segment-sync.test.js`.
- Storyboard prompt enforces knowledge beats (one question per scene in
  beatPurpose, one claim + one concrete evidence, hook ending per scene) and
  chapter-opening scenes must start with a question/prediction that is
  answered progressively across the chapter.
- YouTube publish is resumable upload followed by optional thumbnail upload and
  optional playlist insert.
- SFTP cleanup intentionally avoids `state/` and `thumbnails/`; it sweeps media
  directories only.
- **Graphify knowledge graph** is available at `graphify-out/`. Run
  `graphify extract . --code-only --no-cluster` to refresh after code changes.
  Use `graphify god-nodes` to identify architectural hubs.
- **PRD** is at `docs/PRD.md` — comprehensive product requirements document.
- **AGENTS.md** at project root provides AI agent instructions and conventions.
