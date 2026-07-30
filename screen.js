(() => {
    if (window.__feedforgeConnectLoaded) return;
    window.__feedforgeConnectLoaded = true;

    let song = null;
    let run = null;
    let armedRun = null;
    let autoplayRelease = null;
    let setupDialog = null;
    let songReady = false;
    let mode = 'idle';
    const relevantSettings = [
        'method', 'timing_tolerance_s', 'timing_hit_threshold_s',
        'chord_timing_hit_threshold_s', 'pitch_tolerance_cents',
        'pitch_hit_threshold_cents', 'chord_hit_ratio', 'detection_confidence_min',
    ];
    const rankedSettings = {
        method: 'yin', timing_tolerance_s: 0.15, timing_hit_threshold_s: 0.1,
        chord_timing_hit_threshold_s: 0.15, pitch_tolerance_cents: 50,
        pitch_hit_threshold_cents: 20, chord_hit_ratio: 0.4, detection_confidence_min: 0.2,
    };

    const detail = event => event && event.detail || event || {};
    const speed = () => Number(document.getElementById('speed-slider')?.value || 100) / 100;
    const loopActive = () => {
        try {
            const loop = window.feedBack?.getLoop?.();
            return loop?.loopA != null && loop?.loopB != null;
        } catch (_) { return false; }
    };
    const diagnostic = () => {
        try { return window.noteDetect?.getDiagnostic?.() || null; }
        catch (_) { return null; }
    };
    const chart = () => {
        try { return window.noteDetect?._trainingChartSnapshot?.() || {}; }
        catch (_) { return {}; }
    };
    const settingsEqual = (a, b) => relevantSettings.every(key => a?.[key] === b?.[key]);
    const settingsCompetitive = settings => settings?.method === rankedSettings.method
        && ['timing_tolerance_s', 'timing_hit_threshold_s', 'chord_timing_hit_threshold_s', 'pitch_tolerance_cents', 'pitch_hit_threshold_cents']
            .every(key => Number(settings[key]) > 0 && Number(settings[key]) <= rankedSettings[key])
        && Number(settings.chord_hit_ratio) >= rankedSettings.chord_hit_ratio && Number(settings.chord_hit_ratio) <= 1
        && Number(settings.detection_confidence_min) >= rankedSettings.detection_confidence_min && Number(settings.detection_confidence_min) <= 1;
    const ensureStyles = () => {
        if (!document.getElementById('feedforge-result-style')) {
            const style = document.createElement('style');
            style.id = 'feedforge-result-style';
            style.textContent = `
                .ff-result-backdrop{box-sizing:border-box;position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:24px;border:0;background:transparent;font-family:Inter,Segoe UI,sans-serif;color:#f4f8ff}.ff-result-backdrop[open]{display:grid;place-items:center}.ff-result-backdrop::backdrop{background:rgba(2,6,12,.78);backdrop-filter:blur(10px)}
                .ff-result{width:min(620px,100%);max-height:calc(100vh - 48px);overflow:auto;background:linear-gradient(145deg,#111a29 0%,#090e17 72%);border:1px solid #263a54;border-radius:16px;box-shadow:0 28px 90px rgba(0,0,0,.62),0 0 0 1px rgba(103,199,255,.05) inset}
                .ff-result-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px 14px;border-bottom:1px solid rgba(117,151,190,.15)}
                .ff-result-kicker{font-size:11px;font-weight:800;letter-spacing:.2em;color:#65c9ff;text-transform:uppercase}
                .ff-result-close{width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:#8192aa;font-size:24px;line-height:1;cursor:pointer}.ff-result-close:hover{background:#182337;color:#fff}
                .ff-result-main{padding:26px 28px 20px}
                .ff-result-hero{display:grid;grid-template-columns:112px 1fr;gap:24px;align-items:center}
                .ff-result-grade{height:112px;display:grid;place-content:center;text-align:center;border:1px solid #3e79a6;border-radius:14px;background:radial-gradient(circle at 30% 20%,#244c72,#122238 68%);box-shadow:0 0 32px rgba(54,169,238,.12)}
                .ff-result-grade span,.ff-result-score span,.ff-result-stat span{display:block;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8297b3}
                .ff-result-grade strong{font-size:52px;line-height:1;color:#84d7ff;text-shadow:0 0 22px rgba(86,196,255,.38)}
                .ff-result-score strong{display:block;margin:3px 0 8px;font-size:42px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.03em}
                .ff-result-song{font-size:17px;font-weight:750;color:#f8fbff}.ff-result-arrangement{margin-top:4px;font-size:13px;color:#91a3ba}
                .ff-result-stats{display:grid;grid-template-columns:repeat(4,1fr);margin-top:26px;border-top:1px solid rgba(117,151,190,.17);border-bottom:1px solid rgba(117,151,190,.17)}
                .ff-result-stat{padding:17px 14px;border-right:1px solid rgba(117,151,190,.17)}.ff-result-stat:first-child{padding-left:0}.ff-result-stat:last-child{border-right:0}
                .ff-result-stat strong{display:block;margin-top:6px;font-size:18px;font-variant-numeric:tabular-nums}
                .ff-result-status{display:flex;gap:11px;align-items:flex-start;margin-top:20px;padding:13px 15px;border-radius:9px;font-size:13px;line-height:1.45;background:#101d2a;color:#a9bdd3;border-left:3px solid #47bfff}
                .ff-result-status.is-error{background:#24171b;color:#efbec6;border-left-color:#f26b7a}.ff-result-status b{color:#dff5ff}.ff-result-status.is-error b{color:#ffdce1}
                .ff-result-actions{display:flex;justify-content:flex-end;gap:10px;padding:18px 28px 24px}
                .ff-result-actions button{min-height:42px;padding:0 18px;border-radius:9px;font:700 13px/1 Inter,Segoe UI,sans-serif;cursor:pointer}
                .ff-result-local{border:1px solid #34455d;background:#121b2a;color:#c6d2e1}.ff-result-local:hover{background:#19263a}
                .ff-result-upload{border:1px solid #69cfff;background:linear-gradient(135deg,#45bdf5,#6e8cff);color:#05111d;box-shadow:0 8px 24px rgba(64,174,239,.2)}.ff-result-upload:hover{filter:brightness(1.08)}
                .ff-ranked-intro{margin:0 0 20px;color:#a8b7ca;font-size:14px;line-height:1.55}.ff-ranked-field{display:grid;gap:8px}.ff-ranked-field label{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8297b3}.ff-ranked-field select{width:100%;min-height:46px;padding:0 13px;border:1px solid #344b68;border-radius:9px;background:#0d1522;color:#f4f8ff;font:700 14px Inter,Segoe UI,sans-serif}.ff-ranked-hint{margin-top:18px;color:#7f91a9;font-size:12px;line-height:1.5}.ff-ranked-error{margin-top:18px;padding:12px 14px;border-left:3px solid #f26b7a;border-radius:8px;background:#24171b;color:#efbec6;font-size:13px}.ff-ranked-lock{position:fixed;inset:0;z-index:190;background:transparent;cursor:none}.ff-ranked-badge{position:fixed;z-index:191;top:22px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:9px;padding:10px 15px;border:1px solid #275675;border-radius:999px;background:rgba(7,15,25,.9);box-shadow:0 10px 34px rgba(0,0,0,.35);color:#dff5ff;font:800 11px/1 Inter,Segoe UI,sans-serif;letter-spacing:.12em;text-transform:uppercase;pointer-events:none}.ff-ranked-badge::before{content:'';width:8px;height:8px;border-radius:50%;background:#ff5f70;box-shadow:0 0 14px #ff5f70}body.ff-ranked-active #player-controls,body.ff-ranked-active #v3-railzone{opacity:0!important;pointer-events:none!important}
                @media(max-width:560px){.ff-result-hero{grid-template-columns:82px 1fr;gap:16px}.ff-result-grade{height:82px}.ff-result-grade strong{font-size:38px}.ff-result-score strong{font-size:34px}.ff-result-stats{grid-template-columns:repeat(2,1fr)}.ff-result-stat:nth-child(2){border-right:0}.ff-result-stat:nth-child(-n+2){border-bottom:1px solid rgba(117,151,190,.17)}}
            `;
            document.head.appendChild(style);
        }
    };

    const setRankedLock = (active, arrangementName = '') => {
        document.body.classList.toggle('ff-ranked-active', active);
        document.querySelector('[data-feedforge-ranked-lock]')?.remove();
        document.querySelector('[data-feedforge-ranked-badge]')?.remove();
        if (!active) return;
        ensureStyles();
        const lock = document.createElement('div');
        lock.className = 'ff-ranked-lock';
        lock.dataset.feedforgeRankedLock = '';
        lock.setAttribute('aria-hidden', 'true');
        const badge = document.createElement('div');
        badge.className = 'ff-ranked-badge';
        badge.dataset.feedforgeRankedBadge = '';
        badge.textContent = `Ranked recording${arrangementName ? ` · ${arrangementName}` : ''}`;
        document.body.append(lock, badge);
    };

    const releaseHeldAutoplay = () => {
        if (!autoplayRelease) return;
        const release = autoplayRelease;
        autoplayRelease = null;
        release();
    };

    const showResultDialog = ({ finished, result, arrangementName, challenge }) => new Promise(resolve => {
        document.querySelector('[data-feedforge-result]')?.remove();
        ensureStyles();

        const uploadable = Boolean(challenge?.data?.runId);
        const hits = Number(result.hits || 0);
        const misses = Number(result.misses || 0);
        const backdrop = document.createElement('dialog');
        backdrop.className = 'ff-result-backdrop';
        backdrop.dataset.feedforgeResult = '';
        backdrop.setAttribute('aria-labelledby', 'ff-result-title');
        backdrop.innerHTML = `
            <section class="ff-result">
                <header class="ff-result-head"><div class="ff-result-kicker">FeedForge run result</div><button class="ff-result-close" type="button" aria-label="Close">&times;</button></header>
                <div class="ff-result-main">
                    <div class="ff-result-hero">
                        <div class="ff-result-grade"><span>Grade</span><strong data-grade></strong></div>
                        <div class="ff-result-score"><span>Final score</span><strong data-score></strong><div class="ff-result-song" id="ff-result-title" data-song></div><div class="ff-result-arrangement" data-arrangement></div></div>
                    </div>
                    <div class="ff-result-stats">
                        <div class="ff-result-stat"><span>Accuracy</span><strong data-accuracy></strong></div>
                        <div class="ff-result-stat"><span>Notes hit</span><strong data-hits></strong></div>
                        <div class="ff-result-stat"><span>Best streak</span><strong data-streak></strong></div>
                        <div class="ff-result-stat"><span>Multiplier</span><strong data-multiplier></strong></div>
                    </div>
                    <div class="ff-result-status${uploadable ? '' : ' is-error'}" data-status></div>
                </div>
                <footer class="ff-result-actions"><button class="ff-result-local" type="button" data-local>${uploadable ? 'Keep local' : 'Close'}</button><button class="ff-result-upload" type="button" data-upload${uploadable ? '' : ' hidden'}>Upload result</button></footer>
            </section>`;
        const text = (selector, value) => { backdrop.querySelector(selector).textContent = value; };
        text('[data-grade]', result.grade || 'F');
        text('[data-score]', Number(result.score || 0).toLocaleString());
        text('[data-song]', finished.song.title || finished.song.name || 'Finished run');
        text('[data-arrangement]', arrangementName ? `${arrangementName} arrangement` : 'Current arrangement');
        text('[data-accuracy]', `${Number(result.accuracy || 0)}%`);
        text('[data-hits]', `${hits} / ${hits + misses}`);
        text('[data-streak]', Number(result.bestStreak || 0).toLocaleString());
        text('[data-multiplier]', `x${Number(result.maxMultiplier || 1)}`);
        const status = backdrop.querySelector('[data-status]');
        status.innerHTML = uploadable
            ? '<span aria-hidden="true">&#10003;</span><div><b>Eligible run captured</b><br>Upload to let FeedForge Hub complete competitive validation.</div>'
            : '<span aria-hidden="true">!</span><div><b>Not eligible for upload</b><br><span data-reason></span></div>';
        if (!uploadable) text('[data-reason]', challenge?.errorDescription || challenge?.error || 'Ranked run was not started.');

        const previousFocus = document.activeElement;
        const close = accepted => {
            backdrop.close();
            backdrop.remove();
            previousFocus?.focus?.();
            resolve(accepted);
        };
        backdrop.querySelector('[data-upload]').addEventListener('click', () => close(true));
        backdrop.querySelector('[data-local]').addEventListener('click', () => close(false));
        backdrop.querySelector('.ff-result-close').addEventListener('click', () => close(false));
        backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close(false); });
        backdrop.addEventListener('cancel', event => { event.preventDefault(); close(false); });
        document.body.appendChild(backdrop);
        backdrop.showModal();
        backdrop.querySelector(uploadable ? '[data-upload]' : '[data-local]').focus();
    });

    const showUploadOutcome = outcome => new Promise(resolve => {
        const accepted = Boolean(outcome?.ok && outcome?.data?.accepted);
        const queued = Boolean(outcome?.queued);
        const backdrop = document.createElement('dialog');
        backdrop.className = 'ff-result-backdrop';
        backdrop.dataset.feedforgeResult = '';
        const title = accepted ? 'Result uploaded' : queued ? 'Upload queued' : 'Result not uploaded';
        const message = accepted
            ? `Your score of ${Number(outcome.data.score || 0).toLocaleString()} is now on the scoreboard.`
            : queued
                ? (outcome.error || 'FeedForge is temporarily unavailable. This result will retry automatically.')
                : (outcome?.errorDescription || outcome?.error || 'FeedForge rejected this result.');
        backdrop.innerHTML = `
            <section class="ff-result">
                <header class="ff-result-head"><div class="ff-result-kicker">FeedForge ranked</div><button class="ff-result-close" type="button" aria-label="Close">&times;</button></header>
                <div class="ff-result-main">
                    <div class="ff-result-status${accepted || queued ? '' : ' is-error'}"><span aria-hidden="true">${accepted ? '&#10003;' : queued ? '&#8635;' : '!'}</span><div><b data-title></b><br><span data-message></span></div></div>
                </div>
                <footer class="ff-result-actions"><button class="ff-result-local" type="button" data-close>Close</button></footer>
            </section>`;
        backdrop.querySelector('[data-title]').textContent = title;
        backdrop.querySelector('[data-message]').textContent = message;
        const close = () => { backdrop.close(); backdrop.remove(); resolve(); };
        backdrop.querySelector('[data-close]').addEventListener('click', close);
        backdrop.querySelector('.ff-result-close').addEventListener('click', close);
        backdrop.addEventListener('cancel', event => { event.preventDefault(); close(); });
        document.body.appendChild(backdrop);
        backdrop.showModal();
        backdrop.querySelector('[data-close]').focus();
    });

    const choosePractice = () => {
        mode = 'practice';
        armedRun = null;
        setupDialog?.close();
        setupDialog?.remove();
        setupDialog = null;
        releaseHeldAutoplay();
    };

    const showSetupError = message => {
        if (!setupDialog) return;
        const error = setupDialog.querySelector('[data-setup-error]');
        error.textContent = message;
        error.hidden = false;
        setupDialog.querySelector('[data-start-ranked]').disabled = false;
    };

    const armRanked = async () => {
        if (mode !== 'arming' || !songReady || !song || !setupDialog) return;
        mode = 'checking';
        const arrangementIndex = Number(setupDialog.querySelector('[data-arrangement]').value || 0);
        const selectedOption = setupDialog.querySelector('[data-arrangement]').selectedOptions[0];
        const arrangementName = (selectedOption?.textContent || song.arrangementSmartName || song.arrangement || '').replace(/\s+\(\d+\)$/, '');
        for (const id of ['speed-slider', 'mastery-slider']) {
            const input = document.getElementById(id);
            if (input && input.value !== '100') {
                input.value = '100';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        window.feedBack?.clearLoop?.({ reason: 'feedforge-ranked-start' });
        await Promise.resolve(window.feedBack?.seek?.(0, 'feedforge-ranked-start')).catch(() => {});
        const d = diagnostic();
        const c = chart();
        if (d?.plugin_version !== '1.32.0') {
            mode = 'choosing';
            showSetupError('Ranked play requires Note Detection 1.32.0.');
            return;
        }
        if (!settingsCompetitive(d.settings)) {
            mode = 'choosing';
            showSetupError('Note Detection settings must stay within the competitive limits. Stricter tolerances are allowed.');
            return;
        }
        const challenge = await fetch('/api/plugins/feedforge_connect/run/start', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: song.filename, arrangementIndex }),
        }).then(response => response.json()).catch(() => ({ ok: false, error: 'FeedForge Hub is unavailable.' }));
        if (mode !== 'checking') return;
        if (!challenge?.data?.runId) {
            mode = 'choosing';
            showSetupError(challenge?.errorDescription || challenge?.error || 'This chart is not eligible for ranked play.');
            return;
        }
        armedRun = {
            song: { ...song, arrangementIndex, arrangementSmartName: arrangementName },
            settings: d?.settings || null,
            mastery: c.mastery == null ? null : Math.round(Number(c.mastery) * (Number(c.mastery) <= 1 ? 100 : 1)),
            hasPhraseData: Boolean(c.hasPhraseData),
            playbackRate: speed(),
            challenge: Promise.resolve(challenge),
        };
        mode = 'armed';
        setRankedLock(true, arrangementName);
        setupDialog.close();
        setupDialog.remove();
        setupDialog = null;
        releaseHeldAutoplay();
        window.setTimeout(() => {
            if (mode === 'armed' && !window.feedBack?.isPlaying) document.getElementById('btn-play')?.click();
        }, 100);
    };

    const showRankedSetup = () => {
        if (!song || setupDialog) return;
        ensureStyles();
        const hostArrangement = document.getElementById('arr-select');
        const options = Array.from(hostArrangement?.options || []).map(option => ({ value: option.value, label: option.textContent || option.value }));
        if (!options.length) options.push({ value: String(song.arrangementIndex || 0), label: song.arrangementSmartName || song.arrangement || 'Current arrangement' });
        setupDialog = document.createElement('dialog');
        setupDialog.className = 'ff-result-backdrop';
        setupDialog.dataset.feedforgeSetup = '';
        setupDialog.setAttribute('aria-labelledby', 'ff-ranked-title');
        setupDialog.innerHTML = `
            <section class="ff-result">
                <header class="ff-result-head"><div class="ff-result-kicker">FeedForge ranked</div><button class="ff-result-close" type="button" aria-label="Play normally">&times;</button></header>
                <div class="ff-result-main">
                    <div class="ff-result-song" id="ff-ranked-title">Record a ranked score?</div>
                    <p class="ff-ranked-intro">Choose the arrangement before playback. Ranked mode locks the player controls and records one uninterrupted run; you still choose whether to upload after seeing the result.</p>
                    <div class="ff-ranked-field"><label for="ff-ranked-arrangement">Arrangement</label><select id="ff-ranked-arrangement" data-arrangement></select></div>
                    <div class="ff-ranked-error" data-setup-error hidden></div>
                    <div class="ff-ranked-hint">Practice mode leaves every FeedBack control available.</div>
                </div>
                <footer class="ff-result-actions"><button class="ff-result-local" type="button" data-practice>Play normally</button><button class="ff-result-upload" type="button" data-start-ranked>Start ranked run</button></footer>
            </section>`;
        const select = setupDialog.querySelector('[data-arrangement]');
        options.forEach(option => select.add(new Option(option.label, option.value)));
        select.value = String(song.arrangementIndex ?? hostArrangement?.value ?? options[0].value);
        const start = setupDialog.querySelector('[data-start-ranked]');
        start.addEventListener('click', () => {
            start.disabled = true;
            setupDialog.querySelector('[data-setup-error]').hidden = true;
            mode = 'arming';
            const arrangementIndex = Number(select.value || 0);
            if (arrangementIndex !== Number(song.arrangementIndex || 0) && hostArrangement) {
                songReady = false;
                hostArrangement.value = String(arrangementIndex);
                hostArrangement.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }
            void armRanked();
        });
        setupDialog.querySelector('[data-practice]').addEventListener('click', choosePractice);
        setupDialog.querySelector('.ff-result-close').addEventListener('click', choosePractice);
        setupDialog.addEventListener('cancel', event => { event.preventDefault(); choosePractice(); });
        document.body.appendChild(setupDialog);
        setupDialog.showModal();
        start.focus();
    };

    window.feedBack?.on('song:loading', () => {
        setupDialog?.remove();
        setupDialog = null;
        setRankedLock(false);
        song = null;
        run = null;
        armedRun = null;
        songReady = false;
        mode = 'choosing';
        autoplayRelease = window.feedBack?.holdAutoplay?.() || null;
        autoplayRelease?.settle?.();
    });
    window.feedBack?.on('song:loaded', event => {
        song = detail(event);
        if (mode === 'choosing') showRankedSetup();
    });
    window.feedBack?.on('song:ready', () => {
        songReady = true;
        void armRanked();
    });
    window.feedBack?.on('arrangement:changed', event => {
        songReady = false;
        if (song) song.arrangementIndex = detail(event).index;
        if (mode === 'ranked' && run) run.hadSeek = true;
    });
    window.feedBack?.on('song:play', event => {
        if (mode !== 'armed' || !armedRun || run) return;
        run = {
            ...armedRun,
            startedAt: performance.now(),
            hadSeek: Number(detail(event).time || 0) > 1.5,
            hadLoop: loopActive(),
            hadPause: false,
            settingsChanged: false,
            naturalEnd: false,
        };
        armedRun = null;
        mode = 'ranked';
    });
    window.feedBack?.on('song:seek', () => { if (run) run.hadSeek = true; });
    window.feedBack?.on('song:pause', () => { if (run) run.hadPause = true; });
    window.feedBack?.on('song:ended', () => { if (run) run.naturalEnd = true; });
    window.feedBack?.on('song:stop', () => {
        if (run) run.naturalEnd = false;
        setRankedLock(false);
        releaseHeldAutoplay();
        mode = 'idle';
        armedRun = null;
    });
    document.addEventListener('input', event => {
        if (run && event.target?.id === 'speed-slider' && speed() !== run.playbackRate) run.settingsChanged = true;
    });
    document.addEventListener('keydown', event => {
        if ((mode === 'armed' || mode === 'ranked') && event.key !== 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    window.addEventListener('notedetect:session', event => {
        const finished = run;
        if (!finished) return;
        window.setTimeout(async () => {
            setRankedLock(false);
            mode = 'result';
            const result = detail(event);
            const d = diagnostic();
            const challenge = await finished.challenge;
            const arrangementName = finished.song.arrangementSmartName || result.arrangement || finished.song.arrangement || null;
            const accepted = await showResultDialog({ finished, result, arrangementName, challenge });
            if (!challenge?.data?.runId) {
                window.feedBack?.emit?.('feedforge:score-submitted', challenge || { ok: false, error: 'Ranked run was not started.' });
                if (run === finished) run = null;
                mode = 'practice';
                return;
            }
            if (!accepted) {
                window.feedBack?.emit?.('feedforge:score-declined', { ok: true, uploaded: false });
                if (run === finished) run = null;
                mode = 'practice';
                return;
            }
            finished.hadLoop ||= loopActive();
            finished.settingsChanged ||= !settingsEqual(finished.settings, d?.settings) || speed() !== finished.playbackRate;
            const payload = {
                filename: finished.song.filename,
                score: {
                    runId: challenge.data.runId,
                    arrangementIndex: Number(challenge.data.arrangementIndex ?? finished.song.arrangementIndex ?? 0),
                    arrangementName,
                    score: Number(result.score || 0), accuracy: Number(result.accuracy || 0),
                    hits: Number(result.hits || 0), misses: Number(result.misses || 0),
                    bestStreak: Number(result.bestStreak || 0), maxMultiplier: Number(result.maxMultiplier || 1),
                    singleHits: Number(d?.summary?.singles?.hits || 0), chordHits: Number(d?.summary?.chords?.hits || 0),
                    grade: result.grade || 'F', fullCombo: Boolean(result.fullCombo),
                    mastery: finished.mastery, hasPhraseData: finished.hasPhraseData,
                    playbackRate: finished.playbackRate, naturalEnd: finished.naturalEnd,
                    hadSeek: finished.hadSeek, hadLoop: finished.hadLoop,
                    hadPause: finished.hadPause,
                    settingsChanged: finished.settingsChanged,
                    runDurationMs: Math.round(performance.now() - finished.startedAt),
                    noteDetectVersion: d?.plugin_version || 'unknown', feedbackVersion: null,
                    playedAt: result.timestamp || new Date().toISOString(), settings: d?.settings || {},
                },
            };
            try {
                const response = await fetch('/api/plugins/feedforge_connect/submit', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
                });
                const body = await response.json();
                await showUploadOutcome(body);
                window.feedBack?.emit?.('feedforge:score-submitted', body);
            } catch (error) {
                console.warn('[feedforge_connect] score submission failed', error);
                await showUploadOutcome({ ok: false, error: 'The result could not be sent to FeedForge.' });
            } finally {
                if (run === finished) run = null;
                mode = 'practice';
            }
        }, 0);
    });

    fetch('/api/plugins/feedforge_connect/retry', { method: 'POST' }).catch(() => {});
})();
