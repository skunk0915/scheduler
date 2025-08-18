(() => {
  'use strict';

  // Configuration
  const SLOT_MINUTES = 15; // 15-minute increments
  const SLOTS_PER_HOUR = 60 / SLOT_MINUTES; // 4
  const HOURS_PER_DAY = 24;
  const SLOTS_PER_DAY = HOURS_PER_DAY * SLOTS_PER_HOUR; // 96
  const DAYS_AHEAD = 365; // 1 year ahead

  // Utilities
  const pad2 = (n) => String(n).padStart(2, '0');
  const formatDate = (d) => {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    return `${y}-${m}-${day} ${hh}:${mm}`;
  };
  const parseDateKey = (key) => {
    // key: YYYY-MM-DD
    const [y, m, d] = key.split('-').map((s) => parseInt(s, 10));
    return new Date(y, m - 1, d);
  };
  const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  // Color palette for users
  const USER_COLORS = [
    '#2563eb', // blue
    '#22c55e', // green
    '#ef4444', // red
    '#f59e0b', // amber
    '#a855f7', // purple
    '#06b6d4', // cyan
    '#ec4899', // pink
    '#84cc16', // lime
  ];

  // App State
  const state = {
    users: [], // { id, name, color, selections: Map<dateKey, Set<slotIndex>> }
    activeUserId: null,
    isDragging: false,
    dragMode: 'add', // 'add' or 'remove'
    dragStart: null, // {dateKey, slotIndex}
  };

  // Persistence via URL hash
  // Format: #u=encodedUsers&sel=encodedSelections
  // encodedUsers: base36 userId:name:color, separated by ','
  // encodedSelections: for each userId, dateKey=commaSeparatedSlotIndices; users separated by '|'

  const encodeStateToHash = () => {
    const usersEnc = state.users.map((u) => `${u.id.toString(36)}:${encodeURIComponent(u.name)}:${u.color.substring(1)}`).join(',');
    const parts = [];
    for (const u of state.users) {
      const dayParts = [];
      for (const [dk, set] of u.selections.entries()) {
        if (set.size === 0) continue;
        dayParts.push(`${dk}=${[...set].sort((a,b)=>a-b).join('.')}`);
      }
      parts.push(`${u.id.toString(36)}:${dayParts.join(',')}`);
    }
    const selEnc = parts.join('|');
    const activeEnc = state.activeUserId != null ? state.activeUserId.toString(36) : '';
    const hash = `#u=${usersEnc}&sel=${selEnc}&a=${activeEnc}`;
    history.replaceState(null, '', `${location.pathname}${hash}`);
    // Update display link
    document.getElementById('shareUrl').value = location.href;
  };

  const decodeStateFromHash = () => {
    if (!location.hash.startsWith('#')) return false;
    const params = new URLSearchParams(location.hash.substring(1));
    const u = params.get('u');
    const sel = params.get('sel');
    const a = params.get('a');
    if (!u) return false;

    const users = [];
    const idToUser = new Map();
    for (const part of u.split(',')) {
      if (!part) continue;
      const [id36, encName, colorHex] = part.split(':');
      const id = parseInt(id36, 36);
      const name = decodeURIComponent(encName || 'ユーザー');
      const color = `#${(colorHex || '2563eb').slice(0,6)}`;
      const user = { id, name, color, selections: new Map() };
      users.push(user);
      idToUser.set(id, user);
    }
    if (users.length === 0) return false;

    if (sel) {
      for (const userPart of sel.split('|')) {
        if (!userPart) continue;
        const [id36, dayChunk] = userPart.split(':');
        const id = parseInt(id36, 36);
        const user = idToUser.get(id);
        if (!user) continue;
        if (!dayChunk) continue;
        for (const dp of dayChunk.split(',')) {
          if (!dp) continue;
          const [dk, slotsStr] = dp.split('=');
          if (!dk || !slotsStr) continue;
          const set = new Set();
          for (const s of slotsStr.split('.')) {
            const idx = parseInt(s, 10);
            if (!Number.isFinite(idx)) continue;
            set.add(idx);
          }
          user.selections.set(dk, set);
        }
      }
    }

    state.users = users;
    state.activeUserId = a ? parseInt(a, 36) : users[0]?.id ?? null;
    return true;
  };

  // User management
  const createUser = (name) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const color = USER_COLORS[state.users.length % USER_COLORS.length];
    const user = { id, name, color, selections: new Map() };
    state.users.push(user);
    if (state.activeUserId == null) state.activeUserId = id;
    renderUsers();
    encodeStateToHash();
    updateRangesText();
  };

  const setActiveUser = (id) => {
    state.activeUserId = id;
    renderUsers();
    updateRangesText();
  };

  // Selection helpers
  const getActiveUser = () => state.users.find((u) => u.id === state.activeUserId) || null;

  const toggleSelection = (user, dk, slotIdx, forceMode = null) => {
    let set = user.selections.get(dk);
    if (!set) { set = new Set(); user.selections.set(dk, set); }
    const has = set.has(slotIdx);
    const mode = forceMode || (state.dragMode === 'add' ? 'add' : 'remove');
    if (mode === 'add') {
      set.add(slotIdx);
    } else {
      set.delete(slotIdx);
    }
  };

  const selectRange = (user, dk, startIdx, endIdx, remove = false) => {
    const [a, b] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
    let set = user.selections.get(dk);
    if (!set) { set = new Set(); user.selections.set(dk, set); }
    for (let i = a; i <= b; i++) {
      if (remove) set.delete(i); else set.add(i);
    }
  };

  const getSelectedRangesForUser = (user) => {
    const ranges = [];
    for (const [dk, set] of user.selections.entries()) {
      if (set.size === 0) continue;
      const sorted = [...set].sort((a,b)=>a-b);
      let start = sorted[0];
      for (let i = 1; i <= sorted.length; i++) {
        if (i === sorted.length || sorted[i] !== sorted[i-1] + 1) {
          const end = sorted[i-1];
          const day = parseDateKey(dk);
          const startDate = new Date(day);
          startDate.setMinutes(start * SLOT_MINUTES);
          const endDate = new Date(day);
          endDate.setMinutes((end + 1) * SLOT_MINUTES);
          ranges.push({ dk, startIdx: start, endIdx: end, startDate, endDate });
          start = sorted[i];
        }
      }
    }
    // Sort by startDate
    ranges.sort((r1, r2) => r1.startDate - r2.startDate);
    return ranges;
  };

  const rangesToText = (ranges) => {
    return ranges.map(r => `${formatDate(r.startDate)} - ${formatDate(r.endDate)}`).join('\n');
  };

  // Rendering
  const timeHeaderEl = document.getElementById('timeHeader');
  const gridEl = document.getElementById('grid');
  const usersListEl = document.getElementById('usersList');

  const renderTimeHeader = () => {
    timeHeaderEl.innerHTML = '';
    const corner = document.createElement('div');
    corner.className = 'corner';
    corner.textContent = '日/時間';
    timeHeaderEl.appendChild(corner);

    for (let h = 0; h < HOURS_PER_DAY; h++) {
      for (let s = 0; s < SLOTS_PER_HOUR; s++) {
        const cell = document.createElement('div');
        cell.className = 'cell' + (s === 0 ? ' hour' : '');
        cell.textContent = s === 0 ? `${h}:00` : '';
        timeHeaderEl.appendChild(cell);
      }
    }
  };

  const generateDays = () => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const days = [];
    for (let i = 0; i <= DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const days = generateDays();

  const renderGrid = () => {
    gridEl.innerHTML = '';

    for (const day of days) {
      const dk = dateKey(day);
      const row = document.createElement('div');
      row.className = 'day-row';

      const label = document.createElement('div');
      label.className = 'day-label';
      label.textContent = `${dk} (${['日','月','火','水','木','金','土'][day.getDay()]})`;
      row.appendChild(label);

      for (let i = 0; i < SLOTS_PER_DAY; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.dk = dk;
        slot.dataset.idx = String(i);
        row.appendChild(slot);
      }

      gridEl.appendChild(row);
    }

    refreshSelectionStyles();
  };

  const refreshSelectionStyles = () => {
    // For each slot cell, compute which users have selected it and color accordingly.
    // - 0 users: clear styling
    // - 1 user: fill with that user's color (soft)
    // - 2+ users: show repeating stripes of involved users' colors

    const cells = gridEl.querySelectorAll('.slot');
    cells.forEach((cell) => {
      const dk = cell.dataset.dk;
      const idx = parseInt(cell.dataset.idx, 10);

      const selectedBy = [];
      for (const u of state.users) {
        const set = u.selections.get(dk);
        if (set && set.has(idx)) selectedBy.push(u);
      }

      // Reset previous classes and inline styles
      cell.classList.remove('selected', 'selected-2');
      cell.style.background = '';

      if (selectedBy.length === 0) {
        return;
      }

      if (selectedBy.length === 1) {
        const color = selectedBy[0].color;
        cell.style.background = `color-mix(in oklab, ${color} 35%, white)`;
        return;
      }

      // Build a striped gradient for overlaps. Cycle through up to 4 colors for clarity.
      const colors = selectedBy.map(u => u.color).slice(0, 4);
      const stripeWidthPx = 8;
      let stops = [];
      for (let i = 0; i < colors.length; i++) {
        const start = i * stripeWidthPx;
        const end = (i + 1) * stripeWidthPx;
        stops.push(`${colors[i]} ${start}px ${end}px`);
      }
      const gradient = `repeating-linear-gradient(45deg, ${stops.join(', ')})`;
      cell.style.background = gradient;
    });
  };

  const renderUsers = () => {
    usersListEl.innerHTML = '';
    for (const u of state.users) {
      const item = document.createElement('div');
      item.className = 'user-item' + (u.id === state.activeUserId ? ' active' : '');
      item.onclick = () => setActiveUser(u.id);

      const swatch = document.createElement('div');
      swatch.className = 'user-swatch';
      swatch.style.background = u.color;

      const name = document.createElement('div');
      name.className = 'user-name';
      name.textContent = u.name;

      item.appendChild(swatch);
      item.appendChild(name);
      usersListEl.appendChild(item);
    }
  };

  const updateRangesText = () => {
    const textarea = document.getElementById('rangesText');
    const user = getActiveUser();
    if (!user) { textarea.value = ''; return; }
    const ranges = getSelectedRangesForUser(user);
    textarea.value = rangesToText(ranges);
  };

  // Event handling for drag selection
  let lastHoverCell = null;

  const onPointerDown = (e) => {
    const target = e.target.closest('.slot');
    if (!target) return;
    const user = getActiveUser();
    if (!user) return;

    e.preventDefault();
    const dk = target.dataset.dk;
    const idx = parseInt(target.dataset.idx, 10);

    const hasAlready = (user.selections.get(dk)?.has(idx)) || false;
    state.dragMode = hasAlready ? 'remove' : 'add';
    state.isDragging = true;
    state.dragStart = { dateKey: dk, slotIndex: idx };

    toggleSelection(user, dk, idx, hasAlready ? 'remove' : 'add');
    refreshSelectionStyles();
    updateRangesText();
    encodeStateToHash();

    lastHoverCell = target;
  };

  const onPointerMove = (e) => {
    if (!state.isDragging) return;
    const user = getActiveUser();
    if (!user) return;

    const target = e.target.closest('.slot');
    if (!target) return;

    const dk = target.dataset.dk;
    const idx = parseInt(target.dataset.idx, 10);
    const start = state.dragStart;
    if (!start) return;

    if (dk !== start.dateKey) {
      // Cross-day dragging not supported; end at lastHoverCell
      return;
    }

    // Determine range between start and current
    const [a, b] = [Math.min(start.slotIndex, idx), Math.max(start.slotIndex, idx)];
    // Determine remove mode based on initial cell
    const remove = state.dragMode === 'remove';

    // Reset to which state? For performance, apply incremental: apply to range from min(last, current) to max()
    // Simpler approach: apply to entire range each move
    selectRange(user, dk, start.slotIndex, idx, remove);
    refreshSelectionStyles();
    updateRangesText();
    encodeStateToHash();

    lastHoverCell = target;
  };

  const onPointerUp = () => {
    state.isDragging = false;
    state.dragStart = null;
  };

  const onClickGrid = (e) => {
    const target = e.target.closest('.slot');
    if (!target) return;
    const user = getActiveUser();
    if (!user) return;
    const dk = target.dataset.dk;
    const idx = parseInt(target.dataset.idx, 10);
    const has = user.selections.get(dk)?.has(idx);
    toggleSelection(user, dk, idx, has ? 'remove' : 'add');
    refreshSelectionStyles();
    updateRangesText();
    encodeStateToHash();
  };

  // Buttons
  document.getElementById('addUserBtn').addEventListener('click', () => {
    const name = prompt('ユーザー名を入力', `ユーザー${state.users.length + 1}`) || `ユーザー${state.users.length + 1}`;
    createUser(name);
  });

  document.getElementById('copyRangesBtn').addEventListener('click', async () => {
    const textarea = document.getElementById('rangesText');
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try { await navigator.clipboard.writeText(textarea.value); } catch (e) { document.execCommand('copy'); }
  });

  document.getElementById('copyLinkBtn').addEventListener('click', async () => {
    const input = document.getElementById('shareUrl');
    input.select();
    input.setSelectionRange(0, input.value.length);
    try { await navigator.clipboard.writeText(input.value); } catch (e) { document.execCommand('copy'); }
  });

  // Init
  renderTimeHeader();
  renderGrid();
  const restored = decodeStateFromHash();
  if (!restored) {
    createUser('ユーザー1');
  } else {
    renderUsers();
    refreshSelectionStyles();
    updateRangesText();
    encodeStateToHash();
  }

  // Global grid events
  gridEl.addEventListener('pointerdown', onPointerDown);
  gridEl.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  gridEl.addEventListener('click', onClickGrid);
})();
