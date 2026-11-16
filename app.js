(function () {
  'use strict';

  const LINK_KEY = 'fh:link';
  const BUDDY_KEY = 'fh:b';
  const SLOW_LOAD_MS = 15000;

  const app = document.getElementById('app');
  const $ = (selector) => document.querySelector(selector);

  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (e) {}
    },
  };

  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  let buddyId = window.APP_BUDDY;

  function escapeHtml(value) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return String(value).replace(/[&<>"]/g, (c) => entities[c]);
  }

  function iconUrl(id) {
    return 'icons/' + id + '-192.png';
  }

  function currentBuddy() {
    return BUDDIES.find((b) => b.id === buddyId);
  }

  // Accepts an Apps Script web app URL:
  //   https://script.google.com/macros/s/<id>/exec
  //   https://script.google.com/a/macros/<domain>/s/<id>/exec
  // Returns the normalized URL, or null if it isn't one.
  function parsePageLink(raw) {
    let url;
    try {
      url = new URL(String(raw || '').trim());
    } catch (e) {
      return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com') return null;

    const match = url.pathname.match(/^\/(?:a\/macros\/[^/]+|macros)\/s\/([\w-]{20,})\/(exec|dev)\/?$/);
    return match ? 'https://script.google.com' + url.pathname.replace(/\/$/, '') : null;
  }

  // Setup links look like ?b=fox#link=<page link>. The hash is never sent to a server.
  function readLinkFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const link = parsePageLink(params.get('link'));
    if (link) storage.set(LINK_KEY, link);

    // On iOS, home screen apps don't share storage with Safari. Leave the hash in place
    // so "Add to Home Screen" saves it and the installed app can set itself up.
    if (location.hash && !(isIos && !isStandalone)) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function selectBuddy(id) {
    buddyId = id;
    storage.set(BUDDY_KEY, id);
    history.replaceState(null, '', '?b=' + id);

    const buddy = currentBuddy();
    $('link[rel=manifest]').href = 'manifests/' + id + '.webmanifest';
    $('link[rel=apple-touch-icon]').href = 'icons/' + id + '-180.png';
    $('link[rel=icon]').href = iconUrl(id);
    document.title = buddy.name;
    $('#theme-color').content = buddy.themeColor;
  }

  // Setup screen

  function showSetup(message) {
    const savedLink = storage.get(LINK_KEY) || '';
    const choices = BUDDIES.filter((b) => b.listed || b.id === buddyId);
    const iconButtons = choices.map((b) => `
          <button type="button" data-b="${b.id}" aria-pressed="${b.id === buddyId}" aria-label="${escapeHtml(b.buddyName || b.shortName)}">
            <img src="${iconUrl(b.id)}" alt="">${escapeHtml(b.buddyName)}
          </button>`).join('');

    app.innerHTML = `
      <div class="screen">
        <div class="hero"><img id="hero" src="${iconUrl(buddyId)}" alt=""></div>
        <h1>Your fitness page, as an app</h1>
        <p class="muted intro">Opens full screen, one tap from your home screen.</p>

        <div class="card">
          <h2>1. Paste your page link</h2>
          <label for="link">The link you open your page with</label>
          <input id="link" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="https://script.google.com/macros/s/…/exec" value="${escapeHtml(savedLink)}">
          <div class="error" id="err">${message ? escapeHtml(message) : ''}</div>
          <details class="muted">
            <summary>Where do I find it?</summary>
            <ol>
              <li>Open your page the way you always do.</li>
              <li>Tap the address bar and copy the whole link.</li>
              <li>Or open 🛟 <b>App, reminder &amp; backups</b> at the bottom of your page and tap <b>Copy my page link</b>.</li>
            </ol>
            <p>It stays on this phone only. It is never sent anywhere else.</p>
          </details>
        </div>

        <div class="card">
          <h2>2. Pick your app icon</h2>
          <div class="grid" id="grid">${iconButtons}
          </div>
        </div>

        <div class="card">
          <h2>3. Open it</h2>
          <div class="row"><button id="go">Open my page</button></div>
          <div id="install-help" class="muted"></div>
        </div>

        <details class="card muted">
          <summary>Setting this up for someone else?</summary>
          <p>Paste their page link above, pick their icon, then tap below. It copies a link you can send them. Opening it sets up their app in one tap.</p>
          <div class="row"><button class="ghost" id="share" type="button">Copy their setup link</button></div>
          <div class="error note" id="share-message"></div>
        </details>
      </div>`;

    updateInstallHelp();

    $('#grid').addEventListener('click', (event) => {
      const button = event.target.closest('[data-b]');
      if (!button) return;
      selectBuddy(button.dataset.b);
      $('#hero').src = iconUrl(buddyId);
      document.querySelectorAll('#grid [data-b]').forEach((el) => {
        el.setAttribute('aria-pressed', el.dataset.b === buddyId);
      });
    });

    $('#go').addEventListener('click', () => {
      const link = parsePageLink($('#link').value);
      if (!link) {
        $('#err').textContent = 'That doesn’t look like a page link. It starts with https://script.google.com/ and ends with /exec.';
        $('#link').focus();
        return;
      }
      storage.set(LINK_KEY, link);
      openPage();
    });

    $('#share').addEventListener('click', async () => {
      const shareMessage = $('#share-message');
      const link = parsePageLink($('#link').value);
      if (!link) {
        shareMessage.textContent = 'Paste their page link first.';
        return;
      }
      const setupUrl = location.origin + location.pathname + '?b=' + buddyId + '#link=' + encodeURIComponent(link);
      try {
        await navigator.clipboard.writeText(setupUrl);
        shareMessage.textContent = 'Copied. Send it to them privately (a text, not a group chat).';
      } catch (e) {
        shareMessage.innerHTML = 'Copy this: <input type="text" readonly value="' + escapeHtml(setupUrl) + '" onclick="this.select()">';
      }
    });
  }

  // Install instructions

  let installPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    updateInstallHelp();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    updateInstallHelp();
  });

  function updateInstallHelp() {
    const box = $('#install-help');
    if (!box) return;

    if (isStandalone) {
      box.textContent = '';
    } else if (installPrompt) {
      box.innerHTML = '<button id="install" class="ghost" type="button">📲 Install the app</button>';
      $('#install').onclick = async () => {
        const prompt = installPrompt;
        installPrompt = null;
        prompt.prompt();
        try {
          await prompt.userChoice;
        } catch (e) {}
        updateInstallHelp();
      };
    } else if (isIos) {
      box.innerHTML = 'To keep it on your home screen: tap <b>Share</b> ⬆️ → <b>Add to Home Screen</b> → <b>Add</b>. ' +
        'If it asks for your link when you open it from there, paste it once more (iPhone keeps home-screen apps separate).';
    } else if (isAndroid) {
      box.innerHTML = 'To keep it on your home screen: tap <b>⋮</b> → <b>Install app</b> (or <b>Add to Home screen</b> → <b>Install</b>).';
    } else {
      box.textContent = 'On a computer, use the install icon at the right end of the address bar, or just bookmark this page.';
    }
  }

  // Page view

  let pageReady = false;
  let slowLoadTimer = null;

  // A tapped alarm notification opens the app with ?alarm=wind, so the page can jump to tonight's prep.
  function alarmParam() {
    const kind = new URLSearchParams(location.search).get('alarm');
    if (kind !== 'wind' && kind !== 'wake') return '';
    history.replaceState(null, '', location.pathname);
    return '&alarm=' + kind;
  }

  function openPage() {
    const link = storage.get(LINK_KEY);
    if (!link) return showSetup();
    if (!navigator.onLine) return showOffline();

    pageReady = false;
    app.innerHTML = `
      <div id="wait">
        <img src="${iconUrl(buddyId)}" alt="">
        <div class="muted">Opening your page…</div>
        <div id="help" class="card">
          <p><b>Taking a while?</b></p>
          <p class="muted">If your page never shows up here, its script may need the latest update, or the link changed. Ask whoever set up your page.</p>
          <div class="row">
            <button type="button" id="retry">Try again</button>
            <a class="btn ghost" href="${escapeHtml(link)}" target="_blank" rel="noopener">Open in browser</a>
          </div>
          <div class="row"><button type="button" class="ghost" id="change">Change my link</button></div>
        </div>
      </div>
      <iframe id="frame" title="My fitness page" src="${escapeHtml(link)}?app=1${alarmParam()}" allow="clipboard-write; fullscreen; autoplay; vibrate"></iframe>`;

    $('#retry').onclick = openPage;
    $('#change').onclick = () => showSetup();

    clearTimeout(slowLoadTimer);
    slowLoadTimer = setTimeout(() => {
      if (!pageReady) $('#help').classList.add('on');
    }, SLOW_LOAD_MS);
  }

  function showOffline() {
    app.innerHTML = `
      <div class="screen">
        <div class="hero"><img src="${iconUrl(buddyId)}" alt=""></div>
        <h1>You’re offline</h1>
        <p class="muted center">Your page lives online. Connect to Wi-Fi or data, then try again.</p>
        <div class="row narrow"><button type="button" id="retry">Try again</button></div>
      </div>`;
    $('#retry').onclick = openPage;
  }

  function hidePageLoader(barColor) {
    pageReady = true;
    clearTimeout(slowLoadTimer);

    const wait = $('#wait');
    if (wait) {
      wait.style.opacity = 0;
      setTimeout(() => wait.remove(), 260);
    }
    if (/^#[0-9a-f]{3,8}$/i.test(barColor || '')) $('#theme-color').content = barColor;
  }

  window.addEventListener('online', () => {
    if (!$('#frame')) openPage();
  });

  function isTrustedOrigin(origin) {
    let host = '';
    try {
      host = new URL(origin).hostname;
    } catch (e) {}
    return /(^|\.)googleusercontent\.com$/.test(host) || host === 'script.google.com';
  }

  // Messages from the page (only sent when it is opened with ?app=1).
  window.addEventListener('message', (event) => {
    if (!isTrustedOrigin(event.origin)) return;
    const data = event.data || {};
    if (typeof data !== 'object' || !data.fitnessHub) return;

    switch (data.fitnessHub) {
      case 'ready':
        hidePageLoader(data.bar);
        // Tell the page where the app lives, so its browser version can link straight here.
        event.source.postMessage({ fitnessHub: 'app-info', url: location.origin + location.pathname }, event.origin);
        break;
      case 'setup':
        showSetup();
        break;
      case 'hr':
        heartRate.handleMessage(data, event);
        break;
      case 'push-check':
        alarmNotifications.check(event);
        break;
      case 'push-on':
        alarmNotifications.ask(data, event);
        break;
    }
  });

  // Bluetooth heart rate. The page runs in a Google iframe that isn't allowed to use
  // Web Bluetooth, so the app connects to the sensor and forwards readings to it.
  const heartRate = (function () {
    const MAX_RETRIES = 6;
    const RETRY_DELAY_MS = 1500;

    let pageWindow = null;
    let pageOrigin = '*';
    let connection = null;
    let state = '';
    let deviceName = '';
    let wakeLock = null;

    function notifyPage(message) {
      if (!pageWindow) return;
      try {
        pageWindow.postMessage(Object.assign({ fitnessHub: 'hr-app' }, message), pageOrigin);
      } catch (e) {}
    }

    function setState(next, name, error) {
      state = next;
      if (name) deviceName = name;
      notifyPage({ state, name: deviceName, err: error });
      keepScreenOn(next === 'on' || next === 'lost' || next === 'connecting');
    }

    function handleMessage(data, event) {
      pageWindow = event.source;
      pageOrigin = event.origin;

      if (data.do === 'hello') {
        const hasBluetooth = !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
        notifyPage({ caps: true, ble: hasBluetooth, state, name: deviceName });
      }
      if (data.do === 'connect') connect();
      if (data.do === 'stop') {
        closePrompt();
        if (connection) {
          connection.stop();
          connection = null;
        }
        state = '';
        keepScreenOn(false);
      }
    }

    function connect() {
      if (!navigator.bluetooth) {
        return setState('error', '', 'This browser has no Bluetooth. Use Chrome on Android.');
      }

      let request;
      try {
        request = navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      } catch (e) {
        request = Promise.reject(e);
      }

      request.then((device) => {
        closePrompt();
        if (connection) connection.stop();
        connection = watchDevice(device);
      }, (error) => {
        if (error && error.name === 'NotFoundError') {
          closePrompt();
          return setState('cancel');
        }
        // The tap happened inside the iframe. Some browsers need a tap in the app itself.
        const needsGesture = error && (error.name === 'SecurityError' || /gesture|activation/i.test(error.message));
        if (needsGesture && !$('#hrask')) return showPrompt();

        closePrompt();
        setState('error', '', (error && error.message) || 'Bluetooth didn’t connect');
      });
    }

    function showPrompt() {
      const sheet = document.createElement('div');
      sheet.id = 'hrask';
      sheet.setAttribute('role', 'dialog');
      sheet.innerHTML = `
        <p><b>❤️ Connect your heart rate strap</b></p>
        <p class="muted">Put it on, then tap Connect and pick it from the list.</p>
        <div class="row">
          <button type="button" id="hrgo">Connect</button>
          <button type="button" class="ghost" id="hrno">Not now</button>
        </div>`;
      document.body.appendChild(sheet);

      $('#hrgo').onclick = connect;
      $('#hrno').onclick = () => {
        closePrompt();
        setState('cancel');
      };
    }

    function closePrompt() {
      const sheet = $('#hrask');
      if (sheet) sheet.remove();
    }

    // Heart Rate Measurement (0x2A37): bit 0 of the flags byte says whether the
    // value is uint8 or uint16.
    function readBpm(value) {
      const flags = value.getUint8(0);
      return (flags & 1) && value.byteLength > 2 ? value.getUint16(1, true) : value.getUint8(1);
    }

    function watchDevice(device) {
      let stopped = false;
      let retries = 0;
      let characteristic = null;

      const onValue = (event) => {
        const value = event.target.value;
        if (!value || value.byteLength < 2) return;
        const bpm = readBpm(value);
        if (bpm > 0) {
          if (state !== 'on') setState('on', device.name);
          notifyPage({ bpm });
        }
      };

      async function start() {
        setState('connecting', device.name);
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService('heart_rate');
        characteristic = await service.getCharacteristic('heart_rate_measurement');
        characteristic.addEventListener('characteristicvaluechanged', onValue);
        await characteristic.startNotifications();
        retries = 0;
        setState('on', device.name);
      }

      function reconnect() {
        if (stopped) return;
        if (retries++ >= MAX_RETRIES) return setState('off');
        setState('lost');
        setTimeout(() => start().catch(reconnect), RETRY_DELAY_MS * retries);
      }

      device.addEventListener('gattserverdisconnected', reconnect);
      start().catch(reconnect);

      return {
        stop() {
          stopped = true;
          try {
            if (characteristic) characteristic.removeEventListener('characteristicvaluechanged', onValue);
          } catch (e) {}
          try {
            if (device.gatt.connected) device.gatt.disconnect();
          } catch (e) {}
        },
      };
    }

    // Android pauses Bluetooth for the page when the screen turns off.
    async function keepScreenOn(on) {
      try {
        if (on && !wakeLock && navigator.wakeLock) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLock.addEventListener('release', () => {
            wakeLock = null;
          });
        }
        if (!on && wakeLock) {
          const lock = wakeLock;
          wakeLock = null;
          lock.release();
        }
      } catch (e) {}
    }

    // Wake locks are released when the page is hidden, so take it again on return.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && connection && state !== 'off' && state !== '') keepScreenOn(true);
    });

    return { handleMessage };
  })();

  // Alarm notifications (web push). Only the app itself can ask for notification
  // permission, so the page sends its public key here and gets the subscription back.
  // Pushes carry no data: the service worker asks the page's alarm link what to show.
  const alarmNotifications = (function () {
    let pageWindow = null;
    let pageOrigin = '*';
    let pending = null;

    function reply(message) {
      if (!pageWindow) return;
      try {
        pageWindow.postMessage(Object.assign({ fitnessHub: 'push-app' }, message), pageOrigin);
      } catch (e) {}
    }

    function remember(event) {
      pageWindow = event.source;
      pageOrigin = event.origin;
    }

    function isSupported() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
      // iPhones only allow notifications for apps added to the home screen.
      return !isIos || isStandalone;
    }

    function deviceName() {
      if (isIos) return 'iPhone';
      if (isAndroid) return 'Android phone';
      return 'This device';
    }

    function keyToBytes(base64url) {
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
      return Uint8Array.from(raw, (c) => c.charCodeAt(0));
    }

    // The service worker can't read localStorage, so the alarm link is kept in the cache.
    function saveFeed(feed) {
      if (!feed || !('caches' in window)) return Promise.resolve();
      return caches.open('fitness-push').then((cache) => cache.put('./push-config', new Response(JSON.stringify({ feed, buddy: buddyId }))));
    }

    async function check(event) {
      remember(event);
      if (!isSupported()) return reply({ state: 'unsupported' });
      if (Notification.permission === 'denied') return reply({ state: 'denied' });
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        reply({ state: subscription && Notification.permission === 'granted' ? 'on' : 'off' });
      } catch (e) {
        reply({ state: 'off' });
      }
    }

    function ask(data, event) {
      remember(event);
      if (!isSupported()) return reply({ state: 'unsupported' });
      if (typeof data.key !== 'string') return;
      pending = data;
      showPrompt();
    }

    async function turnOn() {
      const data = pending;
      closePrompt();
      if (!data) return;
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return reply({ state: permission === 'denied' ? 'denied' : 'off' });

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyToBytes(data.key),
          });
        }
        await saveFeed(data.feed);
        reply({ state: 'on', sub: subscription.toJSON(), name: deviceName() });
      } catch (e) {
        reply({ state: 'error', msg: (e && e.message) || 'Notifications didn’t turn on' });
      }
    }

    function showPrompt() {
      if ($('#pushask')) return;
      const sheet = document.createElement('div');
      sheet.id = 'pushask';
      sheet.setAttribute('role', 'dialog');
      sheet.innerHTML = `
        <p><b>🔔 Alarm notifications</b></p>
        <p class="muted">Get your get-ready alarm and wind-down reminder on this phone. Tap Allow, then Allow again when your phone asks.</p>
        <div class="row">
          <button type="button" id="pushgo">Allow</button>
          <button type="button" class="ghost" id="pushno">Not now</button>
        </div>`;
      document.body.appendChild(sheet);

      $('#pushgo').onclick = turnOn;
      $('#pushno').onclick = () => {
        closePrompt();
        reply({ state: 'off' });
      };
    }

    function closePrompt() {
      const sheet = $('#pushask');
      if (sheet) sheet.remove();
    }

    return { check, ask };
  })();

  readLinkFromHash();
  storage.set(BUDDY_KEY, buddyId);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  if (new URLSearchParams(location.search).has('setup')) showSetup();
  else openPage();
})();
