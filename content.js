/* =============================================
   CF Problem Tracker — Content Script v4
   Clean card on CF profile sidebar
   - Hero solved count
   - Stats grid (submissions, AC rate, per day)
   - Date range picker (From → To)
   - Rating breakdown bar chart
   - Tags breakdown bar chart
   ============================================= */

(function () {
  'use strict';

  const profileMatch = window.location.pathname.match(/^\/profile\/([^/]+)/);
  if (!profileMatch) return;
  const handle = profileMatch[1];

  const TIMEOUT = 15000;
  const CACHE_KEY = `cfpt_${handle}`;
  const CACHE_TTL = 10 * 60 * 1000;

  /* ── Rating colors (CF Tracker style) ───────── */
  function getRatingColor(r) {
    if (!r || r === 'Unrated') return '#cccccc';
    if (r < 1200) return '#cccccc'; // Gray
    if (r < 1400) return '#77ff77'; // Green
    if (r < 1600) return '#77ddbb'; // Cyan
    if (r < 1900) return '#aaaaff'; // Blue
    if (r < 2100) return '#ff88ff'; // Violet
    if (r < 2400) return '#ffcc88'; // Orange
    return '#ff7777'; // Red
  }

  /* ── Tag colors ─────────────────────────────── */
  const TAG_COLORS = [
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
    '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
    '#0ea5e9', '#3b82f6', '#2563eb',
  ];
  function getTagColor(i) { return TAG_COLORS[i % TAG_COLORS.length]; }

  /* ── Fetch helpers ──────────────────────────── */
  function fetchT(url) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), TIMEOUT);
    return fetch(url, { signal: c.signal })
      .then((r) => { clearTimeout(t); return r; })
      .catch((e) => { clearTimeout(t); throw e; });
  }

  async function getSubs() {
    try {
      const s = await new Promise((res) => {
        chrome.storage.local.get(CACHE_KEY, (r) => {
          if (chrome.runtime.lastError) return res(null);
          res(r[CACHE_KEY] || null);
        });
      });
      if (s && s.data && Date.now() - s.ts < CACHE_TTL) return s.data;
    } catch (_) {}

    const r = await fetchT(
      `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=10000`
    );
    const j = await r.json();
    if (j.status !== 'OK') throw new Error(j.comment || 'API error');

    try { chrome.storage.local.set({ [CACHE_KEY]: { data: j.result, ts: Date.now() } }); } catch (_) {}
    return j.result;
  }

  /* ── Date helpers ───────────────────────────── */
  function toYMD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function daysBetween(d1, d2) {
    return Math.max(1, Math.round(Math.abs(d2 - d1) / 864e5));
  }

  /* ── Process — filter by timestamp range ────── */
  function process(subs, fromTs, toTs) {
    const fromSec = Math.floor(fromTs / 1000);
    const toSec = Math.floor(toTs / 1000);

    const recent = subs.filter((s) => s.creationTimeSeconds >= fromSec && s.creationTimeSeconds <= toSec);

    const ac = new Set();
    const daily = {};
    const rd = {};
    const tags = {};
    const problems = [];

    recent.forEach((s) => {
      if (s.verdict !== 'OK') return;
      const k = `${s.problem.contestId}-${s.problem.index}`;
      if (ac.has(k)) return;
      ac.add(k);

      const ds = new Date(s.creationTimeSeconds * 1000).toISOString().slice(0, 10);
      daily[ds] = (daily[ds] || 0) + 1;

      const rating = s.problem.rating || 'Unrated';
      rd[rating] = (rd[rating] || 0) + 1;

      const pTags = s.problem.tags || [];
      if (pTags.length > 0) {
        pTags.forEach((tag) => {
          tags[tag] = (tags[tag] || 0) + 1;
        });
      }

      problems.push({ rating, tags: pTags });
    });

    return { solved: ac.size, total: recent.length, daily, rd, tags, problems };
  }

  /* ══════════════════════════════════════════════
     BUILD WIDGET
     ══════════════════════════════════════════════ */
  function build(subs) {

    const w = document.createElement('div');
    w.id = 'cfpt-widget';
    w.className = 'cfpt-widget';

    // ── Header
    const hdr = document.createElement('div');
    hdr.className = 'cfpt-header';

    const titleRow = document.createElement('div');
    titleRow.className = 'cfpt-title-row';
    titleRow.innerHTML = `<div class="cfpt-logo">PT</div><span class="cfpt-title">Problem Tracker</span>`;

    // Date range controls
    const rangeWrap = document.createElement('div');
    rangeWrap.className = 'cfpt-range-wrap';

    const fromInput = document.createElement('input');
    fromInput.type = 'date';
    fromInput.className = 'cfpt-date-input';
    fromInput.id = 'cfpt-from';

    const toInput = document.createElement('input');
    toInput.type = 'date';
    toInput.className = 'cfpt-date-input';
    toInput.id = 'cfpt-to';

    // Default: last 30 days
    const now = new Date();
    const ago30 = new Date(now.getTime() - 30 * 864e5);
    fromInput.value = toYMD(ago30);
    toInput.value = toYMD(now);

    // Find the earliest submission date for min
    if (subs.length > 0) {
      const earliest = Math.min(...subs.map(s => s.creationTimeSeconds));
      fromInput.min = toYMD(new Date(earliest * 1000));
    }
    fromInput.max = toYMD(now);
    toInput.max = toYMD(now);

    const arrow = document.createElement('span');
    arrow.className = 'cfpt-range-arrow';
    arrow.textContent = '→';

    const fromLabel = document.createElement('span');
    fromLabel.className = 'cfpt-range-label';
    fromLabel.textContent = 'From';

    const toLabel = document.createElement('span');
    toLabel.className = 'cfpt-range-label';
    toLabel.textContent = 'To';

    rangeWrap.appendChild(fromLabel);
    rangeWrap.appendChild(fromInput);
    rangeWrap.appendChild(arrow);
    rangeWrap.appendChild(toLabel);
    rangeWrap.appendChild(toInput);

    hdr.appendChild(titleRow);
    hdr.appendChild(rangeWrap);
    w.appendChild(hdr);

    // ── Body
    const body = document.createElement('div');
    body.className = 'cfpt-body';
    w.appendChild(body);

    /* ── Render for selected date range ────────── */
    function render() {
      const fromDate = new Date(fromInput.value + 'T00:00:00');
      const toDate = new Date(toInput.value + 'T23:59:59');

      if (isNaN(fromDate) || isNaN(toDate)) return;

      const days = daysBetween(fromDate, toDate);
      const d = process(subs, fromDate.getTime(), toDate.getTime());
      body.innerHTML = '';

      // Top Area
      const topArea = document.createElement('div');
      topArea.className = 'cfpt-top-area';

      // Hero
      const hero = document.createElement('div');
      hero.className = 'cfpt-hero';

      let periodText;
      if (days <= 1) periodText = '1 day';
      else if (days <= 60) periodText = days + ' days';
      else if (days < 365) periodText = Math.round(days / 30) + ' months';
      else periodText = (days / 365).toFixed(1) + ' years';

      hero.innerHTML = `
        <span class="cfpt-hero-num">${d.solved}</span>
        <span class="cfpt-hero-text">problems solved in <strong>${periodText}</strong></span>
      `;
      topArea.appendChild(hero);

      // Stats grid
      const stats = document.createElement('div');
      stats.className = 'cfpt-stats';

      const sData = [
        { v: d.total, l: 'Submissions', c: '#6366f1' },
        { v: (d.solved / Math.max(days, 1)).toFixed(1), l: 'Per Day', c: '#f59e0b' },
      ];
      sData.forEach((s) => {
        const card = document.createElement('div');
        card.className = 'cfpt-stat';
        card.innerHTML = `<span class="cfpt-stat-val" style="color:${s.c}">${s.v}</span><span class="cfpt-stat-lbl">${s.l}</span>`;
        stats.appendChild(card);
      });
      topArea.appendChild(stats);
      body.appendChild(topArea);

      // ── Two-column breakdowns ──
      const brkRow = document.createElement('div');
      brkRow.className = 'cfpt-brk-row';

      // ── Rating Breakdown (left) ──
      const rtWrap = document.createElement('div');
      rtWrap.className = 'cfpt-brk-col';

      const rtTitle = document.createElement('div');
      rtTitle.className = 'cfpt-sec-title';
      rtTitle.innerHTML = '<span>🏆</span> Rating Breakdown';
      rtWrap.appendChild(rtTitle);

      const rtBox = document.createElement('div');
      rtBox.className = 'cfpt-ratings';

      // ── Tags Breakdown (right) ──
      const tgWrap = document.createElement('div');
      tgWrap.className = 'cfpt-brk-col';

      const tgTitle = document.createElement('div');
      tgTitle.className = 'cfpt-sec-title';
      tgTitle.innerHTML = '<span>🏷️</span> Tags Breakdown';
      tgWrap.appendChild(tgTitle);

      const tgBox = document.createElement('div');
      tgBox.className = 'cfpt-tags';

      const activeRatings = new Set();
      const activeTags = new Set();

      const allRatingsList = Object.keys(d.rd).filter(k => k !== 'Unrated').map(Number).sort((a, b) => a - b);
      if (d.rd['Unrated']) allRatingsList.push('Unrated');

      const maxGlobalRatingCount = allRatingsList.length > 0 ? Math.max(...allRatingsList.map(r => d.rd[r])) : 1;

      function renderRatings(rdData) {
        rtBox.innerHTML = '';
        let hasAny = false;

        allRatingsList.forEach((rating) => {
          const count = rdData[rating] || 0;
          hasAny = true;

          const col = document.createElement('div');
          col.className = 'cfpt-rt-col cfpt-rt-clickable';
          if (activeRatings.has(rating)) col.classList.add('cfpt-rt-active');
          col.title = `Click to toggle tags for ${rating}`;

          const color = rating === 'Unrated' ? '#888' : getRatingColor(rating);
          const pct = (count / maxGlobalRatingCount) * 100;
          const opacity = count === 0 ? '0.3' : '1';

          col.innerHTML = `
            <span class="cfpt-rt-count" style="opacity:${opacity}">${count}</span>
            <div class="cfpt-rt-bar-bg"><div class="cfpt-rt-bar-fill" style="height:${pct}%;background:${color};border:1px solid rgba(0,0,0,0.15)"></div></div>
            <span class="cfpt-rt-label" style="opacity:${opacity}">${rating}</span>
          `;

          col.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeRatings.has(rating)) activeRatings.delete(rating);
            else activeRatings.add(rating);
            updateCharts();
          });

          rtBox.appendChild(col);
        });

        if (!hasAny) {
          rtBox.innerHTML = '<div class="cfpt-empty">No rated problems in this period</div>';
        }

        if (activeTags.size > 0) {
          const totalInTags = allRatingsList.reduce((sum, r) => sum + (rdData[r] || 0), 0);
          rtTitle.innerHTML = `<span>🏆</span> Ratings <span style="font-weight:400;color:#9ca3af">(${totalInTags} problems)</span>`;
        } else {
          rtTitle.innerHTML = `<span>🏆</span> Rating Breakdown`;
        }
      }

      function renderTags(tagsData) {
        tgBox.innerHTML = '';
        
        const sorted = Object.entries(tagsData).sort((a, b) => b[1] - a[1]);
        const maxT = sorted.length > 0 ? sorted[0][1] : 1;

        if (sorted.length === 0) {
          tgBox.innerHTML = '<div class="cfpt-empty">No tagged problems in this period</div>';
        } else {
          sorted.forEach(([tag, count]) => {
            const row = document.createElement('div');
            row.className = 'cfpt-tag-row cfpt-tag-clickable';
            if (activeTags.has(tag)) row.classList.add('cfpt-tag-active');

            const pct = (count / maxT) * 100;
            const globalSortedTags = Object.keys(d.tags).sort((a, b) => d.tags[b] - d.tags[a]);
            let cIdx = globalSortedTags.indexOf(tag);
            if (cIdx === -1) cIdx = 0;
            const color = getTagColor(cIdx);

            row.innerHTML = `
              <span class="cfpt-tag-name">${tag}</span>
              <div class="cfpt-tag-bar-bg">
                <div class="cfpt-tag-bar-fill" style="width:${pct}%;background:${color}"></div>
              </div>
              <span class="cfpt-tag-count">${count}</span>
            `;

            row.addEventListener('click', (e) => {
              e.stopPropagation();
              if (activeTags.has(tag)) activeTags.delete(tag);
              else activeTags.add(tag);
              updateCharts();
            });

            tgBox.appendChild(row);
          });
        }

        if (activeRatings.size > 0) {
          const totalProbs = d.problems.filter(p => activeRatings.has(p.rating)).length;
          tgTitle.innerHTML = `<span>🏷️</span> Tags <span style="font-weight:400;color:#9ca3af">(${totalProbs} problems)</span>`;
        } else {
          tgTitle.innerHTML = `<span>🏷️</span> Tags Breakdown`;
        }
      }

      function updateCharts() {
        const filteredByTags = d.problems.filter(p => {
          if (activeTags.size === 0) return true;
          return p.tags.some(t => activeTags.has(t));
        });

        const rdFiltered = {};
        filteredByTags.forEach(p => {
          rdFiltered[p.rating] = (rdFiltered[p.rating] || 0) + 1;
        });

        const filteredByRatings = d.problems.filter(p => {
          if (activeRatings.size === 0) return true;
          return activeRatings.has(p.rating);
        });

        const tagsFiltered = {};
        filteredByRatings.forEach(p => {
          p.tags.forEach(t => {
            tagsFiltered[t] = (tagsFiltered[t] || 0) + 1;
          });
        });

        renderRatings(rdFiltered);
        renderTags(tagsFiltered);
      }

      rtWrap.appendChild(rtBox);
      brkRow.appendChild(rtWrap);

      tgWrap.appendChild(tgBox);
      brkRow.appendChild(tgWrap);

      body.appendChild(brkRow);

      // Click outside rating box & tags box → reset to all
      document.addEventListener('click', (e) => {
        if (!rtBox.contains(e.target) && !tgWrap.contains(e.target) && (activeRatings.size > 0 || activeTags.size > 0)) {
          activeRatings.clear();
          activeTags.clear();
          updateCharts();
        }
      });

      updateCharts();
    }

    fromInput.addEventListener('change', render);
    toInput.addEventListener('change', render);
    render();
    return w;
  }



  /* ══════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════ */
  async function init() {
    // Find the center column. Usually it's .content-with-sidebar inside #pageContent.
    let target = document.querySelector('.content-with-sidebar') || document.getElementById('pageContent') || document.body;

    const ph = document.createElement('div');
    ph.id = 'cfpt-widget';
    ph.className = 'cfpt-widget';
    ph.style.marginTop = '20px';
    ph.innerHTML = `
      <div class="cfpt-header">
        <div class="cfpt-title-row">
          <div class="cfpt-logo">PT</div>
          <span class="cfpt-title">Problem Tracker</span>
        </div>
      </div>
      <div class="cfpt-body">
        <div class="cfpt-loading">
          <div class="cfpt-spinner"></div>
          <span>Loading submissions…</span>
        </div>
      </div>
    `;
    
    // Append at the bottom of the main content area
    target.appendChild(ph);

    try {
      const subs = await getSubs();
      ph.replaceWith(build(subs));
    } catch (err) {
      console.error('[CF Problem Tracker]', err);
      ph.querySelector('.cfpt-body').innerHTML = `
        <div class="cfpt-error">⚠️ ${err.message}</div>
      `;
    }
  }

  init();
})();
