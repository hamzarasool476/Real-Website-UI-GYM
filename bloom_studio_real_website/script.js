/* Bloom Studio — Supabase-backed frontend.
 * Requires config.js with Supabase project URL + public anon/publishable key.
 * Security is enforced by database RLS and SQL functions, not by hiding UI controls.
 */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const config = window.BLOOM_CONFIG || {};
  const toastElement = $('#liveToast');
  const toast = window.bootstrap && toastElement ? bootstrap.Toast.getOrCreateInstance(toastElement, { delay: 3500 }) : null;
  const validConfig = config.supabaseUrl && config.supabaseAnonKey &&
    !config.supabaseUrl.includes('YOUR_PROJECT_REF') &&
    !config.supabaseAnonKey.includes('YOUR_SUPABASE');
  const supabase = validConfig && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  let currentUser = null;
  let currentProfile = null;
  let classCache = [];
  let authMode = 'login';

  function notify(message) {
    $('#toastMessage').textContent = message;
    if (toast) toast.show();
    else console.info('[Bloom Studio]', message);
  }
  function showSetupNotice() {
    const msg = 'Connect your Supabase project in config.js and run supabase/schema.sql to enable live accounts and bookings.';
    $('#authHint').textContent = msg;
    $('#authOpenButton').title = 'Configure Supabase to enable member accounts';
  }
  function safeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }
  function initials(name, email) {
    const source = (name || email || 'Member').trim();
    return source.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  }
  function localDateString(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  $('#bookingDate').min = localDateString();
  $('#bookingDate').value = localDateString();

  // Scroll reveal and responsive navigation.
  const revealItems = $$('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    revealItems.forEach(item => observer.observe(item));
  } else revealItems.forEach(item => item.classList.add('is-visible'));
  revealItems.slice(0, 2).forEach(item => item.classList.add('is-visible'));

  const sidebar = $('#sidebar');
  const overlay = document.createElement('div');
  overlay.className = 'menu-overlay'; overlay.setAttribute('aria-hidden', 'true'); document.body.appendChild(overlay);
  function closeMenu() { sidebar.classList.remove('open'); overlay.classList.remove('show'); document.body.classList.remove('menu-open'); }
  $('#menuToggle').addEventListener('click', () => {
    const open = sidebar.classList.toggle('open'); overlay.classList.toggle('show', open); document.body.classList.toggle('menu-open', open);
  });
  overlay.addEventListener('click', closeMenu);
  $$('.side-nav .nav-item').forEach(link => link.addEventListener('click', closeMenu));
  window.addEventListener('resize', () => { if (window.innerWidth > 991) closeMenu(); });

  // Auth modal state.
  const authModal = bootstrap.Modal.getOrCreateInstance($('#authModal'));
  const bookingModal = bootstrap.Modal.getOrCreateInstance($('#bookingModal'));
  const adminClassModal = bootstrap.Modal.getOrCreateInstance($('#adminClassModal'));
  function setAuthMode(mode) {
    authMode = mode;
    $$('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.authMode === mode));
    $('#authTitle').textContent = mode === 'signup' ? 'Create your account' : 'Member sign in';
    $('#authSubmitButton').innerHTML = mode === 'signup' ? 'Create account <i class="bi bi-arrow-right ms-2"></i>' : 'Log in <i class="bi bi-arrow-right ms-2"></i>';
    $('#authNameWrap').hidden = mode !== 'signup';
    $('#authName').required = mode === 'signup';
    $('#authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    $('#resetPasswordButton').hidden = mode === 'signup';
    $('#authHint').textContent = mode === 'signup'
      ? 'Use an email you can verify. Password must be at least 8 characters.'
      : 'Use your member account to sync bookings and progress.';
  }
  $$('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
  $('#authOpenButton').addEventListener('click', () => {
    if (!supabase) { showSetupNotice(); authModal.show(); return; }
    if (currentUser) { signOut(); return; }
    setAuthMode('login'); authModal.show();
  });
  $('#profileButton').addEventListener('click', () => {
    if (!supabase) { notify('Set up Supabase first to enable member accounts.'); return; }
    if (currentUser) signOut(); else { setAuthMode('login'); authModal.show(); }
  });
  $('#resetPasswordButton').addEventListener('click', async () => {
    if (!supabase) return showSetupNotice();
    const email = $('#authEmail').value.trim();
    if (!email) { notify('Enter your email address first.'); $('#authEmail').focus(); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) notify(error.message); else notify('If an account exists for that email, a password reset link has been sent.');
  });
  $('#authForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabase) { showSetupNotice(); notify('Supabase is not configured yet. Follow README.md to connect it.'); return; }
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const submit = $('#authSubmitButton');
    submit.disabled = true;
    try {
      let result;
      if (authMode === 'signup') {
        result = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: $('#authName').value.trim() }, emailRedirectTo: window.location.origin }
        });
      } else result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (authMode === 'signup' && !result.data.session) {
        authModal.hide();
        notify('Account created. Check your email to verify your address, then log in.');
      } else {
        authModal.hide();
        notify(authMode === 'signup' ? 'Welcome to Bloom Studio!' : 'Welcome back!');
      }
    } catch (error) {
      notify(error.message || 'Authentication failed. Please try again.');
    } finally { submit.disabled = false; }
  });

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) notify(error.message);
    else notify('You have been signed out.');
  }

  async function loadProfile(user) {
    if (!user) { currentProfile = null; return; }
    // Profile row is created by a secure database trigger when a user signs up.
    const { data, error } = await supabase.from('profiles')
      .select('id, full_name, role')
      .eq('id', user.id).maybeSingle();
    if (error) { console.error(error); currentProfile = null; return; }
    currentProfile = data;
  }

  function updateMemberUI() {
    const name = currentProfile?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'Guest member';
    const avatar = currentUser ? initials(name, currentUser.email) : '?';
    $('#sidebarMemberName').textContent = name;
    $('#sidebarMemberStatus').textContent = currentUser ? (currentProfile?.role === 'admin' ? 'Studio administrator' : 'Bloom member') : 'Sign in to sync your progress';
    $('#sidebarAvatar').textContent = avatar;
    $('#profileAvatar').textContent = avatar;
    $('#authOpenButton').textContent = currentUser ? 'Log out' : 'Log in';
    $('#adminPanel').hidden = currentProfile?.role !== 'admin';
    $('#bookingsLoading').textContent = currentUser ? 'Loading your bookings…' : 'Log in to see your saved bookings.';
  }

  // Fetch published classes from the database and render with safe text escaping.
  async function loadClasses() {
    if (!supabase) { renderFallbackClasses(); return; }
    const { data, error } = await supabase.from('classes')
      .select('id, name, category, trainer_name, duration_minutes, capacity, description, is_active')
      .eq('is_active', true).order('name');
    if (error) {
      console.error(error);
      renderFallbackClasses();
      if (error.code !== '42P01') notify('Could not load live classes. Check the Supabase setup and schema.');
      return;
    }
    classCache = data || [];
    renderClasses(classCache);
    populateBookingClassOptions(classCache);
    if (currentProfile?.role === 'admin') renderAdminClasses();
  }
  function renderFallbackClasses() {
    // Keep the original visual demo visible before Supabase is configured.
    classCache = [];
  }
  function populateBookingClassOptions(classes) {
    const select = $('#classSelect');
    const previous = select.value;
    select.innerHTML = '<option value="">Select a class</option>' + classes.map(item =>
      `<option value="${safeText(item.id)}">${safeText(item.name)}</option>`
    ).join('');
    if (classes.some(item => item.id === previous)) select.value = previous;
  }
  const classVisuals = {
    yoga: { image: 'yoga-image', icon: 'bi-flower1', badge: 'FIND YOUR FLOW', level: 'Beginner' },
    dance: { image: 'zumba-image', icon: 'bi-music-note-beamed', badge: 'HIGH ENERGY', level: 'All levels' },
    strength: { image: 'strength-image', icon: 'bi-lightning-charge', badge: 'BUILD POWER', level: 'All levels' },
    mindful: { image: 'pilates-image', icon: 'bi-sun', badge: 'LOW IMPACT', level: 'Beginner' },
    cardio: { image: 'zumba-image', icon: 'bi-heart-pulse', badge: 'GET MOVING', level: 'All levels' }
  };
  function renderClasses(classes) {
    const grid = $('#classGrid');
    if (!classes.length) {
      grid.innerHTML = '<div class="col-12"><div class="empty-state">No active classes yet. Studio staff can add classes from the admin dashboard.</div></div>';
      return;
    }
    grid.innerHTML = classes.map(item => {
      const visual = classVisuals[item.category] || classVisuals.mindful;
      return `<div class="col-md-6 col-xl-3 class-col" data-category="${safeText(item.category)}">
        <article class="class-card"><div class="class-image ${visual.image}"><span class="class-badge">${visual.badge}</span><div class="image-symbol"><i class="bi ${visual.icon}"></i></div><span class="image-label">MOVE · BREATHE · BLOOM</span></div>
        <div class="class-body"><div class="class-meta"><span><i class="bi bi-clock"></i> ${Number(item.duration_minutes)} min</span><span class="level-dot">● ${visual.level}</span></div>
        <h4>${safeText(item.name)}</h4><p>${safeText(item.description || 'A feel-good class for every level.')}</p>
        <div class="class-footer"><div class="trainer-mini"><div class="avatar tiny-avatar">${safeText(initials(item.trainer_name, 'Trainer'))}</div><span>${safeText(item.trainer_name || 'Bloom trainer')}</span></div>
        <button class="round-arrow book-class" data-class-id="${safeText(item.id)}" aria-label="Book ${safeText(item.name)}"><i class="bi bi-arrow-up-right"></i></button></div></div></article></div>`;
    }).join('');
    $$('.book-class', grid).forEach(button => button.addEventListener('click', () => {
      const item = classCache.find(c => c.id === button.dataset.classId);
      if (item) {
        $('#classSelect').innerHTML = `<option value="${safeText(item.id)}">${safeText(item.name)}</option>`;
        $('#classSelect').value = item.id;
      }
      if (!currentUser) { setAuthMode('login'); authModal.show(); notify('Log in to book a class.'); return; }
      bookingModal.show();
    }));
    applyActiveFilter();
  }

  // Category filter applies to live cards.
  let activeFilter = 'all';
  function applyActiveFilter() {
    $$('.class-col', $('#classGrid')).forEach(card => card.classList.toggle('is-hidden', activeFilter !== 'all' && card.dataset.category !== activeFilter));
  }
  $$('.filter-chip').forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    $$('.filter-chip').forEach(chip => chip.classList.toggle('active', chip === button));
    applyActiveFilter();
  }));

  // Booking uses a database function to enforce capacity and prevent duplicate reservations.
  $('#bookingForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabase) { notify('Connect Supabase before making real bookings.'); return; }
    if (!currentUser) { bookingModal.hide(); authModal.show(); return; }
    const classId = $('#classSelect').value;
    const date = $('#bookingDate').value;
    const time = $('#bookingTime').value;
    if (!classId || !date || !time) { notify('Choose a class, date, and time.'); return; }
    const submit = $('button[type="submit"]', event.currentTarget);
    submit.disabled = true;
    try {
      const startsAt = new Date(`${date}T${timeTo24Hour(time)}:00`);
      if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) throw new Error('Choose a future date and time.');
      const { error } = await supabase.rpc('book_class', { p_class_id: classId, p_starts_at: startsAt.toISOString() });
      if (error) throw error;
      bookingModal.hide();
      event.currentTarget.reset();
      $('#bookingDate').value = localDateString();
      notify('Your booking is confirmed and saved to your account.');
      await loadBookings();
    } catch (error) { notify(error.message || 'Could not complete booking.'); }
    finally { submit.disabled = false; }
  });
  function timeTo24Hour(label) {
    const match = label.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return '00:00';
    let hours = Number(match[1]) % 12;
    if (match[3].toUpperCase() === 'PM') hours += 12;
    return `${String(hours).padStart(2, '0')}:${match[2]}`;
  }

  async function loadBookings() {
    const list = $('#upcomingList');
    if (!supabase || !currentUser) {
      list.innerHTML = '<div class="empty-state">Log in to see your saved bookings. Your bookings will sync across devices.</div>';
      return;
    }
    list.innerHTML = '<div class="empty-state">Loading your bookings…</div>';
    const { data, error } = await supabase.from('bookings')
      .select('id, starts_at, status, classes(name)')
      .eq('user_id', currentUser.id).eq('status', 'booked')
      .gte('starts_at', new Date().toISOString()).order('starts_at').limit(20);
    if (error) {
      console.error(error);
      list.innerHTML = '<div class="empty-state">Bookings could not load. Verify that the database schema has been applied.</div>';
      return;
    }
    if (!data?.length) { list.innerHTML = '<div class="empty-state">No upcoming bookings yet. Pick a class you love and save your spot.</div>'; return; }
    list.innerHTML = data.map(booking => {
      const date = new Date(booking.starts_at);
      return `<div class="upcoming-item" data-booking-id="${safeText(booking.id)}">
        <div class="date-tile"><b>${date.toLocaleDateString(undefined, { day: '2-digit' })}</b><small>${date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</small></div>
        <div class="upcoming-info"><b>${safeText(booking.classes?.name || 'Fitness class')}</b><span><i class="bi bi-clock"></i> ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · Bloom Studio</span></div>
        <span class="spots-pill spots-full">Booked</span><button class="icon-button cancel-booking" data-booking-id="${safeText(booking.id)}" aria-label="Cancel booking"><i class="bi bi-x-lg"></i></button></div>`;
    }).join('');
    $$('.cancel-booking', list).forEach(button => button.addEventListener('click', async () => {
      if (!confirm('Cancel this booking?')) return;
      button.disabled = true;
      const { error: cancelError } = await supabase.rpc('cancel_booking', { p_booking_id: button.dataset.bookingId });
      if (cancelError) { notify(cancelError.message); button.disabled = false; return; }
      notify('Booking cancelled.');
      await loadBookings();
    }));
  }

  // Water and workout metrics remain local demo data. Wire them to member_metrics if desired.
  let glasses = 4, goal = 70, activeMinutes = 85, classCount = 8;
  $('#addWater').addEventListener('click', () => {
    if (glasses >= 8) { notify('You reached your water goal for today!'); return; }
    glasses++;
    $('#waterCount').textContent = glasses;
    [...$('#waterGlasses').children].forEach((el, index) => el.classList.toggle('filled', index < glasses));
    $('#waterGlasses').setAttribute('aria-label', `${glasses} of 8 glasses logged`);
    notify(glasses === 8 ? 'Water goal complete. You did it!' : `Water logged: ${glasses} of 8 glasses.`);
  });
  $('#completeWorkout').addEventListener('click', () => {
    goal = Math.min(100, goal + 10); activeMinutes += 20; classCount = Math.min(12, classCount + 1);
    $('#goalPercent').textContent = `${goal}%`; $('#goalBar').style.width = `${goal}%`;
    $('.goal-progress').setAttribute('aria-valuenow', String(goal));
    $('#activeMinutes').textContent = activeMinutes; $('#classesCount').textContent = classCount;
    const nextDay = $$('.goal-days span').find(el => !el.classList.contains('done')); if (nextDay) nextDay.classList.add('done');
    notify('Workout logged in this session. Connect member_metrics to persist this data.');
  });
  const workoutFilters = { 'Cardio': 'all', 'Dance & Zumba': 'dance', 'Yoga': 'yoga', 'Strength training': 'strength', 'Pilates': 'mindful', 'Stretch & recovery': 'mindful' };
  $$('.workout-type').forEach(button => button.addEventListener('click', () => {
    const chip = $(`.filter-chip[data-filter="${workoutFilters[button.dataset.workout] || 'all'}"]`);
    if (chip) chip.click();
    $('#classes').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  // Admin operations rely on authenticated role + RLS. Never trust front-end role checks alone.
  $('#adminAddClass').addEventListener('click', () => {
    if (currentProfile?.role !== 'admin') { notify('Administrator access required.'); return; }
    $('#adminClassForm').reset(); adminClassModal.show();
  });
  $('#adminClassForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabase || currentProfile?.role !== 'admin') { notify('Administrator access required.'); return; }
    const payload = {
      name: $('#adminClassName').value.trim(),
      category: $('#adminCategory').value,
      duration_minutes: Number($('#adminDuration').value),
      trainer_name: $('#adminTrainer').value.trim(),
      capacity: Number($('#adminCapacity').value),
      description: $('#adminDescription').value.trim(),
      is_active: true
    };
    const submit = $('button[type="submit"]', event.currentTarget); submit.disabled = true;
    try {
      const { error } = await supabase.from('classes').insert(payload);
      if (error) throw error;
      adminClassModal.hide(); notify('Class created.');
      await loadClasses();
    } catch (error) { notify(error.message || 'Could not create class.'); }
    finally { submit.disabled = false; }
  });
  async function renderAdminClasses() {
    if (!supabase || currentProfile?.role !== 'admin') return;
    const { data, error } = await supabase.from('classes')
      .select('id,name,category,trainer_name,duration_minutes,capacity,is_active')
      .order('name');
    const rows = $('#adminClassRows');
    if (error) { rows.innerHTML = '<tr><td colspan="6">Could not load classes.</td></tr>'; return; }
    if (!data?.length) { rows.innerHTML = '<tr><td colspan="6">No classes yet.</td></tr>'; return; }
    rows.innerHTML = data.map(item => `<tr><td><strong>${safeText(item.name)}</strong><small>${item.is_active ? 'Active' : 'Hidden'}</small></td><td>${safeText(item.category)}</td><td>${safeText(item.trainer_name)}</td><td>${Number(item.duration_minutes)} min</td><td>${Number(item.capacity)}</td><td><button class="btn btn-sm ${item.is_active ? 'btn-outline-danger' : 'btn-outline-success'} admin-toggle-class" data-id="${safeText(item.id)}" data-active="${item.is_active}">${item.is_active ? 'Hide' : 'Publish'}</button></td></tr>`).join('');
    $$('.admin-toggle-class', rows).forEach(button => button.addEventListener('click', async () => {
      const { error: updateError } = await supabase.from('classes').update({ is_active: button.dataset.active !== 'true' }).eq('id', button.dataset.id);
      if (updateError) { notify(updateError.message); return; }
      notify('Class visibility updated.'); await loadClasses();
    }));
  }

  $('#notificationButton').addEventListener('click', () => notify(currentUser ? 'Your account and bookings are up to date.' : 'Log in to see your account updates.'));
  // Supabase auth state is the source of truth for the logged-in user.
  async function handleSession(session) {
    currentUser = session?.user || null;
    await loadProfile(currentUser);
    updateMemberUI();
    await loadClasses();
    await loadBookings();
    if (currentProfile?.role === 'admin') await renderAdminClasses();
  }
  if (supabase) {
    supabase.auth.onAuthStateChange((_event, session) => {
      // Defer database reads to avoid doing additional auth work inside the auth callback.
      setTimeout(() => handleSession(session), 0);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error(error);
      handleSession(data?.session || null);
    });
  } else {
    showSetupNotice();
    updateMemberUI();
    // Leave initial static cards in place until a Supabase project is configured.
    $('#bookingsLoading').textContent = 'Connect Supabase to save and sync real bookings.';
  }
})();
