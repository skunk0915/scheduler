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
  const formatTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
    businessHours: { startHour: 9, endHour: 18 }, // [start, end) in hours
    businessDays: [1,2,3,4,5], // 0:Sun ... 6:Sat; grey-out selectable=false
    usersPanelOpen: true,
  };

  // Persistence via URL hash
  // Format: #u=encodedUsers&sel=encodedSelections
  // encodedUsers: base36 userId:name:color, separated by ','
  // encodedSelections: for each userId, dateKey=commaSeparatedSlotIndices; users separated by '|'
  // Also store options: bh=start-end (hours), bd=digits (e.g., 12345), up=1/0

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
    const bh = `${state.businessHours.startHour}-${state.businessHours.endHour}`;
    const bd = state.businessDays.join('');
    const up = state.usersPanelOpen ? '1' : '0';
    const hash = `#u=${usersEnc}&sel=${selEnc}&a=${activeEnc}&bh=${bh}&bd=${bd}&up=${up}`;
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
    const bh = params.get('bh');
    const bd = params.get('bd');
    const up = params.get('up');
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
    if (bh) {
      const [sh, eh] = bh.split('-').map((s)=>parseInt(s,10));
      if (Number.isFinite(sh) && Number.isFinite(eh)) state.businessHours = { startHour: clamp(sh,0,23), endHour: clamp(eh,1,24) };
    }
    if (bd) {
      const days = bd.split('').map(d=>parseInt(d,10)).filter(n=>n>=0&&n<=6);
      if (days.length>0) state.businessDays = days;
    }
    if (up != null) {
      state.usersPanelOpen = up === '1';
    }
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
    return ranges.map(r => `${formatDate(r.startDate)} - ${formatTime(r.endDate)}`).join('\n');
  };

  const getCommonSelectedRanges = () => {
    // Intersect selections across all users per day and emit contiguous ranges
    if (state.users.length === 0) return [];
    // Build a map: dk -> Set of indices selected by everyone
    const allUsers = state.users;
    const dayKeys = new Set();
    for (const u of allUsers) {
      for (const dk of u.selections.keys()) dayKeys.add(dk);
    }
    const resultRanges = [];
    for (const dk of dayKeys) {
      let commonSet = null;
      for (const u of allUsers) {
        const set = u.selections.get(dk) || new Set();
        if (commonSet == null) {
          commonSet = new Set(set);
        } else {
          // intersect
          for (const val of [...commonSet]) {
            if (!set.has(val)) commonSet.delete(val);
          }
        }
        if (commonSet.size === 0) break;
      }
      if (!commonSet || commonSet.size === 0) continue;
      const sorted = [...commonSet].sort((a,b)=>a-b);
      let start = sorted[0];
      for (let i = 1; i <= sorted.length; i++) {
        if (i === sorted.length || sorted[i] !== sorted[i-1] + 1) {
          const end = sorted[i-1];
          const day = parseDateKey(dk);
          const startDate = new Date(day);
          startDate.setMinutes(start * SLOT_MINUTES);
          const endDate = new Date(day);
          endDate.setMinutes((end + 1) * SLOT_MINUTES);
          resultRanges.push({ dk, startIdx: start, endIdx: end, startDate, endDate });
          start = sorted[i];
        }
      }
    }
    // Sort by startDate
    resultRanges.sort((a,b)=>a.startDate - b.startDate);
    return resultRanges;
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

    let visibleSlotsCount = 0;
    for (let h = 0; h < HOURS_PER_DAY; h++) {
      for (let s = 0; s < SLOTS_PER_HOUR; s++) {
        const cell = document.createElement('div');
        const inHours = h >= state.businessHours.startHour && h < state.businessHours.endHour;
        cell.className = 'cell' + (s === 0 ? ' hour' : '') + (!inHours ? ' hidden' : '');
        cell.textContent = s === 0 ? `${h}:00` : '';
        if (inHours) { visibleSlotsCount++; timeHeaderEl.appendChild(cell); }
      }
    }
    // Update CSS var for visible slots
    const totalVisible = (state.businessHours.endHour - state.businessHours.startHour) * SLOTS_PER_HOUR;
    timeHeaderEl.style.setProperty('--visible-slots', String(totalVisible));
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
    const totalVisible = (state.businessHours.endHour - state.businessHours.startHour) * SLOTS_PER_HOUR;
    gridEl.style.setProperty('--visible-slots', String(totalVisible));

    for (const day of days) {
      const dk = dateKey(day);
      const row = document.createElement('div');
      row.className = 'day-row';
      row.style.setProperty('--visible-slots', String(totalVisible));

      const label = document.createElement('div');
      label.className = 'day-label';
      label.textContent = `${dk} (${['日','月','火','水','木','金','土'][day.getDay()]})`;
      const isBusinessDay = state.businessDays.includes(day.getDay());
      if (!isBusinessDay) label.classList.add('disabled');
      row.appendChild(label);

      for (let i = 0; i < SLOTS_PER_DAY; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.dk = dk;
        slot.dataset.idx = String(i);
        const hour = Math.floor(i / SLOTS_PER_HOUR);
        const inHours = hour >= state.businessHours.startHour && hour < state.businessHours.endHour;
        const isBiz = isBusinessDay;
        if (!inHours) {
          slot.classList.add('hidden');
        }
        if (!isBiz) {
          slot.classList.add('disabled');
        }
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

      // Build equal top-to-bottom bands for overlaps. Use up to 4 colors for clarity.
      const baseColors = selectedBy.map(u => u.color).slice(0, 4);
      const softColors = baseColors.map(c => `color-mix(in oklab, ${c} 40%, white)`);
      const segments = softColors.length;
      const stepPercent = 100 / segments;
      const stops = [];
      for (let i = 0; i < segments; i++) {
        const start = (i * stepPercent).toFixed(2);
        const end = ((i + 1) * stepPercent).toFixed(2);
        stops.push(`${softColors[i]} ${start}% ${end}%`);
      }
      const gradient = `linear-gradient(to bottom, ${stops.join(', ')})`;
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
    const commonTextarea = document.getElementById('commonRangesText');
    const user = getActiveUser();
    if (!user) {
      textarea.value = '';
      if (commonTextarea) commonTextarea.value = '';
      return;
    }
    const ranges = getSelectedRangesForUser(user);
    textarea.value = rangesToText(ranges);
    if (commonTextarea) {
      const commonRanges = getCommonSelectedRanges();
      commonTextarea.value = rangesToText(commonRanges);
    }
  };

  // Event handling for drag selection
  let lastHoverCell = null;

  const onPointerDown = (e) => {
    const target = e.target.closest('.slot');
    if (!target) return;
    if (target.classList.contains('disabled')) return;
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
    if (target.classList.contains('disabled')) return;

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
    if (target.classList.contains('disabled')) return;
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

  // Copy buttons on labels
  document.getElementById('copyRangesTextBtn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const textarea = document.getElementById('rangesText');
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try { await navigator.clipboard.writeText(textarea.value); } catch (err) { document.execCommand('copy'); }
  });

  document.getElementById('copyCommonRangesTextBtn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const textarea = document.getElementById('commonRangesText');
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try { await navigator.clipboard.writeText(textarea.value); } catch (err) { document.execCommand('copy'); }
  });

  document.getElementById('copyShareUrlBtn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const input = document.getElementById('shareUrl');
    input.select();
    input.setSelectionRange(0, input.value.length);
    try { await navigator.clipboard.writeText(input.value); } catch (err) { document.execCommand('copy'); }
  });

  // Clear all selections for active user
  document.getElementById('clearSelectionsBtn').addEventListener('click', () => {
    const user = getActiveUser();
    if (!user) return;
    user.selections.clear();
    refreshSelectionStyles();
    updateRangesText();
    encodeStateToHash();
  });

  // Toggle users panel
  const appMainEl = document.querySelector('.app-main');
  const usersPanelEl = document.getElementById('usersPanel');
  document.getElementById('toggleUsersBtn').addEventListener('click', () => {
    state.usersPanelOpen = !state.usersPanelOpen;
    if (state.usersPanelOpen) {
      appMainEl.classList.remove('collapsed-sidebar');
      usersPanelEl.classList.remove('slide-out');
    } else {
      appMainEl.classList.add('collapsed-sidebar');
      usersPanelEl.classList.add('slide-out');
    }
    encodeStateToHash();
  });

  // Business hours controls
  const bhStartEl = document.getElementById('bhStart');
  const bhEndEl = document.getElementById('bhEnd');
  const daysInputsEl = document.getElementById('businessDaysInputs');

  const populateHourSelects = () => {
    const makeOptions = (select) => {
      select.innerHTML = '';
      for (let h = 0; h <= 24; h++) {
        const opt = document.createElement('option');
        opt.value = String(h);
        opt.textContent = `${pad2(h)}:00`;
        select.appendChild(opt);
      }
    };
    makeOptions(bhStartEl);
    makeOptions(bhEndEl);
    bhStartEl.value = String(state.businessHours.startHour);
    bhEndEl.value = String(state.businessHours.endHour);
  };

  const renderBusinessDaysInputs = () => {
    const dayNames = ['日','月','火','水','木','金','土'];
    daysInputsEl.innerHTML = '';
    for (let d = 0; d < 7; d++) {
      const id = `bd-${d}`;
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.value = String(d);
      cb.checked = state.businessDays.includes(d);
      cb.addEventListener('change', () => {
        const val = parseInt(cb.value, 10);
        if (cb.checked) {
          if (!state.businessDays.includes(val)) state.businessDays.push(val);
        } else {
          state.businessDays = state.businessDays.filter(x => x !== val);
        }
        state.businessDays.sort((a,b)=>a-b);
        renderGrid();
        encodeStateToHash();
      });
      label.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = dayNames[d];
      label.appendChild(span);
      daysInputsEl.appendChild(label);
    }
  };

  bhStartEl.addEventListener('change', () => {
    const v = parseInt(bhStartEl.value, 10);
    if (Number.isFinite(v)) state.businessHours.startHour = clamp(v, 0, 23);
    // Ensure start < end
    if (state.businessHours.startHour >= state.businessHours.endHour) {
      state.businessHours.endHour = clamp(state.businessHours.startHour + 1, 1, 24);
      bhEndEl.value = String(state.businessHours.endHour);
    }
    renderTimeHeader();
    renderGrid();
    encodeStateToHash();
  });
  bhEndEl.addEventListener('change', () => {
    const v = parseInt(bhEndEl.value, 10);
    if (Number.isFinite(v)) state.businessHours.endHour = clamp(v, 1, 24);
    if (state.businessHours.startHour >= state.businessHours.endHour) {
      state.businessHours.startHour = clamp(state.businessHours.endHour - 1, 0, 23);
      bhStartEl.value = String(state.businessHours.startHour);
    }
    renderTimeHeader();
    renderGrid();
    encodeStateToHash();
  });

  // Init
  renderTimeHeader();
  renderGrid();
  const restored = decodeStateFromHash();
  // Initialize controls after potential decode
  populateHourSelects();
  renderBusinessDaysInputs();
  // Reflect users panel state
  const appMainElInit = document.querySelector('.app-main');
  const usersPanelElInit = document.getElementById('usersPanel');
  if (!state.usersPanelOpen) {
    appMainElInit.classList.add('collapsed-sidebar');
    usersPanelElInit.classList.add('slide-out');
  }
  if (!restored) {
    createUser('ユーザー1');
  } else {
    // Re-render to reflect restored business settings
    renderTimeHeader();
    renderGrid();
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
